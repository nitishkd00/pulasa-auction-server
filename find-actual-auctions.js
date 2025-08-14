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
    
    console.log('🔍 Checking all auctions and bids...');
    
    // Get all auctions
    const allAuctions = await Auction.find().sort({ created_at: -1 });
    console.log(`\n📊 Total auctions found: ${allAuctions.length}`);
    
    if (allAuctions.length > 0) {
      console.log('\n🏷️  Auctions:');
      allAuctions.forEach((auction, index) => {
        console.log(`\n${index + 1}. Auction ID: ${auction._id}`);
        console.log(`   Title: ${auction.title}`);
        console.log(`   Status: ${auction.status}`);
        console.log(`   Created: ${auction.created_at}`);
        console.log(`   Highest Bid: ₹${auction.highest_bid || 'None'}`);
        console.log(`   Total Bids: ${auction.total_bids || 0}`);
      });
    }
    
    // Get all bids
    const allBids = await Bid.find().populate('auction', 'title status').populate('bidder', 'username name').sort({ created_at: -1 });
    console.log(`\n💰 Total bids found: ${allBids.length}`);
    
    if (allBids.length > 0) {
      console.log('\n🎯 Bids:');
      allBids.forEach((bid, index) => {
        console.log(`\n${index + 1}. Bid ID: ${bid._id}`);
        console.log(`   Auction: ${bid.auction ? bid.auction.title : 'Unknown'} (${bid.auction})`);
        console.log(`   Bidder: ${bid.bidder ? (bid.bidder.username || bid.bidder.name) : 'Unknown'} (${bid.bidder})`);
        console.log(`   Amount: ₹${bid.amount}`);
        console.log(`   Status: ${bid.status}`);
        console.log(`   Payment: ${bid.payment_status}`);
        console.log(`   Created: ${bid.created_at}`);
      });
    }
    
    // Check the specific auction ID you're trying to access
    const targetAuctionId = '689dc158a626c036396fa5fa';
    console.log(`\n🎯 Checking target auction ID: ${targetAuctionId}`);
    
    const targetAuction = await Auction.findById(targetAuctionId);
    if (targetAuction) {
      console.log('✅ Target auction found!');
      console.log(`   Title: ${targetAuction.title}`);
      console.log(`   Status: ${targetAuction.status}`);
    } else {
      console.log('❌ Target auction NOT found!');
      
      // Check if there are any bids for this auction ID
      const targetBids = await Bid.find({ auction: targetAuctionId });
      console.log(`   Bids for this auction: ${targetBids.length}`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    mongoose.connection.close();
    console.log('🔌 MongoDB connection closed');
  }
});
