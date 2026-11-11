/**
 * Open-Source Delivery Distance & Fare Engine (Nominatim + OSRM)
 *
 * Zero-cost geocoding & road routing for Diner's Cafe:
 *  1. Nominatim OSM geocoding with multi-tier landmark precision fallback.
 *  2. OSRM driving route distance calculation ({lng},{lat}).
 *  3. Exact 2-decimal fare formula (Base ₱49.00 + ₱12.00/0.5km >1km + ₱2.83/km fuel + ₱7.50 maintenance).
 */

const axios = require('axios');

let storeSettingsService = null;
try {
  storeSettingsService = require('./storeSettingsService');
} catch (e) {
  storeSettingsService = null;
}

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const OSRM_ROUTE_BASE_URL = 'https://router.project-osrm.org/route/v1/driving';
const OSM_USER_AGENT = 'DinersCafeApp/1.0 (contact@dinerscafe.ph)';

const DEFAULT_STORE_LAT = 14.6143686;
const DEFAULT_STORE_LNG = 120.9642334;
const DEFAULT_MAX_RADIUS_KM = 3.0;

const BASE_FARE = 49.00;
const BASE_COVERAGE_KM = 1.0;
const STEP_RATE_PER_HALF_KM = 12.00;
const FUEL_COST_PER_KM = 2.83;
const MAINTENANCE_ALLOWANCE = 7.50;

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

function appendPhilippinesSuffix(queryText) {
  const clean = String(queryText || '').trim().replace(/\s+/g, ' ');
  if (!clean) return '';
  if (/\bphilippines\b/i.test(clean)) return clean;
  return `${clean}, Philippines`;
}

function isPlaceholderLocation(text) {
  const s = String(text || '').trim();
  if (!s) return true;
  return /^(?:none|n\/a|na|null|nowhere|unknown|asdf+|qwerty+|xyz+|!@#\S*|\.+|-+)$/i.test(s);
}

/**
 * Fetch active store origin coordinates & delivery radius from store_settings.
 * @returns {Promise<{ latitude: number, longitude: number, maxRadiusKm: number }>}
 */
async function getStoreOriginConfig() {
  let settings = null;
  if (storeSettingsService) {
    try {
      settings = typeof storeSettingsService.getStoreSettings === 'function'
        ? await storeSettingsService.getStoreSettings()
        : storeSettingsService.getCachedStoreSettings?.();
    } catch (e) {
      settings = storeSettingsService.getCachedStoreSettings?.() || null;
    }
  }

  const latitude = Number.isFinite(Number(settings?.store_latitude))
    ? Number(settings.store_latitude)
    : DEFAULT_STORE_LAT;
  const longitude = Number.isFinite(Number(settings?.store_longitude))
    ? Number(settings.store_longitude)
    : DEFAULT_STORE_LNG;
  const maxRadiusKm = Number.isFinite(Number(settings?.max_delivery_radius_km)) && Number(settings.max_delivery_radius_km) > 0
    ? Number(settings.max_delivery_radius_km)
    : DEFAULT_MAX_RADIUS_KM;

  return { latitude, longitude, maxRadiusKm };
}

/**
 * Query Nominatim search endpoint for a single query string.
 */
async function queryNominatim(q, options = {}) {
  const httpClient = options.httpClient || axios;
  const timeoutMs = options.timeoutMs || 5000;

  const response = await httpClient.get(NOMINATIM_SEARCH_URL, {
    params: {
      q,
      format: 'json',
      limit: 1,
      addressdetails: 1
    },
    headers: {
      'User-Agent': OSM_USER_AGENT,
      Accept: 'application/json'
    },
    timeout: timeoutMs
  });

  const results = response?.data;
  if (Array.isArray(results) && results.length > 0) {
    const top = results[0];
    const latitude = parseFloat(top.lat);
    const longitude = parseFloat(top.lon);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return {
        latitude,
        longitude,
        displayName: top.display_name || q,
        queryUsed: q
      };
    }
  }
  return null;
}

/**
 * Geocode destination using Nominatim multi-tier landmark precision strategy:
 *  1. "{address}, near {landmark}, Philippines"
 *  2. "{address}, Philippines"
 *  3. "{landmark}, Philippines"
 *
 * @param {string} address
 * @param {string} [landmark]
 * @param {Object} [options]
 * @returns {Promise<{ latitude: number, longitude: number, displayName: string, queryUsed: string }>}
 */
async function geocodeAddressWithLandmark(address, landmark = '', options = {}) {
  const cleanAddr = isPlaceholderLocation(address) ? '' : String(address).trim();
  const cleanLandmark = isPlaceholderLocation(landmark) ? '' : String(landmark).trim();

  if (!cleanAddr && !cleanLandmark) {
    const err = new Error(
      'Hindi po namin ma-locate ang inyong address. Pakibigay ng mas malinaw na street address, barangay, o kilalang landmark.'
    );
    err.code = 'GEOCODE_NOT_FOUND';
    throw err;
  }

  // Handle direct GPS coordinate string if customer sends "14.6143, 120.9642"
  const coordMatch = cleanAddr.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (coordMatch) {
    return {
      latitude: parseFloat(coordMatch[1]),
      longitude: parseFloat(coordMatch[2]),
      displayName: `GPS Pin (${parseFloat(coordMatch[1]).toFixed(4)}, ${parseFloat(coordMatch[2]).toFixed(4)})`,
      queryUsed: cleanAddr
    };
  }

  const attempts = [];
  if (cleanAddr && cleanLandmark) {
    attempts.push(appendPhilippinesSuffix(`${cleanAddr}, near ${cleanLandmark}`));
  }
  if (cleanAddr) {
    attempts.push(appendPhilippinesSuffix(cleanAddr));
  }
  if (cleanLandmark) {
    attempts.push(appendPhilippinesSuffix(cleanLandmark));
  }

  // Deduplicate attempts while preserving order
  const uniqueAttempts = [...new Set(attempts.filter(Boolean))];

  for (const queryStr of uniqueAttempts) {
    try {
      const coords = await queryNominatim(queryStr, options);
      if (coords) {
        return coords;
      }
    } catch (reqErr) {
      // Continue to next fallback query attempt
      console.warn(`[fareEngine] Nominatim query failed for "${queryStr}":`, reqErr.message);
    }
  }

  const err = new Error(
    'Unable to resolve delivery location from OpenStreetMap Nominatim. Please provide a clearer street name, barangay, or nearby landmark.'
  );
  err.code = 'GEOCODE_NOT_FOUND';
  throw err;
}

