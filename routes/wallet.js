const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const WalletService = require('../services/wallet');

const router = express.Router();
const walletService = new WalletService();

// Get user wallet balance
router.get('/balance', authenticateToken, async (req, res) => {
  try {
    const wallet = await walletService.getUserWallet(req.user._id);
    res.json({
      success: true,
      wallet: wallet
    });
  } catch (error) {
    console.error('Get wallet balance error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Create wallet top-up order
router.post('/topup/create-order', authenticateToken, [
  body('amount').isFloat({ min: 100, max: 100000 }).withMessage('Amount must be between ₹100 and ₹1,00,000')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const { amount } = req.body;
    const result = await walletService.createTopupOrder(req.user._id, amount);

    res.json({
      success: true,
      order_id: result.order_id,
      amount: result.amount,
      transaction_id: result.transaction_id
    });

  } catch (error) {
    console.error('Create topup order error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Verify top-up payment and add to wallet
router.post('/topup/verify-payment', authenticateToken, [
  body('razorpay_payment_id').notEmpty().withMessage('Payment ID is required'),
  body('razorpay_order_id').notEmpty().withMessage('Order ID is required'),
  body('razorpay_signature').notEmpty().withMessage('Signature is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
    
    const result = await walletService.processTopupPayment(
      req.user._id, 
      razorpay_order_id, 
      razorpay_payment_id, 
      razorpay_signature
    );

    res.json({
      success: true,
      message: 'Wallet topped up successfully',
      new_balance: result.new_balance,
      added_amount: result.added_amount
    });

  } catch (error) {
    console.error('Verify topup payment error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Place bid using wallet
router.post('/bid', authenticateToken, [
  body('auction_id').matches(/^[a-fA-F0-9]{24}$/).withMessage('Valid auction ID is required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Valid bid amount is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const { auction_id, amount } = req.body;
    const result = await walletService.placeBid(req.user._id, auction_id, amount);

    // Emit real-time update via Socket.IO
    const io = req.app.get('io');
    io.to(`auction_${auction_id}`).emit('newBid', {
      auction_id: auction_id,
      bidder: req.user.username,
      amount: amount,
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Bid placed successfully',
      bid_id: result.bid_id,
      new_highest_bid: result.new_highest_bid,
      locked_amount: result.locked_amount
    });

  } catch (error) {
    console.error('Place bid error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Withdraw wallet balance
router.post('/withdraw', authenticateToken, [
  body('amount').isFloat({ min: 100 }).withMessage('Minimum withdrawal amount is ₹100')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const { amount } = req.body;
    const result = await walletService.withdrawWallet(req.user._id, amount);

    res.json({
      success: true,
      message: 'Withdrawal initiated successfully',
      withdrawn_amount: result.withdrawn_amount,
      new_balance: result.new_balance,
      refunds: result.refunds
    });

  } catch (error) {
    console.error('Withdraw wallet error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get transaction history
router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const result = await walletService.getTransactionHistory(req.user._id, page, limit);

    res.json({
      success: true,
      transactions: result.transactions,
      pagination: result.pagination
    });

  } catch (error) {
    console.error('Get transaction history error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get user's active bids
router.get('/active-bids', authenticateToken, async (req, res) => {
  try {
    const activeBids = await require('../models/Bid').find({
      bidder: req.user._id,
      status: 'active'
    }).populate('auction');
    res.json({
      success: true,
      active_bids: activeBids
    });
  } catch (error) {
    console.error('Get active bids error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get user's won auctions
router.get('/won-auctions', authenticateToken, async (req, res) => {
  try {
    const wonBids = await require('../models/Bid').find({
      bidder: req.user._id,
      status: 'won'
    }).populate('auction');
    const wonAuctions = wonBids.map(bid => ({
      ...bid.auction.toObject(),
      winning_bid: bid.amount
    }));
    res.json({
      success: true,
      won_auctions: wonAuctions
    });
  } catch (error) {
    console.error('Get won auctions error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

module.exports = router; 