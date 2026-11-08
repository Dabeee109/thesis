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
  store_status: 'OPEN', // 'OPEN' or 'CLOSED'
  store_open_time: '09:00:00',
  store_close_time: '21:00:00',
  store_timezone: 'Asia/Manila',
  is_manual_override: 0, // 0 = automated schedule, 1 = manual override active
  override_at: null,     // ISO string when manual override occurred
  override_by: null,     // User who triggered manual override
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
        store_status: row.store_status ? String(row.store_status).toUpperCase() : 'OPEN',
        store_open_time: row.store_open_time || '09:00:00',
        store_close_time: row.store_close_time || '21:00:00',
        store_timezone: row.store_timezone || 'Asia/Manila',
        is_manual_override: (row.is_manual_override === 1 || row.is_manual_override === true || row.is_manual_override === '1') ? 1 : 0,
        override_at: row.override_at || null,
        override_by: row.override_by || null,
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
  let {
    chatbot_enabled,
    store_status,
    store_open_time,
    store_close_time,
    store_timezone,
    is_manual_override,
    override_at,
    override_by,
    updated_by
  } = data;

  if (chatbot_enabled !== undefined) {
    const isBool = (chatbot_enabled === 1 || chatbot_enabled === true || chatbot_enabled === '1' || String(chatbot_enabled).toUpperCase() === 'ON');
    cachedSettings.chatbot_enabled = isBool ? 1 : 0;
    cachedSettings.last_toggled_by = updated_by || 'Admin';
    cachedSettings.last_toggled_at = new Date().toISOString();
  }

  if (store_status !== undefined) {
    const norm = String(store_status).toUpperCase().trim();
    cachedSettings.store_status = (norm === 'CLOSED' || norm === '0' || norm === 'FALSE') ? 'CLOSED' : 'OPEN';
    cachedSettings.last_toggled_by = updated_by || 'Admin';
    cachedSettings.last_toggled_at = new Date().toISOString();
  }

  if (store_open_time) {
    let t = String(store_open_time).trim();
    if (t.length === 5) t += ':00';
    cachedSettings.store_open_time = t;
  }
  if (store_close_time) {
    let t = String(store_close_time).trim();
    if (t.length === 5) t += ':00';
    cachedSettings.store_close_time = t;
  }
  if (store_timezone) {
    cachedSettings.store_timezone = String(store_timezone).trim();
  }

  if (is_manual_override !== undefined) {
    cachedSettings.is_manual_override = (is_manual_override === 1 || is_manual_override === true || is_manual_override === '1') ? 1 : 0;
  }
  if (override_at !== undefined) {
    cachedSettings.override_at = override_at;
  }
  if (override_by !== undefined) {
    cachedSettings.override_by = override_by;
  }

  cachedSettings.updated_at = new Date().toISOString();

  // Persist to database
  try {
    const [existing] = await db.query('SELECT id FROM system_settings WHERE id = 1');
    if (existing && existing.length > 0) {
      await db.query(
        `UPDATE system_settings 
         SET chatbot_enabled = ?, store_status = ?, store_open_time = ?, store_close_time = ?, store_timezone = ?,
             is_manual_override = ?, override_at = ?, override_by = ?, updated_at = CURRENT_TIMESTAMP 
         WHERE id = 1`,
        [
          cachedSettings.chatbot_enabled,
          cachedSettings.store_status,
          cachedSettings.store_open_time,
          cachedSettings.store_close_time,
          cachedSettings.store_timezone,
          cachedSettings.is_manual_override,
          cachedSettings.override_at,
          cachedSettings.override_by
        ]
      );
    } else {
      await db.query(
        `INSERT INTO system_settings (id, chatbot_enabled, store_status, store_open_time, store_close_time, store_timezone, is_manual_override, override_at, override_by)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          cachedSettings.chatbot_enabled,
          cachedSettings.store_status,
          cachedSettings.store_open_time,
          cachedSettings.store_close_time,
          cachedSettings.store_timezone,
          cachedSettings.is_manual_override,
          cachedSettings.override_at,
          cachedSettings.override_by
        ]
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
    } catch (e) { }
  } catch (err) {
    console.error('[SystemSettingsService Error] Failed to persist system settings:', err);
    throw err;
  }

  return { ...cachedSettings };
}

/**
 * Records an entry in the store_status_audit database table
 */
async function recordStoreStatusAudit({
  previous_status,
  new_status,
  is_manual_override = 0,
  trigger_type,
  triggered_by = 'System',
  details = ''
}) {
  try {
    await db.query(
      `INSERT INTO store_status_audit (previous_status, new_status, is_manual_override, trigger_type, triggered_by, details)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        previous_status || null,
        new_status || null,
        is_manual_override ? 1 : 0,
        trigger_type || 'MANUAL_OVERRIDE',
        triggered_by || 'System',
        details || null
      ]
    );
  } catch (err) {
    console.warn('[SystemSettingsService] Failed to record store_status_audit:', err.message);
  }
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
  const storeStatus = cachedSettings.store_status ? String(cachedSettings.store_status).toUpperCase() : 'OPEN';

  let isScheduleOpen = false;
  if (openTime <= closeTime) {
    // Normal daytime schedule (e.g. 09:00 to 21:00)
    isScheduleOpen = (currentTime >= openTime && currentTime < closeTime);
  } else {
    // Overnight schedule (e.g. 21:00 to 04:00)
    isScheduleOpen = (currentTime >= openTime || currentTime < closeTime);
  }

  // Manual override takes priority while active; otherwise follows schedule
  const isOverride = (cachedSettings.is_manual_override === 1 || cachedSettings.is_manual_override === true);
  let isOpen = isScheduleOpen;
  if (isOverride) {
    isOpen = (storeStatus === 'OPEN');
  } else {
    isOpen = isScheduleOpen;
  }

  return {
    isOpen,
    status: isOpen ? 'OPEN' : 'CLOSED',
    store_status: storeStatus,
    isScheduleOpen,
    is_manual_override: isOverride ? 1 : 0,
    override_at: cachedSettings.override_at || null,
    override_by: cachedSettings.override_by || null,
    currentTime,
    store_open_time: openTime,
    store_close_time: closeTime,
    openTimeFormatted: formatTime12h(openTime),
    closeTimeFormatted: formatTime12h(closeTime)
  };
}

