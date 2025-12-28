const crypto = require('crypto');
const Order = require('../models/Order');
const Item = require('../models/Item');
const verifySignature = require('../utils/verifyRazorpaySignature');
const razorpay = require('../config/razorpay');

const updateStock = async (items = []) => {
  for (const i of items) {
    const item = await Item.findById(i.itemId);
    if (!item || item.stockQty < i.quantity) {
      throw new Error(`Insufficient stock for item ${i.itemId}`);
    }
    await Item.findByIdAndUpdate(
      i.itemId,
      { $inc: { stockQty: -i.quantity } }
    );
  }
};

/* -------------------- CREATE ORDER (PENDING) -------------------- */
exports.createOrder = async (req, res) => {
  try {
    const { orderData } = req.body;
    
    if (!orderData || !orderData.items?.length) {
      return res.status(400).json({ success: false, message: 'Invalid order data' });
    }

    // Server-side amount calculation in paise
    const subtotal = orderData.items.reduce(
      (sum, i) => sum + i.price * i.quantity,
      0
    );

    const gstAmount = subtotal * 0.05; // GST only on items, not on delivery charges
    const finalAmountInPaise = Math.round((subtotal + gstAmount + (orderData.deliveryFee || 0)) * 100);

    const razorpayOrder = await razorpay.orders.create({
      amount: finalAmountInPaise,
      currency: 'INR',
      receipt: `rcpt_${Date.now()}`
    });

    const order = await Order.create({
      ...orderData,
      totalAmount: finalAmountInPaise,
      currency: 'INR',
      status: 'pending',
      paymentStatus: 'pending',
      razorpayData: [{
        orderId: razorpayOrder.id,
        status: 'created',
        amount: razorpayOrder.amount,
        currency: 'INR',
        createdAt: new Date()
      }]
    });

    await updateStock(orderData.items);

    res.json({
      success: true,
      order: razorpayOrder,
      dbOrderId: order._id
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* -------------------- VERIFY PAYMENT (UX ONLY) -------------------- */
exports.verifyPayment = async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      dbOrderId
    } = req.body;

    const order = await Order.findById(dbOrderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.paymentStatus === 'paid') {
      return res.json({ success: true, orderId: order._id });
    }

    const valid = verifySignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    );

    if (!valid) {
      return res.status(400).json({ success: false, message: 'Invalid signature' });
    }

    // Force-check payment status after signature verification
    const payment = await razorpay.payments.fetch(razorpay_payment_id);

    if (payment.status === "captured") {
      order.paymentStatus = "paid";
      order.status = "confirmed";
      order.confirmedAt = new Date();

      order.razorpayData.push({
        orderId: razorpay_order_id,
        paymentId: payment.id,
        signature: razorpay_signature,
        amount: payment.amount,
        status: "paid",
        method: payment.method
      });

      await order.save();
    } else {
      // Store payment ID for webhook processing
      order.razorpayData.push({
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
        status: 'signature_verified',
        createdAt: new Date()
      });
      
      await order.save();
    }

    res.json({ success: true, orderId: order._id });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Payment verification failed' });
  }
};

/* -------------------- PAYMENT FAILURE -------------------- */
exports.handlePaymentFailure = async (req, res) => {
  try {
    const { dbOrderId, reason } = req.body;

    const order = await Order.findById(dbOrderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.paymentStatus === 'paid') {
      return res.status(400).json({ success: false, message: 'Cannot cancel - payment already processed' });
    }

    // Cancel the order regardless of current status
    order.status = 'cancelled';
    order.paymentStatus = 'cancelled';
    order.cancelledAt = new Date();
    order.razorpayData.push({
      status: 'cancelled',
      errorReason: reason || 'User cancelled payment',
      createdAt: new Date()
    });

    await order.save();

    res.json({ success: true, orderId: order._id });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Cancellation failed' });
  }
};

