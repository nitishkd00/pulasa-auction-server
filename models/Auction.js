const mongoose = require('mongoose');

const auctionSchema = new mongoose.Schema({
  item_name: { type: String, required: true },
  item_image: { type: String, required: true },
  base_price: { type: Number, required: true },
  description: { type: String, required: true },
  start_time: { type: Date, required: true },
  end_time: { type: Date, required: true },
  highest_bid: { type: Number, default: 0 },
  highest_bidder: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  status: { type: String, enum: ['pending', 'active', 'ended', 'cancelled'], default: 'pending' },
  winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  winning_amount: { type: Number },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

module.exports = mongoose.model('Auction', auctionSchema); 