/**
 * Helper: Returns current date and time formatted in Manila timezone (Asia/Manila)
 */
function getManilaDateTime(date = new Date()) {
  const tz = cachedSettings.store_timezone || 'Asia/Manila';
  try {
    const formatterTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    const formatterDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return {
      time: formatterTime.format(date),
      dateStr: formatterDate.format(date) // YYYY-MM-DD
    };
  } catch (e) {
    const utcTime = date.getTime() + (date.getTimezoneOffset() * 60000);
    const manila = new Date(utcTime + (3600000 * 8));
    return {
      time: manila.toTimeString().split(' ')[0],
      dateStr: manila.toISOString().split('T')[0]
    };
  }
}

/**
 * Returns the next automated schedule milestone (opening or closing)
 */
function getNextScheduleMilestone(date = new Date()) {
  const openTime = cachedSettings.store_open_time || '09:00:00';
  const closeTime = cachedSettings.store_close_time || '21:00:00';
  const schedule = isStoreOpen(date);

  if (schedule.isScheduleOpen) {
    return {
      type: 'CLOSE',
      target_status: 'CLOSED',
      time: closeTime,
      formatted: formatTime12h(closeTime),
      desc: `Closing at ${formatTime12h(closeTime)}`
    };
  } else {
    return {
      type: 'OPEN',
      target_status: 'OPEN',
      time: openTime,
      formatted: formatTime12h(openTime),
      desc: `Opening at ${formatTime12h(openTime)}`
    };
  }
}

/**
 * Checks whether an opening or closing milestone was crossed in Manila time between overrideDate and nowDate
 */
