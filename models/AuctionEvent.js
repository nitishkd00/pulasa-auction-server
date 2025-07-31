const mongoose = require('mongoose');

const auctionEventSchema = new mongoose.Schema({
  auction: { type: mongoose.Schema.Types.ObjectId, ref: 'Auction', required: true },
  event_type: { type: String, enum: ['created', 'bid_placed', 'bid_outbid', 'ended', 'winner_declared'], required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  amount: { type: Number },
  description: { type: String },
}, {
  timestamps: { createdAt: 'created_at' }
});

module.exports = mongoose.model('AuctionEvent', auctionEventSchema); 