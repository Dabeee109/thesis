/**
 * Chatbot & AI Logs Controller (FR5, FR9)
 * Handles retrieving conversational audit logs and handling browser simulator interactions.
 */

const db = require('../../database/db');
const { handleMessageEvent, getSession, getChatbotStatus, setChatbotStatus } = require('../services/nlpEngine');
const { broadcastSSE } = require('../services/notificationService');

/**
 * Get recent chatbot conversation logs
 */
async function getChatbotLogs(req, res) {
  try {
    const [logs] = await db.query(`
      SELECT 
        l.*,
        CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, '')) AS customer_name
      FROM chatbot_logs l
      LEFT JOIN customers c ON l.customer_id = c.id
      ORDER BY l.created_at DESC
      LIMIT 100
    `);

    return res.json({ success: true, count: logs.length, logs });
  } catch (err) {
    console.error('[Chatbot Logs Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve chatbot logs.' });
  }
}

/**
 * Handle direct simulation message from Browser Simulator
 */
async function simulateMessage(req, res) {
  try {
    const { psid = 'PSID_SIMULATOR_USER', text = '', payload = null } = req.body;

    if (!text && !payload) {
      return res.status(400).json({ success: false, message: 'Text message or payload is required.' });
    }

    await handleMessageEvent(psid, text, payload);

    const session = await getSession(psid);
    return res.json({ success: true, message: 'Message processed by chatbot engine.', session });
  } catch (err) {
    console.error('[Simulator Error]', err);
    return res.status(500).json({ success: false, message: err.message || 'Simulator error.' });
  }
}

/**
 * Get current simulator customer session
 */
async function getSimulatorSession(req, res) {
  try {
    const { psid = 'PSID_SIMULATOR_USER' } = req.query;
    const session = await getSession(psid);
    return res.json({ success: true, session });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to get session.' });
  }
}

/**
 * Get current AI Chatbot status (ON/OFF)
 */
function getStatus(req, res) {
  const status = getChatbotStatus();
  return res.json({ success: true, ...status });
}

/**
 * Toggle AI Chatbot status (ON/OFF)
 */
function toggleStatus(req, res) {
  const { isEnabled } = req.body;
  if (isEnabled === undefined) {
    return res.status(400).json({ success: false, message: 'isEnabled boolean is required.' });
  }

  const user = req.user ? req.user.name : 'Admin';
  const updatedStatus = setChatbotStatus(Boolean(isEnabled), user);

  // Broadcast to all active dashboards and simulators in real-time
  broadcastSSE('CHATBOT_STATUS_CHANGED', updatedStatus);

  return res.json({
    success: true,
    message: `AI Chatbot has been successfully ${updatedStatus.isEnabled ? 'turned ON (Active)' : 'turned OFF (Paused)'}.`,
    ...updatedStatus
  });
}

module.exports = {
  getChatbotLogs,
  simulateMessage,
  getSimulatorSession,
  getStatus,
  toggleStatus
};
