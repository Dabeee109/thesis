/**
 * Chatbot & AI Logs Controller (FR5, FR9)
 * Handles retrieving conversational audit logs and handling browser simulator interactions.
 */

const db = require('../../database/db');
const systemSettingsService = require('../services/systemSettingsService');
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
    const { psid = 'PSID_SIMULATOR_USER', text = '', payload = null, location = null, attachments = null } = req.body;

    if (!text && !payload && !location && (!attachments || attachments.length === 0)) {
      return res.status(400).json({ success: false, message: 'Text message, payload, location, or attachments required.' });
    }

    await handleMessageEvent(psid, text, payload, location, attachments);

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
 * Get current AI Chatbot status & store operating hours
 */
async function getStatus(req, res) {
  const sys = await systemSettingsService.getSystemSettings();
  const storeSchedule = systemSettingsService.isStoreOpen();
  return res.json({
    success: true,
    isEnabled: Boolean(sys.chatbot_enabled),
    chatbot_enabled: sys.chatbot_enabled,
    lastToggledBy: sys.last_toggled_by || 'Admin',
    lastToggledAt: sys.last_toggled_at || sys.updated_at,
    store_open_time: sys.store_open_time,
    store_close_time: sys.store_close_time,
    storeSchedule
  });
}

/**
 * Toggle AI Chatbot status (ON/OFF) persistently
 */
async function toggleStatus(req, res) {
  const { isEnabled, chatbot_enabled } = req.body;
  const targetState = isEnabled !== undefined ? isEnabled : chatbot_enabled;
  if (targetState === undefined) {
    return res.status(400).json({ success: false, message: 'isEnabled boolean is required.' });
  }

  const user = req.user ? (req.user.full_name || req.user.name || 'Admin') : 'Admin';
  const updatedSys = await systemSettingsService.updateSystemSettings({
    chatbot_enabled: Boolean(targetState),
    updated_by: user
  });
  setChatbotStatus(Boolean(targetState), user);

  const statusResponse = {
    isEnabled: Boolean(updatedSys.chatbot_enabled),
    chatbot_enabled: updatedSys.chatbot_enabled,
    lastToggledBy: user,
    lastToggledAt: updatedSys.last_toggled_at || updatedSys.updated_at
  };

  // Broadcast to all active dashboards and simulators in real-time
  broadcastSSE('CHATBOT_STATUS_CHANGED', statusResponse);

  return res.json({
    success: true,
    message: `AI Chatbot has been successfully ${statusResponse.isEnabled ? 'turned ON (Active)' : 'turned OFF (Muted / Kill Switch Active)'}.`,
    ...statusResponse
  });
}

module.exports = {
  getChatbotLogs,
  simulateMessage,
  getSimulatorSession,
  getStatus,
  toggleStatus
};
