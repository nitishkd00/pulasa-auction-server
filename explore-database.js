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
    // Get all collections
    const collections = await db.db.listCollections().toArray();
    console.log(`\n📚 Collections found: ${collections.length}`);
    collections.forEach(col => console.log(`   - ${col.name}`));
    
    // Explore each collection
    for (const collection of collections) {
      console.log(`\n🔍 Exploring collection: ${collection.name}`);
      
      try {
        const count = await db.db.collection(collection.name).countDocuments();
        console.log(`   📊 Document count: ${count}`);
        
        if (count > 0) {
          // Get a sample document to see structure
          const sample = await db.db.collection(collection.name).findOne();
          console.log(`   📋 Sample document structure:`);
          console.log(`      ${JSON.stringify(sample, null, 6)}`);
          
          // If it's auctions or bids, show more details
          if (collection.name === 'auctions') {
            console.log(`\n   🏷️  All auctions:`);
            const auctions = await db.db.collection(collection.name).find().toArray();
            auctions.forEach((auction, index) => {
              console.log(`      ${index + 1}. ID: ${auction._id}`);
              console.log(`         Name: ${auction.item_name || auction.title || 'N/A'}`);
              console.log(`         Status: ${auction.status || 'N/A'}`);
              console.log(`         Highest Bid: ${auction.highest_bid || 'N/A'}`);
              console.log(`         Created: ${auction.created_at || auction.createdAt || 'N/A'}`);
            });
          }
          
          if (collection.name === 'bids') {
            console.log(`\n   💰 All bids:`);
            const bids = await db.db.collection(collection.name).find().toArray();
            bids.forEach((bid, index) => {
              console.log(`      ${index + 1}. ID: ${bid._id}`);
              console.log(`         Auction: ${bid.auction || 'N/A'}`);
              console.log(`         Bidder: ${bid.bidder || 'N/A'}`);
              console.log(`         Amount: ${bid.amount || 'N/A'}`);
              console.log(`         Status: ${bid.status || 'N/A'}`);
              console.log(`         Payment: ${bid.payment_status || 'N/A'}`);
            });
          }
        }
        
      } catch (error) {
        console.log(`   ❌ Error exploring ${collection.name}: ${error.message}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    mongoose.connection.close();
    console.log('🔌 MongoDB connection closed');
  }
});
