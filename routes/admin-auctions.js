const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const Auction = require('../models/Auction');
const Bid = require('../models/Bid');
const AuctionEvent = require('../models/AuctionEvent');
const User = require('../models/User');

const router = express.Router();

// Get comprehensive auction overview (admin dashboard)
router.get('/dashboard', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    
    // Get active auctions
    const activeAuctions = await Auction.find({
      status: 'active',
      end_time: { $gt: now }
    }).populate('highest_bidder', 'name email');

    // Get ended auctions
    const endedAuctions = await Auction.find({
      status: 'ended'
    }).populate('winner', 'name email');

    // Get today's activity
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const todayBids = await Bid.find({
      created_at: { $gte: todayStart, $lte: todayEnd }
    }).populate('bidder', 'name email').populate('auction', 'item_name');

    const todayEvents = await AuctionEvent.find({
      created_at: { $gte: todayStart, $lte: todayEnd }
    }).populate('user', 'name email').populate('auction', 'item_name');

    // Get payment statistics
    const paymentStats = await Bid.aggregate([
      {
        $group: {
          _id: '$payment_status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]);

    // Get outbid statistics
    const outbidStats = await Bid.aggregate([
      { $match: { status: 'outbid' } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          totalRefundedAmount: { $sum: '$amount' }
        }
      }
    ]);

    res.json({
      success: true,
      dashboard: {
        activeAuctions: activeAuctions.length,
        endedAuctions: endedAuctions.length,
        todayBids: todayBids.length,
        todayEvents: todayEvents.length,
        paymentStats: paymentStats,
        outbidStats: outbidStats[0] || { count: 0, totalRefundedAmount: 0 },
        recentActivity: {
          bids: todayBids.slice(0, 10),
          events: todayEvents.slice(0, 10)
        }
      }
    });

  } catch (error) {
    console.error('❌ Admin dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// Get detailed auction information with all bids
router.get('/auction/:auctionId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { auctionId } = req.params;
    
    const auction = await Auction.findById(auctionId)
      .populate('highest_bidder', 'name email phone')
      .populate('winner', 'name email phone');

    if (!auction) {
      return res.status(404).json({ error: 'Auction not found' });
    }

    // Get all bids for this auction
    const bids = await Bid.find({ auction: auctionId })
      .populate('bidder', 'name email phone')
      .sort({ created_at: -1 });

    // Get all events for this auction
    const events = await AuctionEvent.find({ auction: auctionId })
      .populate('user', 'name email')
      .sort({ created_at: -1 });

    // Calculate bid statistics
    const bidStats = {
      totalBids: bids.length,
      uniqueBidders: new Set(bids.map(b => b.bidder._id.toString())).size,
      totalAmount: bids.reduce((sum, bid) => sum + bid.amount, 0),
      paymentBreakdown: {
        authorized: bids.filter(b => b.payment_status === 'authorized').length,
        captured: bids.filter(b => b.payment_status === 'captured').length,
        refunded: bids.filter(b => b.payment_status === 'refunded').length
      },
      statusBreakdown: {
        active: bids.filter(b => b.status === 'active').length,
        outbid: bids.filter(b => b.status === 'outbid').length,
        won: bids.filter(b => b.status === 'won').length
      }
    };

    res.json({
      success: true,
      auction: auction,
      bids: bids,
      events: events,
      statistics: bidStats
    });

  } catch (error) {
    console.error('❌ Admin auction detail error:', error);
    res.status(500).json({ error: 'Failed to fetch auction details' });
  }
});

// Get all bids with detailed information
router.get('/bids', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 50, status, payment_status } = req.query;
    const skip = (page - 1) * limit;

    let filter = {};
    if (status) filter.status = status;
    if (payment_status) filter.payment_status = payment_status;

    const bids = await Bid.find(filter)
      .populate('bidder', 'name email phone')
      .populate('auction', 'item_name base_price status')
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalBids = await Bid.countDocuments(filter);

    res.json({
      success: true,
      bids: bids,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalBids / limit),
        totalBids: totalBids,
        hasNext: skip + bids.length < totalBids,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    console.error('❌ Admin bids fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch bids' });
  }
});

