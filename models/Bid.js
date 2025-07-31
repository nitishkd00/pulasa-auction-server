const mongoose = require('mongoose');

const bidSchema = new mongoose.Schema({
  auction: { type: mongoose.Schema.Types.ObjectId, ref: 'Auction', required: true },
  bidder: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  location: { type: String },
  status: { type: String, enum: ['active', 'outbid', 'won', 'cancelled', 'success'], default: 'active' },
}, {
  timestamps: { createdAt: 'created_at' }
});

module.exports = mongoose.model('Bid', bidSchema); 