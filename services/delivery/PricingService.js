const { isGorakhpurPincode } = require('../../config/gorakhpurPincodes');
const SelfDeliveryAdapter = require('./adapters/SelfDeliveryAdapter');
const DelhiveryAdapter = require('./adapters/DelhiveryAdapter');

class PricingService {
  async getDeliveryPricing(pincode, weight = 500) {
    if (!pincode || pincode.length !== 6) {
      throw new Error('Valid 6-digit pincode required');
    }

    if (isGorakhpurPincode(pincode)) {
      return await SelfDeliveryAdapter.getPricing(pincode, weight);
    } else {
      return await DelhiveryAdapter.getPricing(pincode, weight);
    }
  }
}

module.exports = new PricingService();