const axios = require('axios');

class DistanceService {
  async calculateDistance(fromPincode, toPincode) {
    try {
      const [fromCoords, toCoords] = await Promise.all([
        this._getCoordinates(fromPincode),
        this._getCoordinates(toPincode)
      ]);

      if (!fromCoords || !toCoords) return null;

      // Try OSRM first
      try {
        const response = await axios.get(
          `https://router.project-osrm.org/route/v1/driving/${fromCoords[0]},${fromCoords[1]};${toCoords[0]},${toCoords[1]}?overview=false`,
          { timeout: 5000 }
        );
        
        if (response.data.routes?.[0]?.distance) {
          return Math.round(response.data.routes[0].distance / 1000 * 100) / 100;
        }
      } catch (error) {
        // Fallback to Haversine
      }

      return this._haversineDistance(fromCoords[1], fromCoords[0], toCoords[1], toCoords[0]);
    } catch (error) {
      return null;
    }
  }

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
      return null;
    }
  }

  _haversineDistance(lat1, lon1, lat2, lon2) {
    const toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2;
    return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)) * 100) / 100;
  }
}

module.exports = new DistanceService();