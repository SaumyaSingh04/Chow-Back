class SelfDeliveryProvider {
  calculatePrice(distance, weight) {
    const baseRate = 30;
    const distanceRate = Math.max(0, (distance - 2) * 5); // First 2km free, ₹5/km after
    const weightRate = Math.max(0, (Math.ceil(weight / 1000) - 1) * 10); // First kg free, ₹10/kg after
    
    const total = Math.round(baseRate + distanceRate + weightRate);
    
    return {
      total,
      breakdown: {
        baseRate,
        distanceRate,
        weightRate,
        total
      }
    };
  }
}

module.exports = new SelfDeliveryProvider();