/**
 * Inactivity Timeout & Abandoned Cart Worker (Requirement 6)
 * Periodically monitors customer session inactivity and triggers:
 * - 20 Mins: 1st warning ("Hello po! Active pa po ba kayo?...")
 * - 25 Mins: Final warning ("Hi po! Final follow-up lang po:...")
 * - 30 Mins: Complete session purge & cart wipe + notification
 */

const db = require('../../database/db');
const { userSessions, saveSession } = require('./sessionManager');
const { sendTextMessage } = require('./messengerService');

let workerTimer = null;

const INACTIVITY_MESSAGES = {
  WARNING_20M: "Hello po! Active pa po ba kayo? Paalala lang po na ma-re-reset ang inyong chat session and cart kapag walang reply within 10 minutes.",
  WARNING_20M_NOCART: "Hello po! Active pa po ba kayo? Paalala lang po na ma-re-reset ang inyong chat session kapag walang reply within 10 minutes.",
  WARNING_25M: "Hi po! Final follow-up lang po: ma-re-reset na po ang inyong order within 5 minutes kapag hindi po kayo nakapag-reply.",
  WARNING_25M_NOCART: "Hi po! Final follow-up lang po: ma-re-reset na po ang inyong chat session within 5 minutes kapag hindi po kayo nakapag-reply.",
  RESET_30M: "Dahil walang naging response, na-reset na po ang inyong chat session at na-clear ang inyong cart. Mag-message lang po ulit kung handa na po kayong mag-order!",
  RESET_30M_NOCART: "Dahil walang naging response, na-reset na po ang inyong chat session. Mag-message lang po ulit kung may maitutulong kami o kung handa na po kayong mag-order!"
};

/**
 * Check inactivity across all active conversation sessions
 * @param {Object} [deps={}] - Dependency injection for testability
 * @returns {Promise<{ warnings20: number, warnings25: number, purges30: number }>}
 */
async function checkInactivity(deps = {}) {
  const now = typeof deps.now === 'function' ? deps.now() : Date.now();
  const sendFn = deps.sendTextMessage || sendTextMessage;
  let warnings20 = 0;
  let warnings25 = 0;
  let purges30 = 0;

  // 1. Collect all candidate sessions (in-memory + database customers with unpurged state)
  const candidatePsids = new Set(userSessions.keys());

  try {
    const timeFilter = (db.isUsingFallback && db.isUsingFallback()) 
      ? "updated_at >= datetime('now', '-2 hours')" 
      : "updated_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR)";

    const [dbCustomers] = await db.query(
      `SELECT psid FROM customers 
       WHERE psid IS NOT NULL 
         AND (conversation_state NOT IN ('IDLE', 'idle') OR (cart_json IS NOT NULL AND cart_json != '[]') OR ${timeFilter})`
    );
    (dbCustomers || []).forEach(c => {
      if (c.psid) candidatePsids.add(String(c.psid));
    });
  } catch (err) {
    // Ignore DB errors in offline/mock runs
  }

  const { getSession } = require('./sessionManager');

  for (const psid of candidatePsids) {
    if (!psid || psid.startsWith('POS_MANUAL_')) continue;

    let session = null;
    try {
      session = await getSession(psid);
    } catch (e) {
      continue;
    }

    if (!session) continue;

    // Process sessions that have an active draft order, active state, or recent chat interaction within 2 hours
    const hasCart = Array.isArray(session.cart) && session.cart.length > 0;
    const hasActiveState = session.state && session.state !== 'IDLE' && session.state !== 'idle';
    const hasRecentInteraction = session.lastInteraction && (now - session.lastInteraction) < (120 * 60 * 1000);
    const hasChatHistory = Array.isArray(session.chatHistory) && session.chatHistory.length > 0;

    if (!hasCart && !hasActiveState && !(hasRecentInteraction && hasChatHistory)) {
      continue;
    }

    const lastInteraction = session.lastInteraction || now;
    const elapsedMinutes = (now - lastInteraction) / (60 * 1000);

    // 20 Minutes: 1st Inactivity Warning
    if (elapsedMinutes >= 20 && elapsedMinutes < 25) {
      if (!session.warning20Sent) {
        session.warning20Sent = true;
        warnings20++;
        const msg = hasCart ? INACTIVITY_MESSAGES.WARNING_20M : INACTIVITY_MESSAGES.WARNING_20M_NOCART;
        console.log(`[InactivityWorker] Dispatching 20M warning to ${psid} (elapsed: ${elapsedMinutes.toFixed(1)}m, hasCart: ${hasCart})`);
        await sendFn(psid, msg, { messagingType: 'UPDATE' }).catch(e => console.warn('[Inactivity Warning 20M Err]', e.message));
        await saveSession(session);
      }
    }

    // 25 Minutes: Final Follow-up Warning
    else if (elapsedMinutes >= 25 && elapsedMinutes < 30) {
      if (!session.warning25Sent) {
        session.warning25Sent = true;
        warnings25++;
        const msg = hasCart ? INACTIVITY_MESSAGES.WARNING_25M : INACTIVITY_MESSAGES.WARNING_25M_NOCART;
        console.log(`[InactivityWorker] Dispatching 25M warning to ${psid} (elapsed: ${elapsedMinutes.toFixed(1)}m, hasCart: ${hasCart})`);
        await sendFn(psid, msg, { messagingType: 'UPDATE' }).catch(e => console.warn('[Inactivity Warning 25M Err]', e.message));
        await saveSession(session);
      }
    }

    // 30 Minutes: Complete Session Purge & Abandoned Cart Cleanup (Issue 4)
    else if (elapsedMinutes >= 30) {
      if (!session.purged30Sent) {
        session.name = null;
        session.phone_number = null;
        session.address = null;
        session.dining_mode = null;
        session.cart = [];
        session.ordered_items = [];
        session.discount = null;
        session.discount_info = null;
        session.state = 'INITIAL_GREETING';
        session.current_step = 'INITIAL_GREETING';
        session.orderType = null;
        session.order_type = null;
        session.pendingStage5 = null;
        session.pendingItem = null;
        session.pending_suggestion = null;
        session.details = null;
        session.customer_name = null;
        session.contact_number = null;
        session.delivery_address = null;
        session.quote = null;
        session.checkout = null;
        session.order_subtotal = null;
        session.order_total = null;
        session.warning20Sent = false;
        session.warning25Sent = false;
        session.purged30Sent = true;

        purges30++;
        const msg = hasCart ? INACTIVITY_MESSAGES.RESET_30M : INACTIVITY_MESSAGES.RESET_30M_NOCART;
        console.log(`[InactivityWorker] Dispatching 30M purge/reset to ${psid} (elapsed: ${elapsedMinutes.toFixed(1)}m, hadCart: ${hasCart})`);
        await sendFn(psid, msg, { messagingType: 'UPDATE' }).catch(e => console.warn('[Inactivity Purge Err]', e.message));
        await saveSession(session);
      }
    }
  }

  return { warnings20, warnings25, purges30 };
}

/**
 * Start the background inactivity check timer (default runs every 60s)
 * @param {number} [intervalMs=60000]
 */
function startInactivityWorker(intervalMs = 60000) {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    checkInactivity().catch(err => {
      console.error('[InactivityWorker Error]', err.message);
    });
  }, intervalMs);
  if (workerTimer.unref) workerTimer.unref();
}

/**
 * Stop background inactivity timer
 */
function stopInactivityWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}

module.exports = {
  INACTIVITY_MESSAGES,
  checkInactivity,
  startInactivityWorker,
  stopInactivityWorker
};

