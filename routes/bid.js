const express = require('express');
const Razorpay = require('razorpay');
const { body, validationResult } = require('express-validator');
const { authenticateToken, optionalAuth, requireAdmin } = require('../middleware/auth');
const { refundPreviousBidder, isAvailable } = require('../services/razorpay');
const Auction = require('../models/Auction');
const Bid = require('../models/Bid');
const User = require('../models/User');
const AuctionEvent = require('../models/AuctionEvent');
const mongoose = require('mongoose');
const fetch = require('node-fetch');

const router = express.Router();

// Initialize Razorpay only if available
let razorpay = null;
if (isAvailable()) {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });
}

// Create bid order
router.post(
  '/create-order',
  authenticateToken,
  [
    body('auction_id').isString().withMessage('Valid auction ID is required'),
    body('amount').isFloat({ min: 0.01 }).withMessage('Valid bid amount is required')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { auction_id, amount } = req.body;
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
      if (amount <= auction.highest_bid) {
        return res.status(400).json({
          error: `Bid must be at least ₹1 higher than current highest bid: ₹${auction.highest_bid}`
        });
      }
      if (amount < auction.highest_bid + 1) {
        return res.status(400).json({
          error: `Bid must be at least ₹1 higher than current highest bid: ₹${auction.highest_bid}`
        });
      }

      // --- DEVELOPMENT MODE: Allow fake bid without Razorpay ---
      if (!isAvailable()) {
        // Simulate bid using user wallet_balance
        const user = await User.findById(req.user._id);
        if (!user || user.wallet_balance < amount) {
          return res.status(400).json({ error: 'Insufficient wallet balance for test bid.' });
        }
        // Refund previous highest bidder (wallet-based)
        if (auction.highest_bidder && auction.highest_bidder.toString() !== req.user._id.toString()) {
          const prevBid = await Bid.findOne({ auction: auction._id, bidder: auction.highest_bidder, amount: auction.highest_bid, status: 'success' });
          if (prevBid) {
            prevBid.status = 'outbid';
            await prevBid.save();
            const prevUser = await User.findById(auction.highest_bidder);
            if (prevUser) {
              const before = prevUser.wallet_balance;
              prevUser.wallet_balance += auction.highest_bid;
              await prevUser.save();
              const WalletTransaction = require('../models/WalletTransaction');
              await WalletTransaction.create({
                user: prevUser._id,
                type: 'refund',
                amount: auction.highest_bid,
                balance_before: before,
                balance_after: prevUser.wallet_balance,
                auction: auction._id,
                bid: prevBid._id,
                status: 'success',
                description: 'Refund for being outbid'
              });
              // Emit outbid event to previous highest bidder
              const io = req.app.get('io');
              const userSockets = req.app.get('userSockets');
              const prevSocketId = userSockets[prevUser._id.toString()];
              if (prevSocketId) {
                io.to(prevSocketId).emit('outbid', { userId: prevUser._id.toString(), auctionId: auction._id.toString() });
              }
            }
          }
        }
        const before = user.wallet_balance;
        user.wallet_balance -= amount;
        await user.save();
        const WalletTransaction = require('../models/WalletTransaction');
        await WalletTransaction.create({
          user: user._id,
          type: 'bid',
          amount: amount,
          balance_before: before,
          balance_after: user.wallet_balance,
          auction: auction._id,
          status: 'success',
          description: 'Bid placed (DEV MODE)'
        });
        // Get location from IP
        let location = '';
        try {
          const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
          const geoRes = await fetch(`https://ipapi.co/${ip}/json/`);
          const geoData = await geoRes.json();
          if (geoData && geoData.city && geoData.region) {
            location = `${geoData.city}, ${geoData.region}`;
          } else if (geoData && geoData.city) {
            location = geoData.city;
          }
        } catch (e) { location = ''; }
        // Create bid as successful
        const bid = await Bid.create({
          auction: auction._id,
          bidder: req.user._id,
          amount,
          status: 'success',
          location: location,
        });
        auction.highest_bid = amount;
        auction.highest_bidder = req.user._id;
        await auction.save();
        // Log event
        await AuctionEvent.create({
          auction: auction._id,
          event_type: 'bid_placed',
          user: req.user._id,
          amount: bid.amount,
          description: `New highest bid: ₹${bid.amount} (DEV MODE)`
        });
        // Emit real-time update via Socket.IO
        const io = req.app.get('io');
        io.to(`auction_${auction._id}`).emit('newBid', {
          auction_id: auction._id,
          bidder: user.username,
          bidder_address: user.wallet_address,
          amount: bid.amount,
          timestamp: new Date().toISOString()
        });
        return res.json({
          message: 'Test bid placed successfully (DEV MODE)',
          amount,
          bid_amount: amount,
          bid_id: bid._id
        });
      }
      // --- END DEV MODE ---

      const platformFee = Math.min(Math.max(amount * 0.02, 2), 5);
      const totalAmount = amount + platformFee;

      const orderOptions = {
        amount: Math.round(totalAmount * 100),
        currency: 'INR',
        receipt: `bid_${auction_id}_${Date.now()}`,
        notes: {
          auction_id: auction_id.toString(),
          bidder_id: req.user._id.toString(),
          bid_amount: amount.toString(),
          platform_fee: platformFee.toString()
        }
      };
      const order = await razorpay.orders.create(orderOptions);

      // Get location from IP
      let location = '';
      try {
        const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        const geoRes = await fetch(`https://ipapi.co/${ip}/json/`);
        const geoData = await geoRes.json();
        if (geoData && geoData.city && geoData.region) {
          location = `${geoData.city}, ${geoData.region}`;
        } else if (geoData && geoData.city) {
          location = geoData.city;
        }
      } catch (e) { location = ''; }

      // Create a pending bid in MongoDB
      const bid = await Bid.create({
        auction: auction._id,
        bidder: req.user._id,
        amount,
        status: 'active',
        location: location,
      });

      res.json({
        message: 'Bid order created successfully',
        order_id: order.id,
        amount: totalAmount,
        bid_amount: amount,
        bid_id: bid._id
      });
    } catch (error) {
      console.error('Create bid order error:', error);
      res.status(500).json({ error: 'Failed to create bid order' });
    }
  });

