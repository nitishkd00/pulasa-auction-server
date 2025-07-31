const mongoose = require('mongoose');
const Auction = require('./models/Auction');

// TODO: Replace with your actual MongoDB connection string or use environment variable
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/YOUR_DB_NAME';

async function main() {
  await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  const auctions = await Auction.find({});
  if (auctions.length === 0) {
    console.log('No auctions found.');
  } else {
    console.log('Auctions in database:');
    auctions.forEach(a => {
      console.log(`_id: ${a._id} | item_name: ${a.item_name}`);
    });
  }
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
}); 