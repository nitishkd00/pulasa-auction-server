// Test script to simulate bid placement locally
require('dotenv').config();

console.log('🧪 Testing bid placement locally...');
console.log('Environment variables:');
console.log('RAZORPAY_KEY_ID:', process.env.RAZORPAY_KEY_ID ? 'Present' : 'Missing');
console.log('RAZORPAY_KEY_SECRET:', process.env.RAZORPAY_KEY_SECRET ? 'Present' : 'Missing');
console.log('MONGODB_URI:', process.env.MONGODB_URI ? 'Present' : 'Missing');
console.log('NODE_ENV:', process.env.NODE_ENV);

// Test PaymentService
console.log('\n🔧 Testing PaymentService...');
try {
  const PaymentService = require('./services/paymentService.js');
  console.log('✅ PaymentService loaded successfully');
  console.log('Is enabled:', PaymentService.isEnabled);
  
  if (PaymentService.isEnabled) {
    console.log('✅ Razorpay is configured and enabled');
    
    // Test creating a bid order
    console.log('\n🧪 Testing createBidOrder...');
    PaymentService.createBidOrder(100).then(result => {
      console.log('✅ createBidOrder result:', result);
    }).catch(error => {
      console.error('❌ createBidOrder error:', error.message);
    });
    
  } else {
    console.error('❌ Razorpay is not enabled');
  }
  
} catch (error) {
  console.error('❌ Failed to load PaymentService:', error.message);
}

// Test bid route logic
console.log('\n🔧 Testing bid route logic...');
try {
  const { body, validationResult, param } = require('express-validator');
  console.log('✅ express-validator loaded successfully');
  
  // Test ObjectId validation
  const mongoose = require('mongoose');
  const testId = '689b0bde718cb4c58d13619f';
  const isValid = mongoose.Types.ObjectId.isValid(testId);
  console.log('✅ ObjectId validation test:', { testId, isValid });
  
} catch (error) {
  console.error('❌ Failed to test bid route logic:', error.message);
}

console.log('\n🧪 Local testing complete!');