// Verify payment and place bid
router.post('/verify-payment', authenticateToken, [
  body('razorpay_payment_id').notEmpty().withMessage('Payment ID is required'),
  body('razorpay_order_id').notEmpty().withMessage('Order ID is required'),
  body('razorpay_signature').notEmpty().withMessage('Signature is required'),
  body('bid_id').isString().withMessage('Valid bid ID is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    if (!isAvailable()) {
      return res.status(503).json({ 
        error: 'Payment service is not configured. Please contact administrator.' 
      });
    }
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature, bid_id } = req.body;
    const text = `${razorpay_order_id}|${razorpay_payment_id}`;
    const signature = require('crypto')
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(text)
      .digest('hex');
    if (signature !== razorpay_signature) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }
    const bid = await Bid.findById(bid_id);
    if (!bid || !bid.bidder.equals(req.user._id)) {
      return res.status(404).json({ error: 'Bid not found' });
    }
    if (bid.status !== 'active') {
      return res.status(400).json({ error: 'Bid already processed' });
    }
    const auction = await Auction.findById(bid.auction);
    if (!auction) {
      return res.status(404).json({ error: 'Auction not found' });
    }
    const now = new Date();
    if (now > auction.end_time || auction.status === 'ended') {
      await refundPreviousBidder(razorpay_payment_id, bid.amount);
      bid.status = 'refunded';
      await bid.save();
      return res.status(400).json({ error: 'Auction has ended. Payment will be refunded.' });
    }
    if (bid.amount <= auction.highest_bid) {
      await refundPreviousBidder(razorpay_payment_id, bid.amount);
      bid.status = 'refunded';
      await bid.save();
      return res.status(400).json({ 
        error: 'Bid is no longer the highest. Payment will be refunded.' 
      });
    }
    // Update bid and auction
    bid.status = 'success';
    // If location is not set, try to set it now
    if (!bid.location) {
      let location = '';
      try {
        const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        const geoRes = await fetch(`https://ipapi.co/${ip}/json/`);
        const geoData = await geoRes.json();
        if (geoData && geoData.city && geoData.region) {
          location = `${geoData.city}, ${geoData.region}`;
        } else if (geoData && geoData.city) {
          location = geoData.city;
        }
      } catch (e) { location = ''; }
      bid.location = location;
    }
    await bid.save();
    // Refund previous highest bidder if exists
    if (auction.highest_bidder && auction.highest_bidder.toString() !== req.user._id.toString()) {
      // Find the previous highest bid
      const prevBid = await Bid.findOne({ auction: auction._id, bidder: auction.highest_bidder, amount: auction.highest_bid, status: 'success' });
      if (prevBid) {
        // Mark previous bid as outbid
        prevBid.status = 'outbid';
        await prevBid.save();
        // Refund to wallet
        const prevUser = await User.findById(auction.highest_bidder);
        if (prevUser) {
          const before = prevUser.wallet_balance;
          prevUser.wallet_balance += auction.highest_bid;
          await prevUser.save();
          const WalletTransaction = require('../models/WalletTransaction');
          await WalletTransaction.create({
            user: prevUser._id,
            type: 'refund',
            amount: auction.highest_bid,
            balance_before: before,
            balance_after: prevUser.wallet_balance,
            auction: auction._id,
            bid: prevBid._id,
            status: 'success',
            description: 'Refund for being outbid'
          });
          // Emit outbid event to previous highest bidder
          const io = req.app.get('io');
          const userSockets = req.app.get('userSockets');
          const prevSocketId = userSockets[prevUser._id.toString()];
          if (prevSocketId) {
            io.to(prevSocketId).emit('outbid', { userId: prevUser._id.toString(), auctionId: auction._id.toString() });
          }
        }
      }
    }
    auction.highest_bid = bid.amount;
    auction.highest_bidder = req.user._id;
    await auction.save();
    // Log event
    await AuctionEvent.create({
      auction: auction._id,
      event_type: 'bid_placed',
      user: req.user._id,
      amount: bid.amount,
      description: `New highest bid: ₹${bid.amount}`
    });
    // Refund previous highest bidder if exists
    // (Implement logic if you store previous highest bidder/payment info)
    // Emit real-time update via Socket.IO
    const io = req.app.get('io');
    io.to(`auction_${auction._id}`).emit('newBid', {
      auction_id: auction._id,
      bidder: req.user.username,
      bidder_address: req.user.wallet_address,
      amount: bid.amount,
      timestamp: new Date().toISOString()
    });
    res.json({
      message: 'Bid placed successfully',
      new_highest_bid: bid.amount
    });
  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({ error: 'Failed to verify payment and place bid' });
  }
});

