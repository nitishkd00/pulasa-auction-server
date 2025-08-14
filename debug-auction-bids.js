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
    
    const targetAuctionId = '689dc158a626c036396fa5fa';
    console.log(`🔍 Debugging auction: ${targetAuctionId}`);
    
    // Check if auction exists
    const auction = await Auction.findById(targetAuctionId);
    if (!auction) {
      console.log('❌ Auction not found!');
      return;
    }
    
    console.log(`\n🏷️  Auction found:`);
    console.log(`   ID: ${auction._id}`);
    console.log(`   Name: ${auction.item_name}`);
    console.log(`   Status: ${auction.status}`);
    console.log(`   Highest Bid: ₹${auction.highest_bid}`);
    console.log(`   Highest Bidder: ${auction.highest_bidder}`);
    
    // Check for bids for this specific auction
    const bidsForAuction = await Bid.find({ auction: targetAuctionId });
    console.log(`\n💰 Bids for this auction: ${bidsForAuction.length}`);
    
    if (bidsForAuction.length > 0) {
      console.log('\n🎯 Bids found:');
      bidsForAuction.forEach((bid, index) => {
        console.log(`\n${index + 1}. Bid ID: ${bid._id}`);
        console.log(`   Amount: ₹${bid.amount}`);
        console.log(`   Bidder: ${bid.bidder}`);
        console.log(`   Status: ${bid.status}`);
        console.log(`   Payment: ${bid.payment_status}`);
        console.log(`   Created: ${bid.created_at}`);
      });
    } else {
      console.log('\n❌ No bids found for this auction!');
      
      // Check all bids to see what auctions they belong to
      const allBids = await Bid.find().populate('auction', 'item_name _id');
      console.log(`\n🔍 All bids in database: ${allBids.length}`);
      
      if (allBids.length > 0) {
        console.log('\n📋 Bids by auction:');
        const bidsByAuction = {};
        allBids.forEach(bid => {
          const auctionId = bid.auction ? bid.auction._id : 'Unknown';
          const auctionName = bid.auction ? bid.auction.item_name : 'Unknown';
          if (!bidsByAuction[auctionId]) {
            bidsByAuction[auctionId] = { name: auctionName, count: 0, bids: [] };
          }
          bidsByAuction[auctionId].count++;
          bidsByAuction[auctionId].bids.push(bid);
        });
        
        Object.entries(bidsByAuction).forEach(([auctionId, data]) => {
          console.log(`\n   Auction: ${data.name} (${auctionId})`);
          console.log(`   Bid count: ${data.count}`);
          data.bids.forEach(bid => {
            console.log(`     - ₹${bid.amount} by ${bid.bidder} (${bid.status})`);
          });
        });
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    mongoose.connection.close();
    console.log('🔌 MongoDB connection closed');
  }
});
