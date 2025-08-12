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
    const userId = req.user.userId;
    
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
    const orderResult = await paymentService.createBidOrder(amount);
    if (!orderResult.success) {
      return res.status(500).json({ error: orderResult.error || 'Failed to create payment order' });
    }

    // Handle outbid refund if there's a current highest bidder
    if (auction.highest_bidder && auction.highest_bid > 0) {
      try {
        const currentHighestBid = await Bid.findOne({
          auction: auction_id,
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

          console.log(`✅ Refunded bid for user ${currentHighestBid.bidder} on auction ${auction_id}`);
        }
      } catch (refundError) {
        console.error('❌ Failed to refund previous bid:', refundError);
        // Continue with new bid even if refund fails
      }
    }

    // Create new bid record
    const newBid = new Bid({
      auction: auction_id,
      bidder: userId,
      amount: amount,
      location: location || '',
      razorpay_order_id: orderResult.razorpay_order.id,
      authorized_amount: amount,
      payment_status: 'authorized',
      status: 'active'
    });

    await newBid.save();

    // Update auction with new highest bid
    auction.highest_bid = amount;
    auction.highest_bidder = userId;
    await auction.save();

    // Create auction event
    await AuctionEvent.create({
      auction: auction_id,
      event_type: 'bid_placed',
      user: userId,
      details: {
        amount: amount,
        order_id: orderResult.razorpay_order.id
      }
    });

    console.log(`✅ New bid placed: User ${userId} bid ₹${amount} on auction ${auction_id}`);

    res.json({
      success: true,
      message: 'Bid placed successfully',
      bid: {
        id: newBid._id,
        amount: newBid.amount,
        order_id: orderResult.razorpay_order.id
      },
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
    const userId = req.user.userId;

    // Verify payment signature
    const verificationResult = await paymentService.verifyPaymentAuthorization(
      payment_id, order_id, signature
    );

    if (!verificationResult.verified) {
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    // Find and update the bid
    const bid = await Bid.findOne({
      razorpay_order_id: order_id,
      bidder: userId,
      payment_status: 'authorized'
    });

    if (!bid) {
      return res.status(404).json({ error: 'Bid not found or already processed' });
    }

    // Update bid with payment ID
    bid.razorpay_payment_id = payment_id;
    await bid.save();

    // Create auction event
    await AuctionEvent.create({
      auction: bid.auction,
      event_type: 'payment_verified',
      user: userId,
      details: {
        payment_id: payment_id,
        amount: bid.amount
      }
    });

    res.json({
      success: true,
      message: 'Payment verified successfully',
      bid: {
        id: bid._id,
        amount: bid.amount,
        status: bid.status
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
    const userId = req.user.userId;
    
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