function checkMilestoneCrossing(overrideDate, nowDate, openTime, closeTime) {
  if (!overrideDate || isNaN(overrideDate.getTime())) {
    return null;
  }
  if (nowDate <= overrideDate) {
    return null;
  }

  // Helper to convert Manila YYYY-MM-DD + HH:mm:ss to UTC epoch milliseconds
  const getUtcTimestampForManila = (dateStr, timeStr) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const parts = timeStr.split(':').map(Number);
    const hh = parts[0] || 0;
    const mm = parts[1] || 0;
    const ss = parts[2] || 0;
    // Manila is UTC+8 with no DST -> UTC time = Manila time minus 8 hours
    return Date.UTC(y, m - 1, d, hh - 8, mm, ss);
  };

  const { dateStr: startDay } = getManilaDateTime(overrideDate);
  const { dateStr: endDay } = getManilaDateTime(nowDate);

  const candidates = [];
  let curDay = new Date(startDay + 'T00:00:00Z');
  const lastDay = new Date(endDay + 'T00:00:00Z');

  while (curDay <= lastDay) {
    const dStr = curDay.toISOString().split('T')[0];
    const openTs = getUtcTimestampForManila(dStr, openTime);
    const closeTs = getUtcTimestampForManila(dStr, closeTime);

    candidates.push({ type: 'OPEN', target_status: 'OPEN', time: openTime, ts: openTs });
    candidates.push({ type: 'CLOSE', target_status: 'CLOSED', time: closeTime, ts: closeTs });

    curDay = new Date(curDay.getTime() + 86400000);
  }

  const overrideTs = overrideDate.getTime();
  const nowTs = nowDate.getTime();

  const crossed = candidates
    .filter(m => m.ts > overrideTs && m.ts <= nowTs)
    .sort((a, b) => a.ts - b.ts);

  if (crossed.length > 0) {
    return crossed[crossed.length - 1]; // Return latest milestone crossed
  }
  return null;
}

/**
 * Core Hybrid Override Reset & Schedule Evaluator
 * Runs minute-by-minute in the background.
 */
