/**
 * Personal GCash Pay-First & Anti-Flood Service
 *
 * Allows real-money peer-to-peer GCash payments (without merchant KYC) while
 * blocking fake/unpaid order flooding:
 *   1. Pay-First Drafts: Orders stay in session.pendingGCashOrder (not inserted
 *      into `orders` or deducting stock) until valid proof of payment is sent.
 *   2. Expiry Window: Pending GCash checkouts expire after 20 minutes.
 *   3. Spam Cooldown: 3 consecutive invalid/duplicate receipt attempts trigger a
 *      10-minute cooldown lock.
 *   4. Duplicate Ref Blocker: Rejects any reference number already present in
 *      `orders`, `payments`, or matched in `admin_gcash_transactions`.
 *   5. OCR Amount Guard & Auto-Match: Rejects underpaid receipts; auto-advances
 *      straight to kitchen preparation when matched against `admin_gcash_transactions`.
 */

const db = require('../../database/db');

const PENDING_GCASH_EXPIRY_MS = 20 * 60 * 1000; // 20 minutes
const FAILED_ATTEMPT_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
const MAX_FAILED_RECEIPT_ATTEMPTS = 3;

/**
 * Determine whether checkout should dispatch to Xendit API or Personal GCash Pay-First.
 * Defaults to Personal GCash unless GCASH_CHECKOUT_MODE=xendit or a live Xendit production key is configured.
 * @returns {boolean}
 */
function shouldUseXenditCheckout() {
  const mode = String(process.env.GCASH_CHECKOUT_MODE || '').trim().toLowerCase();
  if (mode === 'xendit') return true;
  if (mode === 'personal' || mode === 'gcash' || mode === 'manual') return false;

  const secretKey = String(process.env.XENDIT_SECRET_KEY || '').trim();
  return secretKey.startsWith('xnd_production_');
}

/**
 * Snapshot a pay-first pending GCash order draft inside the customer session.
 * Does NOT insert into `orders` or deduct inventory stock.
 */
function buildPendingGcashOrder(session = {}, overrides = {}, now = Date.now()) {
  const items = Array.isArray(overrides.items)
    ? overrides.items
    : (Array.isArray(session.cart) ? session.cart : []);

  const deliveryFee = overrides.deliveryFee !== undefined
    ? Number(overrides.deliveryFee) || 0
    : (Number(session.delivery_fee ?? session.deliveryFee ?? session.checkout?.deliveryFee) || 0);

  const discountAmount = overrides.discountAmount !== undefined
    ? Number(overrides.discountAmount) || 0
    : (Number(session.discount_amount ?? session.discount?.amount) || 0);

  const subtotal = overrides.subtotal !== undefined
    ? Number(overrides.subtotal) || 0
    : (Number(session.order_subtotal ?? session.checkout?.subtotal) ||
      items.reduce((sum, item) => sum + (Number(item.price || item.unitPrice || 0) * (parseInt(item.quantity, 10) || 1)), 0));

  const grandTotal = overrides.grandTotal !== undefined
    ? Number(overrides.grandTotal) || 0
    : (Number(session.order_total ?? session.checkout?.total) || Math.max(0, Math.round((subtotal - discountAmount + deliveryFee) * 100) / 100));

  return {
    customerName: overrides.customerName || session.customer_name || session.details?.name || 'Customer',
    contactNumber: overrides.contactNumber || overrides.customerPhone || session.contact_number || session.phone_number || session.details?.phone || '',
    address: overrides.address || overrides.deliveryAddress || session.delivery_address || session.address || session.details?.address || 'Store Pickup',
    landmark: overrides.landmark !== undefined ? overrides.landmark : (session.landmark || session.details?.landmark || null),
    arriving_time: overrides.arriving_time || session.arriving_time || session.arrivingTime || session.eta || null,
    note: overrides.note !== undefined ? overrides.note : (session.customer_notes || session.note || session.notes || session.details?.note || null),
    dining_mode: overrides.dining_mode || session.dining_mode || (session.orderType === 'delivery' ? 'Delivery' : 'Pick-up'),
    orderType: overrides.orderType || session.orderType || (deliveryFee > 0 ? 'delivery' : 'pickup'),
    items: items.map(c => ({ ...c })),
    subtotal,
    discountAmount,
    deliveryFee,
    grandTotal,
    quoteToken: overrides.quoteToken || session.quote?.quoteToken || session.quoteToken || null,
    distanceKm: overrides.distanceKm || session.quote?.distanceKm || session.delivery_distance_km || 0,
    is_preorder: Boolean(overrides.is_preorder !== undefined ? overrides.is_preorder : session.is_preorder),
    createdAt: now,
    expiresAt: now + PENDING_GCASH_EXPIRY_MS,
    failedAttempts: 0,
    cooldownUntil: null
  };
}

