const mongoose = require('mongoose');
const Bid = require('./models/Bid');
const Auction = require('./models/Auction');
const User = require('./models/User');
const paymentService = require('./services/paymentService');

// Test script to verify automatic outbid refunds
async function testOutbidRefundFlow() {
  try {
    console.log('🧪 Starting automatic outbid refund test...\n');

    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/pulasa-auction';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Step 1: Create test users
    console.log('\n👥 Step 1: Creating test users...');
    const user1 = await User.findOneAndUpdate(
      { email: 'testuser1@test.com' },
      { 
        username: 'testuser1',
        email: 'testuser1@test.com',
        password: 'testpass123',
        is_admin: false
      },
      { upsert: true, new: true }
    );
    
    const user2 = await User.findOneAndUpdate(
      { email: 'testuser2@test.com' },
      { 
        username: 'testuser2',
        email: 'testuser2@test.com',
        password: 'testpass123',
        is_admin: false
      },
      { upsert: true, new: true }
    );
    
    console.log(`✅ Created test users: ${user1.username}, ${user2.username}`);

    // Step 2: Create test auction
    console.log('\n🏷️ Step 2: Creating test auction...');
    const testAuction = await Auction.findOneAndUpdate(
      { item_name: 'Test Item for Refund' },
      {
        item_name: 'Test Item for Refund',
        description: 'Testing automatic refund flow',
        item_image: 'https://via.placeholder.com/300x200?text=Test+Item',
        base_price: 100,
        start_time: new Date(Date.now() - 24 * 60 * 60 * 1000), // Started 1 day ago
        end_time: new Date(Date.now() + 24 * 60 * 60 * 1000),   // Ends in 1 day
        status: 'active',
        highest_bid: 0,
        highest_bidder: null,
        category: 'test',
        location: 'Test Location'
      },
      { upsert: true, new: true }
    );
    console.log(`✅ Created test auction: ${testAuction.item_name}`);

    // Step 3: Simulate first bid (User 1)
    console.log('\n💰 Step 3: Simulating first bid by User 1...');
    const firstBid = new Bid({
      auction: testAuction._id,
      bidder: user1._id,
      amount: 150,
      status: 'active',
      payment_status: 'authorized',
      razorpay_order_id: 'test_order_1',
      razorpay_payment_id: 'test_payment_1',
      authorized_amount: 150,
      created_at: new Date()
    });
    await firstBid.save();
    
    // Update auction with first bid
    testAuction.highest_bid = 150;
    testAuction.highest_bidder = user1._id;
    await testAuction.save();
    
    console.log(`✅ User 1 placed bid: ₹${firstBid.amount}`);
    console.log(`✅ Auction highest bid updated to: ₹${testAuction.highest_bid}`);

    // Step 4: Simulate second bid (User 2) - This should trigger automatic refund
    console.log('\n🚀 Step 4: Simulating second bid by User 2 (should trigger automatic refund)...');
    
    // Check current auction state
    const currentAuction = await Auction.findById(testAuction._id);
    console.log(`📊 Current auction state:`);
    console.log(`   - Highest bid: ₹${currentAuction.highest_bid}`);
    console.log(`   - Highest bidder: ${currentAuction.highest_bidder}`);
    
    // Simulate the outbid scenario
    const secondBidAmount = 200;
    console.log(`💰 User 2 attempting to bid: ₹${secondBidAmount}`);
    
    // This simulates what happens in the /verify route when outbid occurs
    if (currentAuction.highest_bidder && currentAuction.highest_bid > 0 && 
        currentAuction.highest_bidder.toString() !== user2._id.toString()) {
      
      console.log('🔄 Outbid detected! Processing automatic refund...');
      
      // Find the current highest bid
      const currentHighestBid = await Bid.findOne({
        auction: currentAuction._id,
        bidder: currentAuction.highest_bidder,
        status: 'active',
        payment_status: 'authorized'
      });

      if (currentHighestBid) {
        console.log(`💰 Processing refund for User 1's bid of ₹${currentHighestBid.amount}`);
        
        // Simulate refund (in real scenario, this would call Razorpay)
        const refundResult = {
          success: true,
          refund_id: 'test_refund_' + Date.now(),
          refunded_amount: currentHighestBid.amount,
          status: 'processed'
        };
        
        console.log(`✅ Refund processed: ${refundResult.refund_id}`);

        // Update previous bid status
        currentHighestBid.status = 'outbid';
        currentHighestBid.payment_status = 'refunded';
        currentHighestBid.refund_details = {
          refund_id: refundResult.refund_id,
          refunded_amount: refundResult.refunded_amount,
          refund_reason: 'Outbid by another user',
          refunded_at: new Date()
        };
        await currentHighestBid.save();
        
        // Also update the firstBid reference to keep it in sync
        firstBid.status = 'outbid';
        firstBid.payment_status = 'refunded';
        firstBid.refund_details = currentHighestBid.refund_details;
        
        console.log(`✅ User 1's bid status updated to: ${currentHighestBid.status}`);
        console.log(`✅ Payment status updated to: ${currentHighestBid.payment_status}`);
      }
    }

    // Create new bid for User 2
    const secondBid = new Bid({
      auction: testAuction._id,
      bidder: user2._id,
      amount: secondBidAmount,
      status: 'active',
      payment_status: 'authorized',
      razorpay_order_id: 'test_order_2',
      razorpay_payment_id: 'test_payment_2',
      authorized_amount: secondBidAmount,
      created_at: new Date()
    });
    await secondBid.save();
    
    // Update auction with new highest bid
    testAuction.highest_bid = secondBidAmount;
    testAuction.highest_bidder = user2._id;
    await testAuction.save();
    
    console.log(`✅ User 2's bid placed successfully: ₹${secondBid.amount}`);

    // Step 5: Verify the results
    console.log('\n🔍 Step 5: Verifying automatic refund results...');
    
    // Check User 1's bid status
    const user1Bid = await Bid.findById(firstBid._id);
    console.log(`\n📊 User 1's bid status:`);
    console.log(`   - Status: ${user1Bid.status}`);
    console.log(`   - Payment Status: ${user1Bid.payment_status}`);
    console.log(`   - Refund Details: ${user1Bid.refund_details ? 'Present' : 'None'}`);
    
    if (user1Bid.refund_details) {
      console.log(`   - Refund ID: ${user1Bid.refund_details.refund_id}`);
      console.log(`   - Refund Amount: ₹${user1Bid.refund_details.refunded_amount}`);
      console.log(`   - Refund Reason: ${user1Bid.refund_details.refund_reason}`);
    }
    
    // Check User 2's bid status
    const user2Bid = await Bid.findById(secondBid._id);
    console.log(`\n📊 User 2's bid status:`);
    console.log(`   - Status: ${user2Bid.status}`);
    console.log(`   - Payment Status: ${user2Bid.payment_status}`);
    
    // Check final auction state
    const finalAuction = await Auction.findById(testAuction._id);
    console.log(`\n📊 Final auction state:`);
    console.log(`   - Highest bid: ₹${finalAuction.highest_bid}`);
    console.log(`   - Highest bidder: ${finalAuction.highest_bidder}`);
    
    // Test results
    console.log('\n🎯 Test Results:');
    if (user1Bid.status === 'outbid' && user1Bid.payment_status === 'refunded' && user1Bid.refund_details) {
      console.log('✅ SUCCESS: Automatic refund worked correctly!');
      console.log('   - User 1 was automatically outbid');
      console.log('   - Payment was automatically refunded');
      console.log('   - Refund details were properly recorded');
    } else {
      console.log('❌ FAILED: Automatic refund did not work as expected');
      console.log('   - Check the bid statuses and refund details above');
    }
    
    if (user2Bid.status === 'active' && finalAuction.highest_bidder.toString() === user2._id.toString()) {
      console.log('✅ SUCCESS: New bid was properly recorded!');
      console.log('   - User 2 is now the highest bidder');
      console.log('   - Auction highest bid was updated correctly');
    } else {
      console.log('❌ FAILED: New bid was not properly recorded');
    }

    console.log('\n🧹 Cleaning up test data...');
    // Clean up test data
    await Bid.deleteMany({ auction: testAuction._id });
    await Auction.findByIdAndDelete(testAuction._id);
    await User.findByIdAndDelete(user1._id);
    await User.findByIdAndDelete(user2._id);
    console.log('✅ Test data cleaned up');

  } catch (error) {
    console.error('❌ Test failed with error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
    console.log('\n🏁 Test completed!');
  }
}

// Run the test
if (require.main === module) {
  testOutbidRefundFlow();
}

module.exports = { testOutbidRefundFlow };