async function evaluateStoreSchedule(now = new Date()) {
  const isOverride = (cachedSettings.is_manual_override === 1 || cachedSettings.is_manual_override === true);
  const openTime = cachedSettings.store_open_time || '09:00:00';
  const closeTime = cachedSettings.store_close_time || '21:00:00';

  const scheduleInfo = isStoreOpen(now);
  const scheduledState = scheduleInfo.isScheduleOpen ? 'OPEN' : 'CLOSED';

  if (isOverride) {
    const overrideDate = cachedSettings.override_at ? new Date(cachedSettings.override_at) : null;
    const crossedMilestone = checkMilestoneCrossing(overrideDate, now, openTime, closeTime);

    if (crossedMilestone) {
      const prevStatus = cachedSettings.store_status;
      const resumedStatus = crossedMilestone.target_status;

      console.log(`[StoreScheduleWorker] Scheduled ${crossedMilestone.type} milestone (${crossedMilestone.time}) reached. Clearing manual override. Resuming automated status: ${resumedStatus}`);

      // 1. Reset manual override and set scheduled state
      cachedSettings.is_manual_override = 0;
      cachedSettings.override_at = null;
      cachedSettings.override_by = null;
      cachedSettings.store_status = resumedStatus;
      cachedSettings.last_toggled_by = 'System (Auto-Reset Cron)';
      cachedSettings.last_toggled_at = new Date().toISOString();
      cachedSettings.updated_at = new Date().toISOString();

      // 2. Persist to DB
      try {
        await db.query(
          `UPDATE system_settings 
           SET is_manual_override = 0, override_at = NULL, override_by = NULL, store_status = ?, updated_at = CURRENT_TIMESTAMP 
           WHERE id = 1`,
          [resumedStatus]
        );
      } catch (dbErr) {
        console.error('[StoreScheduleWorker] DB update error:', dbErr.message);
      }

      // 3. Log in store_status_audit
      await recordStoreStatusAudit({
        previous_status: prevStatus,
        new_status: resumedStatus,
        is_manual_override: 0,
        trigger_type: 'AUTO_SCHEDULE_RESUME',
        triggered_by: 'System (Auto-Reset Cron)',
        details: `Scheduled ${crossedMilestone.type} time milestone (${crossedMilestone.time}) reached. Manual override automatically cleared; automated schedule resumed.`
      });

      // 4. Broadcast SSE
      try {
        const { broadcastSSE } = require('./notificationService');
        broadcastSSE('STORE_STATUS_CHANGED', {
          store_status: resumedStatus,
          isOpen: (resumedStatus === 'OPEN'),
          is_manual_override: false,
          trigger_type: 'AUTO_SCHEDULE_RESUME',
          resumed_milestone: crossedMilestone,
          next_milestone: getNextScheduleMilestone(now),
          schedule: isStoreOpen(now),
          updated_by: 'System (Auto-Reset Cron)'
        });
      } catch (sseErr) {
        console.warn('[StoreScheduleWorker] SSE broadcast warning:', sseErr.message);
      }

      return {
        action: 'AUTO_SCHEDULE_RESUME',
        resumedStatus,
        crossedMilestone
      };
    }

    return {
      action: 'OVERRIDE_ACTIVE',
      store_status: cachedSettings.store_status
    };
  } else {
    // Automated schedule active (no override)
    if (cachedSettings.store_status !== scheduledState) {
      const prevStatus = cachedSettings.store_status;
      cachedSettings.store_status = scheduledState;
      cachedSettings.last_toggled_by = 'System (Schedule Timer)';
      cachedSettings.last_toggled_at = new Date().toISOString();
      cachedSettings.updated_at = new Date().toISOString();

      try {
        await db.query(
          `UPDATE system_settings 
           SET store_status = ?, updated_at = CURRENT_TIMESTAMP 
           WHERE id = 1`,
          [scheduledState]
        );
      } catch (dbErr) {
        console.error('[StoreScheduleWorker] DB update error:', dbErr.message);
      }

      await recordStoreStatusAudit({
        previous_status: prevStatus,
        new_status: scheduledState,
        is_manual_override: 0,
        trigger_type: 'AUTO_SCHEDULE_TRANSITION',
        triggered_by: 'System (Schedule Timer)',
        details: `Automated schedule transition: Store changed to ${scheduledState}.`
      });

      try {
        const { broadcastSSE } = require('./notificationService');
        broadcastSSE('STORE_STATUS_CHANGED', {
          store_status: scheduledState,
          isOpen: (scheduledState === 'OPEN'),
          is_manual_override: false,
          trigger_type: 'AUTO_SCHEDULE_TRANSITION',
          next_milestone: getNextScheduleMilestone(now),
          schedule: isStoreOpen(now),
          updated_by: 'System (Schedule Timer)'
        });
      } catch (sseErr) {
        console.warn('[StoreScheduleWorker] SSE broadcast warning:', sseErr.message);
      }

      return {
        action: 'AUTO_SCHEDULE_TRANSITION',
        newStatus: scheduledState
      };
    }

    return {
      action: 'SCHEDULE_NORMAL',
      store_status: cachedSettings.store_status
    };
  }
}

let scheduleWorkerTimer = null;

/**
 * Starts background timer evaluating store operating hours and auto-resetting manual overrides
 */
function startStoreScheduleWorker(intervalMs = 30000) {
  if (scheduleWorkerTimer) return scheduleWorkerTimer;
  console.log(`[StoreScheduleWorker] Starting store operating hours worker (evaluating every ${intervalMs / 1000}s)...`);

  evaluateStoreSchedule().catch(err => {
    console.error('[StoreScheduleWorker Error on startup]:', err.message);
  });

  scheduleWorkerTimer = setInterval(() => {
    evaluateStoreSchedule().catch(err => {
      console.error('[StoreScheduleWorker Error]:', err.message);
    });
  }, intervalMs);

  return scheduleWorkerTimer;
}

function stopStoreScheduleWorker() {
  if (scheduleWorkerTimer) {
    clearInterval(scheduleWorkerTimer);
    scheduleWorkerTimer = null;
  }
}

// Initial warm-up on process start
getSystemSettings().catch(() => { });

module.exports = {
  getSystemSettings,
  getCachedSystemSettings,
  updateSystemSettings,
  isChatbotEnabled,
  isStoreOpen,
  formatTime12h,
  getManilaDateTime,
  getNextScheduleMilestone,
  checkMilestoneCrossing,
  evaluateStoreSchedule,
  recordStoreStatusAudit,
  startStoreScheduleWorker,
  stopStoreScheduleWorker
};

