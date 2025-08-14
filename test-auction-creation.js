const mongoose = require('mongoose');
const Auction = require('./models/Auction');
const User = require('./models/User');

// Test script to verify auction creation
async function testAuctionCreation() {
  try {
    console.log('🧪 Testing auction creation...\n');

    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/pulasa-auction';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Check if we have any users
    const users = await User.find().limit(5);
    console.log(`📊 Found ${users.length} users in database`);
    
    if (users.length === 0) {
      console.log('❌ No users found. Cannot test auction creation.');
      return;
    }

    // Check if we have any admin users
    const adminUsers = users.filter(user => user.is_admin);
    console.log(`👑 Found ${adminUsers.length} admin users`);
    
    if (adminUsers.length === 0) {
      console.log('❌ No admin users found. Cannot test auction creation.');
      return;
    }

    // Check existing auctions
    const existingAuctions = await Auction.countDocuments();
    console.log(`📈 Existing auctions: ${existingAuctions}`);

    // Test auction data
    const testAuctionData = {
      item_name: 'Test Pulasa Fish',
      item_image: 'https://example.com/test-fish.jpg',
      base_price: 1000.00,
      description: 'This is a test auction for testing purposes',
      start_time: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
      end_time: new Date(Date.now() + 48 * 60 * 60 * 1000),   // 48 hours from now
      created_by: adminUsers[0]._id
    };

    console.log('\n📝 Test auction data:');
    console.log(JSON.stringify(testAuctionData, null, 2));

    // Try to create the auction directly in MongoDB
    try {
      const auction = await Auction.create(testAuctionData);
      console.log('\n✅ Auction created successfully in MongoDB!');
      console.log('   - ID:', auction._id);
      console.log('   - Status:', auction.status);
      console.log('   - Created by:', auction.created_by);
      
      // Clean up - delete the test auction
      await Auction.findByIdAndDelete(auction._id);
      console.log('🧹 Test auction cleaned up');
      
    } catch (dbError) {
      console.log('\n❌ Failed to create auction in MongoDB:');
      console.log('   Error:', dbError.message);
      
      if (dbError.errors) {
        console.log('   Validation errors:');
        Object.keys(dbError.errors).forEach(field => {
          console.log(`     ${field}: ${dbError.errors[field].message}`);
        });
      }
    }

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
  testAuctionCreation();
}

module.exports = { testAuctionCreation };
