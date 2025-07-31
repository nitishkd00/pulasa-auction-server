const mongoose = require('mongoose');
const Auction = require('./models/Auction');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pulasa_auction';

async function main() {
  await mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  const result = await Auction.deleteMany({});
  console.log(`Deleted ${result.deletedCount} auctions.`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
}); 