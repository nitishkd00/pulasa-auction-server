// Test the exact bid route logic that's failing
require('dotenv').config();

console.log('🧪 Testing exact bid route logic...');

// Simulate the bid route POST /place logic
async function testBidRoute() {
  try {
    // 1. Test environment variables
    console.log('🔍 Environment check:');
    console.log('RAZORPAY_KEY_ID:', process.env.RAZORPAY_KEY_ID ? 'Present' : 'Missing');
    console.log('RAZORPAY_KEY_SECRET:', process.env.RAZORPAY_KEY_SECRET ? 'Present' : 'Missing');
    
    // 2. Test PaymentService
    console.log('\n🔍 PaymentService test:');
    const PaymentService = require('./services/paymentService.js');
    console.log('PaymentService enabled:', PaymentService.isEnabled);
    
    if (!PaymentService.isEnabled) {
      console.error('❌ PaymentService is disabled!');
      return;
    }
    
    // 3. Test the exact bid route logic
    console.log('\n🔍 Testing bid route logic:');
    
    // Simulate request data
    const auction_id = '689b0bde718cb4c58d13619f';
    const amount = 100;
    const location = '';
    
    console.log('Request data:', { auction_id, amount, location });
    
    // Test ObjectId validation
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(auction_id)) {
      console.error('❌ Invalid auction ID format');
      return;
    }
    console.log('✅ Auction ID validation passed');
    
    // Test PaymentService.createBidOrder
    console.log('\n🔍 Testing PaymentService.createBidOrder...');
    const orderResult = await PaymentService.createBidOrder(amount);
    console.log('✅ Order created:', orderResult);
    
    // Test the response structure that the route expects
    if (!orderResult.success) {
      console.error('❌ Order creation failed:', orderResult.error);
      return;
    }
    
    if (!orderResult.razorpay_order || !orderResult.razorpay_order.id) {
      console.error('❌ Invalid order result structure:', orderResult);
      return;
    }
    
    console.log('✅ Order result structure is valid');
    
    // Test the exact response the route sends
    const response = {
      success: true,
      message: 'Bid placed successfully',
      bid: {
        id: 'test_bid_id',
        amount: amount,
        order_id: orderResult.razorpay_order.id
      },
      razorpay_order: {
        id: orderResult.razorpay_order.id,
        amount: orderResult.razorpay_order.amount,
        currency: orderResult.razorpay_order.currency
      }
    };
    
    console.log('✅ Response structure test passed:', response);
    
  } catch (error) {
    console.error('💥 Test failed with error:', error.message);
    console.error('Stack:', error.stack);
  }
}

// Run the test
testBidRoute();
