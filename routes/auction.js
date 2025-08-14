const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { authenticateToken, optionalAuth, requireAdmin } = require('../middleware/auth');
const Auction = require('../models/Auction');
const User = require('../models/User');
const Bid = require('../models/Bid');
const AuctionEvent = require('../models/AuctionEvent');
const mongoose = require('mongoose');

const router = express.Router();

// Helper function to fix timezone issues
const fixTimezone = (dateString) => {
  // If the date string contains a time (not just date), handle timezone
  if (dateString.includes('T') && dateString.includes(':')) {
    // Parse as local time and create a proper date object
    const date = new Date(dateString);
    
    // Check if this looks like a timezone-shifted time
    // If hours are 18+ (6 PM or later), it might be shifted
    if (date.getHours() >= 18) {
      // Get local timezone offset
      const localOffset = new Date().getTimezoneOffset() * 60000;
      // Adjust the time back to local time
      return new Date(date.getTime() + localOffset);
    }
  }
  
  // Return original date if no adjustment needed
  return new Date(dateString);
};

// Create new auction (Admin only)
router.post('/create', authenticateToken, requireAdmin, [
  body('item_name').notEmpty().withMessage('Item name is required'),
  body('item_image').isURL().withMessage('Valid image URL is required'),
  body('base_price').isFloat({ min: 0.01 }).withMessage('Base price must be greater than 0'),
  body('start_time').isISO8601().withMessage('Valid start time is required'),
  body('end_time').isISO8601().withMessage('Valid end time is required'),
  body('description').notEmpty().withMessage('Description is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('Validation errors:', errors.array());
      return res.status(400).json({ 
        error: 'Validation failed',
        details: errors.array().map(err => `${err.path}: ${err.msg}`).join(', ')
      });
    }

    const { item_name, item_image, base_price, start_time, end_time, description } = req.body;

    console.log('Received auction data:', {
      item_name,
      item_image,
      base_price,
      start_time,
      end_time,
      description: description ? `${description.substring(0, 50)}...` : 'MISSING'
    });
    
    console.log('User info:', {
      userId: req.user._id,
      email: req.user.email,
      isAdmin: req.user.is_admin
    });

    // Fix timezone issues
    const startDateTime = fixTimezone(start_time);
    const endDateTime = fixTimezone(end_time);
    const now = new Date();

    console.log('Parsed startDateTime:', startDateTime);
    console.log('Parsed endDateTime:', endDateTime);

    // Validate that dates are valid
    if (isNaN(startDateTime.getTime())) {
      return res.status(400).json({ error: 'Invalid start time format' });
    }
    if (isNaN(endDateTime.getTime())) {
      return res.status(400).json({ error: 'Invalid end time format' });
    }

    if (startDateTime <= now) {
      return res.status(400).json({ error: 'Start time must be in the future' });
    }
    if (endDateTime <= startDateTime) {
      return res.status(400).json({ error: 'End time must be after start time' });
    }

    // Create auction in MongoDB
    const auction = await Auction.create({
      item_name,
      item_image,
      base_price,
      description,
      start_time: startDateTime,
      end_time: endDateTime,
      created_by: req.user._id
    });

    // Log auction creation event
    await AuctionEvent.create({
      auction: auction._id,
      event_type: 'created',
      user: req.user._id,
      description: `Auction created for ${item_name}`
    });

    // Populate created_by field for response
    await auction.populate('created_by', 'username');

    res.status(201).json({
      message: 'Auction created successfully',
      auction: {
        ...auction.toObject(),
        start_time: startDateTime.toISOString(),
        end_time: endDateTime.toISOString()
      }
    });
  } catch (error) {
    console.error('Create auction error:', error);
    console.error('Full error details:', error);
    res.status(500).json({ 
      error: 'Failed to create auction', 
      details: error.message
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
      query.status = { $ne: 'ended' };
    } else if (status === 'ended') {
      query.end_time = { $lte: now };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const auctions = await Auction.find(query)
      .populate('created_by', 'username')
      .populate('highest_bidder', 'username')
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Auction.countDocuments(query);

    res.json({
      auctions,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalAuctions: total
      }
    });
  } catch (error) {
    console.error('Get auctions error:', error);
    res.status(500).json({ error: 'Failed to fetch auctions' });
  }
});

// Get single auction by ID
router.get('/:id', [
  param('id').custom((value) => {
    if (!mongoose.Types.ObjectId.isValid(value)) {
      throw new Error('Invalid auction ID format');
    }
    return true;
  })
], optionalAuth, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Invalid auction ID format',
        details: errors.array()
      });
    }

    const auction = await Auction.findById(req.params.id)
      .populate('created_by', 'username')
      .populate('highest_bidder', 'username')
      .populate('winner', 'username');

    if (!auction) {
      return res.status(404).json({ error: 'Auction not found' });
    }

    res.json({ auction });
  } catch (error) {
    console.error('Get auction error:', error);
    res.status(500).json({ error: 'Failed to fetch auction' });
  }
});

// Update auction (Admin only)
router.put('/:id', [
  param('id').custom((value) => {
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

    const { item_name, item_image, base_price, start_time, end_time, description } = req.body;
    
    const updateData = {};
    if (item_name) updateData.item_name = item_name;
    if (item_image) updateData.item_image = item_image;
    if (base_price) updateData.base_price = base_price;
    if (description) updateData.description = description;
    
    if (start_time) {
      const startDateTime = fixTimezone(start_time);
      if (isNaN(startDateTime.getTime())) {
        return res.status(400).json({ error: 'Invalid start time format' });
      }
      updateData.start_time = startDateTime;
    }
    
    if (end_time) {
      const endDateTime = fixTimezone(end_time);
      if (isNaN(endDateTime.getTime())) {
        return res.status(400).json({ error: 'Invalid end time format' });
      }
      updateData.end_time = endDateTime;
    }

    const auction = await Auction.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).populate('created_by', 'username');

    if (!auction) {
      return res.status(404).json({ error: 'Auction not found' });
    }

    res.json({ message: 'Auction updated successfully', auction });
  } catch (error) {
    console.error('Update auction error:', error);
    res.status(500).json({ error: 'Failed to update auction' });
  }
});

// Delete auction (Admin only)
router.delete('/:id', [
  param('id').custom((value) => {
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

    const auction = await Auction.findByIdAndDelete(req.params.id);
    
    if (!auction) {
      return res.status(404).json({ error: 'Auction not found' });
    }

    // Delete related bids and events
    await Bid.deleteMany({ auction: req.params.id });
    await AuctionEvent.deleteMany({ auction: req.params.id });

    res.json({ message: 'Auction deleted successfully' });
  } catch (error) {
    console.error('Delete auction error:', error);
    res.status(500).json({ error: 'Failed to delete auction' });
  }
});

module.exports = router;
