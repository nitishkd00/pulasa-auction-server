const Razorpay = require('razorpay');
const crypto = require('crypto');

class PaymentService {
  constructor() {
    this.razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });
  }

  async createBidOrder(amount, currency = 'INR') {
    try {
      const options = {
        amount: Math.round(amount * 100),
        currency: currency,
        payment_capture: 0,
        notes: { purpose: 'bid_authorization' }
      };

      const order = await this.razorpay.orders.create(options);
      console.log('✅ Razorpay order created:', order.id);
      
      return {
        success: true,
        order_id: order.id,
        amount: order.amount,
        currency: order.currency
      };
    } catch (error) {
      console.error('❌ Razorpay order creation failed:', error);
      throw new Error(`Failed to create payment order: ${error.message}`);
    }
  }

  async verifyPaymentAuthorization(paymentId, orderId, signature) {
    try {
      const text = orderId + '|' + paymentId;
      const generatedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(text)
        .digest('hex');

      if (generatedSignature === signature) {
        console.log('✅ Payment signature verified successfully');
        return { success: true, verified: true };
      } else {
        console.error('❌ Payment signature verification failed');
        return { success: false, verified: false, error: 'Invalid signature' };
      }
    } catch (error) {
      console.error('❌ Payment verification error:', error);
      throw new Error(`Payment verification failed: ${error.message}`);
    }
  }

  async capturePayment(paymentId, amount, currency = 'INR') {
    try {
      const captureData = {
        amount: Math.round(amount * 100),
        currency: currency
      };

      const payment = await this.razorpay.payments.capture(paymentId, captureData);
      console.log('✅ Payment captured successfully:', payment.id);
      
      return {
        success: true,
        payment_id: payment.id,
        captured_amount: payment.amount,
        status: payment.status
      };
    } catch (error) {
      console.error('❌ Payment capture failed:', error);
      throw new Error(`Payment capture failed: ${error.message}`);
    }
  }

  async refundPayment(paymentId, amount, reason = 'Outbid by another user') {
    try {
      const refundData = {
        amount: Math.round(amount * 100),
        currency: 'INR'
      };

      const payment = await this.razorpay.payments.refund(paymentId, refundData);
      console.log('✅ Payment refunded successfully:', payment.id);
      
      return {
        success: true,
        refund_id: payment.id,
        refunded_amount: payment.amount,
        status: payment.status
      };
    } catch (error) {
      console.error('❌ Payment refund failed:', error);
      throw new Error(`Payment refund failed: ${error.message}`);
    }
  }

  async getPaymentDetails(paymentId) {
    try {
      const payment = await this.razorpay.payments.fetch(paymentId);
      return { success: true, payment: payment };
    } catch (error) {
      console.error('❌ Failed to fetch payment details:', error);
      throw new Error(`Failed to fetch payment details: ${error.message}`);
    }
  }

  verifyWebhookSignature(payload, signature) {
    try {
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(payload)
        .digest('hex');
      return expectedSignature === signature;
    } catch (error) {
      console.error('❌ Webhook signature verification failed:', error);
      return false;
    }
  }
}

module.exports = new PaymentService();