/**
 * Evaluate active / expired / cooldown status of session.pendingGCashOrder.
 */
function getPendingGcashStatus(session, now = Date.now()) {
  const pending = session?.pendingGCashOrder || null;
  if (!pending) {
    return {
      exists: false,
      active: false,
      expired: false,
      cooldownActive: false,
      remainingCooldownMinutes: 0,
      pending: null
    };
  }

  const expired = Boolean(pending.expiresAt && now > Number(pending.expiresAt));
  const cooldownUntil = Number(pending.cooldownUntil || 0);
  const cooldownActive = Boolean(!expired && cooldownUntil > now);
  const remainingCooldownMinutes = cooldownActive
    ? Math.max(1, Math.ceil((cooldownUntil - now) / 60000))
    : 0;

  return {
    exists: true,
    active: !expired,
    expired,
    cooldownActive,
    remainingCooldownMinutes,
    pending
  };
}

/**
 * Increment failed receipt attempts and engage a 10-minute cooldown after 3 failures.
 */
function registerFailedProofAttempt(pending, now = Date.now()) {
  if (!pending || typeof pending !== 'object') {
    return { attempts: 1, cooldownTriggered: false, cooldownUntil: null, remainingAttempts: MAX_FAILED_RECEIPT_ATTEMPTS - 1 };
  }

  const attempts = (Number(pending.failedAttempts) || 0) + 1;
  pending.failedAttempts = attempts;

  let cooldownTriggered = false;
  if (attempts >= MAX_FAILED_RECEIPT_ATTEMPTS) {
    pending.cooldownUntil = now + FAILED_ATTEMPT_COOLDOWN_MS;
    cooldownTriggered = true;
  }

  return {
    attempts,
    cooldownTriggered,
    cooldownUntil: pending.cooldownUntil || null,
    remainingAttempts: Math.max(0, MAX_FAILED_RECEIPT_ATTEMPTS - attempts)
  };
}

/**
 * Extract a 9-to-13 digit GCash reference number from free text or OCR output.
 */
function extractReferenceNumber(rawText = '') {
  const text = String(rawText || '').trim();
  if (!text) return null;

  const spaced13 = text.match(/\b\d{4}\s?\d{3}\s?\d{6}\b/);
  if (spaced13) return spaced13[0].replace(/\s+/g, '');

  const contiguous = text.match(/\b\d{9,13}\b/);
  if (contiguous) return contiguous[0];

  const compact = text.replace(/[\s-]+/g, '').match(/\b\d{9,13}\b/);
  return compact ? compact[0] : null;
}

/**
 * Check if a GCash reference number has already been used by any prior order or matched ledger entry.
 * Prevents screenshot reuse / duplicate reference flooding.
 */