/* -------------------- RAZORPAY WEBHOOK (FINAL AUTHORITY) -------------------- */
exports.razorpayWebhook = async (req, res) => {
  try {
    console.log('Webhook received:', req.body);
    console.log('Headers:', req.headers);
    
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    
    if (!secret) {
      console.log('No webhook secret configured');
      return res.status(400).json({ message: 'Webhook secret not configured' });
    }
    
    const shasum = crypto.createHmac('sha256', secret);
    shasum.update(JSON.stringify(req.body));
    const digest = shasum.digest('hex');

    const receivedSignature = req.headers['x-razorpay-signature'];
    
    console.log('Expected signature:', digest);
    console.log('Received signature:', receivedSignature);

    if (digest !== receivedSignature) {
      console.log('Signature mismatch');
      return res.status(400).json({ message: 'Invalid signature' });
    }

    const event = req.body.event;
    const payment = req.body.payload.payment.entity;

    console.log('Processing event:', event, 'for payment:', payment.id);

    const order = await Order.findOne({
      'razorpayData.orderId': payment.order_id
    });

    if (!order) {
      console.log('Order not found for:', payment.order_id);
      return res.status(200).end();
    }

    // Idempotency protection
    if (order.paymentStatus === 'paid') {
      console.log('Order already paid');
      return res.status(200).end();
    }

    if (event === 'payment.captured') {
      console.log('Confirming payment for order:', order._id);
      
      order.paymentStatus = 'paid';
      order.status = 'confirmed';
      order.confirmedAt = new Date();

      order.razorpayData.push({
        paymentId: payment.id,
        amount: payment.amount,
        status: 'paid',
        method: payment.method,
        source: 'webhook',
        createdAt: new Date()
      });

      await order.save();
      // Stock already updated during order creation
      
      console.log('Payment confirmed via webhook');
    }

    if (event === 'payment.failed') {
      console.log('Payment failed for order:', order._id);
      order.paymentStatus = 'failed';
      order.status = 'failed';
      await order.save();
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: err.message });
  }
};
/* -------------------- MANUAL PAYMENT CONFIRMATION (FOR MISSED WEBHOOKS) -------------------- */
exports.confirmPayment = async (req, res) => {
  try {
    const { orderId } = req.body;
    
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.paymentStatus === 'paid') {
      return res.json({ success: true, message: 'Already confirmed' });
    }

    // Get payment ID from razorpayData
    const paymentData = order.razorpayData.find(d => d.paymentId);
    if (!paymentData) {
      return res.status(400).json({ success: false, message: 'No payment ID found' });
    }

    // Verify with Razorpay API
    const payment = await razorpay.payments.fetch(paymentData.paymentId);
    
    if (payment.status === 'captured') {
      order.paymentStatus = 'paid';
      order.status = 'confirmed';
      order.confirmedAt = new Date();

      order.razorpayData.push({
        paymentId: payment.id,
        amount: payment.amount,
        status: 'paid',
        method: payment.method,
        source: 'manual_confirmation',
        createdAt: new Date()
      });

      await order.save();
      // Stock already updated during order creation
      
      return res.json({ success: true, message: 'Payment confirmed' });
    }

    res.status(400).json({ success: false, message: 'Payment not captured' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
/* -------------------- FIX INCONSISTENT ORDERS -------------------- */
exports.fixInconsistentOrders = async (req, res) => {
  try {
    // Find orders that are both cancelled and confirmed
    const inconsistentOrders = await Order.find({
      $and: [
        { cancelledAt: { $exists: true } },
        { confirmedAt: { $exists: true } }
      ]
    });

    let fixed = 0;
    for (const order of inconsistentOrders) {
      // If payment is actually captured, keep it confirmed
      if (order.paymentStatus === 'paid') {
        order.status = 'confirmed';
        order.cancelledAt = undefined;
        await order.save();
        fixed++;
      }
    }

    res.json({ success: true, fixed });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.cleanFailedOrders = async (req, res) => {
  try {
    const result = await Order.deleteMany({
      $or: [
        { status: 'failed' },
        { paymentStatus: 'failed' },
        {
          status: 'pending',
          paymentStatus: 'pending',
          createdAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        }
      ]
    });

    res.json({
      success: true,
      deleted: result.deletedCount
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Cleanup failed' });
  }
};

