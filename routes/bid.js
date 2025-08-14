const express = require('express');
const { body, validationResult, param } = require('express-validator');
const { authenticateToken, optionalAuth, requireAdmin } = require('../middleware/auth');
const paymentService = require('../services/paymentService');
const Auction = require('../models/Auction');
const Bid = require('../models/Bid');
const AuctionEvent = require('../models/AuctionEvent');
const User = require('../models/User');
const mongoose = require('mongoose');

const router = express.Router();

// Calculate transaction fee based on bid amount
const calculateTransactionFee = (amount) => {
  if (amount <= 1000) {
    return 7.99;
  } else if (amount <= 25000) {
    return 11.99;
  } else {
    return 14.99;
  }
};

// Create bid order for authorization
router.post('/place', authenticateToken, [
  body('auction_id').custom((value) => {
    if (!mongoose.Types.ObjectId.isValid(value)) {
      throw new Error('Invalid auction ID format');
    }
    return true;
  }).withMessage('Valid auction ID is required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Valid bid amount is required'),
  body('location').optional().isString().withMessage('Location must be a string')
], async (req, res) => {
  console.log('🚨 DEBUG: /place route called!');
  console.log('🚨 DEBUG: Request body:', req.body);
  console.log('🚨 DEBUG: User:', req.user);
  
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { auction_id, amount, location } = req.body;
    const userId = req.user.id;
    
    console.log('🚀 Bid placement request:', { auction_id, amount, location, userId });
    
    // Validate auction exists and is active
    const auction = await Auction.findById(auction_id);
    if (!auction) {
      return res.status(404).json({ error: 'Auction not found' });
    }

    const now = new Date();
    if (now < auction.start_time) {
      return res.status(400).json({ error: 'Auction has not started yet' });
    }
    if (now > auction.end_time || auction.status === 'ended') {
      return res.status(400).json({ error: 'Auction has ended' });
    }

    // Validate bid amount
    if (amount <= auction.highest_bid) {
      return res.status(400).json({ 
        error: `Bid amount must be higher than current highest bid: ₹${auction.highest_bid}` 
      });
    }

    // Check if user already has an active bid on this auction
    const existingBid = await Bid.findOne({
      auction: auction_id,
      bidder: userId,
      status: 'active',
      payment_status: { $in: ['authorized', 'captured'] }
    });

    if (existingBid) {
      return res.status(400).json({ 
        error: 'You already have an active bid on this auction. Please wait for it to be processed.' 
      });
    }

    // Calculate transaction fee and total amount
    const transactionFee = calculateTransactionFee(amount);
    const totalAmount = amount + transactionFee;
    
    console.log('💰 Fee calculation:', {
      bidAmount: amount,
      transactionFee: transactionFee,
      totalAmount: totalAmount
    });
    
    // Create Razorpay order for authorization (total amount including fee)
    console.log('🔑 Creating Razorpay order for total amount:', totalAmount);
    console.log('🔑 User ID:', userId);
    console.log('🔑 Auction ID:', auction_id);
    console.log('🔑 Location:', location);
    
    const orderResult = await paymentService.createBidOrder(totalAmount);
    console.log('🔑 PaymentService response:', orderResult);
    
    if (!orderResult.success) {
      console.error('❌ PaymentService failed:', orderResult.error);
      return res.status(500).json({ error: orderResult.error || 'Failed to create payment order' });
    }

    // Store the order details temporarily (you might want to use Redis or similar for production)
    // For now, we'll store it in the order notes
    const orderWithAuctionInfo = {
      ...orderResult.razorpay_order,
      auction_id: auction_id,
      user_id: userId,
      amount: amount,
      location: location
    };

    // Return order details to frontend - DO NOT create bid yet
    // Bid will be created only after payment success in /verify route
    console.log('✅ Razorpay order created, returning to frontend for payment');
    console.log('📤 Response data:', {
      success: true,
      message: 'Razorpay order created successfully. Please complete payment.',
      razorpay_order: {
        id: orderResult.razorpay_order.id,
        amount: orderResult.razorpay_order.amount,
        currency: orderResult.razorpay_order.currency
      },
      auction_info: {
        id: auction_id,
        amount: amount,
        location: location
      },
      fee_info: {
        bid_amount: amount,
        transaction_fee: transactionFee,
        total_amount: totalAmount
      }
    });
    
    res.json({
      success: true,
      message: 'Razorpay order created successfully. Please complete payment.',
      razorpay_order: {
        id: orderResult.razorpay_order.id,
        amount: orderResult.razorpay_order.amount,
        currency: orderResult.razorpay_order.currency
      },
      auction_info: {
        id: auction_id,
        amount: amount,
        location: location
      },
      fee_info: {
        bid_amount: amount,
        transaction_fee: transactionFee,
        total_amount: totalAmount
      }
    });

  } catch (error) {
    console.error('❌ Bid placement error:', error);
    console.error('❌ Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    res.status(500).json({ 
      error: 'Failed to place bid. Please try again.',
      debug: {
        message: error.message,
        name: error.name
      }
    });
  }
});

