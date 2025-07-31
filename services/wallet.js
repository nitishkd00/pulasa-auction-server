const User = require('../models/User');
const WalletTransaction = require('../models/WalletTransaction');
const Auction = require('../models/Auction');
const Bid = require('../models/Bid');
const { createOrder, verifyPaymentSignature, processRefund, isAvailable } = require('./razorpay');

class WalletService {
  // Get user wallet balance
  async getUserWallet(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }
      return {
        available_balance: user.wallet_balance - user.locked_amount,
        total_balance: user.wallet_balance,
        locked_amount: user.locked_amount
      };
    } catch (error) {
      console.error('Get user wallet error:', error);
      throw error;
    }
  }

  // Create wallet top-up order
  async createTopupOrder(userId, amount) {
    try {
      if (!isAvailable()) {
        throw new Error('Payment service is not configured');
      }
      if (amount < 100) {
        throw new Error('Minimum top-up amount is ₹100');
      }
      if (amount > 100000) {
        throw new Error('Maximum top-up amount is ₹1,00,000');
      }
      // Create Razorpay order
      const order = await createOrder(amount, `topup_${userId}_${Date.now()}`, {
        user_id: userId.toString(),
        type: 'wallet_topup'
      });
      // Store transaction record
      const transaction = await WalletTransaction.create({
        user: userId,
        type: 'topup',
        amount: amount,
        balance_before: 0,
        balance_after: 0,
        razorpay_order_id: order.id,
        status: 'pending',
        description: `Wallet top-up of ₹${amount}`
      });
      return {
        order_id: order.id,
        amount: amount,
        transaction_id: transaction._id
      };
    } catch (error) {
      console.error('Create topup order error:', error);
      throw error;
    }
  }

  // Process successful top-up payment
  async processTopupPayment(userId, orderId, paymentId, signature) {
    try {
      if (!isAvailable()) {
        throw new Error('Payment service is not configured');
      }

      // Verify payment signature
      if (!verifyPaymentSignature(orderId, paymentId, signature)) {
        throw new Error('Invalid payment signature');
      }

      // Get transaction details
      const transaction = await WalletTransaction.findOne({ razorpay_order_id: orderId, user: userId, type: 'topup', status: 'pending' });

      if (!transaction) {
        throw new Error('Transaction not found or already processed');
      }

      // Update user wallet balance
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const currentBalance = user.wallet_balance;
      const newBalance = currentBalance + transaction.amount;

      // Update user balance
      await User.findByIdAndUpdate(userId, { wallet_balance: newBalance });

      // Update transaction status
      await WalletTransaction.findByIdAndUpdate(transaction._id, {
        status: 'success',
        razorpay_payment_id: paymentId,
        balance_before: currentBalance,
        balance_after: newBalance
      });

      return {
        success: true,
        new_balance: newBalance,
        added_amount: transaction.amount
      };
    } catch (error) {
      console.error('Process topup payment error:', error);
      throw error;
    }
  }

  // Place bid using wallet balance
  async placeBid(userId, auctionId, bidAmount) {
    try {
      // Get user wallet
      const wallet = await this.getUserWallet(userId);
      if (wallet.available_balance < bidAmount) {
        throw new Error(`Insufficient wallet balance. Available: ₹${wallet.available_balance}, Required: ₹${bidAmount}`);
      }
      // Get auction details
      const auction = await Auction.findById(auctionId);
      if (!auction) {
        throw new Error('Auction not found');
      }
      // Prevent auction creator and admins from bidding
      const user = await User.findById(userId);
      if (auction.created_by && auction.created_by.toString() === userId.toString()) {
        throw new Error('You cannot bid on your own auction.');
      }
      if (user.is_admin) {
        throw new Error('Admins are not allowed to place bids.');
      }
      const now = new Date();
      if (now < auction.start_time) {
        throw new Error('Auction has not started yet');
      }
      if (now > auction.end_time || auction.status === 'ended') {
        throw new Error('Auction has ended');
      }
      if (bidAmount <= auction.highest_bid) {
        throw new Error(`Bid must be higher than current highest bid: ₹${auction.highest_bid}`);
      }
      // Lock the bid amount (increase locked_amount)
      const currentLocked = user.locked_amount;
      const newLocked = currentLocked + bidAmount;
      user.locked_amount = newLocked;
      await user.save();
      // Create bid record
      const bid = await Bid.create({
        auction: auction._id,
        bidder: userId,
        amount: bidAmount,
        status: 'success', // Ensure wallet bids are visible in frontend
      });
      // Record wallet transaction
      await WalletTransaction.create({
        user: userId,
        type: 'bid',
        amount: bidAmount,
        balance_before: user.wallet_balance,
        balance_after: user.wallet_balance,
        locked_before: currentLocked,
        locked_after: newLocked,
        auction: auction._id,
        bid: bid._id,
        status: 'success',
        description: `Bid placed: ₹${bidAmount}`
      });
      // Handle previous highest bidder refund (if needed)
      // (Implement logic if you store previous highest bidder info)
      // Update auction with new highest bid
      auction.highest_bid = bidAmount;
      auction.highest_bidder = userId;
      await auction.save();
      // Log auction event
      await require('../models/AuctionEvent').create({
        auction: auction._id,
        event_type: 'bid_placed',
        user: userId,
        amount: bidAmount,
        description: `New highest bid: ₹${bidAmount}`
      });
      return {
        success: true,
        bid_id: bid._id,
        new_highest_bid: bidAmount,
        locked_amount: newLocked
      };
    } catch (error) {
      console.error('Place bid error:', error);
      throw error;
    }
  }

  // Refund outbid user (internal refund)
  async refundOutbidUser(userId, amount, auctionId) {
    try {
      const user = await User.findById(userId);
      if (!user) return;
      const currentLocked = user.locked_amount;
      const newLocked = Math.max(0, currentLocked - amount);
      user.locked_amount = newLocked;
      await user.save();
      // Record wallet transaction
      await WalletTransaction.create({
        user: userId,
        type: 'unlock',
        amount: amount,
        balance_before: user.wallet_balance,
        balance_after: user.wallet_balance,
        locked_before: currentLocked,
        locked_after: newLocked,
        auction: auctionId,
        status: 'success',
        description: `Bid outbid, amount unlocked: ₹${amount}`
      });
      // Update bid status to outbid
      await Bid.updateMany({ auction: auctionId, bidder: userId, status: 'active' }, { status: 'outbid' });
      // Log auction event
      await require('../models/AuctionEvent').create({
        auction: auctionId,
        event_type: 'bid_outbid',
        user: userId,
        amount: amount,
        description: `User outbid, amount unlocked: ₹${amount}`
      });
    } catch (error) {
      console.error('Refund outbid user error:', error);
      throw error;
    }
  }

  // Withdraw wallet balance to bank
  async withdrawWallet(userId, amount) {
    try {
      if (!isAvailable()) {
        throw new Error('Payment service is not configured');
      }

      // Get user wallet
      const wallet = await this.getUserWallet(userId);
      
      if (wallet.available_balance < amount) {
        throw new Error(`Insufficient available balance. Available: ₹${wallet.available_balance}, Requested: ₹${amount}`);
      }

      if (amount < 100) {
        throw new Error('Minimum withdrawal amount is ₹100');
      }

      // Get user's payment history for refund
      const transactions = await WalletTransaction.find({ user: userId, type: 'topup', status: 'success' }).sort({ created_at: 1 });

      if (transactions.length === 0) {
        throw new Error('No payment history found for withdrawal');
      }

      // Find the oldest payment that can cover the withdrawal
      let remainingAmount = amount;
      const refunds = [];

      for (const transaction of transactions) {
        if (remainingAmount <= 0) break;

        const refundAmount = Math.min(remainingAmount, parseFloat(transaction.amount));
        
        try {
          // Process refund through Razorpay
          const refund = await processRefund(transaction.razorpay_payment_id, refundAmount, 'Wallet withdrawal');
          
          refunds.push({
            payment_id: transaction.razorpay_payment_id,
            refund_id: refund.id,
            amount: refundAmount
          });

          remainingAmount -= refundAmount;
        } catch (error) {
          console.error(`Refund failed for payment ${transaction.razorpay_payment_id}:`, error);
          // Continue with next transaction
        }
      }

      if (remainingAmount > 0) {
        throw new Error(`Could not process full withdrawal. Remaining: ₹${remainingAmount}`);
      }

      // Update user wallet balance
      const user = await User.findById(userId);
      const currentBalance = user.wallet_balance;
      const newBalance = currentBalance - amount;

      await User.findByIdAndUpdate(userId, { wallet_balance: newBalance });

      // Record withdrawal transaction
      await WalletTransaction.create({
        user: userId,
        type: 'withdrawal',
        amount: amount,
        balance_before: currentBalance,
        balance_after: newBalance,
        razorpay_refund_id: refunds[0]?.refund_id,
        status: 'success',
        description: `Wallet withdrawal: ₹${amount}`
      });

      return {
        success: true,
        withdrawn_amount: amount,
        new_balance: newBalance,
        refunds: refunds
      };

    } catch (error) {
      console.error('Withdraw wallet error:', error);
      throw error;
    }
  }

  // Get user transaction history
  async getTransactionHistory(userId, page = 1, limit = 10) {
    try {
      const offset = (page - 1) * limit;

      const transactions = await WalletTransaction.find({ user: userId }).sort({ created_at: -1 }).skip(offset).limit(limit);

      // Get total count
      const total = await WalletTransaction.countDocuments({ user: userId });

      return {
        transactions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      console.error('Get transaction history error:', error);
      throw error;
    }
  }
}

const walletService = new WalletService();

module.exports = WalletService; 