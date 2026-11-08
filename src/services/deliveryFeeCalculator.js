/**
 * Diner's Cafe - Automated Distance-Based Delivery Fare Calculation Module
 * 
 * Matrix Rules:
 *  - Cafe Origin: Diner's Cafe - Main Branch (Static Latitude: 14.6143686, Longitude: 120.9642334)
 *  - Base Fare: ₱40.00 (covers the first 2.0 kilometers)
 *  - Incremental Rate: ₱12.00 per kilometer for every kilometer beyond 2 km (rounded up to nearest km)
 *  - In-house delivery threshold: 3.0 km (configurable via store_settings)
 */

const config = require('../config/config');
const maps = require('./maps');

let storeSettingsService = null;
try {
  storeSettingsService = require('./storeSettingsService');
} catch (e) {
  storeSettingsService = null;
}

// Fixed static origin coordinates for Diner's Cafe - Main Branch
const DEFAULT_STORE_NAME = "Diner's Cafe - Main Branch";
const DEFAULT_STORE_LAT = 14.6143686;
const DEFAULT_STORE_LNG = 120.9642334;
const DEFAULT_MAX_RADIUS_KM = 3.0;
const MAX_DELIVERY_RADIUS_LIMIT_KM = 10.0; // Radius limit: distances > 10 km are non-deliverable

// Fare Matrix Constants
const BASE_FARE = 40.00;
const BASE_COVERAGE_KM = 2.0;
const INCREMENTAL_RATE_PER_KM = 12.00;

// Route cache to avoid redundant external network roundtrips
const routeCache = new Map();
const ROUTE_CACHE_MAX = 500;
const ROUTE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Great-circle distance between two geographic coordinates in kilometers
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371.0;
  const toRad = deg => (deg * Math.PI) / 180;
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
 * Resolve the current active store origin coordinates & delivery radius
 */
function getStoreOrigin() {
  const settings = storeSettingsService?.getCachedStoreSettings?.();
  const lat = Number.isFinite(settings?.store_latitude)
    ? settings.store_latitude
    : (Number.isFinite(config.store?.lat) ? config.store.lat : DEFAULT_STORE_LAT);
  const lng = Number.isFinite(settings?.store_longitude)
    ? settings.store_longitude
    : (Number.isFinite(config.store?.lng) ? config.store.lng : DEFAULT_STORE_LNG);
  const name = settings?.store_name || config.store?.name || DEFAULT_STORE_NAME;
  const maxRadiusKm = Number.isFinite(settings?.max_delivery_radius_km)
    ? settings.max_delivery_radius_km
    : (Number.isFinite(config.store?.maxDeliveryKm) ? config.store.maxDeliveryKm : DEFAULT_MAX_RADIUS_KM);

  return { lat, lng, name, maxRadiusKm };
}

/**
 * Compute road distance via OSRM public API with timeout
 */
async function fetchOsrmDistance(origin, dest, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `http://router.project-osrm.org/route/v1/driving/${dest.lng},${dest.lat};${origin.lng},${origin.lat}?overview=false`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code === 'Ok' && Array.isArray(data.routes) && data.routes.length > 0) {
      const distanceMeters = data.routes[0].distance;
      if (Number.isFinite(distanceMeters) && distanceMeters > 0) {
        return Math.round((distanceMeters / 1000) * 10) / 10;
      }
    }
    return null;
  } catch (err) {
    clearTimeout(timer);
    return null;
  }
}

/**
 * Calculate route distance using Haversine formula (offline zero-cost),
 * Google Distance Matrix, or OSRM API route distance
 * 
 * @param {{ lat: number, lng: number }} origin
 * @param {{ lat: number, lng: number }} dest
 * @param {Object} [options] - { method: 'haversine'|'osrm'|'google' }
 */
