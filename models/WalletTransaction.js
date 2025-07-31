const mongoose = require('mongoose');

const walletTransactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['topup', 'bid', 'refund', 'withdrawal', 'unlock'], required: true },
  amount: { type: Number, required: true },
  balance_before: { type: Number, required: true },
  balance_after: { type: Number, required: true },
  locked_before: { type: Number, default: 0.00 },
  locked_after: { type: Number, default: 0.00 },
  razorpay_payment_id: { type: String },
  razorpay_order_id: { type: String },
  razorpay_refund_id: { type: String },
  auction: { type: mongoose.Schema.Types.ObjectId, ref: 'Auction' },
  bid: { type: mongoose.Schema.Types.ObjectId, ref: 'Bid' },
  status: { type: String, enum: ['pending', 'success', 'failed', 'refunded'], default: 'pending' },
  description: { type: String },
}, {
  timestamps: { createdAt: 'created_at' }
});

module.exports = mongoose.model('WalletTransaction', walletTransactionSchema); 