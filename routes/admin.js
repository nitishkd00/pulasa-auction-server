const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const Auction = require('../models/Auction');
const Bid = require('../models/Bid');
const User = require('../models/User');
const AuctionEvent = require('../models/AuctionEvent');
const mongoose = require('mongoose');

const router = express.Router();

// All routes require admin authentication
router.use(authenticateToken, requireAdmin);

// Get comprehensive admin stats
router.get('/stats', async (req, res) => {
  try {
    const [
      totalAuctions,
      activeAuctions,
      totalBids,
      totalUsers,
      refunds,
      wonAuctions
    ] = await Promise.all([
      Auction.countDocuments(),
      Auction.countDocuments({ status: 'active' }),
      Bid.countDocuments(),
      User.countDocuments(),
      Bid.countDocuments({ payment_status: 'refunded' }),
      Bid.countDocuments({ status: 'won' })
    ]);

    // Calculate revenue from won auctions
    const wonBids = await Bid.find({ status: 'won' });
    const totalRevenue = wonBids.reduce((sum, bid) => sum + bid.amount, 0);

    // Calculate refund amount
    const refundedBids = await Bid.find({ payment_status: 'refunded' });
    const refundAmount = refundedBids.reduce((sum, bid) => sum + bid.amount, 0);

    // Calculate average bids per auction
    const averageBidsPerAuction = totalAuctions > 0 ? (totalBids / totalAuctions).toFixed(2) : 0;

    // Get top bidders (users with most bids)
    const topBidders = await Bid.aggregate([
      { $group: { _id: '$bidder', bidCount: { $sum: 1 } } },
      { $sort: { bidCount: -1 } },
      { $limit: 10 }
    ]);

    res.json({
      success: true,
      stats: {
        totalAuctions,
        activeAuctions,
        totalBids,
        totalRevenue,
        totalUsers,
        totalRefunds: refunds,
        refundAmount,
        averageBidsPerAuction: parseFloat(averageBidsPerAuction),
        topBidders: topBidders.length,
        wonAuctions
      }
    });
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
});

// Get detailed bidding analytics
router.get('/bidding-analytics', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Bids by hour (last 24 hours)
    const bidsByHour = await Bid.aggregate([
      { $match: { created_at: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } },
      {
        $group: {
          _id: { $hour: '$created_at' },
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Bids by day
    const bidsByDay = await Bid.aggregate([
      { $match: { created_at: { $gte: startDate } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Top bidders
    const topBidders = await Bid.aggregate([
      { $match: { created_at: { $gte: startDate } } },
      {
        $group: {
          _id: '$bidder',
          totalBids: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          wonAuctions: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } },
          outbids: { $sum: { $cond: [{ $eq: ['$status', 'outbid'] }, 1, 0] } }
        }
      },
      { $sort: { totalBids: -1 } },
      { $limit: 20 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: '$user' },
      {
        $project: {
          username: '$user.username',
          email: '$user.email',
          totalBids: 1,
          totalAmount: 1,
          wonAuctions: 1,
          outbids: 1
        }
      }
    ]);

    // Refund trends
    const refundTrends = await Bid.aggregate([
      { $match: { payment_status: 'refunded', created_at: { $gte: startDate } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // User engagement (bids per user)
    const userEngagement = await Bid.aggregate([
      { $match: { created_at: { $gte: startDate } } },
      {
        $group: {
          _id: '$bidder',
          bidCount: { $sum: 1 },
          lastBid: { $max: '$created_at' }
        }
      },
      { $sort: { bidCount: -1 } },
      { $limit: 50 }
    ]);
    
    res.json({
      success: true,
      biddingAnalytics: {
        bidsByHour,
        bidsByDay,
        topBidders,
        refundTrends,
        userEngagement
      }
    });
  } catch (error) {
    console.error('Error fetching bidding analytics:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch analytics' });
  }
});

// Get all bids with detailed information
router.get('/all-bids', async (req, res) => {
  try {
    const { page = 1, limit = 100, status, auction_id, user_id } = req.query;
    const skip = (page - 1) * limit;

    let matchQuery = {};
    if (status && status !== 'all') matchQuery.status = status;
    if (auction_id) matchQuery.auction = auction_id;
    if (user_id) matchQuery.bidder = user_id;

    const bids = await Bid.find(matchQuery)
      .populate('bidder', 'username email name')
      .populate('auction', 'item_name item_image base_price status')
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Bid.countDocuments(matchQuery);

    res.json({
      success: true,
      bids,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching all bids:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch bids' });
  }
});

// Get refund details
router.get('/refunds', async (req, res) => {
  try {
    const refunds = await Bid.find({ payment_status: 'refunded' })
      .populate('bidder', 'username email')
      .populate('auction', 'item_name')
      .sort({ created_at: -1 });
    
    // Transform to refund format
    const refundDetails = refunds.map(bid => ({
      _id: bid._id,
      user: bid.bidder,
      auction: bid.auction,
      original_amount: bid.amount,
      refunded_amount: bid.refund_details?.refunded_amount || bid.amount,
      reason: bid.refund_details?.refund_reason || 'Outbid',
      refund_id: bid.refund_details?.refund_id || 'N/A',
      refunded_at: bid.refund_details?.refunded_at || bid.updated_at,
      status: 'completed'
    }));

    res.json({
      success: true,
      refunds: refundDetails
    });
  } catch (error) {
    console.error('Error fetching refunds:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch refunds' });
  }
});

// Get users with analytics
router.get('/users', async (req, res) => {
  try {
    const users = await User.find({})
      .select('username email name created_at last_login')
      .sort({ created_at: -1 });

    res.json({
      success: true,
      users
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch users' });
  }
});

// Get user-specific bidding analytics
router.get('/user/:userId/analytics', async (req, res) => {
  try {
    const { userId } = req.params;
    const { days = 30 } = req.query;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const userBids = await Bid.find({
      bidder: userId,
      created_at: { $gte: startDate }
    }).populate('auction', 'item_name base_price');

    const analytics = {
      totalBids: userBids.length,
      totalAmount: userBids.reduce((sum, bid) => sum + bid.amount, 0),
      wonAuctions: userBids.filter(bid => bid.status === 'won').length,
      outbids: userBids.filter(bid => bid.status === 'outbid').length,
      activeBids: userBids.filter(bid => bid.status === 'active').length,
      refunds: userBids.filter(bid => bid.payment_status === 'refunded').length,
      averageBidAmount: userBids.length > 0 ? (userBids.reduce((sum, bid) => sum + bid.amount, 0) / userBids.length).toFixed(2) : 0,
      bidsByDay: {},
      favoriteAuctions: {}
    };

    // Bids by day
    userBids.forEach(bid => {
      const day = bid.created_at.toISOString().split('T')[0];
      analytics.bidsByDay[day] = (analytics.bidsByDay[day] || 0) + 1;
    });

    // Favorite auctions (most bid on)
    userBids.forEach(bid => {
      const auctionId = bid.auction._id.toString();
      if (!analytics.favoriteAuctions[auctionId]) {
        analytics.favoriteAuctions[auctionId] = {
          auction: bid.auction,
          bidCount: 0,
          totalAmount: 0
        };
      }
      analytics.favoriteAuctions[auctionId].bidCount++;
      analytics.favoriteAuctions[auctionId].totalAmount += bid.amount;
    });

    // Convert to arrays and sort
    analytics.bidsByDay = Object.entries(analytics.bidsByDay)
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => a.day.localeCompare(b.day));

    analytics.favoriteAuctions = Object.values(analytics.favoriteAuctions)
      .sort((a, b) => b.bidCount - a.bidCount)
      .slice(0, 5);
    
    res.json({
      success: true,
      analytics
    });
  } catch (error) {
    console.error('Error fetching user analytics:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch user analytics' });
  }
});

// Get auction-specific analytics
router.get('/auction/:auctionId/analytics', async (req, res) => {
  try {
    const { auctionId } = req.params;
    const { days = 30 } = req.query;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const auction = await Auction.findById(auctionId);
    if (!auction) {
      return res.status(404).json({ success: false, error: 'Auction not found' });
    }

    const bids = await Bid.find({
      auction: auctionId,
      created_at: { $gte: startDate }
    }).populate('bidder', 'username email');

    const analytics = {
      auction: {
        id: auction._id,
        name: auction.item_name,
        basePrice: auction.base_price,
        currentBid: auction.highest_bid,
        totalBids: auction.total_bids,
        status: auction.status
      },
      totalBids: bids.length,
      uniqueBidders: new Set(bids.map(bid => bid.bidder._id.toString())).size,
      totalAmount: bids.reduce((sum, bid) => sum + bid.amount, 0),
      averageBidAmount: bids.length > 0 ? (bids.reduce((sum, bid) => sum + bid.amount, 0) / bids.length).toFixed(2) : 0,
      bidsByHour: {},
      topBidders: {},
      bidHistory: bids.map(bid => ({
        bidder: bid.bidder.username,
        amount: bid.amount,
        status: bid.status,
        timestamp: bid.created_at
      }))
    };

    // Bids by hour
    bids.forEach(bid => {
      const hour = bid.created_at.getHours();
      analytics.bidsByHour[hour] = (analytics.bidsByHour[hour] || 0) + 1;
    });

    // Top bidders
    bids.forEach(bid => {
      const bidderId = bid.bidder._id.toString();
      if (!analytics.topBidders[bidderId]) {
        analytics.topBidders[bidderId] = {
          username: bid.bidder.username,
          bidCount: 0,
          totalAmount: 0,
          highestBid: 0
        };
      }
      analytics.topBidders[bidderId].bidCount++;
      analytics.topBidders[bidderId].totalAmount += bid.amount;
      if (bid.amount > analytics.topBidders[bidderId].highestBid) {
        analytics.topBidders[bidderId].highestBid = bid.amount;
      }
    });

    // Convert to arrays and sort
    analytics.bidsByHour = Object.entries(analytics.bidsByHour)
      .map(([hour, count]) => ({ hour: parseInt(hour), count }))
      .sort((a, b) => a.hour - b.hour);

    analytics.topBidders = Object.values(analytics.topBidders)
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 10);
    
    res.json({
      success: true,
      analytics
    });
  } catch (error) {
    console.error('Error fetching auction analytics:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch auction analytics' });
  }
});

// Export data endpoints
router.get('/export/bids', async (req, res) => {
  try {
    const { format = 'csv', status, startDate, endDate } = req.query;
    
    let matchQuery = {};
    if (status && status !== 'all') matchQuery.status = status;
    if (startDate && endDate) {
      matchQuery.created_at = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const bids = await Bid.find(matchQuery)
      .populate('bidder', 'username email')
      .populate('auction', 'item_name base_price')
      .sort({ created_at: -1 });

    if (format === 'csv') {
      // Generate CSV
      const csvData = [
        ['User', 'Email', 'Auction', 'Amount', 'Status', 'Payment Status', 'Date', 'Refund Details'],
        ...bids.map(bid => [
          bid.bidder?.username || 'Unknown',
          bid.bidder?.email || 'Unknown',
          bid.auction?.item_name || 'Unknown',
          bid.amount,
          bid.status,
          bid.payment_status,
          bid.created_at.toISOString(),
          bid.refund_details ? `${bid.refund_details.refund_reason} - ${bid.refund_details.refunded_amount}` : 'N/A'
        ])
      ];

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=bids-export.csv');
      res.send(csvData.map(row => row.join(',')).join('\n'));
    } else {
      res.json({
        success: true,
        bids,
        exportFormat: format
      });
    }
  } catch (error) {
    console.error('Error exporting bids:', error);
    res.status(500).json({ success: false, error: 'Failed to export bids' });
  }
});

module.exports = router; 