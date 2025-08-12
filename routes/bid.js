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

    // Create Razorpay order for authorization
    console.log('🔑 Creating Razorpay order for amount:', amount);
    const orderResult = await paymentService.createBidOrder(amount);
    console.log('🔑 PaymentService response:', orderResult);
    
    if (!orderResult.success) {
      console.error('❌ PaymentService failed:', orderResult.error);
      return res.status(500).json({ error: orderResult.error || 'Failed to create payment order' });
    }

    // Return order details to frontend - DO NOT create bid yet
    // Bid will be created only after payment success in /verify route
    console.log('✅ Razorpay order created, returning to frontend for payment');
    
    res.json({
      success: true,
      message: 'Razorpay order created successfully. Please complete payment.',
      razorpay_order: {
        id: orderResult.razorpay_order.id,
        amount: orderResult.razorpay_order.amount,
        currency: orderResult.razorpay_order.currency
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
  body('signature').isString().withMessage('Signature is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { payment_id, order_id, signature } = req.body;
    const userId = req.user.id;

    console.log('🔍 Payment verification request:', { payment_id, order_id, signature, userId });

    // Verify payment signature
    const verificationResult = await paymentService.verifyPaymentAuthorization(
      payment_id, order_id, signature
    );

    if (!verificationResult.verified) {
      console.error('❌ Payment signature verification failed');
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    console.log('✅ Payment signature verified, proceeding with bid creation');

    // Find the auction and order details
    const order = await paymentService.getPaymentDetails(payment_id);
    if (!order.success) {
      console.error('❌ Failed to get payment details');
      return res.status(400).json({ error: 'Failed to get payment details' });
    }

    // Get auction details from the order
    const auction = await Auction.findOne({ 
      'highest_bidder': { $exists: true, $ne: null } 
    }).sort({ highest_bid: -1 });

    if (!auction) {
      console.error('❌ No auction found for this payment');
      return res.status(404).json({ error: 'Auction not found' });
    }

    const amount = order.payment.amount / 100; // Convert from paise to rupees

    // Handle outbid refund if there's a current highest bidder
    if (auction.highest_bidder && auction.highest_bid > 0 && auction.highest_bidder.toString() !== userId) {
      try {
        const currentHighestBid = await Bid.findOne({
          auction: auction._id,
          bidder: auction.highest_bidder,
          status: 'active',
          payment_status: 'authorized'
        });

        if (currentHighestBid && currentHighestBid.razorpay_payment_id) {
          // Refund the previous highest bidder
          await paymentService.refundPayment(
            currentHighestBid.razorpay_payment_id,
            currentHighestBid.amount,
            'Outbid by another user'
          );

          // Update previous bid status
          currentHighestBid.status = 'outbid';
          currentHighestBid.payment_status = 'refunded';
          await currentHighestBid.save();

          console.log(`✅ Refunded bid for user ${currentHighestBid.bidder} on auction ${auction._id}`);
        }
      } catch (refundError) {
        console.error('❌ Failed to refund previous bid:', refundError);
        // Continue with new bid even if refund fails
      }
    }

    // Create new bid record
    const newBid = new Bid({
      auction: auction._id,
      bidder: userId,
      amount: amount,
      location: '',
      razorpay_order_id: order_id,
      razorpay_payment_id: payment_id,
      authorized_amount: amount,
      payment_status: 'captured',
      status: 'active'
    });

    await newBid.save();

    // Update auction with new highest bid
    auction.highest_bid = amount;
    auction.highest_bidder = userId;
    await auction.save();

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

    res.json({
      success: true,
      message: 'Payment verified and bid placed successfully',
      bid: {
        id: newBid._id,
        amount: newBid.amount,
        status: newBid.status
      }
    });

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

    res.json({
      success: true,
      bids: bids
    });

  } catch (error) {
    console.error('❌ Admin fetch bids error:', error);
    res.status(500).json({ error: 'Failed to fetch bids' });
  }
});

module.exports = router;
