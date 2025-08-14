const mongoose = require('mongoose');

const bidSchema = new mongoose.Schema({
  auction: { type: mongoose.Schema.Types.ObjectId, ref: 'Auction', required: true },
  bidder: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  location: { type: String },
  // Razorpay payment fields
  razorpay_order_id: { type: String, required: true },
  razorpay_payment_id: { type: String },
  payment_status: { 
    type: String, 
    enum: ['authorized', 'captured', 'refunded'], 
    default: 'authorized' 
  },
  authorized_amount: { type: Number, required: true },
  // Transaction fee fields
  transaction_fee: { type: Number, required: true },
  total_amount: { type: Number, required: true },
  // Bid status
  status: { type: String, enum: ['active', 'outbid', 'won', 'cancelled', 'success'], default: 'active' },
  // Refund details for outbid bids
  refund_details: {
    refund_id: String,
    refunded_amount: Number,
    refund_reason: String,
    refunded_at: Date
  }
}, {
  timestamps: { createdAt: 'created_at' }
});

module.exports = mongoose.model('Bid', bidSchema);
