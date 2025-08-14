const mongoose = require('mongoose');

// Connect to MongoDB
mongoose.connect('mongodb+srv://nitishkumardevoju:muwLYrPn5blRAGCd@pulasa.sjvscku.mongodb.net/test?retryWrites=true&w=majority&appName=pulasa', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', async () => {
  console.log('✅ Connected to MongoDB (test database)');
  
  try {
    // Import models
    const Auction = require('./models/Auction');
    const Bid = require('./models/Bid');
    const User = require('./models/User');
    
    const targetAuctionId = '689dc158a626c036396fa5fa';
    console.log(`🔍 Testing bid endpoint for auction: ${targetAuctionId}`);
    
    // Test 1: Direct database query (what the endpoint does)
    console.log('\n📊 Test 1: Direct database query');
    const bids = await Bid.find({ auction: targetAuctionId })
      .populate('bidder', 'username name email')
      .sort({ created_at: -1 });
    
    console.log(`   Bids found: ${bids.length}`);
    if (bids.length > 0) {
      bids.forEach((bid, index) => {
        console.log(`\n   Bid ${index + 1}:`);
        console.log(`     ID: ${bid._id}`);
        console.log(`     Amount: ₹${bid.amount}`);
        console.log(`     Status: ${bid.status}`);
        console.log(`     Payment: ${bid.payment_status}`);
        console.log(`     Bidder: ${bid.bidder ? JSON.stringify(bid.bidder) : 'Not populated'}`);
        console.log(`     Created: ${bid.created_at}`);
      });
    }
    
    // Test 2: Check if the bidder user exists
    console.log('\n👤 Test 2: Check bidder user');
    if (bids.length > 0) {
      const bidderId = bids[0].bidder;
      if (bidderId) {
        const user = await User.findById(bidderId);
        console.log(`   Bidder user found: ${user ? 'Yes' : 'No'}`);
        if (user) {
          console.log(`   Username: ${user.username}`);
          console.log(`   Name: ${user.name}`);
          console.log(`   Email: ${user.email}`);
        }
      } else {
        console.log('   ❌ Bidder ID is null/undefined');
      }
    }
    
    // Test 3: Check the exact query the endpoint uses
    console.log('\n🔍 Test 3: Raw bid data without populate');
    const rawBids = await Bid.find({ auction: targetAuctionId }).sort({ created_at: -1 });
    console.log(`   Raw bids found: ${rawBids.length}`);
    if (rawBids.length > 0) {
      rawBids.forEach((bid, index) => {
        console.log(`\n   Raw Bid ${index + 1}:`);
        console.log(`     ID: ${bid._id}`);
        console.log(`     Auction: ${bid.auction}`);
        console.log(`     Bidder: ${bid.bidder}`);
        console.log(`     Amount: ₹${bid.amount}`);
        console.log(`     Status: ${bid.status}`);
        console.log(`     Payment: ${bid.payment_status}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    mongoose.connection.close();
    console.log('🔌 MongoDB connection closed');
  }
});
