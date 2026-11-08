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
  WARNING_25M: "Hi po! Final follow-up lang po: ma-re-reset na po ang inyong order within 5 minutes kapag hindi po kayo nakapag-reply.",
  RESET_30M: "Dahil walang naging response, na-reset na po ang inyong chat session at na-clear ang inyong cart. Mag-message lang po ulit kung handa na po kayong mag-order!"
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
    const [dbCustomers] = await db.query(
      `SELECT psid FROM customers 
       WHERE psid IS NOT NULL 
         AND (conversation_state NOT IN ('IDLE', 'idle') OR (cart_json IS NOT NULL AND cart_json != '[]'))`
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

    // Only process sessions that have an active draft order or state
    const hasCart = Array.isArray(session.cart) && session.cart.length > 0;
    const hasActiveState = session.state && session.state !== 'IDLE' && session.state !== 'idle';
    if (!hasCart && !hasActiveState) {
      continue;
    }

    const lastInteraction = session.lastInteraction || now;
    const elapsedMinutes = (now - lastInteraction) / (60 * 1000);

    // 20 Minutes: 1st Inactivity Warning
    if (elapsedMinutes >= 20 && elapsedMinutes < 25) {
      if (!session.warning20Sent) {
        session.warning20Sent = true;
        warnings20++;
        await sendFn(psid, INACTIVITY_MESSAGES.WARNING_20M).catch(e => console.warn('[Inactivity Warning 20M Err]', e.message));
        await saveSession(session);
      }
    }

    // 25 Minutes: Final Follow-up Warning
    else if (elapsedMinutes >= 25 && elapsedMinutes < 30) {
      if (!session.warning25Sent) {
        session.warning25Sent = true;
        warnings25++;
        await sendFn(psid, INACTIVITY_MESSAGES.WARNING_25M).catch(e => console.warn('[Inactivity Warning 25M Err]', e.message));
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
        await sendFn(psid, INACTIVITY_MESSAGES.RESET_30M).catch(e => console.warn('[Inactivity Purge Err]', e.message));
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

