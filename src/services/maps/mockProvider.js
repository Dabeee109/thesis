const config = require('../../config/config');
const { GeoError } = require('./errors');

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371.0;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Deterministic Mock Maps Provider for development and testing.
 * Refuses to run in production.
 */
class MockProvider {
  constructor() {
    this.name = 'mock';
  }

  ensureNotProduction() {
    if (process.env.NODE_ENV === 'production' || config.nodeEnv === 'production') {
      throw new GeoError('GEO_PROVIDER_ERROR', 'Mock maps provider cannot be used in production.', 502);
    }
  }

  async geocode(address) {
    this.ensureNotProduction();
    const text = String(address || '').trim().toLowerCase();

    if (text.includes('nowhere')) {
      throw new GeoError('GEO_NOT_FOUND', `Address '${address}' not found.`, 422);
    }

    const storeLat = Number.isFinite(config.store.lat) ? config.store.lat : 14.6042;
    const storeLng = Number.isFinite(config.store.lng) ? config.store.lng : 120.9822;

    if (text.includes('toofar')) {
      // Point ~6.1 km north of the store (0.055 degrees lat ≈ 6.1 km)
      return {
        lat: storeLat + 0.055,
        lng: storeLng,
        formattedAddress: address.trim(),
        precision: 'ROOFTOP'
      };
    }

    if (text.includes('vague')) {
      return {
        lat: storeLat + 0.01,
        lng: storeLng,
        formattedAddress: address.trim(),
        precision: 'APPROXIMATE'
      };
    }

    // Default: point ~1.1 km north of the store (0.01 degrees lat ≈ 1.11 km)
    return {
      lat: storeLat + 0.01,
      lng: storeLng,
      formattedAddress: address.trim(),
      precision: 'ROOFTOP'
    };
  }

  async routeDistance(origin, dest) {
    this.ensureNotProduction();
    const dist = haversineKm(origin.lat, origin.lng, dest.lat, dest.lng);
    const km = dist * 1.25;
    const etaMin = Math.ceil(km * 4) + 2;

    return {
      km,
      etaMin
    };
  }
}

module.exports = {
  MockProvider,
  haversineKm
};
