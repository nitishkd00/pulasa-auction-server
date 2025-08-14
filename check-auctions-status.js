const mongoose = require('mongoose');
const Auction = require('./models/Auction');
const Bid = require('./models/Bid');

// Script to check auction statuses and identify ended auctions
async function checkAuctionsStatus() {
  try {
    console.log('🔍 Checking auction statuses...\n');

    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/pulasa-auction';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    const now = new Date();
    console.log(`⏰ Current time: ${now.toLocaleString()}\n`);

    // Get all auctions
    const allAuctions = await Auction.find().sort({ end_time: 1 });

    if (allAuctions.length === 0) {
      console.log('📊 No auctions found in the system.');
      return;
    }

    console.log(`📊 Found ${allAuctions.length} total auctions:\n`);

    let activeCount = 0;
    let endedCount = 0;
    let pastDueCount = 0;

    allAuctions.forEach((auction, index) => {
      const isPastDue = auction.end_time < now;
      const status = auction.status;
      const timeLeft = auction.end_time - now;
      
      console.log(`${index + 1}. ${auction.item_name}`);
      console.log(`   - ID: ${auction._id}`);
      console.log(`   - Status: ${status}`);
      console.log(`   - End time: ${auction.end_time.toLocaleString()}`);
      console.log(`   - Base price: ₹${auction.base_price}`);
      console.log(`   - Current highest bid: ₹${auction.highest_bid || 0}`);
      
      if (isPastDue) {
        console.log(`   - ⚠️  PAST DUE (${Math.floor(timeLeft / (1000 * 60 * 60 * 24))} days ago)`);
        pastDueCount++;
        
        if (status !== 'ended') {
          console.log(`   - 🔴 Should be marked as 'ended'`);
        }
      } else {
        const daysLeft = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
        const hoursLeft = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        console.log(`   - ✅ Active (${daysLeft}d ${hoursLeft}h left)`);
        activeCount++;
      }
      
      console.log(''); // Empty line for readability
    });

    // Summary
    console.log('📊 Summary:');
    console.log(`   - Total auctions: ${allAuctions.length}`);
    console.log(`   - Active auctions: ${activeCount}`);
    console.log(`   - Ended auctions: ${endedCount}`);
    console.log(`   - Past due (should be ended): ${pastDueCount}`);

    if (pastDueCount > 0) {
      console.log('\n⚠️  Found auctions that are past due but not marked as ended!');
      console.log('   These should be cleaned up or marked as ended.');
    }

    // Check for any test auctions
    const testAuctions = allAuctions.filter(auction => 
      auction.item_name.toLowerCase().includes('test') ||
      auction.description?.toLowerCase().includes('test')
    );

    if (testAuctions.length > 0) {
      console.log('\n🧪 Test auctions found:');
      testAuctions.forEach(auction => {
        console.log(`   - ${auction.item_name} (${auction.status})`);
      });
    }

  } catch (error) {
    console.error('❌ Check failed with error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
    console.log('\n🏁 Status check completed!');
  }
}

// Run the check
if (require.main === module) {
  checkAuctionsStatus();
}

module.exports = { checkAuctionsStatus };