async function getRouteDistance(origin, dest, options = {}) {
  const method = (options.method || '').toLowerCase().trim();

  // If explicit offline/zero-cost Haversine formula requested:
  if (method === 'haversine') {
    const straightKm = haversineKm(origin.lat, origin.lng, dest.lat, dest.lng);
    const distanceKm = Math.round(straightKm * 1.25 * 10) / 10;
    return {
      distanceKm: Math.max(0.1, distanceKm),
      providerUsed: 'haversine'
    };
  }

  const cacheKey = `${Number(dest.lat).toFixed(4)},${Number(dest.lng).toFixed(4)}_${method || 'auto'}`;
  const now = Date.now();

  const cached = routeCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.result;
  }

  let distanceKm = null;
  let providerUsed = 'haversine';

  // 1. If Google Distance Matrix is requested or configured
  const mapsProvider = (config.maps?.provider || '').toLowerCase().trim();
  if (method === 'google' || mapsProvider === 'google' || config.maps?.googleKey) {
    try {
      const routeRes = await maps.routeDistance(origin, dest);
      if (routeRes && Number.isFinite(routeRes.km) && routeRes.km > 0) {
        distanceKm = Math.round(routeRes.km * 10) / 10;
        providerUsed = 'google';
      }
    } catch (gErr) {
      // Fall through to OSRM or Haversine
    }
  }

  // 2. Try OSRM route distance if requested or if Google wasn't used/failed
  if (distanceKm === null && (method === 'osrm' || method === '' || method === 'auto')) {
    try {
      const osrmKm = await fetchOsrmDistance(origin, dest);
      if (osrmKm !== null) {
        distanceKm = osrmKm;
        providerUsed = 'osrm';
      }
    } catch (oErr) {
      // Fall through to Haversine
    }
  }

  // 3. Fallback / Zero-cost method: Haversine distance with 1.25 urban route circuity factor
  if (distanceKm === null) {
    const straightKm = haversineKm(origin.lat, origin.lng, dest.lat, dest.lng);
    distanceKm = Math.round(straightKm * 1.25 * 10) / 10;
    providerUsed = 'haversine';
  }

  // Minimum sensible distance
  if (distanceKm < 0.1) distanceKm = 0.5;

  const result = { distanceKm, providerUsed };

  // Cache result
  if (routeCache.size >= ROUTE_CACHE_MAX) {
    const oldestKey = routeCache.keys().next().value;
    routeCache.delete(oldestKey);
  }
  routeCache.set(cacheKey, { result, expiresAt: now + ROUTE_CACHE_TTL_MS });

  return result;
}

/**
 * Pure calculation of fare from distance based on matrix rules:
 * - Base Fare: ₱40.00 (covers the first 2.0 km)
 * - Incremental Rate: ₱12.00 per km for every km beyond 2 km (rounded up to nearest km)
 * - Radius Limit: If distance exceeds 10 km, flag as non-deliverable
 * 
 * @param {number} distanceKm 
 * @param {number|null} maxRadiusKm 
 * @param {number|null} radiusLimitKm 
 * @returns {Object}
 */
function computeDeliveryFee(distanceKm, maxRadiusKm = null, radiusLimitKm = MAX_DELIVERY_RADIUS_LIMIT_KM) {
  const dist = Math.max(0.1, Number(distanceKm) || 0.1);
  const roundedDist = Math.round(dist * 10) / 10;
  const effectiveMaxRadius = Number.isFinite(maxRadiusKm) && maxRadiusKm > 0
    ? maxRadiusKm
    : (getStoreOrigin().maxRadiusKm || DEFAULT_MAX_RADIUS_KM);
  const effectiveLimit = Number.isFinite(radiusLimitKm) && radiusLimitKm > 0
    ? radiusLimitKm
    : MAX_DELIVERY_RADIUS_LIMIT_KM;

  let fee = BASE_FARE;
  let excessKm = 0;
  let incrementalCharge = 0;

  if (roundedDist > BASE_COVERAGE_KM) {
    excessKm = Math.ceil(roundedDist - BASE_COVERAGE_KM);
    incrementalCharge = excessKm * INCREMENTAL_RATE_PER_KM;
    fee = BASE_FARE + incrementalCharge;
  }

  fee = Math.round(fee * 100) / 100;
  const isBeyondRadius = roundedDist > effectiveMaxRadius;
  const isDeliverable = roundedDist <= effectiveLimit;

  return {
    deliveryFee: fee,
    distanceKm: roundedDist,
    baseFare: BASE_FARE,
    baseCoverageKm: BASE_COVERAGE_KM,
    incrementalRate: INCREMENTAL_RATE_PER_KM,
    excessKm,
    incrementalCharge,
    isBeyondRadius,
    isDeliverable,
    radiusLimitKm: effectiveLimit,
    maxRadiusKm: effectiveMaxRadius
  };
}

