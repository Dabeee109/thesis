const config = require('../config/config');
const { quoteDelivery, GeoError } = require('../services/geoService');
const { MAX_DELIVERY_DISTANCE_KM } = require('../services/fareCalculator');

/**
 * Handle delivery quote requests.
 * POST /api/delivery/quote
 */
async function getQuote(req, res) {
  try {
    const quote = await quoteDelivery(req.body);
    return res.status(200).json({
      success: true,
      ...quote
    });
  } catch (err) {
    if (err instanceof GeoError) {
      return res.status(err.status).json({
        success: false,
        code: err.code,
        message: err.message,
        details: err.details || {}
      });
    }

    console.error('[Delivery Quote Server Error]', err);
    return res.status(500).json({
      success: false,
      code: 'QUOTE_FAILED',
      message: 'Failed to calculate delivery quote.',
      details: {}
    });
  }
}

/**
 * Return public service area details and store coordinates.
 * GET /api/delivery/service-area
 */
function getServiceArea(req, res) {
  const storeLat = Number.isFinite(config.store.lat) ? config.store.lat : 14.6042;
  const storeLng = Number.isFinite(config.store.lng) ? config.store.lng : 120.9822;
  const maxDeliveryKm = Math.min(config.store.maxDeliveryKm || 3.0, MAX_DELIVERY_DISTANCE_KM);

  return res.status(200).json({
    success: true,
    storeLat,
    storeLng,
    maxDeliveryKm
  });
}

module.exports = {
  getQuote,
  getServiceArea
};