/**
 * Compute driving road distance in km via OSRM ({longitude},{latitude} order).
 *
 * @param {{ latitude: number, longitude: number }} origin
 * @param {{ latitude: number, longitude: number }} destination
 * @param {Object} [options]
 * @returns {Promise<{ distanceKm: number, provider: string }>}
 */
async function getOsrmDrivingDistanceKm(origin, destination, options = {}) {
  const httpClient = options.httpClient || axios;
  const timeoutMs = options.timeoutMs || 5000;

  const storeLng = Number(origin.longitude);
  const storeLat = Number(origin.latitude);
  const custLng = Number(destination.longitude);
  const custLat = Number(destination.latitude);

  if (![storeLng, storeLat, custLng, custLat].every(Number.isFinite)) {
    throw new Error('Invalid coordinates supplied to OSRM distance calculator.');
  }

  const url = `${OSRM_ROUTE_BASE_URL}/${storeLng},${storeLat};${custLng},${custLat}?overview=false`;

  try {
    const response = await httpClient.get(url, { timeout: timeoutMs });
    const data = response?.data;
    if (data && data.code === 'Ok' && Array.isArray(data.routes) && data.routes.length > 0) {
      const meters = Number(data.routes[0].distance);
      if (Number.isFinite(meters) && meters >= 0) {
        return {
          distanceKm: Number((meters / 1000).toFixed(2)),
          provider: 'osrm'
        };
      }
    }
  } catch (osrmErr) {
    console.warn('[fareEngine] OSRM routing error, falling back to Haversine estimate:', osrmErr.message);
  }

  // Resilient Haversine urban estimate fallback if OSRM public server times out
  const straightKm = haversineKm(storeLat, storeLng, custLat, custLng);
  return {
    distanceKm: Number((straightKm * 1.25).toFixed(2)),
    provider: 'haversine_fallback'
  };
}

/**
 * Compute exact 2-decimal delivery fare breakdown from distance in km.
 * - Base Fare: ₱49.00 (covers first 1.0 km)
 * - Distance Charge: ₱12.00 per 0.5 km beyond 1.0 km
 * - Fuel Cost: distanceKm * 2.83
 * - Maintenance Allowance: ₱7.50 flat
 * - Exact sum without ₱5 rounding
 *
 * @param {number} distanceKm
 * @param {number} [maxRadiusKm=3.0]
 */
function computeBreakdown(distanceKm, maxRadiusKm = DEFAULT_MAX_RADIUS_KM) {
  const dist = Math.max(0, Number(Number(distanceKm).toFixed(2)));
  const baseFare = BASE_FARE;
  const excessKm = Math.max(0, dist - BASE_COVERAGE_KM);
  const steps = excessKm > 0 ? Math.ceil(excessKm / 0.5) : 0;
  const distanceCharge = Number((steps * STEP_RATE_PER_HALF_KM).toFixed(2));
  const fuelCost = Number((dist * FUEL_COST_PER_KM).toFixed(2));
  const maintenanceAllowance = MAINTENANCE_ALLOWANCE;
  const finalFare = Number((baseFare + distanceCharge + fuelCost + maintenanceAllowance).toFixed(2));

  return {
    distanceKm: dist,
    isOutOfBounds: dist > maxRadiusKm,
    maxRadiusKm,
    breakdown: {
      baseFare,
      distanceCharge,
      fuelCost,
      maintenanceAllowance,
      finalFare
    }
  };
}

/**
 * End-to-end delivery calculation from customer address + optional landmark.
 *
 * @param {string} address
 * @param {string} [landmark]
 * @param {Object} [options]
 */
async function calculateFareForAddress(address, landmark = '', options = {}) {
  const origin = options.origin || (await getStoreOriginConfig());
  const geocoded = await geocodeAddressWithLandmark(address, landmark, options);
  const route = await getOsrmDrivingDistanceKm(origin, geocoded, options);
  const computed = computeBreakdown(route.distanceKm, options.maxRadiusKm || origin.maxRadiusKm);

  return {
    success: true,
    distanceKm: computed.distanceKm,
    isOutOfBounds: computed.isOutOfBounds,
    maxRadiusKm: computed.maxRadiusKm,
    provider: route.provider,
    origin,
    coordinates: {
      latitude: geocoded.latitude,
      longitude: geocoded.longitude
    },
    formattedAddress: geocoded.displayName,
    queryUsed: geocoded.queryUsed,
    breakdown: computed.breakdown
  };
}

module.exports = {
  geocodeAddressWithLandmark,
  getOsrmDrivingDistanceKm,
  computeBreakdown,
  calculateFareForAddress,
  getStoreOriginConfig,
  OSM_USER_AGENT,
  DEFAULT_STORE_LAT,
  DEFAULT_STORE_LNG,
  DEFAULT_MAX_RADIUS_KM
};