// Verify payment and complete bid
router.post('/verify', authenticateToken, [
  body('payment_id').isString().withMessage('Payment ID is required'),
  body('order_id').isString().withMessage('Order ID is required'),
  body('signature').isString().withMessage('Signature is required'),
  body('auction_id').isString().withMessage('Auction ID is required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Valid bid amount is required'),
  body('location').optional().isString().withMessage('Location must be a string'),
  body('transaction_fee').isFloat({ min: 0 }).withMessage('Valid transaction fee is required'),
  body('total_amount').isFloat({ min: 0.01 }).withMessage('Valid total amount is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { payment_id, order_id, signature, auction_id, amount, location, transaction_fee, total_amount } = req.body;
    const userId = req.user.id;

    console.log('🔍 Payment verification request:', { payment_id, order_id, signature, auction_id, amount, userId });

    // Verify payment signature
    const verificationResult = await paymentService.verifyPaymentAuthorization(
      payment_id, order_id, signature
    );

    console.log('🔍 Payment verification result:', verificationResult);

    if (!verificationResult.success || !verificationResult.verified) {
      console.error('❌ Payment signature verification failed:', verificationResult.error || 'Unknown error');
      return res.status(400).json({ 
        error: 'Payment verification failed',
        details: verificationResult.error || 'Signature verification failed'
      });
    }

    console.log('✅ Payment signature verified, proceeding with bid creation');

    // Find the auction
    const auction = await Auction.findById(auction_id);
    if (!auction) {
      console.error('❌ Auction not found:', auction_id);
      return res.status(404).json({ error: 'Auction not found' });
    }

    // Validate auction status
    const now = new Date();
    if (now < auction.start_time) {
      return res.status(400).json({ error: 'Auction has not started yet' });
    }
    if (now > auction.end_time || auction.status === 'ended') {
      return res.status(400).json({ error: 'Auction has ended' });
    }

    // Validate bid amount
    if (amount <= auction.highest_bid) {
      return res.status(400).json({ 
        error: `Bid amount must be higher than current highest bid: ₹${auction.highest_bid}` 
      });
    }

    // Handle outbid refund if there's a current highest bidder
    if (auction.highest_bidder && auction.highest_bid > 0 && auction.highest_bidder.toString() !== userId) {
      console.log(`🔄 Outbid detected: Current highest bid ₹${auction.highest_bid} by user ${auction.highest_bidder}, new bid ₹${amount} by user ${userId}`);
      
      try {
        const currentHighestBid = await Bid.findOne({
          auction: auction._id,
          bidder: auction.highest_bidder,
          status: 'active',
          payment_status: 'authorized'
        });

        console.log(`🔍 Found current highest bid:`, {
          bidId: currentHighestBid?._id,
          bidder: currentHighestBid?.bidder,
          amount: currentHighestBid?.amount,
          paymentId: currentHighestBid?.razorpay_payment_id,
          status: currentHighestBid?.status,
          paymentStatus: currentHighestBid?.payment_status
        });

        if (currentHighestBid && currentHighestBid.razorpay_payment_id) {
          console.log(`💰 Processing outbid refund for user ${currentHighestBid.bidder} on auction ${auction._id}`);
          
          // Refund the previous highest bidder
          console.log(`💳 Attempting refund for payment ID: ${currentHighestBid.razorpay_payment_id}, amount: ₹${currentHighestBid.amount}`);
          
          const refundResult = await paymentService.refundPayment(
            currentHighestBid.razorpay_payment_id,
            currentHighestBid.amount,
            'Outbid by another user'
          );

          console.log(`💰 Refund result:`, refundResult);

          // Update previous bid status
          currentHighestBid.status = 'outbid';
          currentHighestBid.payment_status = 'refunded';
          currentHighestBid.refund_details = {
            refund_id: refundResult.refund_id,
            refunded_amount: refundResult.refunded_amount,
            refund_reason: 'Outbid by another user',
            refunded_at: new Date()
          };
          
                     console.log(`💾 Updating bid status to outbid and refunded`);
           await currentHighestBid.save();
           console.log(`✅ Bid status updated successfully`);
           
           // Update auction total bids count after refund
           const updatedTotalBidsCount = await Bid.countDocuments({ 
             auction: auction._id,
             status: { $in: ['active', 'authorized'] }
           });
           auction.total_bids = updatedTotalBidsCount;
           await auction.save();
           console.log(`🔢 Updated auction total bids count to: ${updatedTotalBidsCount}`);

          // Create outbid event for notifications
          await AuctionEvent.create({
            auction: auction._id,
            event_type: 'bid_outbid',
            user: currentHighestBid.bidder,
            details: {
              previous_amount: currentHighestBid.amount,
              new_amount: amount,
              outbid_by: userId,
              refund_id: refundResult.refund_id,
              refunded_amount: refundResult.refunded_amount
            }
          });

          console.log(`✅ Refunded bid for user ${currentHighestBid.bidder} on auction ${auction._id}`);

          // Emit outbid notification to the previous highest bidder
          const io = req.app.get('io');
          if (io) {
            io.to(`user_${currentHighestBid.bidder}`).emit('outbid', {
              type: 'outbid',
              auction_id: auction._id.toString(),
              auction_name: auction.item_name,
              previous_amount: currentHighestBid.amount,
              new_amount: amount,
              refund_id: refundResult.refund_id,
              refunded_amount: refundResult.refunded_amount,
              message: `You've been outbid on "${auction.item_name}"! Your refund of ₹${refundResult.refunded_amount} has been processed.`,
              timestamp: new Date().toISOString()
            });
          }
        }
      } catch (refundError) {
        console.error('❌ Failed to refund previous bid:', refundError);
        
        // Create refund failure event
        await AuctionEvent.create({
          auction: auction._id,
          event_type: 'refund_failed',
          user: auction.highest_bidder,
          details: {
            error: refundError.message,
            bid_id: currentHighestBid?._id,
            amount: currentHighestBid?.amount
          }
        });
        
        // Continue with new bid even if refund fails
      }
    }

    // Check if user already has a bid on this auction
    const existingUserBid = await Bid.findOne({
      auction: auction._id,
      bidder: userId,
      status: { $in: ['active', 'authorized'] }
    });

    let finalBidId;

    if (existingUserBid) {
      console.log(`⚠️ User ${userId} already has an existing bid on auction ${auction._id}:`, {
        bidId: existingUserBid._id,
        amount: existingUserBid.amount,
        status: existingUserBid.status,
        paymentStatus: existingUserBid.payment_status
      });
      
      // Update existing bid instead of creating new one
      existingUserBid.amount = amount;
      existingUserBid.location = location || '';
      existingUserBid.razorpay_order_id = order_id;
      existingUserBid.razorpay_payment_id = payment_id;
      existingUserBid.authorized_amount = amount;
      existingUserBid.transaction_fee = transaction_fee;
      existingUserBid.total_amount = total_amount;
      existingUserBid.payment_status = 'authorized';
      existingUserBid.status = 'active';
      existingUserBid.updated_at = new Date();
      
             console.log(`🔄 Updating existing bid instead of creating new one`);
       await existingUserBid.save();
       console.log(`✅ Existing bid updated successfully`);
       finalBidId = existingUserBid._id;
       
       // Update auction total bids count after updating existing bid
       const updatedTotalBidsCount = await Bid.countDocuments({ 
         auction: auction._id,
         status: { $in: ['active', 'authorized'] }
       });
       auction.total_bids = updatedTotalBidsCount;
       await auction.save();
       console.log(`🔢 Updated auction total bids count to: ${updatedTotalBidsCount}`);
    } else {
      // Create new bid record
      console.log(`🆕 Creating new bid record for user ${userId}`);
      const newBid = new Bid({
        auction: auction._id,
        bidder: userId,
        amount: amount,
        location: location || '',
        razorpay_order_id: order_id,
        razorpay_payment_id: payment_id,
        authorized_amount: amount,
        transaction_fee: transaction_fee,
        total_amount: total_amount,
        payment_status: 'authorized', // Keep as authorized until auction ends
        status: 'active'
      });

      await newBid.save();
      console.log(`✅ New bid created successfully: ${newBid._id}`);
      finalBidId = newBid._id;
    }

    // Update auction with new highest bid and total bids count
    console.log(`📈 Updating auction highest bid from ₹${auction.highest_bid} to ₹${amount}`);
    console.log(`👤 Updating highest bidder from ${auction.highest_bidder} to ${userId}`);
    
    // Count total bids for this auction
    const totalBidsCount = await Bid.countDocuments({ 
      auction: auction._id,
      status: { $in: ['active', 'authorized'] } // Only count active/authorized bids
    });
    
    console.log(`🔢 Total bids count for auction: ${totalBidsCount}`);
    
    auction.highest_bid = amount;
    auction.highest_bidder = userId;
    auction.total_bids = totalBidsCount;
    
    console.log(`💾 Saving auction with new data:`, {
      highest_bid: auction.highest_bid,
      highest_bidder: auction.highest_bidder,
      total_bids: auction.total_bids,
      auction_id: auction._id
    });
    
    await auction.save();
    console.log(`✅ Auction updated successfully`);

    // Create auction event
    await AuctionEvent.create({
      auction: auction._id,
      event_type: 'bid_placed',
      user: userId,
      details: {
        amount: amount,
        order_id: order_id,
        payment_id: payment_id
      }
    });

    console.log(`✅ New bid placed successfully: User ${userId} bid ₹${amount} on auction ${auction._id}`);

    // Emit real-time update to all connected clients
    const io = req.app.get('io');
    if (io) {
      io.to(`auction_${auction._id}`).emit('newBid', {
        auction_id: auction._id.toString(),
        bidder_id: userId,
        amount: amount,
        timestamp: new Date().toISOString()
      });
    }

    const responseData = {
      success: true,
      message: 'Payment verified and bid placed successfully',
      bid: {
        id: finalBidId,
        amount: amount,
        auction_id: auction._id,
        status: 'active'
      }
    };

    console.log(`🎉 Final response data:`, responseData);
    res.json(responseData);

  } catch (error) {
    console.error('❌ Payment verification error:', error);
    res.status(500).json({ error: 'Payment verification failed' });
  }
});

