const config = require('../../config/config');
const { GeoError } = require('./errors');
const { MockProvider, haversineKm } = require('./mockProvider');
const { GoogleProvider } = require('./googleProvider');

// In-memory route distance TTL cache
// Key: destination rounded to 5 decimals (lat,lng), Max: 500 entries, TTL: routeCacheTtlSec
const routeCache = new Map();
const MAX_CACHE_ENTRIES = 500;

function getActiveProvider() {
  const providerType = (config.maps.provider || '').toLowerCase().trim();
  if (providerType === 'google') {
    return new GoogleProvider();
  }
  if (providerType === 'mock') {
    return new MockProvider();
  }
  if (config.maps.googleKey) {
    return new GoogleProvider();
  }
  return new MockProvider();
}

/**
 * Geocode an address using the active maps provider.
 * 
 * @param {string} address
 * @returns {Promise<{ lat: number, lng: number, formattedAddress: string, precision: string }>}
 */
async function geocode(address) {
  const provider = getActiveProvider();
  return provider.geocode(address);
}

/**
 * Compute road route distance between origin and destination.
 * Results are cached in memory for config.delivery.routeCacheTtlSec seconds.
 * 
 * @param {{ lat: number, lng: number }} origin
 * @param {{ lat: number, lng: number }} dest
 * @returns {Promise<{ km: number, etaMin: number }>}
 */
async function routeDistance(origin, dest) {
  const cacheKey = `${Number(dest.lat).toFixed(5)},${Number(dest.lng).toFixed(5)}`;
  const now = Date.now();
  const ttlMs = (config.delivery.routeCacheTtlSec || 600) * 1000;

  // Check cache
  if (routeCache.has(cacheKey)) {
    const entry = routeCache.get(cacheKey);
    if (entry.expiresAt > now) {
      return { ...entry.value };
    }
    routeCache.delete(cacheKey);
  }

  const provider = getActiveProvider();
  const result = await provider.routeDistance(origin, dest);

  // Evict oldest if exceeding max entries
  if (routeCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = routeCache.keys().next().value;
    routeCache.delete(oldestKey);
  }

  routeCache.set(cacheKey, {
    value: { km: result.km, etaMin: result.etaMin },
    expiresAt: now + ttlMs
  });

  return result;
}

function clearRouteCache() {
  routeCache.clear();
}

module.exports = {
  geocode,
  routeDistance,
  clearRouteCache,
  GeoError,
  haversineKm,
  getActiveProvider,
  MockProvider,
  GoogleProvider
};
