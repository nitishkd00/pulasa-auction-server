const mongoose = require('mongoose');
const Auction = require('./models/Auction');
const Bid = require('./models/Bid');
const AuctionEvent = require('./models/AuctionEvent');

// Script to clean up all ended auctions and their associated data
async function cleanupEndedAuctions() {
  try {
    console.log('🧹 Starting cleanup of ended auctions...\n');

    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/pulasa-auction';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Find all ended auctions
    const endedAuctions = await Auction.find({ 
      $or: [
        { status: 'ended' },
        { end_time: { $lt: new Date() } }  // Past end time
      ]
    });

    console.log(`📊 Found ${endedAuctions.length} ended auctions to clean up`);

    if (endedAuctions.length === 0) {
      console.log('✅ No ended auctions found. Nothing to clean up.');
      return;
    }

    // Show what will be deleted
    console.log('\n🗑️ Auctions to be deleted:');
    endedAuctions.forEach((auction, index) => {
      console.log(`   ${index + 1}. ${auction.item_name} (ID: ${auction._id})`);
      console.log(`      - Status: ${auction.status}`);
      console.log(`      - End time: ${auction.end_time}`);
      console.log(`      - Highest bid: ₹${auction.highest_bid || 0}`);
    });

    // Get confirmation
    console.log('\n⚠️  WARNING: This will permanently delete:');
    console.log(`   - ${endedAuctions.length} auctions`);
    console.log(`   - All associated bids`);
    console.log(`   - All associated auction events`);
    console.log('   - This action cannot be undone!');

    // For safety, let's add a confirmation prompt
    console.log('\n🔒 To proceed with deletion, you need to manually confirm.');
    console.log('   Set CONFIRM_DELETE=true environment variable to proceed.');
    
    if (process.env.CONFIRM_DELETE !== 'true') {
      console.log('\n❌ Deletion cancelled. Set CONFIRM_DELETE=true to proceed.');
      console.log('   Example: CONFIRM_DELETE=true node cleanup-ended-auctions.js');
      return;
    }

    console.log('\n🚨 CONFIRMATION RECEIVED. Proceeding with deletion...');

    let deletedCount = 0;
    let deletedBids = 0;
    let deletedEvents = 0;

    // Delete each auction and its associated data
    for (const auction of endedAuctions) {
      console.log(`\n🗑️ Deleting auction: ${auction.item_name}`);
      
      // Delete associated bids
      const bidsToDelete = await Bid.find({ auction: auction._id });
      if (bidsToDelete.length > 0) {
        await Bid.deleteMany({ auction: auction._id });
        deletedBids += bidsToDelete.length;
        console.log(`   - Deleted ${bidsToDelete.length} bids`);
      }

      // Delete associated auction events
      const eventsToDelete = await AuctionEvent.find({ auction: auction._id });
      if (eventsToDelete.length > 0) {
        await AuctionEvent.deleteMany({ auction: auction._id });
        deletedEvents += eventsToDelete.length;
        console.log(`   - Deleted ${eventsToDelete.length} auction events`);
      }

      // Delete the auction
      await Auction.findByIdAndDelete(auction._id);
      deletedCount++;
      console.log(`   ✅ Auction deleted successfully`);
    }

    // Summary
    console.log('\n🎯 Cleanup Summary:');
    console.log(`   - Auctions deleted: ${deletedCount}`);
    console.log(`   - Bids deleted: ${deletedBids}`);
    console.log(`   - Auction events deleted: ${deletedEvents}`);
    console.log('   - Total items cleaned up: ' + (deletedCount + deletedBids + deletedEvents));

    // Verify cleanup
    const remainingAuctions = await Auction.countDocuments();
    const remainingBids = await Bid.countDocuments();
    const remainingEvents = await AuctionEvent.countDocuments();

    console.log('\n📊 Remaining data:');
    console.log(`   - Active auctions: ${remainingAuctions}`);
    console.log(`   - Total bids: ${remainingBids}`);
    console.log(`   - Total auction events: ${remainingEvents}`);

    console.log('\n✅ Cleanup completed successfully!');

  } catch (error) {
    console.error('❌ Cleanup failed with error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
    console.log('\n🏁 Cleanup script completed!');
  }
}

// Run the cleanup
if (require.main === module) {
  cleanupEndedAuctions();
}

module.exports = { cleanupEndedAuctions };
