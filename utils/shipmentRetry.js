const Order = require('../models/Order');
const { createDelhiveryShipment } = require('./paymentHelper');

/**
 * Retry failed shipments for confirmed orders
 * This should be called via cron job or manually
 */
const retryFailedShipments = async (maxAttempts = 3) => {
  try {
    const failedOrders = await Order.find({
      paymentStatus: 'paid',
      status: 'confirmed',
      waybill: { $exists: false },
      $or: [
        { shipmentAttempts: { $lt: maxAttempts } },
        { shipmentAttempts: { $exists: false } }
      ]
    });

    console.log(`Found ${failedOrders.length} orders needing shipment creation`);

    let successCount = 0;
    let failCount = 0;

    for (const order of failedOrders) {
      try {
        await createDelhiveryShipment(order._id);
        successCount++;
        console.log(`✅ Shipment created for order ${order._id}`);
      } catch (error) {
        failCount++;
        console.log(`❌ Failed to create shipment for order ${order._id}: ${error.message}`);
      }
    }

    return {
      total: failedOrders.length,
      success: successCount,
      failed: failCount
    };
  } catch (error) {
    console.error('Shipment retry process failed:', error);
    throw error;
  }
};

/**
 * Get orders that need manual intervention (too many failed attempts)
 */
const getOrdersNeedingIntervention = async (maxAttempts = 3) => {
  return await Order.find({
    paymentStatus: 'paid',
    status: 'confirmed',
    waybill: { $exists: false },
    shipmentAttempts: { $gte: maxAttempts }
  }).select('_id shipmentAttempts shipmentLastError totalAmount createdAt');
};

module.exports = {
  retryFailedShipments,
  getOrdersNeedingIntervention
};