async function isDuplicateReferenceNumber(referenceNumber) {
  const cleanRef = String(referenceNumber || '').trim();
  if (!cleanRef) return { duplicate: false };

  const [orderRows] = await db.query(
    `SELECT id, order_number, status
     FROM orders
     WHERE gcash_ref = ? OR payment_ref_number = ?
     LIMIT 1`,
    [cleanRef, cleanRef]
  );

  if (orderRows && orderRows.length > 0 && !['cancelled', 'voided'].includes(String(orderRows[0].status || '').toLowerCase())) {
    return {
      duplicate: true,
      source: 'orders',
      orderNumber: orderRows[0].order_number
    };
  }

  const [paymentRows] = await db.query(
    `SELECT id, order_id, status
     FROM payments
     WHERE reference_no = ? AND LOWER(status) IN ('verified', 'completed', 'pending')
     LIMIT 1`,
    [cleanRef]
  );

  if (paymentRows && paymentRows.length > 0) {
    return {
      duplicate: true,
      source: 'payments',
      orderId: paymentRows[0].order_id
    };
  }

  const [adminRows] = await db.query(
    `SELECT id, status
     FROM admin_gcash_transactions
     WHERE reference_number = ? AND UPPER(status) = 'MATCHED'
     LIMIT 1`,
    [cleanRef]
  );

  if (adminRows && adminRows.length > 0) {
    return {
      duplicate: true,
      source: 'admin_gcash_transactions'
    };
  }

  return { duplicate: false };
}

/**
 * Match a GCash reference number against admin_gcash_transactions ledger.
 */
async function matchAdminGcashTransaction(referenceNumber, expectedAmount) {
  const cleanRef = String(referenceNumber || '').trim();
  if (!cleanRef) return { matched: false, duplicate: false };

  const [rows] = await db.query(
    `SELECT id, reference_number, amount, status
     FROM admin_gcash_transactions
     WHERE reference_number = ?
     LIMIT 1`,
    [cleanRef]
  );

  if (!rows || rows.length === 0) {
    return { matched: false, duplicate: false };
  }

  const record = rows[0];
  if (String(record.status || '').toUpperCase() === 'MATCHED') {
    return { matched: false, duplicate: true, record };
  }

  const actualPaid = Number(record.amount) || 0;
  const expected = Number(expectedAmount) || 0;
  const diff = Math.round((actualPaid - expected) * 100) / 100;

  return {
    matched: true,
    duplicate: false,
    exact: Math.abs(diff) <= 0.01,
    actualPaid,
    expected,
    diff,
    record
  };
}

/**
 * Mark an admin_gcash_transactions row as MATCHED once linked to a paid order.
 */
async function markAdminGcashMatched(referenceNumber) {
  const cleanRef = String(referenceNumber || '').trim();
  if (!cleanRef) return;
  await db.query(
    `UPDATE admin_gcash_transactions SET status = 'MATCHED' WHERE reference_number = ?`,
    [cleanRef]
  );
}

/**
 * Parse an incoming GCash SMS / app notification string into { amount, referenceNumber }.
 * Supports standard GCash alerts like:
 *   "You have received PHP 350.00 of GCash from JUAN D. (0917...) Ref. No. 1009 876 543210."
 */
function parseGcashSmsNotification(rawText = '') {
  const text = String(rawText || '').trim();
  if (!text) return { amount: null, referenceNumber: null };

  let amount = null;
  const amountMatch = text.match(/(?:received|php|₱)\s*(?:php|₱)?\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (amountMatch && amountMatch[1]) {
    const parsed = parseFloat(amountMatch[1].replace(/,/g, ''));
    if (Number.isFinite(parsed) && parsed > 0) {
      amount = parsed;
    }
  }

  const labeledRef = text.match(/(?:ref(?:erence)?\.?\s*(?:no\.?|#)?)\s*[:#]?\s*([0-9\s]{9,18})/i);
  let referenceNumber = null;
  if (labeledRef && labeledRef[1]) {
    const cleaned = labeledRef[1].replace(/\s+/g, '');
    if (cleaned.length >= 9 && cleaned.length <= 13) {
      referenceNumber = cleaned;
    }
  }
  if (!referenceNumber) {
    referenceNumber = extractReferenceNumber(text);
  }

  return { amount, referenceNumber };
}

module.exports = {
  PENDING_GCASH_EXPIRY_MS,
  FAILED_ATTEMPT_COOLDOWN_MS,
  MAX_FAILED_RECEIPT_ATTEMPTS,
  shouldUseXenditCheckout,
  buildPendingGcashOrder,
  getPendingGcashStatus,
  registerFailedProofAttempt,
  extractReferenceNumber,
  isDuplicateReferenceNumber,
  matchAdminGcashTransaction,
  markAdminGcashMatched,
  parseGcashSmsNotification
};
