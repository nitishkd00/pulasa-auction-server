const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const User = require('../models/User');
const Order = require('../models/Order');

const router = express.Router();

// Get all users (admin only)
router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await User.find({}, 'name email phone created_at').sort({ created_at: -1 });
    
    res.json({
      success: true,
      users: users
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get all orders (admin only)
router.get('/orders', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const orders = await Order.find({})
      .populate('user_id', 'name email')
      .sort({ created_at: -1 });
    
    const formattedOrders = orders.map(order => {
      const productsText = order.products.map(p => `${p.name} x ${p.quantity}`).join(', ');
      const addressText = [order.first_name, order.last_name, order.city, order.state, order.zip].filter(Boolean).join(', ');
      
      return {
        id: order._id,
        order_number: order.order_number,
        user_name: order.user_id ? `${order.user_id.first_name || ''} ${order.user_id.last_name || ''}`.trim() || order.user_id.name : '-',
        user_email: order.user_id ? order.user_id.email : '-',
        products: productsText || '-',
        amount: order.amount,
        status: order.status,
        transaction_reference: order.upi_reference || '-',
        address: addressText || order.address || '-',
        created_at: order.created_at
      };
    });
    
    res.json({
      success: true,
      orders: formattedOrders
    });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Update order status (admin only)
router.put('/orders/:orderId/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;
    
    const order = await Order.findByIdAndUpdate(
      orderId,
      { status },
      { new: true }
    );
    
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }
    
    res.json({
      success: true,
      order: order
    });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get dashboard stats (admin only)
router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalOrders = await Order.countDocuments();
    
    // Calculate revenue (mock data for now)
    const monthlyRevenue = 405000;
    const weeklyRevenue = 75000;
    
    res.json({
      success: true,
      stats: {
        totalUsers,
        totalOrders,
        monthlyRevenue,
        weeklyRevenue
      }
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

module.exports = router; 