const cron = require('node-cron');
const paymentService = require('./paymentService');
const Auction = require('../models/Auction');
const Bid = require('../models/Bid');
const AuctionEvent = require('../models/AuctionEvent');

class AuctionEndService {
  constructor() {
    this.isRunning = false;
  }

  // Start the cron job to check for ended auctions every minute
  startCronJob() {
    if (this.isRunning) {
      console.log('⚠️ Auction end cron job is already running');
      return;
    }

    console.log('🚀 Starting auction end cron job (runs every minute)');
    
    cron.schedule('* * * * *', async () => {
      await this.processEndedAuctions();
    });

    this.isRunning = true;
  }

  // Process all ended auctions
  async processEndedAuctions() {
    try {
      const now = new Date();
      
      // Find auctions that have ended but not yet processed
      const endedAuctions = await Auction.find({
        end_time: { $lte: now },
        status: { $ne: 'ended' }
      });

      if (endedAuctions.length === 0) {
        return;
      }

      console.log(`🕐 Processing ${endedAuctions.length} ended auctions`);

      for (const auction of endedAuctions) {
        await this.processAuctionEnd(auction);
      }
    } catch (error) {
      console.error('❌ Error processing ended auctions:', error);
    }
  }

  // Process a single ended auction
  async processAuctionEnd(auction) {
    try {
      console.log(`🏁 Processing auction end: ${auction.item_name} (ID: ${auction._id})`);

      // Check if there are any bids
      const highestBid = await Bid.findOne({
        auction: auction._id,
        status: 'active',
        payment_status: 'authorized'
      }).sort({ amount: -1 });

      if (!highestBid) {
        // No bids - mark auction as unsold
        auction.status = 'ended';
        auction.winner = null;
        auction.winning_amount = null;
        await auction.save();

        // Create auction event
        await AuctionEvent.create({
          auction: auction._id,
          event_type: 'auction_ended_no_bids',
          details: {
            message: 'Auction ended with no bids'
          }
        });

        console.log(`📭 Auction ${auction._id} ended with no bids`);
        return;
      }

      // Capture payment for the winning bid
      try {
        const captureResult = await paymentService.capturePayment(
          highestBid.razorpay_payment_id,
          highestBid.amount
        );

        if (captureResult.success) {
          // Update bid status
          highestBid.payment_status = 'captured';
          highestBid.status = 'won';
          await highestBid.save();

          // Update auction
          auction.status = 'ended';
          auction.winner = highestBid.bidder;
          auction.winning_amount = highestBid.amount;
          await auction.save();

          // Create auction event
          await AuctionEvent.create({
            auction: auction._id,
            event_type: 'auction_ended_winner',
            user: highestBid.bidder,
            details: {
              winning_amount: highestBid.amount,
              payment_id: highestBid.razorpay_payment_id
            }
          });

          console.log(`🏆 Auction ${auction._id} ended - Winner: ${highestBid.bidder}, Amount: ₹${highestBid.amount}`);
        } else {
          throw new Error('Payment capture failed');
        }
      } catch (captureError) {
        console.error(`❌ Failed to capture payment for auction ${auction._id}:`, captureError);
        
        // Log the error and mark for retry
        await AuctionEvent.create({
          auction: auction._id,
          event_type: 'payment_capture_failed',
          details: {
            error: captureError.message,
            bid_id: highestBid._id,
            amount: highestBid.amount
          }
        });

        // Don't mark auction as ended if capture fails
        // It will be retried in the next cron run
        return;
      }

      // Refund all other active bids
      const otherBids = await Bid.find({
        auction: auction._id,
        _id: { $ne: highestBid._id },
        status: 'active',
        payment_status: 'authorized'
      });

      for (const bid of otherBids) {
        try {
          if (bid.razorpay_payment_id) {
            await paymentService.refundPayment(
              bid.razorpay_payment_id,
              bid.amount,
              'Auction ended - outbid by winner'
            );

            bid.status = 'outbid';
            bid.payment_status = 'refunded';
            await bid.save();

            console.log(`💰 Refunded bid ${bid._id} for user ${bid.bidder}`);
          }
        } catch (refundError) {
          console.error(`❌ Failed to refund bid ${bid._id}:`, refundError);
          
          // Log refund failure
          await AuctionEvent.create({
            auction: auction._id,
            event_type: 'refund_failed',
            user: bid.bidder,
            details: {
              error: refundError.message,
              bid_id: bid._id,
              amount: bid.amount
            }
          });
        }
      }

    } catch (error) {
      console.error(`❌ Error processing auction end for ${auction._id}:`, error);
      
      // Log the error
      await AuctionEvent.create({
        auction: auction._id,
        event_type: 'auction_end_processing_error',
        details: {
          error: error.message
        }
      });
    }
  }

  // Manual trigger to process a specific auction (for testing/admin use)
  async processSpecificAuction(auctionId) {
    try {
      const auction = await Auction.findById(auctionId);
      if (!auction) {
        throw new Error('Auction not found');
      }

      await this.processAuctionEnd(auction);
      return { success: true, message: 'Auction processed successfully' };
    } catch (error) {
      console.error('❌ Error processing specific auction:', error);
      throw error;
    }
  }

  // Stop the cron job
  stopCronJob() {
    if (this.isRunning) {
      console.log('🛑 Stopping auction end cron job');
      this.isRunning = false;
    }
  }
}

module.exports = new AuctionEndService();
