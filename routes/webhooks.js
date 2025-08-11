const express = require('express');
const paymentService = require('../services/paymentService');
const Bid = require('../models/Bid');
const Auction = require('../models/Auction');
const AuctionEvent = require('../models/AuctionEvent');

const router = express.Router();

// Razorpay webhook handler
router.post('/razorpay', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const payload = JSON.stringify(req.body);

    // Verify webhook signature
    if (!paymentService.verifyWebhookSignature(payload, signature)) {
      console.error('❌ Invalid webhook signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = req.body;
    console.log('📨 Webhook received:', event.event);

    switch (event.event) {
      case 'payment.authorized':
        await handlePaymentAuthorized(event.payload.payment.entity);
        break;
      case 'payment.captured':
        await handlePaymentCaptured(event.payload.payment.entity);
        break;
      case 'payment.refunded':
        await handlePaymentRefunded(event.payload.refund.entity);
        break;
      default:
        console.log('ℹ️ Unhandled webhook event:', event.event);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Handle payment authorization
async function handlePaymentAuthorized(payment) {
  try {
    const bid = await Bid.findOne({ 
      razorpay_order_id: payment.order_id,
      payment_status: 'authorized'
    });

    if (bid) {
      bid.razorpay_payment_id = payment.id;
      bid.payment_status = 'authorized';
      await bid.save();
      
      console.log(`✅ Payment authorized for bid ${bid._id}: ${payment.id}`);
    }
  } catch (error) {
    console.error('❌ Error handling payment authorized:', error);
  }
}

// Handle payment capture
async function handlePaymentCaptured(payment) {
  try {
    const bid = await Bid.findOne({ 
      razorpay_payment_id: payment.id,
      payment_status: 'authorized'
    });

    if (bid) {
      bid.payment_status = 'captured';
      bid.status = 'won';
      await bid.save();
      
      console.log(`✅ Payment captured for bid ${bid._id}: ${payment.id}`);
    }
  } catch (error) {
    console.error('❌ Error handling payment captured:', error);
  }
}

// Handle payment refund
async function handlePaymentRefunded(refund) {
  try {
    const bid = await Bid.findOne({ 
      razorpay_payment_id: refund.payment_id,
      payment_status: 'authorized'
    });

    if (bid) {
      bid.payment_status = 'refunded';
      bid.status = 'outbid';
      await bid.save();
      
      console.log(`✅ Payment refunded for bid ${bid._id}: ${refund.id}`);
    }
  } catch (error) {
    console.error('❌ Error handling payment refunded:', error);
  }
}

module.exports = router;
