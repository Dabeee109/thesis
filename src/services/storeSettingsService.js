/**
 * Centralized Store Branch, Delivery Location & GCash Settings Service
 * Single source of truth for store branch identity, physical address,
 * GPS coordinates, delivery dispatch boundaries, and GCash payment gateway
 * across Admin Dashboard & Messenger Bot.
 */

const db = require('../../database/db');
const config = require('../config/config');

// In-memory cache seeded with sensible defaults
let cachedSettings = {
  id: 1,
  store_name: config.store?.name || "Diner's Cafe Tondo",
  store_address: config.store?.address || "Diner's Cafe, Tondo, Manila",
  store_latitude: Number.isFinite(config.store?.lat) ? config.store.lat : 14.6143686,
  store_longitude: Number.isFinite(config.store?.lng) ? config.store.lng : 120.9642334,
  max_delivery_radius_km: Number.isFinite(config.store?.maxDeliveryKm) ? config.store.maxDeliveryKm : 3.00,
  gcash_account_name: config.store?.gcashName || "Diner's Cafe - Tondo Branch",
  gcash_account_number: config.store?.gcashNumber || "09171234567",
  gcash_qr_image_url: "/uploads/qr/gcash_qr_CHECKOUT.png",
  updated_at: new Date().toISOString()
};

/**
 * Returns current store settings synchronously from in-memory cache
 */
function getCachedStoreSettings() {
  return { ...cachedSettings };
}

/**
 * Loads store settings from database into cache and synchronizes config.store
 */
async function getStoreSettings() {
  try {
    const [rows] = await db.query('SELECT * FROM store_settings WHERE id = 1 LIMIT 1');
    if (rows && rows.length > 0) {
      const row = rows[0];
      cachedSettings = {
        id: 1,
        store_name: row.store_name || "Diner's Cafe Tondo",
        store_address: row.store_address || "Diner's Cafe, Tondo, Manila",
        store_latitude: parseFloat(row.store_latitude) || 14.6143686,
        store_longitude: parseFloat(row.store_longitude) || 120.9642334,
        max_delivery_radius_km: parseFloat(row.max_delivery_radius_km) || 3.00,
        gcash_account_name: row.gcash_account_name || "Diner's Cafe - Tondo Branch",
        gcash_account_number: row.gcash_account_number || "09171234567",
        gcash_qr_image_url: row.gcash_qr_image_url || "/uploads/qr/gcash_qr_CHECKOUT.png",
        updated_at: row.updated_at || new Date().toISOString()
      };

      // Sync config.store
      if (config.store) {
        config.store.name = cachedSettings.store_name;
        config.store.address = cachedSettings.store_address;
        config.store.lat = cachedSettings.store_latitude;
        config.store.lng = cachedSettings.store_longitude;
        config.store.maxDeliveryKm = cachedSettings.max_delivery_radius_km;
        config.store.gcashName = cachedSettings.gcash_account_name;
        config.store.gcashNumber = cachedSettings.gcash_account_number;
      }
    }
  } catch (err) {
    console.warn('[StoreSettingsService] Could not load from DB, using cached settings:', err.message);
  }
  return { ...cachedSettings };
}

/**
 * Validates and updates store location settings in DB and updates memory cache
 */
async function updateStoreSettings(data = {}) {
  const name = String(data.store_name !== undefined ? data.store_name : cachedSettings.store_name).trim();
  const address = String(data.store_address !== undefined ? data.store_address : cachedSettings.store_address).trim();
  const lat = parseFloat(data.store_latitude !== undefined ? data.store_latitude : cachedSettings.store_latitude);
  const lng = parseFloat(data.store_longitude !== undefined ? data.store_longitude : cachedSettings.store_longitude);
  const radius = parseFloat(data.max_delivery_radius_km !== undefined ? data.max_delivery_radius_km : cachedSettings.max_delivery_radius_km);

  if (!name) {
    throw new Error('Store branch name is required.');
  }
  if (!address) {
    throw new Error('Store physical address is required.');
  }
  if (isNaN(lat) || lat < -90 || lat > 90) {
    throw new Error('Invalid latitude: must be between -90 and 90.');
  }
  if (isNaN(lng) || lng < -180 || lng > 180) {
    throw new Error('Invalid longitude: must be between -180 and 180.');
  }
  if (isNaN(radius) || radius <= 0) {
    throw new Error('Maximum delivery radius must be a positive number.');
  }

  // Persist to database
  try {
    const [existing] = await db.query('SELECT id FROM store_settings WHERE id = 1');
    if (existing && existing.length > 0) {
      await db.query(
        'UPDATE store_settings SET store_name = ?, store_address = ?, store_latitude = ?, store_longitude = ?, max_delivery_radius_km = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1',
        [name, address, lat, lng, radius]
      );
    } else {
      await db.query(
        'INSERT INTO store_settings (id, store_name, store_address, store_latitude, store_longitude, max_delivery_radius_km) VALUES (1, ?, ?, ?, ?, ?)',
        [name, address, lat, lng, radius]
      );
    }
  } catch (dbErr) {
    console.error('[StoreSettingsService Error] DB update location failed:', dbErr);
    throw dbErr;
  }

  // Update in-memory cache
  cachedSettings = {
    ...cachedSettings,
    store_name: name,
    store_address: address,
    store_latitude: lat,
    store_longitude: lng,
    max_delivery_radius_km: radius,
    updated_at: new Date().toISOString()
  };

  // Sync config.store
  if (config.store) {
    config.store.name = name;
    config.store.address = address;
    config.store.lat = lat;
    config.store.lng = lng;
    config.store.maxDeliveryKm = radius;
  }

  return { ...cachedSettings };
}

/**
 * Validates and updates GCash payment settings in DB and updates memory cache
 */
async function updateGcashSettings(data = {}) {
  const gName = String(data.gcash_account_name !== undefined ? data.gcash_account_name : cachedSettings.gcash_account_name).trim();
  const gNum = String(data.gcash_account_number !== undefined ? data.gcash_account_number : cachedSettings.gcash_account_number).trim();
  const gQr = data.gcash_qr_image_url !== undefined ? data.gcash_qr_image_url : cachedSettings.gcash_qr_image_url;

  if (!gName) {
    throw new Error('GCash account name is required.');
  }
  if (!gNum) {
    throw new Error('GCash mobile number is required.');
  }

  try {
    const [existing] = await db.query('SELECT id FROM store_settings WHERE id = 1');
    if (existing && existing.length > 0) {
      await db.query(
        'UPDATE store_settings SET gcash_account_name = ?, gcash_account_number = ?, gcash_qr_image_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1',
        [gName, gNum, gQr]
      );
    } else {
      await db.query(
        'INSERT INTO store_settings (id, gcash_account_name, gcash_account_number, gcash_qr_image_url) VALUES (1, ?, ?, ?)',
        [gName, gNum, gQr]
      );
    }
  } catch (dbErr) {
    console.error('[StoreSettingsService Error] DB update GCash failed:', dbErr);
    throw dbErr;
  }

  cachedSettings = {
    ...cachedSettings,
    gcash_account_name: gName,
    gcash_account_number: gNum,
    gcash_qr_image_url: gQr,
    updated_at: new Date().toISOString()
  };

  if (config.store) {
    config.store.gcashName = gName;
    config.store.gcashNumber = gNum;
  }

  return { ...cachedSettings };
}

// Initial warm-up on process start
getStoreSettings().catch(() => {});

module.exports = {
  getStoreSettings,
  getCachedStoreSettings,
  updateStoreSettings,
  updateGcashSettings
};
