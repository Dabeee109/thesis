/**
 * System Settings Service
 * Single source of truth for:
 * 1. Master AI Chatbot Toggle (Mute / Kill Switch)
 * 2. Store Operating Hours & Timezone Evaluation (Asia/Manila, GMT+8)
 * 3. Pre-Order & Operating Hours Policies
 */

const db = require('../../database/db');

// In-memory cache for ultra-fast, zero-latency webhook & router middleware checks
let cachedSettings = {
  id: 1,
  chatbot_enabled: 1, // 1 = ON, 0 = OFF
  store_open_time: '09:00:00',
  store_close_time: '21:00:00',
  store_timezone: 'Asia/Manila',
  last_toggled_by: 'System',
  last_toggled_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};

/**
 * Helper: Formats 24h time ("09:00:00" or "21:00") into friendly 12h time ("9:00 AM" or "9:00 PM")
 */
function formatTime12h(timeStr) {
  if (!timeStr) return '';
  const parts = String(timeStr).split(':');
  let hour = parseInt(parts[0], 10);
  const min = parts[1] || '00';
  if (isNaN(hour)) return timeStr;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  hour = hour ? hour : 12;
  return `${hour}:${min} ${ampm}`;
}

/**
 * Returns current system settings synchronously from cache
 */
function getCachedSystemSettings() {
  return { ...cachedSettings };
}

/**
 * Loads system settings from database into memory cache
 */
async function getSystemSettings() {
  try {
    const [rows] = await db.query('SELECT * FROM system_settings WHERE id = 1 LIMIT 1');
    if (rows && rows.length > 0) {
      const row = rows[0];
      const enabled = (row.chatbot_enabled === 1 || row.chatbot_enabled === true || row.chatbot_enabled === '1' || String(row.chatbot_enabled).toUpperCase() === 'ON');
      cachedSettings = {
        ...cachedSettings,
        id: 1,
        chatbot_enabled: enabled ? 1 : 0,
        store_open_time: row.store_open_time || '09:00:00',
        store_close_time: row.store_close_time || '21:00:00',
        store_timezone: row.store_timezone || 'Asia/Manila',
        updated_at: row.updated_at || new Date().toISOString()
      };
    }
  } catch (err) {
    console.warn('[SystemSettingsService] DB query skipped, using memory cache:', err.message);
  }
  return { ...cachedSettings };
}

/**
 * Updates system settings persistently in DB and synchronizes memory cache
 */
async function updateSystemSettings(data = {}) {
  let { chatbot_enabled, store_open_time, store_close_time, store_timezone, updated_by } = data;

  if (chatbot_enabled !== undefined) {
    const isBool = (chatbot_enabled === 1 || chatbot_enabled === true || chatbot_enabled === '1' || String(chatbot_enabled).toUpperCase() === 'ON');
    cachedSettings.chatbot_enabled = isBool ? 1 : 0;
    cachedSettings.last_toggled_by = updated_by || 'Admin';
    cachedSettings.last_toggled_at = new Date().toISOString();
  }

  if (store_open_time) {
    cachedSettings.store_open_time = String(store_open_time).trim();
  }
  if (store_close_time) {
    cachedSettings.store_close_time = String(store_close_time).trim();
  }
  if (store_timezone) {
    cachedSettings.store_timezone = String(store_timezone).trim();
  }
  cachedSettings.updated_at = new Date().toISOString();

  // Persist to database
  try {
    const [existing] = await db.query('SELECT id FROM system_settings WHERE id = 1');
    if (existing && existing.length > 0) {
      await db.query(
        `UPDATE system_settings 
         SET chatbot_enabled = ?, store_open_time = ?, store_close_time = ?, store_timezone = ?, updated_at = CURRENT_TIMESTAMP 
         WHERE id = 1`,
        [cachedSettings.chatbot_enabled, cachedSettings.store_open_time, cachedSettings.store_close_time, cachedSettings.store_timezone]
      );
    } else {
      await db.query(
        `INSERT INTO system_settings (id, chatbot_enabled, store_open_time, store_close_time, store_timezone)
         VALUES (1, ?, ?, ?, ?)`,
        [cachedSettings.chatbot_enabled, cachedSettings.store_open_time, cachedSettings.store_close_time, cachedSettings.store_timezone]
      );
    }

    // Also sync store_settings columns
    try {
      await db.query(
        `UPDATE store_settings 
         SET chatbot_enabled = ?, store_open_time = ?, store_close_time = ?, store_timezone = ?, updated_at = CURRENT_TIMESTAMP 
         WHERE id = 1`,
        [cachedSettings.chatbot_enabled, cachedSettings.store_open_time, cachedSettings.store_close_time, cachedSettings.store_timezone]
      );
    } catch (e) {}
  } catch (err) {
    console.error('[SystemSettingsService Error] Failed to persist system settings:', err);
    throw err;
  }

  return { ...cachedSettings };
}

/**
 * Returns whether the AI Chatbot is currently active / enabled (Master Toggle)
 */
function isChatbotEnabled() {
  return cachedSettings.chatbot_enabled === 1 || cachedSettings.chatbot_enabled === true;
}

/**
 * Evaluates whether the store is currently open in GMT+8 (Asia/Manila)
 */
function isStoreOpen(date = new Date()) {
  const tz = cachedSettings.store_timezone || 'Asia/Manila';

  // Format current time in Asia/Manila (HH:mm:ss)
  let currentTime = '12:00:00';
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    currentTime = formatter.format(date);
  } catch (tzErr) {
    // Fallback to UTC+8 manual offset calculation
    const utcTime = date.getTime() + (date.getTimezoneOffset() * 60000);
    const manilaDate = new Date(utcTime + (3600000 * 8));
    currentTime = manilaDate.toTimeString().split(' ')[0];
  }

  const openTime = cachedSettings.store_open_time || '09:00:00';
  const closeTime = cachedSettings.store_close_time || '21:00:00';

  let isOpen = false;
  if (openTime <= closeTime) {
    // Normal daytime schedule (e.g. 09:00 to 21:00)
    isOpen = (currentTime >= openTime && currentTime < closeTime);
  } else {
    // Overnight schedule (e.g. 21:00 to 04:00)
    isOpen = (currentTime >= openTime || currentTime < closeTime);
  }

  return {
    isOpen,
    currentTime,
    store_open_time: openTime,
    store_close_time: closeTime,
    openTimeFormatted: formatTime12h(openTime),
    closeTimeFormatted: formatTime12h(closeTime)
  };
}

// Initial warm-up on process start
getSystemSettings().catch(() => {});

module.exports = {
  getSystemSettings,
  getCachedSystemSettings,
  updateSystemSettings,
  isChatbotEnabled,
  isStoreOpen,
  formatTime12h
};
