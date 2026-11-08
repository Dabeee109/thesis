require('dotenv').config();

let resolvedAppUrl = process.env.APP_URL || '';
if (process.env.RENDER_EXTERNAL_URL) {
  if (!resolvedAppUrl || resolvedAppUrl.includes('ngrok') || resolvedAppUrl.includes('localhost') || resolvedAppUrl.includes('127.0.0.1')) {
    resolvedAppUrl = process.env.RENDER_EXTERNAL_URL;
  }
} else if (process.env.RENDER_EXTERNAL_HOSTNAME) {
  if (!resolvedAppUrl || resolvedAppUrl.includes('ngrok') || resolvedAppUrl.includes('localhost') || resolvedAppUrl.includes('127.0.0.1')) {
    resolvedAppUrl = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
  }
}
if (!resolvedAppUrl) {
  resolvedAppUrl = 'http://localhost:3000';
}

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  appName: process.env.APP_NAME || "Diner's Cafe Ordering & Delivery System",
  appUrl: resolvedAppUrl.trim().replace(/\/+$/, ''),

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'diners_cafe_db'
  },

  jwtSecret: process.env.JWT_SECRET || 'diners_cafe_super_secure_secret_key_2026_thesis',

  facebook: {
    verifyToken: process.env.FB_VERIFY_TOKEN || 'diners_cafe_verify_token_2026',
    pageAccessToken: process.env.FB_PAGE_ACCESS_TOKEN || '',
    appSecret: process.env.FB_APP_SECRET || ''
  },

  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  geminiTimeoutMs: parseInt(process.env.GEMINI_TIMEOUT_MS, 10) || 15000,

  webhookSecret: process.env.WEBHOOK_SECRET || '',

  witAi: {
    serverAccessToken: process.env.WIT_AI_SERVER_ACCESS_TOKEN || process.env.WIT_AI_TOKEN || ''
  },

  firebase: {
    serverKey: process.env.FIREBASE_SERVER_KEY || '',
    projectId: process.env.FIREBASE_PROJECT_ID || 'diners-cafe-delivery'
  },

  timezone: process.env.TZ_NAME || 'Asia/Manila',

  store: {
    name: process.env.STORE_NAME || "Diner's Cafe - Main Branch",
    phone: process.env.STORE_PHONE || '+63 912 345 6789',
    address: process.env.STORE_ADDRESS || '123 Academic Hub Ave., University District',
    gcashName: process.env.STORE_GCASH_NAME || "Diner's Cafe Official",
    gcashNumber: process.env.STORE_GCASH_NUMBER || '0912-345-6789',
    hours: process.env.STORE_HOURS || 'Monday - Sunday: 8:00 AM - 9:00 PM',
    maxDeliveryKm: parseFloat(process.env.STORE_MAX_DELIVERY_KM || '3.0'),
    lat: Number.isFinite(parseFloat(process.env.STORE_LAT)) ? parseFloat(process.env.STORE_LAT) : 14.6143686,
    lng: Number.isFinite(parseFloat(process.env.STORE_LNG)) ? parseFloat(process.env.STORE_LNG) : 120.9642334
  },

  maps: {
    provider: process.env.MAPS_PROVIDER || '',          // 'google' | 'mock' | ''
    googleKey: process.env.GOOGLE_MAPS_API_KEY || '',
    timeoutMs: parseInt(process.env.MAPS_TIMEOUT_MS, 10) || 5000
  },

  delivery: {
    quoteTtlSec: parseInt(process.env.QUOTE_TTL_SEC, 10) || 600,
    bicycleMaxKm: parseFloat(process.env.BICYCLE_MAX_KM || '1.5'),
    routeCacheTtlSec: parseInt(process.env.ROUTE_CACHE_TTL_SEC, 10) || 600
  },

  weather: {
    openWeatherKey: process.env.OPENWEATHER_API_KEY || '',
    heavyRainMmPerHour: parseFloat(process.env.HEAVY_RAIN_MM_H || '7.5')
  }
};
