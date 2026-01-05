const DeliveryService = require('../services/delivery/DeliveryService');

exports.checkDeliveryOptions = async (req, res) => {
  try {
    const { pincode } = req.params;
    const { weight } = req.query;
    
    if (!pincode) {
      return res.status(400).json({
        success: false,
        message: 'Pincode is required'
      });
    }

    const totalWeight = parseInt(weight) || 500;
    const deliveryInfo = await DeliveryService.getDeliveryInfo(pincode, totalWeight);
    
    res.json(deliveryInfo);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};