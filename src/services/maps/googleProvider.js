const config = require('../../config/config');
const { GeoError } = require('./errors');

/**
 * Google Maps Provider for Geocoding and Routes API v2
 */
class GoogleProvider {
  constructor(apiKey = config.maps.googleKey, timeoutMs = config.maps.timeoutMs) {
    this.name = 'google';
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs || 5000;
  }

  async geocode(address) {
    if (!this.apiKey) {
      console.error('[Google Provider] Missing Google Maps API key');
      throw new GeoError('GEO_PROVIDER_ERROR', 'Google Maps API key is not configured.', 502);
    }

    const encodedAddress = encodeURIComponent(address.trim());
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&components=country:PH&key=${encodeURIComponent(this.apiKey)}`;

    let response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (err) {
      console.error(`[Google Provider Geocode] Request failed: ${err.name || 'Error'}`);
      throw new GeoError('GEO_PROVIDER_ERROR', 'Maps geocoding service unavailable or timed out.', 502);
    }

    if (!response.ok) {
      console.error(`[Google Provider Geocode] HTTP status: ${response.status}`);
      throw new GeoError('GEO_PROVIDER_ERROR', `Maps geocoding service returned status ${response.status}.`, 502);
    }

    let data;
    try {
      data = await response.json();
    } catch (err) {
      console.error('[Google Provider Geocode] Failed to parse response JSON');
      throw new GeoError('GEO_PROVIDER_ERROR', 'Invalid response from maps geocoding service.', 502);
    }

    if (data.status === 'ZERO_RESULTS' || !data.results || data.results.length === 0) {
      throw new GeoError('GEO_NOT_FOUND', `Address '${address}' not found.`, 422);
    }

    if (data.status !== 'OK') {
      console.error(`[Google Provider Geocode] API status code: ${data.status}`);
      throw new GeoError('GEO_PROVIDER_ERROR', `Maps provider returned status ${data.status}.`, 502);
    }

    const firstResult = data.results[0];
    const loc = firstResult.geometry.location;
    const precision = firstResult.geometry.location_type || 'APPROXIMATE';

    return {
      lat: loc.lat,
      lng: loc.lng,
      formattedAddress: firstResult.formatted_address || address.trim(),
      precision
    };
  }

  async routeDistance(origin, dest) {
    if (!this.apiKey) {
      console.error('[Google Provider] Missing Google Maps API key');
      throw new GeoError('GEO_PROVIDER_ERROR', 'Google Maps API key is not configured.', 502);
    }

    const url = 'https://routes.googleapis.com/directions/v2:computeRoutes';
    const requestBody = {
      origin: {
        location: {
          latLng: {
            latitude: origin.lat,
            longitude: origin.lng
          }
        }
      },
      destination: {
        location: {
          latLng: {
            latitude: dest.lat,
            longitude: dest.lng
          }
        }
      },
      travelMode: 'TWO_WHEELER'
    };

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration'
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (err) {
      console.error(`[Google Provider Route] Request failed: ${err.name || 'Error'}`);
      throw new GeoError('GEO_PROVIDER_ERROR', 'Routes service unavailable or timed out.', 502);
    }

    if (!response.ok) {
      console.error(`[Google Provider Route] HTTP status: ${response.status}`);
      throw new GeoError('GEO_PROVIDER_ERROR', `Routes service returned status ${response.status}.`, 502);
    }

    let data;
    try {
      data = await response.json();
    } catch (err) {
      console.error('[Google Provider Route] Failed to parse response JSON');
      throw new GeoError('GEO_PROVIDER_ERROR', 'Invalid response from routes service.', 502);
    }

    if (!data.routes || data.routes.length === 0) {
      throw new GeoError('GEO_NOT_FOUND', 'No road route found between origin and destination.', 422);
    }

    const route = data.routes[0];
    const distanceMeters = route.distanceMeters || 0;
    const km = distanceMeters / 1000;

    let etaMin = 0;
    if (route.duration) {
      const seconds = parseInt(String(route.duration).replace('s', ''), 10) || 0;
      etaMin = Math.round(seconds / 60);
    }

    return {
      km,
      etaMin
    };
  }
}

module.exports = { GoogleProvider };
