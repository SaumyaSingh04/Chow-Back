const axios = require('axios');

class DelhiveryAdapter {
  constructor() {
    this.baseURL = process.env.DELHIVERY_BASE_URL;
    this.token = process.env.DELHIVERY_TOKEN;
    this.pickupPin = process.env.DELHIVERY_PICKUP_PIN;
  }

  async getPricing(pincode, weight) {
    try {
      const response = await axios.get(`${this.baseURL}/api/kinko/v1/invoice/charges/.json`, {
        headers: { 
          'Authorization': `Token ${this.token}`,
          'Content-Type': 'application/json'
        },
        params: {
          md: 'S',
          ss: 'Delivered',
          d_pin: pincode,
          o_pin: this.pickupPin,
          cgm: Math.ceil(weight / 1000)
        },
        timeout: 10000
      });

      const rateData = response.data?.[0];
      if (!rateData?.total_amount) {
        return {
          success: false,
          serviceable: false,
          message: 'Pincode not serviceable'
        };
      }

      return {
        success: true,
        serviceable: true,
        pricingSource: 'DELHIVERY_REAL',
        provider: 'DELHIVERY',
        charge: rateData.total_amount,
        eta: '1-3 business days',
        breakdown: rateData
      };
    } catch (error) {
      return {
        success: false,
        serviceable: false,
        message: 'Pincode not serviceable'
      };
    }
  }
}

module.exports = new DelhiveryAdapter();