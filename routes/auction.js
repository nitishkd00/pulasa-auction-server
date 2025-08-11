const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken, requireAdmin, optionalAuth } = require('../middleware/auth');
const Auction = require('../models/Auction');
const User = require('../models/User');
const Bid = require('../models/Bid');
const AuctionEvent = require('../models/AuctionEvent');
const mongoose = require('mongoose');

const router = express.Router();

// Create new auction (Admin only)
router.post('/create', authenticateToken, requireAdmin, [
  body('item_name').notEmpty().withMessage('Item name is required'),
  body('item_image').isURL().withMessage('Valid image URL is required'),
  body('base_price').isFloat({ min: 0.01 }).withMessage('Base price must be greater than 0'),
  body('start_time').isISO8601().withMessage('Valid start time is required'),
  body('end_time').isISO8601().withMessage('Valid end time is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { item_name, item_image, base_price, start_time, end_time, description } = req.body;

    // Validate time constraints
    const startDate = new Date(start_time);
    const endDate = new Date(end_time);
    const now = new Date();

    if (startDate <= now) {
      return res.status(400).json({ error: 'Start time must be in the future' });
    }
    if (endDate <= startDate) {
      return res.status(400).json({ error: 'End time must be after start time' });
    }

    // Create auction in MongoDB
    const auction = await Auction.create({
      item_name,
      item_image,
      base_price,
      description,
      start_time: startDate,
      end_time: endDate,
      created_by: req.user.userId
    });

    // Log auction creation event
    await AuctionEvent.create({
      auction: auction._id,
      event_type: 'created',
      user: req.user.userId,
      description: `Auction created for ${item_name}`
    });

    // Populate created_by field for response
    await auction.populate('created_by', 'username');

    res.status(201).json({
      message: 'Auction created successfully',
      auction
    });
  } catch (error) {
    console.error('Create auction error:', error);
    console.error('Validation errors:', errors.array());
    console.error('Full error details:', error);
    res.status(500).json({ 
      error: 'Failed to create auction', 
      details: error.message,
      validationErrors: errors ? errors.array() : null
    });
  }
});

// Get all auctions
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const query = {};
    const now = new Date();
    if (status === 'pending') {
      query.start_time = { $gt: now };
    } else if (status === 'active') {
      query.start_time = { $lte: now };
      query.end_time = { $gt: now };
    } else if (status === 'ended') {
      query.end_time = { $lte: now };
    }
    const skip = (parseInt(page) - 1) * parseInt(limit);
    let auctions = await Auction.find(query)
      .populate('created_by', 'username')
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    // Dynamically update status based on time
    // For each auction, add total_bids
    const auctionsWithBids = await Promise.all(auctions.map(async a => {
      const auction = a.toObject();
      if (now < auction.start_time) auction.status = 'pending';
      else if (now >= auction.start_time && now < auction.end_time) auction.status = 'active';
      else if (now >= auction.end_time) auction.status = 'ended';
      auction.total_bids = await Bid.countDocuments({ auction: auction._id, status: 'success' });
      // Add winner info for ended auctions
      if (auction.status === 'ended' && auction.winner) {
        const winnerUser = await User.findById(auction.winner);
        auction.winner_name = winnerUser ? winnerUser.username : 'Unknown';
        auction.winning_amount = auction.winning_amount || 0;
      }
      return auction;
    }));
    const total = await Auction.countDocuments(query);
    res.json({
      auctions: auctionsWithBids,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get auctions error:', error);
    res.status(500).json({ error: 'Failed to get auctions' });
  }
});

