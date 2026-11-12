/**
 * Session Manager & Customer State Persistence (Task 1)
 * Manages in-memory customer conversation sessions with database persistence.
 * Solves silent update failures for first-time customers by ensuring a customer row exists.
 */

const db = require('../../database/db');

// In-memory active customer conversation sessions (keyed by PSID)
const userSessions = new Map();

/**
 * Ensure customer record exists in DB on first contact.
 * Tolerates duplicate-key race.
 * @param {string} psid 
 * @returns {Promise<number|null>} customer id
 */
async function ensureCustomer(psid) {
  if (!psid) return null;
  const psidStr = String(psid);
  try {
    const [rows] = await db.query(`SELECT id FROM customers WHERE psid = ?`, [psidStr]);
    if (rows && rows.length > 0) {
      return rows[0].id;
    }
    const [res] = await db.query(
      `INSERT INTO customers (psid, first_name, last_name, conversation_state) 
       VALUES (?, 'Messenger', 'Customer', 'IDLE')`,
      [psidStr]
    );
    return res.insertId || null;
  } catch (err) {
    // Tolerating duplicate-key race
    try {
      const [rows] = await db.query(`SELECT id FROM customers WHERE psid = ?`, [psidStr]);
      if (rows && rows.length > 0) return rows[0].id;
    } catch (e) {
      // Ignore
    }
    return null;
  }
}

/**
 * Get or initialize user conversation session state
 * @param {string} psid - Facebook Page-Scoped User ID
 * @returns {Promise<Object>} - User session object
 */
