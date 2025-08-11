const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const AuctionEvent = require('../models/AuctionEvent');
const Bid = require('../models/Bid');

const router = express.Router();

// Get user's notifications (bids, outbids, wins, etc.)
router.get('/my-notifications', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Get user's recent events
    const events = await AuctionEvent.find({
      user: userId
    })
      .populate('auction', 'item_name item_image')
      .sort({ created_at: -1 })
      .limit(50);

    // Get user's bid statuses
    const bids = await Bid.find({ bidder: userId })
      .populate('auction', 'item_name item_image')
      .sort({ created_at: -1 })
      .limit(20);

    // Format notifications
    const notifications = [];

    // Add bid status notifications
    bids.forEach(bid => {
      if (bid.status === 'outbid') {
        notifications.push({
          type: 'outbid',
          title: 'You\'ve been outbid!',
          message: `Someone placed a higher bid on "${bid.auction.item_name}"`,
          auction: bid.auction,
          amount: bid.amount,
          timestamp: bid.updated_at,
          read: false
        });
      } else if (bid.status === 'won') {
        notifications.push({
          type: 'won',
          title: '🎉 You won the auction!',
          message: `Congratulations! You won "${bid.auction.item_name}" for ₹${bid.amount}`,
          auction: bid.auction,
          amount: bid.amount,
          timestamp: bid.updated_at,
          read: false
        });
      } else if (bid.status === 'active' && bid.payment_status === 'authorized') {
        notifications.push({
          type: 'active_bid',
          title: '✅ Bid Active',
          message: `Your bid of ₹${bid.amount} on "${bid.auction.item_name}" is currently the highest`,
          auction: bid.auction,
          amount: bid.amount,
          timestamp: bid.created_at,
          read: false
        });
      }
    });

    // Add event notifications
    events.forEach(event => {
      if (event.event_type === 'bid_placed') {
        notifications.push({
          type: 'bid_placed',
          title: 'Bid Placed Successfully',
          message: `Your bid of ₹${event.details.amount} has been placed`,
          auction: event.auction,
          amount: event.details.amount,
          timestamp: event.created_at,
          read: false
        });
      }
    });

    // Sort by timestamp (newest first)
    notifications.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({
      success: true,
      notifications: notifications.slice(0, 20), // Return latest 20
      unreadCount: notifications.filter(n => !n.read).length
    });

  } catch (error) {
    console.error('❌ Fetch notifications error:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Mark notification as read
router.post('/mark-read/:notificationId', authenticateToken, async (req, res) => {
  try {
    // This is a simple implementation - you can enhance it later
    res.json({
      success: true,
      message: 'Notification marked as read'
    });
  } catch (error) {
    console.error('❌ Mark read error:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// Get real-time notification count for navbar
router.get('/count', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const unreadCount = await Bid.countDocuments({
      bidder: userId,
      status: { $in: ['outbid', 'won'] },
      updated_at: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
    });

    res.json({
      success: true,
      unreadCount: unreadCount
    });

  } catch (error) {
    console.error('❌ Notification count error:', error);
    res.status(500).json({ error: 'Failed to fetch notification count' });
  }
});

module.exports = router;
