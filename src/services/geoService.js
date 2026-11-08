const jwt = require('jsonwebtoken');
const config = require('../config/config');
const storeSettingsService = require('./storeSettingsService');
const { calculateDeliveryFare, MAX_DELIVERY_DISTANCE_KM } = require('./fareCalculator');
const defaultMaps = require('./maps');
const { GeoError } = require('./maps/errors');
const defaultWeather = require('./weatherService');

/**
 * Validate geographic coordinates.
 * Coordinates must be finite numbers, within bounds, non-zero, and within the Philippines bounding box.
 * 
 * @param {number} lat 
 * @param {number} lng 
 */
function validateCoords(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new GeoError('GEO_INVALID_COORDS', 'Coordinates must be valid finite numbers.', 422);
  }

  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
    throw new GeoError('GEO_INVALID_COORDS', 'Coordinates are outside valid geographical bounds or 0,0.', 422);
  }

  // Philippines bounding box: lat 4.5..21.5, lng 116.0..127.0
  if (lat < 4.5 || lat > 21.5 || lng < 116.0 || lng > 127.0) {
    throw new GeoError('GEO_OUT_OF_COUNTRY', 'Delivery location is outside the Philippines.', 422);
  }
}

/**
 * Great-circle distance between two points in kilometers.
 */
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
 * Vehicle selection rule:
 * Distance <= BICYCLE_MAX_KM (default 1.5) uses bicycle, otherwise motorcycle.
 * 
 * Note on simplification: Route calculations always request the motorcycle travel mode ('TWO_WHEELER')
 * and do not re-route separately for bicycles to minimize external API costs and latency.
 */
function chooseVehicle(distanceKm) {
  const bicycleMax = Number.isFinite(config.delivery.bicycleMaxKm) ? config.delivery.bicycleMaxKm : 1.5;
  return Number(distanceKm) <= bicycleMax ? 'bicycle' : 'motorcycle';
}

/**
 * Sanitize formatted address string for plain text storage.
 * Strips <, >, and control characters.
 */
function sanitizeAddress(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').replace(/[\x00-\x1F\x7F]/g, '').trim();
}

/**
 * Parse coordinate candidate from input (supports numbers and numeric strings).
 * Rejects booleans, arrays, objects, NaN, Infinity.
 */
function parseCoordinate(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value === 'boolean' || Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    throw new GeoError('VALIDATION_ERROR', `${fieldName} must be a number or numeric string.`, 400);
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new GeoError('VALIDATION_ERROR', `${fieldName} must be a finite number.`, 400);
  }
  return num;
}

/**
 * Quote delivery for a given pin or address.
 * 
 * @param {Object} input - { lat, lng, address }
 * @param {Object} [deps] - { maps, weather, now } for test injection
 * @returns {Promise<Object>} Delivery quote response
 */
