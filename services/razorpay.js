const Razorpay = require('razorpay');
require('dotenv').config();

// Initialize Razorpay only if credentials are available
let razorpay = null;
let razorpayInitialized = false;

const initializeRazorpay = () => {
  if (razorpayInitialized) return razorpay;
  
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  
  if (!keyId || !keySecret || keyId === 'rzp_test_your_razorpay_key_id') {
    console.warn('⚠️  Razorpay credentials not configured. Payment features will be disabled.');
    razorpayInitialized = true;
    return null;
  }
  
  try {
    razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret
    });
    razorpayInitialized = true;
    console.log('✅ Razorpay initialized successfully');
    return razorpay;
  } catch (error) {
    console.error('❌ Failed to initialize Razorpay:', error.message);
    razorpayInitialized = true;
    return null;
  }
};

class RazorpayService {
  constructor() {
    this.razorpay = initializeRazorpay();
  }

  // Check if Razorpay is available
  isAvailable() {
    return this.razorpay !== null;
  }

  // Create payment order
  async createOrder(amount, receipt, notes = {}) {
    if (!this.isAvailable()) {
      throw new Error('Razorpay is not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in environment variables.');
    }

    try {
      const orderOptions = {
        amount: Math.round(amount * 100), // Convert to paise
        currency: 'INR',
        receipt: receipt,
        notes: notes
      };

      const order = await this.razorpay.orders.create(orderOptions);
      console.log('Razorpay order created:', order.id);
      return order;
    } catch (error) {
      console.error('Create order failed:', error);
      throw new Error('Failed to create payment order');
    }
  }

  // Verify payment signature
  verifyPaymentSignature(orderId, paymentId, signature) {
    if (!this.isAvailable()) {
      throw new Error('Razorpay is not configured');
    }

    try {
      const text = `${orderId}|${paymentId}`;
      const crypto = require('crypto');
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(text)
        .digest('hex');

      return expectedSignature === signature;
    } catch (error) {
      console.error('Signature verification failed:', error);
      return false;
    }
  }

  // Process refund
  async processRefund(paymentId, amount, reason = 'Bid outbid') {
    if (!this.isAvailable()) {
      throw new Error('Razorpay is not configured');
    }

    try {
      const refundOptions = {
        amount: Math.round(amount * 100), // Convert to paise
        speed: 'normal',
        notes: {
          reason: reason
        }
      };

      const refund = await this.razorpay.payments.refund(paymentId, refundOptions);
      console.log('Refund processed:', refund.id);
      return refund;
    } catch (error) {
      console.error('Refund failed:', error);
      throw new Error('Failed to process refund');
    }
  }

  // Get payment details
  async getPaymentDetails(paymentId) {
    if (!this.isAvailable()) {
      throw new Error('Razorpay is not configured');
    }

    try {
      const payment = await this.razorpay.payments.fetch(paymentId);
      return payment;
    } catch (error) {
      console.error('Get payment details failed:', error);
      throw new Error('Failed to get payment details');
    }
  }

  // Get order details
  async getOrderDetails(orderId) {
    if (!this.isAvailable()) {
      throw new Error('Razorpay is not configured');
    }

    try {
      const order = await this.razorpay.orders.fetch(orderId);
      return order;
    } catch (error) {
      console.error('Get order details failed:', error);
      throw new Error('Failed to get order details');
    }
  }

  // Calculate platform fee
  calculatePlatformFee(bidAmount) {
    // Platform fee: 2% with minimum ₹2 and maximum ₹5
    const feePercentage = 0.02;
    const minFee = 2;
    const maxFee = 5;
    
    const calculatedFee = bidAmount * feePercentage;
    return Math.min(Math.max(calculatedFee, minFee), maxFee);
  }

  // Create payment link for bid
  async createPaymentLink(bidAmount, platformFee, auctionId, bidderId) {
    if (!this.isAvailable()) {
      throw new Error('Razorpay is not configured');
    }

    try {
      const totalAmount = bidAmount + platformFee;
      
      const paymentLinkOptions = {
        amount: Math.round(totalAmount * 100), // Convert to paise
        currency: 'INR',
        description: `Bid for Auction #${auctionId}`,
        reference_id: `bid_${auctionId}_${bidderId}_${Date.now()}`,
        callback_url: `${process.env.CLIENT_URL}/auction/${auctionId}`,
        callback_method: 'get',
        notes: {
          auction_id: auctionId.toString(),
          bidder_id: bidderId.toString(),
          bid_amount: bidAmount.toString(),
          platform_fee: platformFee.toString()
        }
      };

      const paymentLink = await this.razorpay.paymentLink.create(paymentLinkOptions);
      console.log('Payment link created:', paymentLink.id);
      return paymentLink;
    } catch (error) {
      console.error('Create payment link failed:', error);
      throw new Error('Failed to create payment link');
    }
  }

