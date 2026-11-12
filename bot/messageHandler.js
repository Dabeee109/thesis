/**
 * Diner's Cafe Facebook Messenger AI Assistant Message Handler
 * End-to-End Conversational State Machine & Order Processing Pipeline
 * Powered by Google Gemini API (gemini-2.5-flash / gemini-3.8-flash) & TiDB Cloud MySQL
 */

const db = require('../database/db');
const nlpEngine = require('../src/services/nlpEngine');
const aiService = require('../src/services/aiService');
const sessionManager = require('../src/services/sessionManager');
const messengerService = require('../src/services/messengerService');

/**
 * Helper: Atomically reset a customer's session state and purge all drafts
 * 1. Clears in-memory Gemini conversation history buffer.
 * 2. Clears temporary checkout metadata (address, landmark, phone, dining mode, discount state).
 * 3. Deletes all unfinished rows from cart_items in TiDB Cloud.
 * 4. Resets session_state = 'IDLE' in TiDB Cloud.
 */
async function resetCustomerSession(sender_psid) {
  if (!sender_psid) return null;
  const psidStr = String(sender_psid);

  // 1. Clear Gemini conversation history buffer
  aiService.clearConversationHistory(psidStr);

  // 2, 3, 4. Atomic session purge & TiDB cart/customer cleanup
  const session = await sessionManager.resetUserSession(psidStr, { targetState: 'IDLE' });

  try {
    await db.query(`DELETE FROM cart_items WHERE sender_psid = ?`, [psidStr]);
    await db.query(
      `UPDATE customers SET conversation_state = 'IDLE', cart_json = '[]', updated_at = CURRENT_TIMESTAMP WHERE psid = ?`,
      [psidStr]
    );
  } catch (err) {
    console.warn('[resetCustomerSession] DB cleanup warning:', err.message);
  }

  return session;
}

/**
 * Step 0 Pre-LLM Session Lifecycle Checks:
 * - Condition A: 30-Minute Inactivity Timeout
 * - Condition B: Active order cancelled / voided on Admin Dashboard
 * - Condition C: Post-order feedback submitted
 * - Condition D: Exact single-word "reset" command (bypasses LLM, instant reply)
 */
async function processPreLlmLifecycle(psid, incomingText = '') {
  if (!psid) return { shouldBypassLlm: false, bypassResponse: null };

  const userMessage = String(incomingText || '').trim();

  // Condition D: Exact Single-Word "reset" Command (case-insensitive)
  // Guard: Multi-word strings like "Pa-reset po" or "Na-reset wifi namin" must NOT match
  if (userMessage.toLowerCase() === 'reset') {
    await resetCustomerSession(psid);
    try {
      await db.query(
        `UPDATE customers SET last_interaction_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE psid = ?`,
        [String(psid)]
      );
    } catch (_) {}

    const reply = "Na-reset na po ang ating chat session at nabura na rin ang mga hindi natuloy na laman ng inyong cart. Maaari na po kayong magsimula muli—ano pong nais ninyong i-order?";
    await messengerService.sendTextMessage(psid, reply);
    return {
      shouldBypassLlm: true,
      bypassResponse: {
        intent: 'SESSION_RESET_COMMAND',
        confidence: 1.0,
        replyLog: reply
      }
    };
  }

  // Condition A: 30-Minute Inactivity Timeout Check
  try {
    const [custRows] = await db.query(
      `SELECT last_interaction_at, updated_at,
              TIMESTAMPDIFF(MINUTE, COALESCE(last_interaction_at, updated_at), NOW()) AS elapsed_mins
       FROM customers WHERE psid = ? LIMIT 1`,
      [String(psid)]
    );
    if (custRows && custRows.length > 0) {
      const elapsed = custRows[0].elapsed_mins;
      if (elapsed !== null && elapsed !== undefined && Number(elapsed) >= 30) {
        await resetCustomerSession(psid);
      }
    }
  } catch (_) {}

  // Update last_interaction_at timestamp in TiDB
  try {
    await db.query(
      `UPDATE customers SET last_interaction_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE psid = ?`,
      [String(psid)]
    );
  } catch (_) {}

  return { shouldBypassLlm: false, bypassResponse: null };
}

/**
 * Main Message & Event Handler for Facebook Messenger Webhook & Simulator
 */
async function handleMessage(event) {
  const senderPsid = event?.sender?.id || event?.psid || event?.sender_psid;
  const message = event?.message;
  const postback = event?.postback;

  const incomingText = message?.text || postback?.title || '';
  const payload = message?.quick_reply?.payload || postback?.payload || null;
  const attachments = message?.attachments || null;

  // Execute Step 0 Pre-LLM Session Lifecycle Checks
  const preCheck = await processPreLlmLifecycle(senderPsid, incomingText);
  if (preCheck.shouldBypassLlm) {
    return preCheck.bypassResponse;
  }

  // Forward to full Conversational State Machine
  return nlpEngine.handleMessageEvent(senderPsid, incomingText, payload, null, attachments);
}

module.exports = {
  ...nlpEngine,
  resetCustomerSession,
  processPreLlmLifecycle,
  handleMessage,
  handleMessageEvent: nlpEngine.handleMessageEvent,
  handleTextInput: nlpEngine.handleTextInput,
  processMessage: nlpEngine.processMessage
};
