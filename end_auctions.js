const mongoose = require('mongoose');
const Auction = require('./models/Auction');
const Bid = require('./models/Bid');
const AuctionEvent = require('./models/AuctionEvent');

// TODO: Replace with your actual MongoDB connection string or use environment variable
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/YOUR_DB_NAME';

async function endAuctionsAndDeclareWinners() {
  await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  const now = new Date();
  // Find auctions that have ended by time, are not cancelled, and have no winner set
  const auctions = await Auction.find({
    end_time: { $lte: now },
    status: { $ne: 'cancelled' },
    winner: null
  });
  if (auctions.length === 0) {
    console.log('No auctions to process.');
    await mongoose.disconnect();
    return;
  }
  for (const auction of auctions) {
    // Find the highest successful bid
    const highestBid = await Bid.findOne({ auction: auction._id, status: 'success' })
      .sort({ amount: -1 });
    if (highestBid) {
      auction.winner = highestBid.bidder;
      auction.winning_amount = highestBid.amount;
      auction.status = 'ended';
      await auction.save();
      // Mark the winning bid
      highestBid.status = 'won';
      await highestBid.save();
      // Log event
      await AuctionEvent.create({
        auction: auction._id,
        event_type: 'winner_declared',
        user: highestBid.bidder,
        amount: highestBid.amount,
        description: `Winner declared: User ${highestBid.bidder} with ₹${highestBid.amount}`
      });
      console.log(`Auction ${auction._id}: Winner set to ${highestBid.bidder} (₹${highestBid.amount})`);
    } else {
      // No bids placed, just end the auction
      auction.status = 'ended';
      await auction.save();
      console.log(`Auction ${auction._id}: Ended with no bids.`);
    }
  }
  await mongoose.disconnect();
}

endAuctionsAndDeclareWinners().catch(err => {
  console.error('Error:', err);
  process.exit(1);
}); 