const cron = require('node-cron');
const Auction = require('../models/Auction');
const AuctionEvent = require('../models/AuctionEvent');

class AuctionStartService {
  constructor() {
    this.isRunning = false;
  }

  // Start the cron job to check for auctions that should start every minute
  startCronJob() {
    if (this.isRunning) {
      console.log('⚠️ Auction start cron job is already running');
      return;
    }

    console.log('🚀 Starting auction start cron job (runs every minute)');
    
    cron.schedule('* * * * *', async () => {
      await this.processStartingAuctions();
    });

    this.isRunning = true;
  }

  // Process auctions that should start
  async processStartingAuctions() {
    try {
      const now = new Date();
      
      // Find auctions that should start (start_time <= now < end_time) but still have status 'pending'
      const startingAuctions = await Auction.find({
        start_time: { $lte: now },
        end_time: { $gt: now },
        status: 'pending'
      });

      if (startingAuctions.length === 0) {
        return;
      }

      console.log(`🕐 Processing ${startingAuctions.length} auctions that should start`);

      for (const auction of startingAuctions) {
        await this.processAuctionStart(auction);
      }
    } catch (error) {
      console.error('❌ Error processing starting auctions:', error);
    }
  }

  // Process a single auction that should start
  async processAuctionStart(auction) {
    try {
      console.log(`🏁 Processing auction start: ${auction.item_name} (ID: ${auction._id})`);
      console.log(`📅 Start time: ${auction.start_time}, Current time: ${new Date().toISOString()}`);

      // Update auction status from 'pending' to 'active'
      auction.status = 'active';
      auction.updated_at = new Date();
      
      await auction.save();
      console.log(`✅ Auction ${auction._id} status updated from 'pending' to 'active'`);

      // Create auction event
      await AuctionEvent.create({
        auction: auction._id,
        event_type: 'auction_started',
        details: {
          message: `Auction "${auction.item_name}" has started`,
          start_time: auction.start_time,
          end_time: auction.end_time
        }
      });

      console.log(`📝 Auction start event created for ${auction._id}`);

      // Emit real-time update to all connected clients
      // Note: This will be handled by the main server's io instance
      console.log(`📡 Auction ${auction._id} is now active and accepting bids`);

    } catch (error) {
      console.error(`❌ Failed to process auction start for ${auction._id}:`, error);
    }
  }

  // Manual method to start a specific auction (for testing/debugging)
  async startSpecificAuction(auctionId) {
    try {
      const auction = await Auction.findById(auctionId);
      if (!auction) {
        throw new Error('Auction not found');
      }

      if (auction.status === 'active') {
        console.log(`✅ Auction ${auctionId} is already active`);
        return { success: true, message: 'Auction already active' };
      }

      if (auction.status === 'ended') {
        throw new Error('Cannot start an ended auction');
      }

      await this.processAuctionStart(auction);
      return { success: true, message: 'Auction started successfully' };

    } catch (error) {
      console.error(`❌ Failed to start auction ${auctionId}:`, error);
      throw error;
    }
  }

  // Get status of the service
  getStatus() {
    return {
      isRunning: this.isRunning,
      service: 'AuctionStartService',
      description: 'Updates auction status from pending to active when start time arrives'
    };
  }
}

module.exports = new AuctionStartService();
