const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect('mongodb+srv://nitishkumardevoju:muwLYrPn5blRAGCd@pulasa.sjvscku.mongodb.net/pulasa-auction?retryWrites=true&w=majority&appName=pulasa', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', async () => {
  console.log('✅ Connected to MongoDB');
  
  try {
    // Import models
    const Auction = require('./models/Auction');
    const Bid = require('./models/Bid');
    
    const auctionId = '689dc158a626c036396fa5fa';
    
    console.log(`🔍 Checking auction: ${auctionId}`);
    
    // Check if auction exists
    const auction = await Auction.findById(auctionId);
    if (!auction) {
      console.log('❌ Auction not found');
      return;
    }
    
    console.log('✅ Auction found:', {
      id: auction._id,
      item_name: auction.item_name,
      status: auction.status,
      highest_bid: auction.highest_bid,
      highest_bidder: auction.highest_bidder,
      total_bids: auction.total_bids,
      start_time: auction.start_time,
      end_time: auction.end_time
    });
    
    // Check all bids for this auction
    const allBids = await Bid.find({ auction: auctionId });
    console.log(`\n📊 Total bids found: ${allBids.length}`);
    
    if (allBids.length > 0) {
      console.log('\n📋 Bid details:');
      allBids.forEach((bid, index) => {
        console.log(`${index + 1}. Bid ID: ${bid._id}`);
        console.log(`   Bidder: ${bid.bidder}`);
        console.log(`   Amount: ₹${bid.amount}`);
        console.log(`   Status: ${bid.status}`);
        console.log(`   Payment Status: ${bid.payment_status}`);
        console.log(`   Created: ${bid.created_at}`);
        console.log(`   Updated: ${bid.updated_at}`);
        console.log('   ---');
      });
    }
    
    // Check active/authorized bids specifically
    const activeBids = await Bid.find({ 
      auction: auctionId,
      status: { $in: ['active', 'authorized'] }
    });
    console.log(`\n🟢 Active/Authorized bids: ${activeBids.length}`);
    
    // Check outbid/refunded bids
    const outbidBids = await Bid.find({ 
      auction: auctionId,
      status: 'outbid'
    });
    console.log(`🟡 Outbid bids: ${outbidBids.length}`);
    
    // Check if there are any bids with different auction IDs
    const allBidsInSystem = await Bid.find().limit(10);
    console.log(`\n🔍 Sample of all bids in system (first 10):`);
    allBidsInSystem.forEach((bid, index) => {
      console.log(`${index + 1}. Auction: ${bid.auction}, Amount: ₹${bid.amount}, Status: ${bid.status}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    mongoose.connection.close();
    console.log('🔌 MongoDB connection closed');
  }
});