// Get user's bids
router.get('/my-bids', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;
    const bids = await Bid.find({ bidder: req.user._id })
      .populate('auction')
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    const total = await Bid.countDocuments({ bidder: req.user._id });
    // Flatten auction info for each bid
    const mappedBids = bids.map(bid => {
      const b = bid.toObject();
      const auction = b.auction || {};
      return {
        _id: b._id,
        auction_id: auction._id || '',
        item_name: auction.item_name || 'Unknown',
        item_image: auction.item_image || 'https://via.placeholder.com/80x80?text=Fish',
        base_price: auction.base_price || 0,
        start_time: auction.start_time || '',
        end_time: auction.end_time || '',
        auction_status: auction.status || '',
        amount: b.amount,
        status: b.status,
        created_at: b.created_at,
        location: b.location || '',
      };
    });
    res.json({
      bids: mappedBids,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get user bids error:', error);
    res.status(500).json({ error: 'Failed to get user bids' });
  }
});

// Get auction bids (for auction page)
router.get('/auction/:auctionId', authenticateToken, async (req, res) => {
  try {
    const { auctionId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(auctionId)) {
      return res.status(400).json({ error: 'Invalid auction ID' });
    }
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;
    // Add logging for debugging
    console.log('[DEBUG] Querying bids for auction:', auctionId);
    const bids = await Bid.find({ auction: auctionId, status: 'success' })
      .populate('bidder', 'username')
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    console.log('[DEBUG] Number of bids found:', bids.length);
    const total = await Bid.countDocuments({ auction: auctionId, status: 'success' });
    res.json({
      bids,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get auction bids error:', error);
    res.status(500).json({ error: 'Failed to get auction bids' });
  }
});

// TEMP DEBUG: Print all bids for an auction (remove after debugging)
router.get('/debug/all-bids/:auctionId', authenticateToken, async (req, res) => {
  try {
    const { auctionId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(auctionId)) {
      return res.status(400).json({ error: 'Invalid auction ID' });
    }
    const bids = await Bid.find({ auction: auctionId });
    res.json({ count: bids.length, bids });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// TEMP DEBUG: Update all bids for an auction to status 'success' (remove after debugging)
router.post('/debug/fix-bid-status/:auctionId', authenticateToken, async (req, res) => {
  try {
    const { auctionId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(auctionId)) {
      return res.status(400).json({ error: 'Invalid auction ID' });
    }
    const result = await Bid.updateMany({ auction: auctionId }, { $set: { status: 'success' } });
    res.json({ message: 'All bids updated to status success', result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// TEMP DEBUG: Update all bids in the database to status 'success' (global fix, no auth)
router.post('/debug/fix-all-bids-status-noauth', async (req, res) => {
  try {
    const result = await Bid.updateMany({}, { $set: { status: 'success' } });
    res.json({ message: 'All bids in the database updated to status success', result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get recent bids (admin only)
router.get('/recent', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const recentBids = await Bid.find({})
      .populate('bidder', 'username email')
      .populate('auction', 'item_name')
      .sort({ created_at: -1 })
      .limit(10);
    
    const formattedBids = recentBids.map(bid => ({
      _id: bid._id,
      amount: bid.amount,
      status: bid.status,
      created_at: bid.created_at,
      user: bid.bidder,
      auction: bid.auction
    }));
    
    res.json({
      success: true,
      bids: formattedBids
    });
  } catch (error) {
    console.error('Get recent bids error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

module.exports = router; 