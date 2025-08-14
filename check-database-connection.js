const mongoose = require('mongoose');

// Connect to MongoDB
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
    
    // Check if pulasa-auction database exists
    const pulasaAuctionDb = dbList.databases.find(db => db.name === 'pulasa-auction');
    if (pulasaAuctionDb) {
      console.log(`\n✅ Found pulasa-auction database (Size: ${(pulasaAuctionDb.sizeOnDisk / 1024 / 1024).toFixed(2)} MB)`);
    } else {
      console.log('\n❌ pulasa-auction database not found');
    }
    
    // Check if pulasa database exists
    const pulasaDb = dbList.databases.find(db => db.name === 'pulasa');
    if (pulasaDb) {
      console.log(`✅ Found pulasa database (Size: ${(pulasaDb.sizeOnDisk / 1024 / 1024).toFixed(2)} MB)`);
    } else {
      console.log('❌ pulasa database not found');
    }
    
    // Check if pulasa_auction database exists (with underscore)
    const pulasaUnderscoreDb = dbList.databases.find(db => db.name === 'pulasa_auction');
    if (pulasaUnderscoreDb) {
      console.log(`✅ Found pulasa_auction database (Size: ${(pulasaUnderscoreDb.sizeOnDisk / 1024 / 1024).toFixed(2)} MB)`);
    } else {
      console.log('❌ pulasa_auction database not found');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    mongoose.connection.close();
    console.log('🔌 MongoDB connection closed');
  }
});
