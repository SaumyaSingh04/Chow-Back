const { isGorakhpurPincode } = require('../config/gorakhpurPincodes');
const Order = require('../models/Order');

/**
 * Middleware to prevent Delhivery operations for Gorakhpur orders
 * This acts as a safety net to ensure no Delhivery operations happen for local deliveries
 */
const preventGorakhpurDelhivery = async (req, res, next) => {
  try {
    // Check if this is a Delhivery-related operation
    const isDelhiveryOperation = req.originalUrl.includes('/delhivery/') || 
                                req.body?.provider === 'delhivery' ||
                                req.body?.deliveryProvider === 'delhivery';

    if (!isDelhiveryOperation) {
      return next();
    }

    // Check for pincode in request
    let pincode = req.body?.pincode || req.body?.deliveryPincode || req.params?.pincode;
    
    // If no pincode in request, check if orderId is provided to get pincode from order
    if (!pincode && req.body?.orderId) {
      const order = await Order.findById(req.body.orderId).populate('userId', 'address');
      if (order && order.addressId) {
        const deliveryAddress = order.userId.address?.find(
          addr => String(addr._id) === String(order.addressId)
        );
        pincode = deliveryAddress?.postcode;
      }
    }

    // If we have a pincode and it's Gorakhpur, block the operation
    if (pincode && isGorakhpurPincode(pincode)) {
      console.error(`BLOCKED: Attempted Delhivery operation for Gorakhpur pincode ${pincode}`);
      return res.status(403).json({
        success: false,
        error: 'CRITICAL: Delhivery operations are not allowed for Gorakhpur deliveries'
      });
    }

    next();
  } catch (error) {
    console.error('Delivery validation middleware error:', error);
    next(); // Continue on error to avoid blocking legitimate requests
  }
};

module.exports = { preventGorakhpurDelhivery };