// Get user's bids
router.get('/my-bids', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const bids = await Bid.find({ bidder: userId })
      .populate('auction', 'item_name item_image base_price status')
      .sort({ created_at: -1 });

    res.json({
      success: true,
      bids: bids.map(bid => ({
        id: bid._id,
        amount: bid.amount,
        status: bid.status,
        payment_status: bid.payment_status,
        auction: bid.auction,
        created_at: bid.created_at
      }))
    });

  } catch (error) {
    console.error('❌ Fetch user bids error:', error);
    res.status(500).json({ error: 'Failed to fetch your bids' });
  }
});

// Get all bids for an auction (public endpoint)
router.get('/auction/:auctionId', [
  param('auctionId').custom((value) => {
    if (!mongoose.Types.ObjectId.isValid(value)) {
      throw new Error('Invalid auction ID format');
    }
    return true;
  })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Invalid auction ID format',
        details: errors.array()
      });
    }

    const { auctionId } = req.params;
    
    const bids = await Bid.find({ auction: auctionId })
      .populate('bidder', 'username name email')
      .sort({ created_at: -1 });
    
    // Process bids to handle missing username field
    const processedBids = bids.map(bid => {
      const bidder = bid.bidder;
      if (bidder) {
        // Ensure bidder has all required fields with fallbacks
        bidder.username = bidder.username || bidder.name || 'Unknown User';
        bidder.name = bidder.name || bidder.username || 'Unknown User';
        bidder.email = bidder.email || 'No Email';
      }
      return bid;
    });

    res.json({
      success: true,
      bids: processedBids
    });

  } catch (error) {
    console.error('❌ Fetch auction bids error:', error);
    res.status(500).json({ error: 'Failed to fetch auction bids' });
  }
});

// Admin: Get all bids for an auction
router.get('/admin/auction/:auctionId', [
  param('auctionId').custom((value) => {
    if (!mongoose.Types.ObjectId.isValid(value)) {
      throw new Error('Invalid auction ID format');
    }
    return true;
  })
], authenticateToken, requireAdmin, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Invalid auction ID format',
        details: errors.array()
      });
    }

    const { auctionId } = req.params;
    
    const bids = await Bid.find({ auction: auctionId })
      .populate('bidder', 'username name email')
      .sort({ created_at: -1 });
    
    // Process bids to handle missing username field
    const processedBids = bids.map(bid => {
      const bidder = bid.bidder;
      if (bidder) {
        // Ensure bidder has all required fields with fallbacks
        bidder.username = bidder.username || bidder.name || 'Unknown User';
        bidder.name = bidder.name || bidder.username || 'Unknown User';
        bidder.email = bidder.email || 'No Email';
      }
      return bid;
    });

    res.json({
      success: true,
      bids: processedBids
    });

  } catch (error) {
    console.error('❌ Admin fetch bids error:', error);
    res.status(500).json({ error: 'Failed to fetch bids' });
  }
});



module.exports = router;
