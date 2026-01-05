const axios = require('axios');

class DelhiveryService {
  constructor() {
    this.baseURL = process.env.DELHIVERY_BASE_URL || 'https://track.delhivery.com';
    this.token = process.env.DELHIVERY_TOKEN;
    this.pickupPincode = process.env.DELHIVERY_PICKUP_PIN || '273002';
    this.useRealAPI = process.env.USE_REAL_DELHIVERY === 'true';
    
    // Validate configuration on startup
    const validation = this.validateConfig();
    if (!validation.isValid) {
      console.warn('Delhivery Service Configuration Issues:', validation.errors);
    }
    
    console.log(`Delhivery Service initialized - Mode: ${this.useRealAPI ? 'REAL API' : 'MOCK'}`);
  }

  // Utility method to validate environment configuration
  validateConfig() {
    const errors = [];
    
    if (this.useRealAPI) {
      if (!this.token) errors.push('DELHIVERY_TOKEN is required when USE_REAL_DELHIVERY is true');
      if (!this.baseURL) errors.push('DELHIVERY_BASE_URL is required');
    }
    
    if (!this.pickupPincode) errors.push('DELHIVERY_PICKUP_PIN is required');
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Check if pincode is serviceable
  async checkPincode(pincode) {
    // Input validation
    if (!pincode || pincode.length !== 6 || !/^\d{6}$/.test(pincode)) {
      return { success: false, error: 'Valid 6-digit pincode required' };
    }
    
    if (!this.useRealAPI) {
      return this._mockCheckPincode(pincode);
    }

    try {
      console.log(`Checking pincode ${pincode} with Delhivery API...`);
      // Try the correct Delhivery API endpoint for pincode serviceability
      const response = await axios.get(`${this.baseURL}/api/kinko/v1/invoice/charges/.json`, {
        headers: { 
          'Authorization': `Token ${this.token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        params: {
          md: 'S', // Surface mode
          ss: 'Delivered',
          d_pin: pincode, // destination pincode
          o_pin: this.pickupPincode, // origin pincode
          cgm: 1 // 1 kg weight for testing
        },
        timeout: 10000
      });
      
      console.log('Delhivery pincode response status:', response.status);
      console.log('Delhivery pincode response:', JSON.stringify(response.data, null, 2));
      
      // If we get a successful response with rate data, the pincode is serviceable
      if (response.data && Array.isArray(response.data) && response.data.length > 0) {
        const rateData = response.data[0];
        if (rateData && rateData.total_amount !== undefined) {
          console.log(`Pincode ${pincode} is serviceable - rate: ₹${rateData.total_amount}`);
          return {
            success: true,
            serviceable: true,
            city: rateData.destination_city || 'Unknown',
            state: rateData.destination_state || 'Unknown',
            message: 'Pincode serviceable'
          };
        }
      }
      
      // If no rate data, pincode is not serviceable
      console.log(`No rate data found for pincode ${pincode} - not serviceable`);
      return {
        success: false,
        serviceable: false,
        message: 'Pincode not serviceable'
      };
    } catch (error) {
      console.error('Delhivery pincode check error:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        message: error.message,
        url: error.config?.url,
        data: error.response?.data
      });
      
      // If authentication fails, return non-serviceable instead of throwing
      if (error.response?.status === 401) {
        console.error('Delhivery authentication failed - check DELHIVERY_TOKEN');
        return {
          success: false,
          serviceable: false,
          message: 'Pincode not serviceable'
        };
      }
      
      // For any other error, return non-serviceable
      return {
        success: false,
        serviceable: false,
        message: 'Pincode not serviceable'
      };
    }
  }

  // Calculate shipping rate (PREPAID only)
  async calculateRate({ pickupPincode, deliveryPincode, weight }) {
    // Input validation
    if (!deliveryPincode || !weight) {
      return { success: false, error: 'Delivery pincode and weight are required' };
    }
    
    if (weight <= 0) {
      return { success: false, error: 'Weight must be greater than 0' };
    }
    
    if (!this.useRealAPI) {
      return this._mockCalculateRate({ pickupPincode, deliveryPincode, weight });
    }

    try {
      const response = await axios.get(`${this.baseURL}/api/kinko/v1/invoice/charges/.json`, {
        headers: { 
          'Authorization': `Token ${this.token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        params: {
          md: 'S',
          ss: 'Delivered', 
          d_pin: deliveryPincode,
          o_pin: pickupPincode || this.pickupPincode,
          cgm: Math.ceil(weight / 1000)
        },
        timeout: 10000
      });

      console.log('Delhivery rate response:', response.data);

      const rateData = response.data?.[0];
      if (!rateData) {
        return { success: false, error: 'No rate data received from Delhivery' };
      }

      return {
        success: true,
        rate: rateData.total_amount || 0,
        currency: 'INR',
        breakdown: rateData.breakdown || null
      };
    } catch (error) {
      console.error('Delhivery rate calculation error:', error.response?.status, error.message);
      
      // If authentication fails, throw error to trigger fallback
      if (error.response?.status === 401 || error.message.includes('Authentication')) {
        throw new Error('Delhivery authentication failed');
      }
      
      return { success: false, error: `Rate calculation failed: ${error.message}` };
    }
  }

  // Create shipment
  async createShipment(orderData) {
    // Input validation
    if (!orderData || !orderData.orderId) {
      return { success: false, error: 'Order data with orderId is required' };
    }
    
    // CRITICAL: Never create Delhivery shipment for Gorakhpur orders
    const { isGorakhpurPincode } = require('../config/gorakhpurPincodes');
    if (isGorakhpurPincode(orderData.deliveryPincode)) {
      return { 
        success: false, 
        error: 'Gorakhpur orders use self-delivery, no Delhivery shipment needed' 
      };
    }
    
    if (!this.useRealAPI) {
      return this._mockCreateShipment(orderData);
    }

    try {
      const shipmentData = this._buildShipmentPayload(orderData);
      
      const response = await axios.post(`${this.baseURL}/cmu/create.json`, 
        `format=json&data=${JSON.stringify(shipmentData)}`,
        {
          headers: {
            'Authorization': `Token ${this.token}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 15000 // 15 second timeout for shipment creation
        }
      );

      const packageData = response.data.packages?.[0];
      if (!packageData?.waybill) {
        return { success: false, error: 'No waybill received from Delhivery' };
      }

      return {
        success: true,
        waybill: packageData.waybill,
        status: 'SHIPMENT_CREATED',
        estimatedDelivery: packageData.expected_delivery_date
      };
    } catch (error) {
      console.error('Delhivery shipment creation error:', error.message);
      return { success: false, error: `Shipment creation failed: ${error.message}` };
    }
  }

  // Track shipment
  async trackShipment(waybill) {
    // Input validation
    if (!waybill) {
      return { success: false, error: 'Waybill number is required' };
    }
    
    if (!this.useRealAPI) {
      return this._mockTrackShipment(waybill);
    }

    try {
      const response = await axios.get(`${this.baseURL}/v1/packages/json/`, {
        headers: { 'Authorization': `Token ${this.token}` },
        params: { waybill },
        timeout: 10000 // 10 second timeout
      });

      const shipment = response.data.ShipmentData?.[0];
      if (!shipment) {
        return { success: false, error: 'Shipment not found' };
      }
      
      const shipmentInfo = shipment.Shipment;
      return {
        success: true,
        status: this._mapDelhiveryStatus(shipmentInfo?.Status?.Status),
        location: shipmentInfo?.Origin,
        expectedDelivery: shipmentInfo?.ExpectedDeliveryDate,
        currentLocation: shipmentInfo?.Destination,
        trackingHistory: shipment.ShipmentTrack || []
      };
    } catch (error) {
      console.error('Delhivery tracking error:', error.message);
      return { success: false, error: `Tracking failed: ${error.message}` };
    }
  }

  // Build shipment payload for Delhivery API
  _buildShipmentPayload(orderData) {
    // Validate required fields
    const requiredFields = ['customerName', 'address', 'pincode', 'city', 'state', 'phone', 'orderId'];
    for (const field of requiredFields) {
      if (!orderData[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    
    return {
      shipments: [{
        name: orderData.customerName.substring(0, 50), // Limit name length
        add: orderData.address.substring(0, 200), // Limit address length
        pin: orderData.pincode,
        city: orderData.city.substring(0, 50),
        state: orderData.state.substring(0, 50),
        country: 'India',
        phone: orderData.phone.replace(/[^0-9]/g, '').substring(0, 10), // Clean phone number
        order: String(orderData.orderId).substring(0, 50),
        payment_mode: orderData.paymentMode || 'PREPAID',
        return_pin: process.env.RETURN_PINCODE || this.pickupPincode,
        return_city: process.env.RETURN_CITY || 'Gorakhpur',
        return_phone: process.env.RETURN_PHONE || '9999999999',
        return_add: process.env.RETURN_ADDRESS || 'Return Address',
        return_state: process.env.RETURN_STATE || 'Uttar Pradesh',
        products_desc: (orderData.itemsDescription || 'Food Items').substring(0, 300),
        hsn_code: '21069099', // HSN code for food products
        cod_amount: 0, // Always 0 for PREPAID
        order_date: new Date().toISOString().split('T')[0],
        total_amount: Math.round(orderData.totalAmount || 0),
        seller_add: process.env.SELLER_ADDRESS || 'Seller Address',
        seller_name: process.env.SELLER_NAME || 'Chow',
        seller_inv: `INV-${Date.now()}`, // Generate invoice number
        quantity: orderData.totalQuantity || 1,
        waybill: '', // Will be generated by Delhivery
        shipment_width: 15, // cm
        shipment_height: 10, // cm
        shipment_length: 20, // cm
        weight: Math.max(1, Math.ceil((orderData.totalWeight || 500) / 1000)), // Min 1kg
        seller_gst_tin: process.env.SELLER_GST || '',
        shipping_mode: 'Surface',
        address_type: 'home'
      }]
    };
  }

  // Map Delhivery status to our internal status
  _mapDelhiveryStatus(delhiveryStatus) {
    if (!delhiveryStatus) return 'PENDING';
    
    const statusMap = {
      'Shipped': 'SHIPMENT_CREATED',
      'Dispatched': 'SHIPMENT_CREATED',
      'In transit': 'IN_TRANSIT',
      'In Transit': 'IN_TRANSIT',
      'Out for Delivery': 'IN_TRANSIT',
      'Out For Delivery': 'IN_TRANSIT',
      'Delivered': 'DELIVERED',
      'RTO Initiated': 'RTO',
      'RTO-Initiated': 'RTO',
      'RTO Delivered': 'RTO',
      'RTO-Delivered': 'RTO',
      'Cancelled': 'RTO',
      'Lost': 'RTO',
      'Damaged': 'RTO'
    };
    
    return statusMap[delhiveryStatus] || 'PENDING';
  }

  // Mock implementations for testing - realistic responses
  _mockCheckPincode(pincode) {
    // Simulate some pincodes as non-serviceable
    const nonServiceablePincodes = ['000000', '999999', '123456', '111111', '222222'];
    
    if (nonServiceablePincodes.includes(pincode)) {
      return {
        success: false,
        serviceable: false,
        message: 'Pincode not serviceable'
      };
    }
    
    // Accept all valid 6-digit pincodes in mock mode
    if (/^\d{6}$/.test(pincode)) {
      return {
        success: true,
        serviceable: true,
        city: 'Mock City',
        state: 'Mock State',
        message: 'Pincode serviceable'
      };
    }
    
    return {
      success: false,
      serviceable: false,
      message: 'Invalid pincode format'
    };
  }

  async _mockCalculateRate({ pickupPincode, deliveryPincode, weight }) {
    // Realistic rate calculation (PREPAID only)
    const baseRate = 50; // PREPAID base rate
    const weightInKg = Math.ceil(weight / 1000);
    const weightRate = weightInKg * 15; // ₹15 per kg
    const fuelSurcharge = Math.round((baseRate + weightRate) * 0.1); // 10% fuel surcharge
    
    // Get real distance using OpenStreetMap
    let estimatedDistance = 25; // fallback distance
    try {
      const realDistance = await this._calculateRealDistance(pickupPincode || this.pickupPincode, deliveryPincode);
      if (realDistance) {
        estimatedDistance = realDistance;
      }
    } catch (error) {
      console.log('Distance calculation fallback:', error.message);
    }
    
    const totalRate = baseRate + weightRate + fuelSurcharge;
    
    return {
      success: true,
      rate: totalRate,
      distance: estimatedDistance,
      currency: 'INR',
      breakdown: {
        baseRate,
        weightRate,
        fuelSurcharge,
        total: totalRate
      }
    };
  }

  // Calculate real distance using OpenStreetMap
  async _calculateRealDistance(fromPincode, toPincode) {
    try {
      const [fromCoords, toCoords] = await Promise.all([
        this._getCoordinates(fromPincode),
        this._getCoordinates(toPincode)
      ]);

      if (!fromCoords || !toCoords) {
        return null;
      }

      // Try OSRM for driving distance
      try {
        const response = await axios.get(
          `https://router.project-osrm.org/route/v1/driving/${fromCoords[0]},${fromCoords[1]};${toCoords[0]},${toCoords[1]}?overview=false`,
          { timeout: 5000 }
        );
        
        if (response.data.routes?.[0]?.distance) {
          return Math.round(response.data.routes[0].distance / 1000 * 100) / 100;
        }
      } catch (error) {
        console.log('OSRM fallback to Haversine');
      }

      // Fallback to Haversine distance
      return this._haversineDistance(fromCoords[1], fromCoords[0], toCoords[1], toCoords[0]);
    } catch (error) {
      console.error('Real distance calculation error:', error);
      return null;
    }
  }

  // Get coordinates from pincode using OpenStreetMap
  async _getCoordinates(pincode) {
    try {
      const response = await axios.get(
        `https://nominatim.openstreetmap.org/search?format=json&countrycodes=in&postalcode=${pincode}&limit=1`,
        { 
          headers: { 'User-Agent': 'ChowApp/1.0' },
          timeout: 5000
        }
      );
      const data = response.data;
      return data[0] ? [parseFloat(data[0].lon), parseFloat(data[0].lat)] : null;
    } catch (error) {
      console.error('Geocoding error:', error);
      return null;
    }
  }

  // Haversine distance calculation
  _haversineDistance(lat1, lon1, lat2, lon2) {
    const toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2;
    return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)) * 100) / 100;
  }

  _mockCreateShipment(orderData) {
    // Generate unique waybill number with better collision avoidance
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    const waybill = `MOCK${timestamp.toString().slice(-8)}${random}`;
    
    return {
      success: true,
      waybill,
      status: 'SHIPMENT_CREATED',
      estimatedDelivery: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    };
  }

  _mockTrackShipment(waybill) {
    // Simulate tracking based on waybill age
    const waybillTime = parseInt(waybill.replace('MOCK', ''));
    const ageInHours = (Date.now() - waybillTime) / (1000 * 60 * 60);
    
    let status = 'SHIPMENT_CREATED';
    let location = 'Origin Hub';
    
    if (ageInHours > 24) {
      status = 'IN_TRANSIT';
      location = 'Transit Hub';
    }
    if (ageInHours > 48) {
      status = 'DELIVERED';
      location = 'Destination';
    }
    
    return {
      success: true,
      status,
      location,
      expectedDelivery: new Date(waybillTime + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      trackingHistory: [
        { status: 'SHIPMENT_CREATED', timestamp: new Date(waybillTime).toISOString(), location: 'Origin Hub' },
        ...(ageInHours > 24 ? [{ status: 'IN_TRANSIT', timestamp: new Date(waybillTime + 24 * 60 * 60 * 1000).toISOString(), location: 'Transit Hub' }] : []),
        ...(ageInHours > 48 ? [{ status: 'DELIVERED', timestamp: new Date(waybillTime + 48 * 60 * 60 * 1000).toISOString(), location: 'Destination' }] : [])
      ]
    };
  }
}

module.exports = new DelhiveryService();