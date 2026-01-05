const PricingService = require('./PricingService');
const DistanceService = require('./DistanceService');
const { isGorakhpurPincode } = require('../../config/gorakhpurPincodes');

class DeliveryService {
  async getDeliveryInfo(pincode, weight = 500) {
    const pricingResult = await PricingService.getDeliveryPricing(pincode, weight);
    
    if (!pricingResult.success) {
      return pricingResult;
    }

    // Add distance for display (doesn't affect Delhivery pricing)
    if (pricingResult.pricingSource === 'DELHIVERY_REAL') {
      const distance = await DistanceService.calculateDistance(
        process.env.BASE_PINCODE || '273001',
        pincode
      );
      pricingResult.distance = distance;
    }

    // Safety guard
    if (pricingResult.pricingSource === 'DELHIVERY_REAL' && !pricingResult.breakdown?.total_amount) {
      throw new Error('INVALID STATE: DELHIVERY_REAL without Delhivery price');
    }

    return pricingResult;
  }

  /**
   * Validate delivery provider selection - prevents Delhivery for Gorakhpur
   */
  validateDeliveryProvider(pincode, selectedProvider) {
    const isGorakhpur = isGorakhpurPincode(pincode);
    
    if (isGorakhpur && selectedProvider === 'delhivery') {
      throw new Error('CRITICAL: Delhivery cannot be used for Gorakhpur deliveries');
    }
    
    if (!isGorakhpur && selectedProvider === 'self') {
      throw new Error('Local delivery only available for Gorakhpur pincodes');
    }
    
    return true;
  }

  /**
   * Check if shipment creation is allowed for the order
   */
  shouldCreateDelhiveryShipment(order) {
    // Never create Delhivery shipment for Gorakhpur orders
    if (order.deliveryProvider === 'self') {
      return false;
    }
    
    // Only create for confirmed, paid Delhivery orders without existing waybill
    return order.deliveryProvider === 'delhivery' && 
           order.paymentStatus === 'paid' && 
           order.status === 'confirmed' && 
           !order.waybill;
  }
}

module.exports = new DeliveryService();