async function getSession(psid) {
  if (!psid) {
    throw new Error('PSID is required to get session.');
  }

  const psidStr = String(psid);
  if (userSessions.has(psidStr)) {
    return userSessions.get(psidStr);
  }

  // Load from database if exists
  let customer = null;
  try {
    const [rows] = await db.query(
      `SELECT id, first_name, last_name, phone_number, delivery_address, distance_km, conversation_state, cart_json, session_json 
       FROM customers WHERE psid = ?`,
      [psidStr]
    );
    if (rows && rows.length > 0) {
      customer = rows[0];
    } else {
      // Unknown sender: create row on first contact (fixes F8)
      const customerId = await ensureCustomer(psidStr);
      customer = {
        id: customerId,
        first_name: 'Messenger',
        last_name: 'Customer',
        phone_number: null,
        delivery_address: null,
        distance_km: 1.2,
        conversation_state: 'IDLE',
        cart_json: null,
        session_json: null
      };
    }
  } catch (err) {
    console.error('[SessionManager DB Read Error]', err.message);
  }

  let cart = [];
  if (customer && customer.cart_json) {
    try {
      cart = JSON.parse(customer.cart_json);
      if (!Array.isArray(cart)) cart = [];
    } catch (e) {
      cart = [];
    }
  }

  let extras = {};
  if (customer && customer.session_json) {
    try {
      extras = JSON.parse(customer.session_json) || {};
    } catch (e) {
      extras = {};
    }
  }

  const hasSavedDetails = customer && customer.first_name && customer.first_name !== 'Messenger' && customer.phone_number;
  const savedDetails = hasSavedDetails ? {
    name: `${customer.first_name || ''} ${customer.last_name || ''}`.trim(),
    phone: customer.phone_number || '',
    address: customer.delivery_address || ''
  } : null;

  const session = {
    psid: psidStr,
    customerId: customer ? customer.id : null,
    name: customer ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'Messenger Customer' : 'Messenger Customer',
    phone: customer?.phone_number || '',
    address: customer?.delivery_address || '',
    distanceKm: customer ? parseFloat(customer.distance_km) || 1.2 : 1.2,
    deliveryFee: extras.checkout?.deliveryFee || 0,
    quoteToken: extras.quote?.quoteToken || null,
    quote: extras.quote || null,
    checkout: extras.checkout || null,
    details: extras.details || savedDetails,
    orderType: extras.orderType !== undefined ? extras.orderType : (extras.order_type !== undefined ? extras.order_type : null),
    order_type: extras.order_type !== undefined ? extras.order_type : (extras.orderType !== undefined ? extras.orderType : null),
    customer_name: extras.customer_name || null,
    contact_number: extras.contact_number || null,
    delivery_address: extras.delivery_address !== undefined ? extras.delivery_address : (customer?.delivery_address || null),
    distance_km: extras.distance_km !== undefined ? extras.distance_km : null,
    delivery_fee: extras.delivery_fee !== undefined ? extras.delivery_fee : null,
    order_subtotal: extras.order_subtotal !== undefined ? extras.order_subtotal : null,
    ordered_items: extras.ordered_items || null,
    previous_step: extras.previous_step || null,
    order_total: extras.order_total || extras.checkout?.total || null,
    partial_paid: extras.partial_paid || null,
    gcash_ref: extras.gcash_ref || null,
    receipt_url: extras.receipt_url || null,
    cart,
    pendingItem: extras.pendingItem || null,
    pendingDrinkOrder: extras.pendingDrinkOrder || null,
    current_drink_item: extras.current_drink_item || null,
    temp_drink_id: extras.temp_drink_id || null,
    pending_suggestion: extras.pending_suggestion || null,
    pendingStage5: extras.pendingStage5 || null,
    pendingGCashOrder: extras.pendingGCashOrder || null,
    pendingQuantity: null,
    pendingAction: null,
    pendingIntent: null,
    pendingDisambiguation: null,
    awaiting_field: extras.awaiting_field || null,
    editingField: extras.editingField || null,
    checkout_step: extras.checkout_step || null,
    activeOrderNumber: extras.activeOrderNumber || null,
    active_order_id: extras.active_order_id || null,
    order_id: extras.order_id || null,
    pendingRating: extras.pendingRating || null,
    pendingFeedbackOrderId: null,
    pendingFeedbackOrderNumber: extras.pendingFeedbackOrderNumber || null,
    geminiInteractionId: extras.geminiInteractionId || null,
    dining_mode: extras.dining_mode !== undefined ? extras.dining_mode : (extras.orderType || null),
    payment_mode: extras.payment_mode || null,
    landmark: extras.landmark || null,
    arriving_time: extras.arriving_time || null,
    arrivingTime: extras.arrivingTime || null,
    customer_notes: extras.customer_notes || null,
    note: extras.note || null,
    discount_info: extras.discount_info || null,
    discount_amount: extras.discount_amount || 0,
    chatHistory: Array.isArray(extras.chatHistory) ? extras.chatHistory.slice(-10) : [],
    failedAttempts: extras.failedAttempts || 0,
    lastInteraction: extras.lastInteraction || Date.now(),
    warning20Sent: !!extras.warning20Sent,
    warning25Sent: !!extras.warning25Sent,
    purged30Sent: !!extras.purged30Sent
  };

  let _step = extras.current_step || customer?.conversation_state || 'IDLE';
  Object.defineProperty(session, 'state', {
    get() { return _step; },
    set(v) { _step = v; },
    enumerable: true,
    configurable: true
  });
  Object.defineProperty(session, 'current_step', {
    get() { return _step; },
    set(v) { _step = v; },
    enumerable: true,
    configurable: true
  });

  userSessions.set(psidStr, session);
  return session;
}

/**
 * Persist session changes to database.
 * Serializes cart and session_json extras.
 * @param {Object} session - Active user session
 * @returns {Promise<Object>} - Updated session
 */