// Get outbid users and refund status
router.get('/outbids', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const outbidBids = await Bid.find({ status: 'outbid' })
      .populate('bidder', 'name email phone')
      .populate('auction', 'item_name')
      .sort({ updated_at: -1 });

    // Group by user to see who got outbid multiple times
    const outbidUsers = {};
    outbidBids.forEach(bid => {
      const userId = bid.bidder._id.toString();
      if (!outbidUsers[userId]) {
        outbidUsers[userId] = {
          user: bid.bidder,
          outbidCount: 0,
          totalRefundedAmount: 0,
          auctions: []
        };
      }
      outbidUsers[userId].outbidCount++;
      outbidUsers[userId].totalRefundedAmount += bid.amount;
      outbidUsers[userId].auctions.push({
        auction: bid.auction,
        bidAmount: bid.amount,
        outbidAt: bid.updated_at,
        refundStatus: bid.payment_status
      });
    });

    res.json({
      success: true,
      outbidBids: outbidBids,
      outbidUsers: Object.values(outbidUsers),
      summary: {
        totalOutbids: outbidBids.length,
        uniqueUsersOutbid: Object.keys(outbidUsers).length,
        totalRefundedAmount: outbidBids.reduce((sum, bid) => sum + bid.amount, 0)
      }
    });

  } catch (error) {
    console.error('❌ Admin outbids error:', error);
    res.status(500).json({ error: 'Failed to fetch outbid data' });
  }
});

// Get payment status overview
router.get('/payments', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const paymentOverview = await Bid.aggregate([
      {
        $group: {
          _id: {
            payment_status: '$payment_status',
            status: '$status'
          },
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          averageAmount: { $avg: '$amount' }
        }
      },
      {
        $sort: { '_id.payment_status': 1, '_id.status': 1 }
      }
    ]);

    // Get recent payment activities
    const recentPayments = await Bid.find({
      payment_status: { $in: ['captured', 'refunded'] }
    })
      .populate('bidder', 'name email')
      .populate('auction', 'item_name')
      .sort({ updated_at: -1 })
      .limit(20);

    res.json({
      success: true,
      overview: paymentOverview,
      recentPayments: recentPayments
    });

  } catch (error) {
    console.error('❌ Admin payments error:', error);
    res.status(500).json({ error: 'Failed to fetch payment data' });
  }
});

// Get system events and logs
router.get('/events', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 50, event_type, auction_id } = req.query;
    const skip = (page - 1) * limit;

    let filter = {};
    if (event_type) filter.event_type = event_type;
    if (auction_id) filter.auction = auction_id;

    const events = await AuctionEvent.find(filter)
      .populate('user', 'name email')
      .populate('auction', 'item_name')
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalEvents = await AuctionEvent.countDocuments(filter);

    res.json({
      success: true,
      events: events,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalEvents / limit),
        totalBids: totalEvents,
        hasNext: skip + events.length < totalEvents,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    console.error('❌ Admin events error:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Manual trigger for auction end processing (admin override)
router.post('/auction/:auctionId/end', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { auctionId } = req.params;
    const auctionEndService = require('../services/auctionEndService');
    
    const result = await auctionEndService.processSpecificAuction(auctionId);
    
    res.json({
      success: true,
      message: 'Auction end processing triggered manually',
      result: result
    });

  } catch (error) {
    console.error('❌ Manual auction end error:', error);
    res.status(500).json({ error: 'Failed to trigger auction end processing' });
  }
});

// Get refund status and retry failed refunds
router.get('/refunds', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const failedRefunds = await Bid.find({
      status: 'outbid',
      payment_status: { $ne: 'refunded' }
    }).populate('bidder', 'name email').populate('auction', 'item_name');

    const successfulRefunds = await Bid.find({
      payment_status: 'refunded'
    })
      .populate('bidder', 'name email')
      .populate('auction', 'item_name')
      .sort({ updated_at: -1 })
      .limit(20);

    res.json({
      success: true,
      failedRefunds: failedRefunds,
      successfulRefunds: successfulRefunds
    });

  } catch (error) {
    console.error('❌ Admin refunds error:', error);
    res.status(500).json({ error: 'Failed to fetch refund data' });
  }
});

// Retry failed refund for a specific bid
router.post('/refund/:bidId/retry', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { bidId } = req.params;
    const paymentService = require('../services/paymentService');
    
    const bid = await Bid.findById(bidId);
    if (!bid) {
      return res.status(404).json({ error: 'Bid not found' });
    }

    if (bid.payment_status === 'refunded') {
      return res.status(400).json({ error: 'Bid already refunded' });
    }

    // Attempt refund
    const refundResult = await paymentService.refundPayment(
      bid.razorpay_payment_id,
      bid.amount,
      'Admin retry - Outbid refund'
    );

    if (refundResult.success) {
      bid.payment_status = 'refunded';
      bid.status = 'outbid';
      await bid.save();

      // Log the event
      await AuctionEvent.create({
        auction: bid.auction,
        event_type: 'admin_refund_retry_success',
        user: bid.bidder,
        details: {
          bid_id: bid._id,
          amount: bid.amount,
          admin_action: true
        }
      });

      res.json({
        success: true,
        message: 'Refund retry successful',
        refund: refundResult
      });
    } else {
      throw new Error('Refund failed');
    }

  } catch (error) {
    console.error('❌ Refund retry error:', error);
    res.status(500).json({ error: 'Failed to retry refund' });
  }
});

module.exports = router;
