const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password_hash: { type: String, required: true },
  name: { type: String, required: true },
  phone: { type: String },
  address: { type: String },
  is_admin: { type: Boolean, default: false },
  wallet_balance: { type: Number, default: 0.00 },
  locked_amount: { type: Number, default: 0.00 },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

module.exports = mongoose.model('User', userSchema); 