async function saveSession(session) {
  if (!session || !session.psid) {
    return session;
  }

  const psidStr = String(session.psid);
  session.lastInteraction = session.lastInteraction || Date.now();
  userSessions.set(psidStr, session);

  try {
    const cartJson = JSON.stringify(session.cart || []);
    const sessionJson = JSON.stringify({
      details: session.details || null,
      orderType: session.order_type !== undefined ? session.order_type : (session.orderType !== undefined ? session.orderType : null),
      order_type: session.order_type !== undefined ? session.order_type : (session.orderType !== undefined ? session.orderType : null),
      customer_name: session.customer_name || session.details?.name || null,
      contact_number: session.contact_number || session.details?.phone || null,
      delivery_address: session.delivery_address !== undefined ? session.delivery_address : null,
      distance_km: session.distance_km !== undefined ? session.distance_km : null,
      delivery_fee: session.delivery_fee !== undefined ? session.delivery_fee : null,
      order_subtotal: session.order_subtotal !== undefined ? session.order_subtotal : null,
      ordered_items: session.ordered_items || null,
      previous_step: session.previous_step || null,
      order_total: session.order_total || null,
      partial_paid: session.partial_paid || null,
      gcash_ref: session.gcash_ref || null,
      receipt_url: session.receipt_url || null,
      current_step: session.current_step || session.state || 'IDLE',
      quote: session.quote || null,
      checkout: session.checkout || null,
      pendingRating: session.pendingRating || null,
      activeOrderNumber: session.activeOrderNumber || null,
      active_order_id: session.active_order_id || null,
      order_id: session.order_id || null,
      awaiting_field: session.awaiting_field || null,
      editingField: session.editingField || null,
      checkout_step: session.checkout_step || null,
      lastInteraction: session.lastInteraction,
      failedAttempts: session.failedAttempts || 0,
      pendingFeedbackOrderNumber: session.pendingFeedbackOrderNumber || null,
      pendingItem: session.pendingItem || null,
      pendingDrinkOrder: session.pendingDrinkOrder || null,
      current_drink_item: session.current_drink_item || null,
      temp_drink_id: session.temp_drink_id || null,
      pending_suggestion: session.pending_suggestion || null,
      pendingStage5: session.pendingStage5 || null,
      pendingGCashOrder: session.pendingGCashOrder || null,
      geminiInteractionId: session.geminiInteractionId || null,
      dining_mode: session.dining_mode !== undefined ? session.dining_mode : (session.orderType || null),
      payment_mode: session.payment_mode || null,
      landmark: session.landmark || null,
      arriving_time: session.arriving_time || null,
      arrivingTime: session.arrivingTime || null,
      customer_notes: session.customer_notes || null,
      note: session.note || null,
      discount_info: session.discount_info || null,
      discount_amount: session.discount_amount || 0,
      chatHistory: Array.isArray(session.chatHistory) ? session.chatHistory.slice(-10) : [],
      warning20Sent: !!session.warning20Sent,
      warning25Sent: !!session.warning25Sent,
      purged30Sent: !!session.purged30Sent
    });
    const state = session.state || session.current_step || 'IDLE';

    // Ensure customer row exists before update
    if (!session.customerId) {
      session.customerId = await ensureCustomer(psidStr);
    }

    const [updateRes] = await db.query(
      `UPDATE customers 
       SET conversation_state = ?,
           cart_json = ?,
           session_json = ?,
           delivery_address = COALESCE(NULLIF(?, ''), delivery_address),
           phone_number = COALESCE(NULLIF(?, ''), phone_number),
           distance_km = COALESCE(?, distance_km),
           last_interaction_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP 
       WHERE psid = ?`,
      [
        state,
        cartJson,
        sessionJson,
        session.address || (session.details?.address) || '',
        session.phone || (session.details?.phone) || '',
        session.distanceKm || 1.2,
        psidStr
      ]
    );

    if (updateRes && updateRes.affectedRows === 0) {
      // Row might not exist yet if ensureCustomer wasn't called or failed
      await ensureCustomer(psidStr);
      await db.query(
        `UPDATE customers 
         SET conversation_state = ?,
             cart_json = ?,
             session_json = ?,
             delivery_address = COALESCE(NULLIF(?, ''), delivery_address),
             phone_number = COALESCE(NULLIF(?, ''), phone_number),
             distance_km = COALESCE(?, distance_km),
             last_interaction_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP 
         WHERE psid = ?`,
        [
          state,
          cartJson,
          sessionJson,
          session.address || (session.details?.address) || '',
          session.phone || (session.details?.phone) || '',
          session.distanceKm || 1.2,
          psidStr
        ]
      );
    }
  } catch (err) {
    console.error('[SessionManager Save DB Error]', err.message);
  }

  return session;
}

/**
 * Clear cart and reset pending states (persists DB deletion in cart_items & customers.cart_json)
 */
