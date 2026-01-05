const { isGorakhpurPincode } = require('../../../config/gorakhpurPincodes');
const DistanceService = require('../DistanceService');

class SelfDeliveryAdapter {
  async getPricing(pincode, weight) {
    if (!isGorakhpurPincode(pincode)) {
      throw new Error('Self delivery only for Gorakhpur pincodes');
    }

    const distance = await DistanceService.calculateDistance(
      process.env.BASE_PINCODE || '273001', 
      pincode
    ) || 5; // Default fallback

    // Distance-based pricing
    const baseRate = 30;
    const distanceRate = Math.max(0, (distance - 2) * 5); // First 2km free
    const weightRate = Math.max(0, (Math.ceil(weight / 1000) - 1) * 10);
    const charge = Math.round(baseRate + distanceRate + weightRate);

    return {
      success: true,
      serviceable: true,
      pricingSource: 'SELF_DISTANCE',
      provider: 'SELF',
      charge,
      distance,
      eta: '1-2 hours',
      breakdown: {
        baseRate,
        distanceRate,
        weightRate,
        total: charge
      }
    };
  }
}

module.exports = new SelfDeliveryAdapter();