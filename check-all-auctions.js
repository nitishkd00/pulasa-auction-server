const mongoose = require('mongoose');

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
    
    console.log('🔍 Checking all auctions in database...');
    
    // Get all auctions
    const allAuctions = await Auction.find().sort({ created_at: -1 });
    console.log(`\n📊 Total auctions found: ${allAuctions.length}`);
    
    if (allAuctions.length > 0) {
      console.log('\n📋 Auction details:');
      allAuctions.forEach((auction, index) => {
        console.log(`${index + 1}. Auction ID: ${auction._id}`);
        console.log(`   Item Name: ${auction.item_name}`);
        console.log(`   Status: ${auction.status}`);
        console.log(`   Base Price: ₹${auction.base_price}`);
        console.log(`   Highest Bid: ₹${auction.highest_bid || 'None'}`);
        console.log(`   Total Bids: ${auction.total_bids || 0}`);
        console.log(`   Start Time: ${auction.start_time}`);
        console.log(`   End Time: ${auction.end_time}`);
        console.log(`   Created: ${auction.created_at}`);
        console.log('   ---');
      });
    }
    
    // Check all bids
    const allBids = await Bid.find().sort({ created_at: -1 });
    console.log(`\n📊 Total bids found: ${allBids.length}`);
    
    if (allBids.length > 0) {
      console.log('\n📋 Sample bid details (first 5):');
      allBids.slice(0, 5).forEach((bid, index) => {
        console.log(`${index + 1}. Bid ID: ${bid._id}`);
        console.log(`   Auction: ${bid.auction}`);
        console.log(`   Bidder: ${bid.bidder}`);
        console.log(`   Amount: ₹${bid.amount}`);
        console.log(`   Status: ${bid.status}`);
        console.log(`   Payment Status: ${bid.payment_status}`);
        console.log('   ---');
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    mongoose.connection.close();
    console.log('🔌 MongoDB connection closed');
  }
});
