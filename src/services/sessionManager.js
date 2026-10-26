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
    orderType: extras.orderType || 'delivery',
    state: customer?.conversation_state || 'IDLE',
    cart,
    pendingItem: extras.pendingItem || null,
    pendingQuantity: null,
    pendingAction: null,
    pendingIntent: null,
    pendingDisambiguation: null,
    activeOrderNumber: extras.activeOrderNumber || null,
    pendingRating: extras.pendingRating || null,
    pendingFeedbackOrderId: null,
    pendingFeedbackOrderNumber: extras.pendingFeedbackOrderNumber || null,
    failedAttempts: extras.failedAttempts || 0,
    lastInteraction: extras.lastInteraction || Date.now()
  };

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
      orderType: session.orderType || 'delivery',
      quote: session.quote || null,
      checkout: session.checkout || null,
      pendingRating: session.pendingRating || null,
      activeOrderNumber: session.activeOrderNumber || null,
      lastInteraction: session.lastInteraction,
      failedAttempts: session.failedAttempts || 0,
      pendingFeedbackOrderNumber: session.pendingFeedbackOrderNumber || null,
      pendingItem: session.pendingItem || null
    });
    const state = session.state || 'IDLE';

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
 * Clear cart and reset pending states
 */
async function clearSessionCart(session) {
  session.cart = [];
  session.pendingItem = null;
  session.pendingQuantity = null;
  session.pendingAction = null;
  session.pendingIntent = null;
  session.pendingDisambiguation = null;
  session.state = 'IDLE';
  await saveSession(session);
  return session;
}

/**
 * Clear in-memory cache (primarily for tests)
 */
function clearMemorySessions() {
  userSessions.clear();
}

module.exports = {
  ensureCustomer,
  getSession,
  saveSession,
  clearSessionCart,
  clearMemorySessions,
  userSessions
};
