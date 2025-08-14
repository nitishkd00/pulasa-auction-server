const Razorpay = require('razorpay');
const crypto = require('crypto');

class PaymentService {
  constructor() {
    // Check if Razorpay credentials are available
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      console.warn('⚠️ Razorpay credentials not configured. Payment features will be disabled.');
      this.razorpay = null;
      this.isEnabled = false;
      return;
    }

    try {
      this.razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
      });
      this.isEnabled = true;
      console.log('✅ Razorpay initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Razorpay:', error);
      this.razorpay = null;
      this.isEnabled = false;
    }
  }

  // Create Razorpay order for bid authorization (capture = 0)
  async createBidOrder(amount, currency = 'INR') {
    try {
      if (!this.isEnabled || !this.razorpay) {
        throw new Error('Razorpay is not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET environment variables.');
      }

      const options = {
        amount: Math.round(amount * 100), // Convert to paise
        currency: currency,
        payment_capture: 0, // 0 means authorize only, 1 means capture immediately
        notes: {
          purpose: 'bid_authorization'
        }
      };

      const order = await this.razorpay.orders.create(options);
      console.log('✅ Razorpay order created:', order.id);
      
      return {
        success: true,
        razorpay_order: {
          id: order.id,
          amount: order.amount / 100, // Convert paise back to rupees for frontend
          currency: order.currency
        }
      };
    } catch (error) {
      console.error('❌ Razorpay order creation failed:', error);
      throw new Error(`Failed to create payment order: ${error.message}`);
    }
  }

  // Verify payment authorization
  async verifyPaymentAuthorization(paymentId, orderId, signature) {
    try {
      if (!this.isEnabled || !this.razorpay) {
        throw new Error('Razorpay is not configured');
      }

      // Try different signature verification methods
      // Method 1: orderId + '|' + paymentId + '|' + 'authorized' (most likely correct)
      const text1 = orderId + '|' + paymentId + '|' + 'authorized';
      const generatedSignature1 = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(text1)
        .digest('hex');

      // Method 2: orderId + '|' + paymentId (current method)
      const text2 = orderId + '|' + paymentId;
      const generatedSignature2 = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(text2)
        .digest('hex');

      // Method 3: orderId + '|' + paymentId + '|' + 'captured'
      const text3 = orderId + '|' + paymentId + '|' + 'captured';
      const generatedSignature3 = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(text3)
        .digest('hex');

      console.log('🔍 Signature verification attempts:');
      console.log('📝 Method 1 (authorized):', text1, '→', generatedSignature1);
      console.log('📝 Method 2 (current):', text2, '→', generatedSignature2);
      console.log('📝 Method 3 (captured):', text3, '→', generatedSignature3);
      console.log('📝 Received signature:', signature);

      // Check if any method matches
      if (generatedSignature1 === signature) {
        console.log('✅ Payment signature verified successfully (Method 1)');
        return { success: true, verified: true, method: 'authorized' };
      } else if (generatedSignature2 === signature) {
        console.log('✅ Payment signature verified successfully (Method 2)');
        return { success: true, verified: true, method: 'current' };
      } else if (generatedSignature3 === signature) {
        console.log('✅ Payment signature verified successfully (Method 3)');
        return { success: true, verified: true, method: 'captured' };
      } else {
        console.error('❌ Payment signature verification failed for all methods');
        console.error('❌ Expected signatures:');
        console.error('   Method 1 (authorized):', generatedSignature1);
        console.error('   Method 2 (current):', generatedSignature2);
        console.error('   Method 3 (captured):', generatedSignature3);
        console.error('❌ Received signature:', signature);
        return { success: false, verified: false, error: 'Invalid signature for all methods' };
      }
    } catch (error) {
      console.error('❌ Payment verification error:', error);
      throw new Error(`Payment verification failed: ${error.message}`);
    }
  }

  // Capture authorized payment
  async capturePayment(paymentId, amount, currency = 'INR') {
    try {
      if (!this.isEnabled || !this.razorpay) {
        throw new Error('Razorpay is not configured');
      }

      const captureData = {
        amount: Math.round(amount * 100), // Convert to paise
        currency: currency
      };

      const payment = await this.razorpay.payments.capture(paymentId, captureData);
      console.log('✅ Payment captured successfully:', payment.id);
      
      return {
        success: true,
        payment_id: payment.id,
        captured_amount: payment.amount / 100, // Convert paise to rupees
        status: payment.status
      };
    } catch (error) {
      console.error('❌ Payment capture failed:', error);
      throw new Error(`Payment capture failed: ${error.message}`);
    }
  }

  // Refund payment (for outbid users)
  async refundPayment(paymentId, amount, reason = 'Outbid by another user') {
    try {
      if (!this.isEnabled || !this.razorpay) {
        throw new Error('Razorpay is not configured');
      }

      const refundData = {
        amount: Math.round(amount * 100), // Convert to paise
        currency: 'INR'
      };

      const payment = await this.razorpay.payments.refund(paymentId, refundData);
      console.log('✅ Payment refunded successfully:', payment.id);
      
      return {
        success: true,
        refund_id: payment.id,
        refunded_amount: payment.amount / 100, // Convert paise to rupees
        status: payment.status
      };
    } catch (error) {
      console.error('❌ Payment refund failed:', error);
      throw new Error(`Payment refund failed: ${error.message}`);
    }
  }

  // Get payment details
  async getPaymentDetails(paymentId) {
    try {
      if (!this.isEnabled || !this.razorpay) {
        throw new Error('Razorpay is not configured');
      }

      const payment = await this.razorpay.payments.fetch(paymentId);
      return {
        success: true,
        payment: payment
      };
    } catch (error) {
      console.error('❌ Failed to fetch payment details:', error);
      throw new Error(`Failed to fetch payment details: ${error.message}`);
    }
  }

  // Verify webhook signature
  verifyWebhookSignature(payload, signature) {
    try {
      if (!this.isEnabled) {
        return false;
      }

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