/**
 * Automated Distance-Based Delivery Fare Calculator
 * 
 * Signatures:
 *  - calculateDeliveryFee(customerLat, customerLng)
 *  - calculateDeliveryFee({ lat, lng })
 *  - calculateDeliveryFee(addressOrCoordString)
 * 
 * @param {number|string|Object} customerLat - Latitude number/string, address string, or coordinate object
 * @param {number|string|null} customerLng - Longitude number/string (if lat is a number)
 * @param {Object} [options] - Optional overrides (origin, maxRadiusKm)
 * @returns {Promise<Object>} Complete fee and distance details
 */
async function calculateDeliveryFee(customerLat, customerLng = null, options = {}) {
  const origin = options.origin || getStoreOrigin();
  const maxRadiusKm = Number.isFinite(options.maxRadiusKm) ? options.maxRadiusKm : origin.maxRadiusKm;

  let destLat = null;
  let destLng = null;
  let formattedAddress = null;

  // Case 1: Coordinate Object { lat, lng } or { latitude, longitude }
  if (typeof customerLat === 'object' && customerLat !== null) {
    const obj = customerLat;
    destLat = Number(obj.lat ?? obj.latitude ?? obj.customerLat);
    destLng = Number(obj.lng ?? obj.longitude ?? obj.customerLng);
    formattedAddress = obj.address || obj.formattedAddress || null;
  }
  // Case 2: customerLat and customerLng are both numeric numbers or strings
  else if (
    customerLat !== null && customerLat !== undefined &&
    customerLng !== null && customerLng !== undefined &&
    !isNaN(Number(customerLat)) && !isNaN(Number(customerLng)) &&
    customerLat !== '' && customerLng !== ''
  ) {
    destLat = Number(customerLat);
    destLng = Number(customerLng);
  }
  // Case 3: customerLat is a string (e.g. coordinates "14.614, 120.964" or text address)
  else if (typeof customerLat === 'string') {
    const str = customerLat.trim();
    // Check if comma-separated coordinates: "14.6143, 120.9642"
    const coordMatch = str.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (coordMatch) {
      destLat = parseFloat(coordMatch[1]);
      destLng = parseFloat(coordMatch[2]);
      formattedAddress = `GPS (${destLat.toFixed(4)}, ${destLng.toFixed(4)})`;
    } else {
      // Address string: Geocode using maps provider
      try {
        const geocoded = await maps.geocode(str);
        if (geocoded && Number.isFinite(geocoded.lat) && Number.isFinite(geocoded.lng)) {
          destLat = geocoded.lat;
          destLng = geocoded.lng;
          formattedAddress = geocoded.formattedAddress || str;
        } else {
          throw new Error(`Address '${str}' could not be geocoded.`);
        }
      } catch (geoErr) {
        // Fallback to standard base delivery fee if geocoding fails
        const fallbackCalc = computeDeliveryFee(1.5, maxRadiusKm);
        return {
          ...fallbackCalc,
          origin,
          destination: null,
          formattedAddress: str,
          provider: 'fallback',
          geocodingFailed: true,
          valueOf() { return this.deliveryFee; },
          toString() { return this.deliveryFee.toFixed(2); }
        };
      }
    }
  }

  if (!Number.isFinite(destLat) || !Number.isFinite(destLng)) {
    throw new Error('Invalid customer coordinates provided to calculateDeliveryFee.');
  }

  const dest = { lat: destLat, lng: destLng };
  const { distanceKm, providerUsed } = await getRouteDistance(origin, dest, options);
  const feeDetails = computeDeliveryFee(distanceKm, maxRadiusKm, options.radiusLimitKm);

  return {
    ...feeDetails,
    origin,
    destination: dest,
    formattedAddress: formattedAddress || `Coordinates (${dest.lat.toFixed(4)}, ${dest.lng.toFixed(4)})`,
    provider: providerUsed,
    valueOf() { return this.deliveryFee; },
    toString() { return this.deliveryFee.toFixed(2); }
  };
}

module.exports = {
  calculateDeliveryFee,
  computeDeliveryFee,
  getStoreOrigin,
  haversineKm,
  DEFAULT_STORE_NAME,
  DEFAULT_STORE_LAT,
  DEFAULT_STORE_LNG,
  DEFAULT_MAX_RADIUS_KM,
  MAX_DELIVERY_RADIUS_LIMIT_KM,
  BASE_FARE,
  BASE_COVERAGE_KM,
  INCREMENTAL_RATE_PER_KM
};

