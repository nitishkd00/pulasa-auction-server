const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  order_number: { type: String, required: true, unique: true },
  products: [{
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true }
  }],
  address: { type: String },
  first_name: { type: String },
  last_name: { type: String },
  phone: { type: String },
  city: { type: String },
  state: { type: String },
  zip: { type: String },
  status: { type: String, default: 'pending' },
  upi_reference: { type: String },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

module.exports = mongoose.model('Order', orderSchema); 