async function quoteDelivery(input = {}, deps = {}) {
  const maps = deps.maps || defaultMaps;
  const weather = deps.weather || defaultWeather;
  const now = deps.now || (() => new Date());

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new GeoError('VALIDATION_ERROR', 'Request body must be an object.', 400);
  }

  // Ignore any client-supplied pricing inputs (Decision 1)
  const latVal = parseCoordinate(input.lat, 'Latitude');
  const lngVal = parseCoordinate(input.lng, 'Longitude');

  let hasPin = false;
  let lat = null;
  let lng = null;

  if (latVal !== null && lngVal !== null) {
    hasPin = true;
    lat = latVal;
    lng = lngVal;
  } else if (latVal !== null || lngVal !== null) {
    throw new GeoError('VALIDATION_ERROR', 'Both latitude and longitude must be provided for a location pin.', 400);
  }

  let rawAddress = input.address;
  let addressText = null;

  if (rawAddress !== undefined && rawAddress !== null) {
    if (typeof rawAddress !== 'string') {
      throw new GeoError('VALIDATION_ERROR', 'Address must be a string.', 400);
    }
    const sanitized = rawAddress.replace(/[\x00-\x1F\x7F]/g, '').trim();
    if (sanitized.length > 200) {
      throw new GeoError('VALIDATION_ERROR', 'Address must not exceed 200 characters.', 400);
    }
    if (!hasPin && sanitized.length < 5) {
      throw new GeoError('VALIDATION_ERROR', 'Address must be at least 5 characters.', 400);
    }
    addressText = sanitized;
  }

  if (!hasPin && !addressText) {
    throw new GeoError('VALIDATION_ERROR', 'Share a location pin or type an address.', 400);
  }

  let formattedAddress = '';

  // Pipeline Step 1: Pin beats address. If both sent, use coordinates.
  if (hasPin) {
    formattedAddress = addressText ? sanitizeAddress(addressText) : `Pin (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
  } else {
    // Geocode address
    const geocoded = await maps.geocode(addressText);
    if (geocoded.precision === 'APPROXIMATE' || geocoded.precision === 'GEOMETRIC_CENTER') {
      throw new GeoError('GEO_LOW_PRECISION', 'Address is too vague. Please share a location pin or enter a more specific address.', 422);
    }
    lat = geocoded.lat;
    lng = geocoded.lng;
    formattedAddress = sanitizeAddress(geocoded.formattedAddress || addressText);
  }

  // Pipeline Step 2: Validate coordinates
  validateCoords(lat, lng);

  const storeSettings = storeSettingsService.getCachedStoreSettings();
  const storeLat = Number.isFinite(storeSettings.store_latitude) ? storeSettings.store_latitude : (Number.isFinite(config.store.lat) ? config.store.lat : 14.6042);
  const storeLng = Number.isFinite(storeSettings.store_longitude) ? storeSettings.store_longitude : (Number.isFinite(config.store.lng) ? config.store.lng : 120.9822);
  const maxKm = Number.isFinite(storeSettings.max_delivery_radius_km) ? storeSettings.max_delivery_radius_km : (Number.isFinite(config.store.maxDeliveryKm) ? config.store.maxDeliveryKm : 3.0);

  // Pipeline Step 3: Haversine prefilter from store
  const straightLineKm = haversineKm(storeLat, storeLng, lat, lng);
  if (straightLineKm > maxKm) {
    throw new GeoError('GEO_TOO_FAR', `Delivery location is beyond the maximum radius of ${maxKm.toFixed(1)} km.`, 422, {
      roadKm: straightLineKm,
      maxKm
    });
  }

  // Pipeline Step 4: Road distance via routing API
  const route = await maps.routeDistance({ lat: storeLat, lng: storeLng }, { lat, lng });
  if (route.km > maxKm) {
    throw new GeoError('GEO_TOO_FAR', `Road distance (${route.km.toFixed(1)} km) exceeds the maximum delivery radius of ${maxKm.toFixed(1)} km.`, 422, {
      roadKm: route.km,
      maxKm
    });
  }

  // Pipeline Step 5: Distance in kilometers rounded to nearest 0.1 km, capped at maxKm
  const distanceKm = Math.min(maxKm, Math.round(route.km * 10) / 10);

  // Pipeline Step 6: Server chooses vehicle type
  const vehicleType = chooseVehicle(distanceKm);

  // Pipeline Step 7: Server checks weather condition
  const weatherCondition = await weather.getCurrentWeather();

  // Pipeline Step 8: Price through existing fare calculator with injected time
  const currentTime = now();
  const fare = calculateDeliveryFare(distanceKm, vehicleType, weatherCondition, currentTime, maxKm);

  // Pipeline Step 9: Sign the quote token
  const iat = Math.floor(currentTime.getTime() / 1000);
  const claims = {
    lat,
    lng,
    address: formattedAddress,
    distanceKm,
    vehicleType,
    weatherCondition: fare.weatherCondition,
    deliveryFee: fare.finalFare
  };

  const quoteToken = jwt.sign(
    { ...claims, iat },
    config.jwtSecret,
    {
      audience: 'delivery-quote',
      expiresIn: config.delivery.quoteTtlSec
    }
  );

  return {
    quoteToken,
    expiresInSec: config.delivery.quoteTtlSec,
    destination: {
      lat,
      lng,
      formattedAddress
    },
    distanceKm,
    etaMin: route.etaMin,
    vehicleType,
    weatherCondition: fare.weatherCondition,
    fare: {
      baseFare: fare.baseFare,
      distanceCharge: fare.distanceCharge,
      fuelCost: fare.fuelCost,
      maintenanceCost: fare.maintenanceCost,
      surchargeRate: fare.surchargeRate,
      finalFare: fare.finalFare
    },
    currency: 'PHP'
  };
}

/**
 * Verify signed delivery quote token.
 * 
 * @param {string} token 
 * @param {Object} [deps] - { now }
 * @returns {Object} Decoded quote claims
 */
function verifyQuote(token, deps = {}) {
  const now = deps.now || (() => new Date());

  if (!token || typeof token !== 'string') {
    throw new GeoError('QUOTE_INVALID', 'Delivery quote token is missing or malformed.', 400);
  }

  const clockTimestamp = Math.floor(now().getTime() / 1000);

  try {
    const decoded = jwt.verify(token, config.jwtSecret, {
      audience: 'delivery-quote',
      clockTimestamp
    });
    return decoded;
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new GeoError('QUOTE_EXPIRED', 'Delivery quote has expired. Please obtain a fresh delivery quote.', 410);
    }
    throw new GeoError('QUOTE_INVALID', 'Delivery quote is invalid or tampered.', 400);
  }
}

module.exports = {
  quoteDelivery,
  verifyQuote,
  chooseVehicle,
  haversineKm,
  validateCoords,
  GeoError
};
