const config = require('../config/config');

// In-memory weather cache: 10 minutes TTL
let weatherCache = {
  condition: null,
  expiresAt: 0
};

/**
 * Get current weather condition at store location.
 * Returns 'sunny' | 'light_rain' | 'heavy_rain'.
 * Fails open to 'sunny' on any API failure or missing key.
 * 
 * @returns {Promise<'sunny' | 'light_rain' | 'heavy_rain'>}
 */
async function getCurrentWeather() {
  const apiKey = config.weather.openWeatherKey;
  if (!apiKey) {
    return 'sunny';
  }

  const now = Date.now();
  if (weatherCache.condition && weatherCache.expiresAt > now) {
    return weatherCache.condition;
  }

  const storeLat = Number.isFinite(config.store.lat) ? config.store.lat : 14.6042;
  const storeLng = Number.isFinite(config.store.lng) ? config.store.lng : 120.9822;
  const timeoutMs = config.maps.timeoutMs || 5000;
  const heavyRainMmPerHour = config.weather.heavyRainMmPerHour || 7.5;

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${storeLat}&lon=${storeLng}&appid=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (!response.ok) {
      console.warn(`[Weather Warning] OpenWeatherMap returned status ${response.status}. Defaulting to sunny.`);
      return 'sunny';
    }

    const data = await response.json();
    const weatherList = data.weather || [];
    const mainCondition = (weatherList[0]?.main || '').toLowerCase();
    const weatherId = weatherList[0]?.id || 800;

    const rain1h = (data.rain && (data.rain['1h'] || data.rain['3h'])) || 0;

    let condition = 'sunny';
    // Thunderstorm (ids 200-299) or rain >= heavyRainMmPerHour
    if (mainCondition === 'thunderstorm' || (weatherId >= 200 && weatherId < 300) || rain1h >= heavyRainMmPerHour) {
      condition = 'heavy_rain';
    } else if (
      mainCondition === 'rain' ||
      mainCondition === 'drizzle' ||
      (weatherId >= 300 && weatherId < 600)
    ) {
      condition = 'light_rain';
    } else {
      condition = 'sunny';
    }

    weatherCache = {
      condition,
      expiresAt: now + 10 * 60 * 1000 // 10 minutes
    };

    return condition;
  } catch (err) {
    console.warn(`[Weather Warning] Weather check failed (${err.name || 'Error'}). Defaulting to sunny.`);
    return 'sunny';
  }
}

function clearWeatherCache() {
  weatherCache = {
    condition: null,
    expiresAt: 0
  };
}

module.exports = {
  getCurrentWeather,
  clearWeatherCache
};
