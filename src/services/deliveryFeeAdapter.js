/**
 * Delivery Fee Adapter (Task 6)
 * Interfaces with geoService.quoteDelivery when present,
 * or falls back to calculateDeliveryFare with DELIVERY_FALLBACK_KM.
 */

const config = require('../config/config');
const { calculateDeliveryFare } = require('./fareCalculator');

let geoService = null;
try {
  geoService = require('./geoService');
} catch (e) {
  geoService = null;
}

const FALLBACK_KM = parseFloat(process.env.DELIVERY_FALLBACK_KM || '1.5');

if (!geoService || typeof geoService.quoteDelivery !== 'function') {
  console.warn('[DeliveryFeeAdapter] geoService.quoteDelivery is unavailable. Using fallback delivery fee estimate (1.5 km).');
}

/**
 * Quote delivery fee for given address or coordinates.
 * @param {Object} param0 { address, lat, lng }
 * @returns {Promise<{ distanceKm: number, deliveryFee: number, formattedAddress: string, quoteToken: string|null, surchargeRate: number, source: string }>}
 */
async function quoteForAddress({ address, lat, lng } = {}) {
  if (geoService && typeof geoService.quoteDelivery === 'function') {
    try {
      const quote = await geoService.quoteDelivery({ address, lat, lng });
      return {
        distanceKm: quote.distanceKm,
        deliveryFee: quote.fare?.finalFare ?? quote.deliveryFee,
        formattedAddress: quote.destination?.formattedAddress || address || '',
        quoteToken: quote.quoteToken || null,
        surchargeRate: quote.fare?.surchargeRate || 0,
        source: 'quote'
      };
    } catch (err) {
      const code = err.code || 'GEO_PROVIDER_ERROR';
      const enhancedErr = new Error(err.message || 'Delivery fee calculation error.');
      enhancedErr.code = code;
      enhancedErr.km = err.details?.roadKm || err.roadKm || null;
      enhancedErr.max = err.details?.maxKm || err.maxKm || (config.store?.maxDeliveryKm || 3.0);
      throw enhancedErr;
    }
  }

  // Fallback calculation
  const fare = calculateDeliveryFare(FALLBACK_KM, 'motorcycle', 'sunny', new Date());
  return {
    distanceKm: FALLBACK_KM,
    deliveryFee: fare.finalFare,
    formattedAddress: address || '',
    quoteToken: null,
    surchargeRate: fare.surchargeRate || 0,
    source: 'fallback'
  };
}

module.exports = {
  quoteForAddress,
  FALLBACK_KM
};
