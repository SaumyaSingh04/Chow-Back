const razorpay = require('../config/razorpay');
const delhiveryService = require('../services/delhiveryService');
const deliveryService = require('../services/delivery/DeliveryService');

/**
 * Common payment processing logic to avoid duplication
 * between verifyPayment and razorpayWebhook
 */
const processPaymentConfirmation = async (order, paymentData) => {
  if (order.paymentStatus === 'paid') {
    return { success: true, message: 'Already confirmed' };
  }

  order.paymentStatus = 'paid';
  order.status = 'confirmed';
  order.confirmedAt = new Date();

  order.razorpayData.push({
    paymentId: paymentData.id,
    amount: paymentData.amount,
    status: 'paid',
    method: paymentData.method,
    source: paymentData.source || 'api',
    signatureVerified: paymentData.signatureVerified || false,
    attemptNumber: (order.razorpayData.length || 0) + 1,
    createdAt: new Date()
  });

  await order.save();

  // Only create Delhivery shipment for external deliveries
  if (deliveryService.shouldCreateDelhiveryShipment(order)) {
    console.log('Payment confirmed for Delhivery order:', order._id, '- Shipment creation should be handled separately');
  } else {
    console.log('Payment confirmed for local delivery order:', order._id, '- No external shipment needed');
  }

  return { success: true, orderId: order._id };
};

/**
 * Create Delhivery shipment with retry logic
 */
const createDelhiveryShipment = async (orderId) => {
  const Order = require('../models/Order');
  
  const order = await Order.findById(orderId)
    .populate('userId', 'name email phone address')
    .populate('items.itemId', 'name weight');

  if (!order || order.waybill) return; // Skip if order not found or shipment already created
  
  // CRITICAL: Validate that Delhivery shipment should be created
  if (!deliveryService.shouldCreateDelhiveryShipment(order)) {
    console.log(`BLOCKED: Shipment creation attempted for order: ${orderId} (Provider: ${order.deliveryProvider})`);
    return;
  }

  const deliveryAddress = order.userId.address?.find(
    addr => String(addr._id) === String(order.addressId)
  );

  if (!deliveryAddress) throw new Error('Delivery address not found');

  const shipmentData = {
    orderId: order._id,
    customerName: `${deliveryAddress.firstName} ${deliveryAddress.lastName}`,
    address: deliveryAddress.street,
    city: deliveryAddress.city,
    state: deliveryAddress.state,
    pincode: deliveryAddress.postcode,
    phone: order.userId.phone,
    paymentMode: 'PREPAID', // Always PREPAID
    totalAmount: order.totalAmount, // Already in INR
    totalWeight: order.totalWeight,
    totalQuantity: order.items.reduce((sum, item) => sum + item.quantity, 0),
    itemsDescription: order.items.map(item => 
      `${item.itemId.name} x ${item.quantity}`
    ).join(', ')
  };

  try {
    const result = await delhiveryService.createShipment(shipmentData);
    
    if (result.success) {
      order.waybill = result.waybill;
      order.deliveryStatus = result.status;
      order.status = 'shipped';
      order.shipmentAttempts = (order.shipmentAttempts || 0) + 1;
      order.shipmentLastError = null;
      await order.save();
      return result;
    } else {
      throw new Error(result.error || 'Shipment creation failed');
    }
  } catch (error) {
    order.shipmentAttempts = (order.shipmentAttempts || 0) + 1;
    order.shipmentLastError = error.message;
    await order.save();
    
    console.error(`Shipment creation failed for order ${orderId} (attempt ${order.shipmentAttempts}):`, error.message);
    throw error;
  }
};

module.exports = {
  processPaymentConfirmation,
  createDelhiveryShipment
};