const mongoose = require('mongoose');

// Connect to MongoDB without specifying database
mongoose.connect('mongodb+srv://nitishkumardevoju:muwLYrPn5blRAGCd@pulasa.sjvscku.mongodb.net/?retryWrites=true&w=majority&appName=pulasa', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', async () => {
  console.log('✅ Connected to MongoDB');
  
  try {
    // List all databases
    const adminDb = mongoose.connection.db.admin();
    const dbList = await adminDb.listDatabases();
    
    console.log('\n🔍 Available databases:');
    dbList.databases.forEach(db => {
      console.log(`   - ${db.name} (Size: ${(db.sizeOnDisk / 1024 / 1024).toFixed(2)} MB)`);
    });
    
    // Check each database for auctions and bids
    for (const database of dbList.databases) {
      if (database.name === 'admin' || database.name === 'local') continue;
      
      console.log(`\n🔍 Checking database: ${database.name}`);
      
      try {
        // Connect to this specific database
        const dbConnection = mongoose.connection.useDb(database.name);
        
        // Check if collections exist
        const collections = await dbConnection.db.listCollections().toArray();
        console.log(`   Collections: ${collections.map(c => c.name).join(', ')}`);
        
        // Check for auctions collection
        if (collections.find(c => c.name === 'auctions')) {
          const auctionCount = await dbConnection.db.collection('auctions').countDocuments();
          console.log(`   📊 Auctions: ${auctionCount}`);
          
          if (auctionCount > 0) {
            const sampleAuction = await dbConnection.db.collection('auctions').findOne();
            console.log(`   Sample auction ID: ${sampleAuction._id}`);
          }
        }
        
        // Check for bids collection
        if (collections.find(c => c.name === 'bids')) {
          const bidCount = await dbConnection.db.collection('bids').countDocuments();
          console.log(`   💰 Bids: ${bidCount}`);
          
          if (bidCount > 0) {
            const sampleBid = await dbConnection.db.collection('bids').findOne();
            console.log(`   Sample bid auction: ${sampleBid.auction}`);
          }
        }
        
      } catch (error) {
        console.log(`   ❌ Error accessing ${database.name}: ${error.message}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    mongoose.connection.close();
    console.log('🔌 MongoDB connection closed');
  }
});