async function clearSessionCart(sessionOrPsid) {
  const isStringPsid = typeof sessionOrPsid === 'string' || typeof sessionOrPsid === 'number';
  const session = isStringPsid ? await getSession(String(sessionOrPsid)) : sessionOrPsid;
  if (!session) return null;

  const psidStr = String(session.psid || (isStringPsid ? sessionOrPsid : ''));
  session.cart = [];
  session.ordered_items = [];
  session.order_subtotal = 0;
  session.order_total = 0;
  session.pendingItem = null;
  session.pending_suggestion = null;
  session.pendingQuantity = null;
  session.pendingAction = null;
  session.pendingIntent = null;
  session.pendingDisambiguation = null;
  session.state = 'IDLE';

  if (psidStr) {
    await db.query(`DELETE FROM cart_items WHERE sender_psid = ?`, [psidStr]).catch(() => {});
    await db.query(
      `UPDATE customers SET cart_json = '[]', updated_at = CURRENT_TIMESTAMP WHERE psid = ?`,
      [psidStr]
    ).catch(() => {});
  }

  await saveSession(session);
  return session;
}

/**
 * Completely reset a customer's conversational session state and purge all transaction drafts.
 * Triggered automatically when an order is DELIVERED or CANCELLED / VOIDED.
 *
 * @param {string} psid - Customer Facebook PSID
 * @returns {Promise<Object|null>} Reset session object
 */
async function resetUserSession(psid, options = {}) {
  if (!psid) return null;
  const psidStr = String(psid);
  const targetState = options.targetState || 'IDLE';

  // Load or initialize session object so in-memory Map reference stays consistent
  const session = await getSession(psidStr);

  // 1. Reset conversational state & step pointers
  session.state = targetState;
  session.current_step = targetState;
  session.previous_step = null;
  session.checkout_step = null;

  // 2. Clear active cart & order transaction pointers
  session.cart = [];
  session.ordered_items = null;
  session.activeOrderNumber = null;
  session.active_order_id = null;
  session.order_id = null;
  session.awaiting_field = null;
  session.editingField = null;
  session.temp_drink_id = null;
  session.current_drink_item = null;

  // 3. Purge temporary add-ons, checkout drafts, and feedback/payment pointers
  session.pendingItem = null;
  session.pendingDrinkOrder = null;
  session.pending_suggestion = null;
  session.pendingQuantity = null;
  session.pendingAction = null;
  session.pendingIntent = null;
  session.pendingDisambiguation = null;
  session.pendingStage5 = null;
  session.pendingGCashOrder = null;
  session.pendingRating = null;
  session.pendingFeedbackOrderId = null;
  session.pendingFeedbackOrderNumber = null;
  session.partial_paid = null;
  session.gcash_ref = null;
  session.receipt_url = null;

  // 4. Purge delivery address, fare quote, dining mode, and pricing drafts
  session.quote = null;
  session.quoteToken = null;
  session.checkout = null;
  session.details = null;
  session.orderType = null;
  session.order_type = null;
  session.dining_mode = null;
  session.payment_mode = null;
  session.delivery_address = null;
  session.address = '';
  session.landmark = null;
  session.arriving_time = null;
  session.arrivingTime = null;
  session.customer_notes = null;
  session.note = null;
  session.distance_km = null;
  session.delivery_fee = null;
  session.deliveryFee = 0;
  session.customer_lat = null;
  session.customer_lng = null;
  session.delivery_coordinates = null;
  session.order_subtotal = null;
  session.order_total = null;
  session.discount = null;
  session.discount_amount = 0;
  session.discount_info = null;
  session.is_preorder = false;

  // 5. Reset AI conversation thread & inactivity flags
  session.geminiInteractionId = null;
  session.chatHistory = [];
  try {
    require('./aiService').clearConversationHistory(psidStr);
  } catch (_) {}
  session.failedAttempts = 0;
  session.warning20Sent = false;
  session.warning25Sent = false;
  session.purged30Sent = false;
  session.lastInteraction = Date.now();

  if (psidStr) {
    await db.query(`DELETE FROM cart_items WHERE sender_psid = ?`, [psidStr]).catch(() => {});
    await db.query(
      `UPDATE customers SET cart_json = '[]', updated_at = CURRENT_TIMESTAMP WHERE psid = ?`,
      [psidStr]
    ).catch(() => {});
  }

  await saveSession(session);
  return session;
}

/**
 * Clear in-memory cache (primarily for tests)
 */
function clearMemorySessions() {
  userSessions.clear();
}

async function resetCustomerSession(psid) {
  return resetUserSession(psid, { targetState: 'IDLE' });
}

module.exports = {
  ensureCustomer,
  getSession,
  saveSession,
  clearSessionCart,
  resetUserSession,
  resetCustomerSession,
  clearMemorySessions,
  userSessions
};
