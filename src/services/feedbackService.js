/**
 * Feedback Service (Task 9)
 * Manages post-delivery customer rating requests, claiming prompts atomically,
 * and handling proactive updates to customers.
 */

const db = require('../../database/db');
const { sendFeedbackPrompt } = require('./messengerService');
const { getSession, saveSession } = require('./sessionManager');

function isMessengerPsid(psid) {
  if (!psid || typeof psid !== 'string') return false;
  return !psid.startsWith('WEB_') && !psid.startsWith('POS_MANUAL_');
}

function utcNow() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Request feedback atomically for an order.
 * @param {number|string} orderId 
 * @returns {Promise<string>} 'sent' | 'skipped_missing' | 'skipped_non_messenger' | 'skipped_already_rated' | 'skipped_already_requested' | 'send_failed'
 */
async function requestFeedback(orderId) {
  const [rows] = await db.query(
    `SELECT o.id, o.order_number, o.order_type, c.psid
     FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?`,
    [orderId]
  );
  const o = rows[0];
  if (!o) return 'skipped_missing';
  if (!isMessengerPsid(o.psid)) return 'skipped_non_messenger';

  const [fb] = await db.query(`SELECT id FROM feedback WHERE order_id = ?`, [orderId]);
  if (fb && fb.length > 0) return 'skipped_already_rated';

  const [claim] = await db.query(
    `UPDATE orders SET feedback_requested_at = ? WHERE id = ? AND feedback_requested_at IS NULL`,
    [utcNow(), orderId]
  );
  if (!claim || claim.affectedRows !== 1) return 'skipped_already_requested';

  try {
    // Record pending rating in session
    try {
      const session = await getSession(o.psid);
      if (session) {
        session.pendingRating = { orderNumber: o.order_number };
        await saveSession(session);
      }
    } catch (sessionErr) {
      console.warn('[feedback] Could not update session pendingRating:', sessionErr.message);
    }

    await sendFeedbackPrompt(o.psid, o.order_number, o.order_type);
    return 'sent';
  } catch (err) {
    await db.query(`UPDATE orders SET feedback_requested_at = NULL WHERE id = ?`, [orderId]);
    console.warn('[feedback] send failed:', err.code || err.message);
    return 'send_failed';
  }
}

module.exports = {
  requestFeedback,
  isMessengerPsid,
  utcNow
};