// Get single auction by ID
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid auction ID' });
    }
    let auction = await Auction.findById(id).populate('created_by', 'username');
    if (!auction) {
      return res.status(404).json({ error: 'Auction not found' });
    }
    // Dynamically update status based on time
    const now = new Date();
    auction = auction.toObject();
    if (now < auction.start_time) auction.status = 'pending';
    else if (now >= auction.start_time && now < auction.end_time) auction.status = 'active';
    else if (now >= auction.end_time) auction.status = 'ended';
    // Add total_bids
    auction.total_bids = await Bid.countDocuments({ auction: id, status: 'success' });
    // Add winner_name if winner is set
    let winner_name = null;
    let winner_location = null;
    if (auction.winner) {
      const winnerUser = await User.findById(auction.winner);
      if (winnerUser) winner_name = winnerUser.username;
      // Find the winning bid for location
      const winningBid = await Bid.findOne({ auction: id, bidder: auction.winner, amount: auction.winning_amount, status: 'success' });
      if (winningBid && winningBid.location) winner_location = winningBid.location;
    }
    auction.winner_name = winner_name;
    auction.winner_location = winner_location;
    // Get recent bids for this auction (ALL bids from ALL users - last 10)
    const recentBids = await Bid.find({ auction: id, status: 'success' })
      .populate('bidder', 'username name email')
      .sort({ created_at: -1 })
      .limit(10)
      .lean();
    // Map recent bids to include bidder name and location
    const mappedRecentBids = recentBids.map(bid => ({
      amount: bid.amount,
      username: bid.bidder && (bid.bidder.username || bid.bidder.name) ? (bid.bidder.username || bid.bidder.name) : (bid.bidder ? `User ${bid.bidder._id}` : 'Unknown'),
      bidder_id: bid.bidder && bid.bidder._id ? bid.bidder._id : (bid.bidder ? bid.bidder : 'Unknown'),
      created_at: bid.created_at,
      location: bid.location || '',
    }));
    
    // Get bid history for CURRENT USER ONLY (if logged in)
    let mappedBidHistory = [];
    if (req.user) {
      const bidHistory = await Bid.find({ 
        auction: id, 
        bidder: req.user.userId, 
        status: 'success' 
      })
        .populate('bidder', 'username name email')
        .sort({ created_at: -1 })
        .lean();
      
      mappedBidHistory = bidHistory.map(bid => ({
        amount: bid.amount,
        username: bid.bidder && (bid.bidder.username || bid.bidder.name) ? (bid.bidder.username || bid.bidder.name) : (bid.bidder ? `User ${bid.bidder._id}` : 'Unknown'),
        bidder_id: bid.bidder && bid.bidder._id ? bid.bidder._id : (bid.bidder ? bid.bidder : 'Unknown'),
        created_at: bid.created_at,
        location: bid.location || '',
      }));
    }
    // Get user's highest bid if logged in
    let userHighestBid = null;
    if (req.user) {
      const userBid = await Bid.findOne({ auction: id, bidder: req.user.userId }).sort({ amount: -1 });
      userHighestBid = userBid ? userBid.amount : null;
    }
    // Get auction events for audit trail
    const events = await AuctionEvent.find({ auction: id })
      .populate('user', 'username')
      .sort({ created_at: -1 })
      .limit(20);
    res.json({
      auction,
      recent_bids: mappedRecentBids,
      bid_history: mappedBidHistory,
      user_highest_bid: userHighestBid,
      events
    });
  } catch (error) {
    console.error('Get auction error:', error);
    res.status(500).json({ error: 'Failed to get auction' });
  }
});

// Delete auction (only by owner/auctioneer or admin)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid auction ID' });
    }
    const auction = await Auction.findById(id);
    if (!auction) {
      return res.status(404).json({ error: 'Auction not found' });
    }
    // Only allow if the user is the creator or admin
    if (auction.created_by.toString() !== req.user.userId && !req.user.isAdmin) {
      return res.status(403).json({ error: 'You are not authorized to delete this auction.' });
    }
    await auction.deleteOne();
    // Optionally, delete related bids and events
    await Bid.deleteMany({ auction: id });
    await AuctionEvent.deleteMany({ auction: id });
    res.json({ message: 'Auction deleted successfully.' });
  } catch (error) {
    console.error('Delete auction error:', error);
    res.status(500).json({ error: 'Failed to delete auction' });
  }
});

// Update auction end time (only by owner/auctioneer or admin)
router.patch('/:id/end-time', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { end_time } = req.body;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid auction ID' });
    }
    if (!end_time) {
      return res.status(400).json({ error: 'New end time is required.' });
    }
    const auction = await Auction.findById(id);
    if (!auction) {
      return res.status(404).json({ error: 'Auction not found' });
    }
    // Only allow if the user is the creator or admin
    if (auction.created_by.toString() !== req.user.userId && !req.user.isAdmin) {
      return res.status(403).json({ error: 'You are not authorized to update this auction.' });
    }
    const newEndTime = new Date(end_time);
    const now = new Date();
    if (newEndTime <= now) {
      return res.status(400).json({ error: 'End time must be in the future.' });
    }
    if (newEndTime <= auction.start_time) {
      return res.status(400).json({ error: 'End time must be after start time.' });
    }
    auction.end_time = newEndTime;
    await auction.save();
    // Log auction update event
    await AuctionEvent.create({
      auction: auction._id,
      event_type: 'end_time_updated',
      user: req.user.userId,
      description: `Auction end time updated to ${newEndTime.toISOString()}`
    });
    res.json({ message: 'Auction end time updated successfully.', auction });
  } catch (error) {
    console.error('Update auction end time error:', error);
    res.status(500).json({ error: 'Failed to update auction end time' });
  }
});

// Get auction statistics (admin only)
router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    
    // Get total auctions
    const totalAuctions = await Auction.countDocuments();
    
    // Get active auctions (started but not ended)
    const activeAuctions = await Auction.countDocuments({
      start_time: { $lte: now },
      end_time: { $gt: now }
    });
    
    // Get total bids
    const totalBids = await Bid.countDocuments({ status: 'success' });
    
    // Calculate total revenue from completed auctions
    const completedAuctions = await Auction.find({
      end_time: { $lte: now }
    }).populate('winner');
    
    let totalRevenue = 0;
    for (const auction of completedAuctions) {
      if (auction.winner && auction.winner.amount) {
        totalRevenue += auction.winner.amount;
      }
    }
    
    // Get total users
    const totalUsers = await User.countDocuments();
    
    res.json({
      success: true,
      stats: {
        totalAuctions,
        activeAuctions,
        totalBids,
        totalRevenue,
        totalUsers
      }
    });
  } catch (error) {
    console.error('Get auction stats error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

module.exports = router; 