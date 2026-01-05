const axios = require('axios');

class DelhiveryProvider {
  constructor() {
    this.baseURL = process.env.DELHIVERY_BASE_URL;
    this.token = process.env.DELHIVERY_TOKEN;
    this.pickupPincode = process.env.DELHIVERY_PICKUP_PIN;
  }

  async checkServiceability(pincode) {
    try {
      const response = await axios.get(`${this.baseURL}/api/cmu/klp/`, {
        headers: { 
          'Authorization': `Token ${this.token}`,
          'Content-Type': 'application/json'
        },
        params: { pincode },
        timeout: 8000
      });
      
      const deliveryCode = response.data.delivery_codes?.[0];
      const postalCode = deliveryCode?.postal_code;
      
      if (!postalCode || postalCode.pre_paid !== 'Y') {
        return { serviceable: false };
      }
      
      return { serviceable: true };
    } catch (error) {
      throw new Error('Delhivery serviceability check failed');
    }
  }

  async calculatePrice({ fromPincode, toPincode, weight }) {
    try {
      const response = await axios.get(`${this.baseURL}/api/kinko/v1/invoice/charges/.json`, {
        headers: { 
          'Authorization': `Token ${this.token}`,
          'Content-Type': 'application/json'
        },
        params: {
          md: 'S',
          ss: 'Delivered',
          d_pin: toPincode,
          o_pin: fromPincode,
          cgm: Math.ceil(weight / 1000)
        },
        timeout: 8000
      });

      const rateData = response.data?.[0];
      if (!rateData?.total_amount) {
        throw new Error('No rate data from Delhivery');
      }

      // Runtime guard - only DELHIVERY_REAL if we have real total_amount
      if (!rateData.total_amount) {
        throw new Error('DELHIVERY_REAL used without Delhivery API price');
      }

      return {
        total: rateData.total_amount,
        breakdown: rateData.breakdown || null
      };
    } catch (error) {
      throw new Error('Delhivery rate calculation failed');
    }
  }

  async trackOrder(orderId) {
    try {
      const response = await axios.get(`${this.baseURL}/api/v1/packages/json/`, {
        headers: { 
          'Authorization': `Token ${this.token}`,
          'Content-Type': 'application/json'
        },
        params: {
          waybill: orderId
        },
        timeout: 8000
      });

      const shipment = response.data?.ShipmentData?.[0];
      if (!shipment) {
        throw new Error('Order not found');
      }

      return {
        waybill: shipment.Waybill,
        status: shipment.Status?.Status,
        statusDate: shipment.Status?.StatusDateTime,
        destination: shipment.Destination,
        origin: shipment.Origin
      };
    } catch (error) {
      throw new Error('Failed to track order');
    }
  }
}

module.exports = new DelhiveryProvider();