  // Handle webhook events
  async handleWebhook(event, signature) {
    if (!this.isAvailable()) {
      throw new Error('Razorpay is not configured');
    }

    try {
      // Verify webhook signature
      const crypto = require('crypto');
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
        .update(JSON.stringify(event))
        .digest('hex');

      if (expectedSignature !== signature) {
        throw new Error('Invalid webhook signature');
      }

      const { event: eventType, payload } = event;

      switch (eventType) {
        case 'payment.captured':
          return await this.handlePaymentCaptured(payload.payment.entity);
        
        case 'payment.failed':
          return await this.handlePaymentFailed(payload.payment.entity);
        
        case 'refund.processed':
          return await this.handleRefundProcessed(payload.refund.entity);
        
        default:
          console.log('Unhandled webhook event:', eventType);
          return { status: 'ignored' };
      }
    } catch (error) {
      console.error('Webhook handling failed:', error);
      throw error;
    }
  }

  // Handle payment captured event
  async handlePaymentCaptured(payment) {
    try {
      console.log('Payment captured:', payment.id);
      
      // Extract auction and bidder info from notes
      const notes = payment.notes;
      const auctionId = notes.auction_id;
      const bidderId = notes.bidder_id;
      const bidAmount = parseFloat(notes.bid_amount);
      const platformFee = parseFloat(notes.platform_fee);

      // Here you would typically:
      // 1. Update bid status in database
      // 2. Place bid on blockchain
      // 3. Emit real-time updates
      // 4. Handle refunds for previous bidders

      return {
        status: 'success',
        payment_id: payment.id,
        auction_id: auctionId,
        bidder_id: bidderId,
        amount: bidAmount,
        platform_fee: platformFee
      };
    } catch (error) {
      console.error('Handle payment captured failed:', error);
      throw error;
    }
  }

  // Handle payment failed event
  async handlePaymentFailed(payment) {
    try {
      console.log('Payment failed:', payment.id);
      
      // Extract auction and bidder info from notes
      const notes = payment.notes;
      const auctionId = notes.auction_id;
      const bidderId = notes.bidder_id;

      // Here you would typically:
      // 1. Update bid status to failed in database
      // 2. Notify user about payment failure
      // 3. Clean up any temporary data

      return {
        status: 'failed',
        payment_id: payment.id,
        auction_id: auctionId,
        bidder_id: bidderId,
        error: payment.error_description || 'Payment failed'
      };
    } catch (error) {
      console.error('Handle payment failed failed:', error);
      throw error;
    }
  }

  // Handle refund processed event
  async handleRefundProcessed(refund) {
    try {
      console.log('Refund processed:', refund.id);
      
      // Here you would typically:
      // 1. Update refund status in database
      // 2. Notify user about refund
      // 3. Update transaction records

      return {
        status: 'refunded',
        refund_id: refund.id,
        payment_id: refund.payment_id,
        amount: refund.amount / 100, // Convert from paise
        reason: refund.notes?.reason || 'Refund processed'
      };
    } catch (error) {
      console.error('Handle refund processed failed:', error);
      throw error;
    }
  }
}

// Create service instance
const razorpayService = new RazorpayService();

// Export functions
const createOrder = (amount, receipt, notes) => 
  razorpayService.createOrder(amount, receipt, notes);

const verifyPaymentSignature = (orderId, paymentId, signature) => 
  razorpayService.verifyPaymentSignature(orderId, paymentId, signature);

const processRefund = (paymentId, amount, reason) => 
  razorpayService.processRefund(paymentId, amount, reason);

const getPaymentDetails = (paymentId) => 
  razorpayService.getPaymentDetails(paymentId);

const getOrderDetails = (orderId) => 
  razorpayService.getOrderDetails(orderId);

const calculatePlatformFee = (bidAmount) => 
  razorpayService.calculatePlatformFee(bidAmount);

const createPaymentLink = (bidAmount, platformFee, auctionId, bidderId) => 
  razorpayService.createPaymentLink(bidAmount, platformFee, auctionId, bidderId);

const handleWebhook = (event, signature) => 
  razorpayService.handleWebhook(event, signature);

// Refund previous bidder function
const refundPreviousBidder = async (paymentId, amount) => {
  try {
    if (!razorpayService.isAvailable()) {
      console.warn('⚠️  Razorpay not configured, skipping refund');
      return { status: 'skipped', reason: 'Razorpay not configured' };
    }

    const refund = await razorpayService.processRefund(paymentId, amount, 'Bid outbid');
    console.log('Previous bidder refunded:', refund.id);
    return { status: 'success', refund_id: refund.id };
  } catch (error) {
    console.error('Refund previous bidder failed:', error);
    return { status: 'failed', error: error.message };
  }
};

module.exports = {
  createOrder,
  verifyPaymentSignature,
  processRefund,
  getPaymentDetails,
  getOrderDetails,
  calculatePlatformFee,
  createPaymentLink,
  handleWebhook,
  refundPreviousBidder,
  isAvailable: () => razorpayService.isAvailable()
}; 