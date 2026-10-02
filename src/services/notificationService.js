/**
 * Real-Time Notification & Server-Sent Events (SSE) Service
 * Manages live streaming connections to admin dashboards and rider views,
 * and records outbound customer notifications.
 */

const db = require('../../database/db');

// Set of active SSE client response streams
const sseClients = new Set();

/**
 * Register a new SSE client
 * @param {Object} res - Express response object
 */
function addSSEClient(res) {
  sseClients.add(res);
  res.on('close', () => {
    sseClients.delete(res);
  });
}

/**
 * Broadcast an event to all connected dashboard and rider clients
 * @param {string} eventType - e.g. 'NEW_ORDER', 'STATUS_CHANGE', 'NEW_FEEDBACK', 'STOCK_ALERT'
 * @param {Object} data - Event payload
 */
function broadcastSSE(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify({
    ...data,
    timestamp: new Date().toISOString()
  })}\n\n`;

  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (err) {
      sseClients.delete(client);
    }
  }
}

/**
 * Log and dispatch a notification
 * @param {string} psid - Recipient PSID
 * @param {string} type - Notification type
 * @param {string} title - Notification title
 * @param {string} message - Message text
 * @param {string} channel - 'messenger' | 'system'
 */
async function sendNotification(psid, type, title, message, channel = 'messenger') {
  try {
    await db.query(
      `INSERT INTO notifications (recipient_psid, channel, type, title, message, status)
       VALUES (?, ?, ?, ?, ?, 'sent')`,
      [psid, channel, type, title, message]
    );
  } catch (err) {
    console.error('[NotificationService] Error saving notification:', err.message);
  }

  // Also broadcast to real-time dashboard
  broadcastSSE('SYSTEM_NOTIFICATION', {
    psid,
    type,
    title,
    message
  });
}

/**
 * Firebase Notification Broker (Real-Time Dispatch Updates)
 * Sends push notifications to mobile delivery riders and staff devices.
 * 
 * @param {string|string[]} deviceTokens - FCM Device Registration Token(s)
 * @param {Object} notification - { title, body, data }
 */
async function dispatchFirebasePushNotification(deviceTokens, { title, body, data = {} }) {
  const config = require('../config/config');
  const serverKey = config.firebase?.serverKey;

  // Broadcast to live SSE stream
  broadcastSSE('FIREBASE_PUSH_DISPATCHED', { title, body, data, tokensCount: Array.isArray(deviceTokens) ? deviceTokens.length : 1 });

  if (!serverKey) {
    // In local development / mock mode, log simulation
    return {
      success: true,
      simulated: true,
      message: 'Firebase push notification dispatched (Mock broker active).'
    };
  }

  try {
    const payload = {
      notification: { title, body, sound: 'default' },
      data: { ...data, timestamp: new Date().toISOString() },
      registration_ids: Array.isArray(deviceTokens) ? deviceTokens : [deviceTokens]
    };

    const res = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `key=${serverKey}`
      },
      body: JSON.stringify(payload)
    });

    const result = await res.json();
    return { success: res.ok, result };
  } catch (err) {
    console.error('[Firebase Broker Error]', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  addSSEClient,
  broadcastSSE,
  sendNotification,
  dispatchFirebasePushNotification,
  getClientCount: () => sseClients.size
};
