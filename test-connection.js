const mongoose = require('mongoose');

// Test the updated connection string
const MONGODB_URI = 'mongodb+srv://nitishkumardevoju:muwLYrPn5blRAGCd@pulasa.sjvscku.mongodb.net/test?retryWrites=true&w=majority&appName=pulasa';

mongoose.connect(MONGODB_URI, {
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
    
    // Check if we can find auctions and bids
    const auctionCount = await Auction.countDocuments();
    const bidCount = await Bid.countDocuments();
    
    console.log(`📊 Auctions found: ${auctionCount}`);
    console.log(`💰 Bids found: ${bidCount}`);
    
    if (auctionCount > 0) {
      const sampleAuction = await Auction.findOne();
      console.log(`\n🏷️  Sample auction: ${sampleAuction.item_name} (ID: ${sampleAuction._id})`);
    }
    
    if (bidCount > 0) {
      const sampleBid = await Bid.findOne().populate('auction', 'title');
      console.log(`\n🎯 Sample bid: ₹${sampleBid.amount} for auction: ${sampleBid.auction ? sampleBid.auction.title : 'Unknown'}`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    mongoose.connection.close();
    console.log('🔌 MongoDB connection closed');
  }
});
