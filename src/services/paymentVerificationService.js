/**
 * Payment Verification & Anti-Scam Service
 * Cross-checks GCash receipts against previous orders and admin transaction records.
 */

const db = require('../../database/db');

/**
 * Format currency amount cleanly (e.g. 145 or 145.50)
 * @param {number|string} val 
 * @returns {string}
 */
function formatAmount(val) {
  if (val === null || val === undefined) return '0';
  const num = Number(val);
  if (isNaN(num)) return String(val);
  return (num % 1 === 0) ? String(Math.round(num)) : num.toFixed(2);
}

/**
 * Resolve order total from session
 * @param {Object} session 
 * @returns {number}
 */
function resolveOrderTotal(session) {
  if (!session) return 0;
  if (session.order_total && Number(session.order_total) > 0) {
    return parseFloat(session.order_total);
  }
  if (session.checkout && session.checkout.total && Number(session.checkout.total) > 0) {
    return parseFloat(session.checkout.total);
  }
  if (session.checkout && session.checkout.totalAmount && Number(session.checkout.totalAmount) > 0) {
    return parseFloat(session.checkout.totalAmount);
  }
  if (session.cart && session.cart.length > 0) {
    const subtotal = session.cart.reduce((sum, item) => {
      const price = parseFloat(item.price || item.unitPrice || 0);
      const qty = parseInt(item.quantity, 10) || 1;
      return sum + (price * qty);
    }, 0);
    const fee = parseFloat(session.delivery_fee !== null && session.delivery_fee !== undefined ? session.delivery_fee : (session.deliveryFee || session.checkout?.deliveryFee || 50.00));
    return subtotal + fee;
  }
  return 145.00;
}

/**
 * Anti-scam cross-check and payment verification logic
 * 
 * @param {Object} params
 * @param {string} params.referenceNumber - 13-digit GCash reference number
 * @param {Object} params.session - Customer session
 * @param {string} [params.psid] - Facebook PSID
 * @param {string} [params.receiptUrl] - Receipt image URL or path
 * @param {number} [params.parsedAmount] - OCR parsed amount if available
 * @returns {Promise<{ success: boolean, step: number, status: string, botReply: string, actualPaid?: number, kulang?: number, sobra?: number }>}
 */
async function verifyPaymentTransaction({ referenceNumber, session, psid, receiptUrl = null, parsedAmount = null }) {
  if (!referenceNumber || typeof referenceNumber !== 'string') {
    return {
      success: false,
      step: 0,
      status: 'INVALID_REFERENCE',
      botReply: 'Pakisend po ang 13-digit Reference Number o screenshot ng inyong GCash resibo.'
    };
  }

  const cleanRef = referenceNumber.trim();
  const orderTotal = resolveOrderTotal(session);

  // -------------------------------------------------------------------------
  // Hakbang 1: Duplicate Check sa Database
  // I-check kung ang Reference Number ay nagamit na sa mga nakaraang orders (orders.gcash_ref).
  // -------------------------------------------------------------------------
  const [ordersWithRef] = await db.query(
    `SELECT id, order_number, status FROM orders WHERE gcash_ref = ?`,
    [cleanRef]
  );
  const [paymentsWithRef] = await db.query(
    `SELECT id, order_id, status FROM payments WHERE reference_no = ? AND status IN ('verified', 'completed')`,
    [cleanRef]
  );

  if ((ordersWithRef && ordersWithRef.length > 0) || (paymentsWithRef && paymentsWithRef.length > 0)) {
    return {
      success: false,
      step: 1,
      status: 'DUPLICATE_REFERENCE',
      botReply: 'Ang Reference Number na ito ay nagamit na sa ibang order. Pakisend ang bagong resibo.'
    };
  }

  // -------------------------------------------------------------------------
  // Hakbang 2: Admin Records Matching
  // I-query ang admin_gcash_transactions gamit ang Reference Number.
  // -------------------------------------------------------------------------
  const [adminRows] = await db.query(
    `SELECT id, reference_number, amount, status FROM admin_gcash_transactions WHERE reference_number = ?`,
    [cleanRef]
  );

  if (!adminRows || adminRows.length === 0) {
    return {
      success: false,
      step: 2,
      status: 'ADMIN_RECORD_NOT_FOUND',
      botReply: `Hindi pa nagre-reflect sa aming GCash ang transaksyon na may Ref No. ${cleanRef}. Pakihintay ng ilang minuto bago subukang muli.`
    };
  }

  const adminRecord = adminRows[0];

  // If already matched, treat as already claimed / duplicate
  if (adminRecord.status === 'MATCHED') {
    return {
      success: false,
      step: 1,
      status: 'DUPLICATE_REFERENCE',
      botReply: 'Ang Reference Number na ito ay nagamit na sa ibang order. Pakisend ang bagong resibo.'
    };
  }

  // -------------------------------------------------------------------------
  // Hakbang 3: Halaga (Amount Comparison)
  // Kunin ang actual_paid mula sa resibo/admin record at ikumpara sa order_total
  // -------------------------------------------------------------------------
  const actualPaid = parseFloat(adminRecord.amount);
  const diff = Math.round((actualPaid - orderTotal) * 100) / 100;

  // Case a: actual_paid === order_total
  if (Math.abs(diff) < 0.01) {
    // 1. Mark admin record as MATCHED
    await db.query(
      `UPDATE admin_gcash_transactions SET status = 'MATCHED' WHERE reference_number = ?`,
      [cleanRef]
    );

    // 2. Update order if already created in database
    await updateOrderAndPaymentStatus({
      session,
      psid,
      orderStatus: 'pending',
      paymentStatus: 'verified',
      referenceNumber: cleanRef,
      receiptUrl,
      actualPaid,
      orderTotal,
      notes: null
    });

    // 3. Update session
    session.current_step = 'order_placed';
    session.state = 'order_placed';
    session.gcash_ref = cleanRef;
    if (receiptUrl) session.receipt_url = receiptUrl;

    const formattedTotal = formatAmount(orderTotal);
    return {
      success: true,
      step: 3,
      status: 'PAID_EXACT',
      actualPaid,
      orderTotal,
      botReply: `Salamat! Kumpirmado ang inyong bayad na ₱${formattedTotal}. Inihahanda na ng kusina ang inyong order.`
    };
  }

  // Case b: actual_paid < order_total
  if (diff < -0.01) {
    const kulang = Math.round((orderTotal - actualPaid) * 100) / 100;
    session.partial_paid = actualPaid;
    session.gcash_ref = cleanRef;
    if (receiptUrl) session.receipt_url = receiptUrl;

    const formattedPaid = formatAmount(actualPaid);
    const formattedKulang = formatAmount(kulang);

    return {
      success: false,
      step: 3,
      status: 'UNDERPAID',
      actualPaid,
      kulang,
      orderTotal,
      botReply: `Natanggap namin ang ₱${formattedPaid}, ngunit may kulang pa na ₱${formattedKulang}. Paki-send ang karagdagang bayad at ang bagong resibo upang maproseso ang order.`
    };
  }

  // Case c: actual_paid > order_total
  const sobra = Math.round((actualPaid - orderTotal) * 100) / 100;
  const note = `OVERPAID: ₱${formatAmount(sobra)}`;

  // 1. Mark admin record as MATCHED
  await db.query(
    `UPDATE admin_gcash_transactions SET status = 'MATCHED' WHERE reference_number = ?`,
    [cleanRef]
  );

  // 2. Update order in database with status 'pending' and note
  await updateOrderAndPaymentStatus({
    session,
    psid,
    orderStatus: 'pending',
    paymentStatus: 'verified',
    referenceNumber: cleanRef,
    receiptUrl,
    actualPaid,
    orderTotal,
    notes: note,
    isMismatch: 1
  });

  // 3. Update session
  session.current_step = 'order_placed';
  session.state = 'order_placed';
  session.gcash_ref = cleanRef;
  if (receiptUrl) session.receipt_url = receiptUrl;

  const formattedSobra = formatAmount(sobra);
  return {
    success: true,
    step: 3,
    status: 'OVERPAID',
    actualPaid,
    sobra,
    orderTotal,
    botReply: `Salamat! Kumpirmado ang bayad. May labis kayong ₱${formattedSobra} na ibabalik kasabay ng inyong delivery. Inihahanda na ang inyong order.`
  };
}

/**
 * Helper to update order and payment records in DB
 */
async function updateOrderAndPaymentStatus({ session, psid, orderStatus, paymentStatus, referenceNumber, receiptUrl, actualPaid, orderTotal, notes, isMismatch = 0 }) {
  try {
    const effectiveOrderStatus = (orderStatus && orderStatus.toUpperCase() === 'PAID') ? 'pending' : (orderStatus || 'pending');
    const orderNumber = session.activeOrderNumber;

    if (orderNumber) {
      const [orderRows] = await db.query(
        `SELECT id, customer_notes FROM orders WHERE order_number = ?`,
        [orderNumber]
      );

      if (orderRows && orderRows.length > 0) {
        const orderId = orderRows[0].id;
        const existingNotes = orderRows[0].customer_notes || '';
        const combinedNotes = notes ? (existingNotes ? `${existingNotes} | ${notes}` : notes) : existingNotes;

        await db.query(
          `UPDATE orders 
           SET status = ?, gcash_ref = ?, receipt_url = COALESCE(?, receipt_url), customer_notes = ? 
           WHERE id = ?`,
          [effectiveOrderStatus, referenceNumber, receiptUrl, combinedNotes, orderId]
        );

        await db.query(
          `UPDATE payments 
           SET status = ?, reference_no = ?, amount_paid = ?, is_mismatch = ?, mismatch_notes = ?, verified_at = CURRENT_TIMESTAMP 
           WHERE order_id = ?`,
          [paymentStatus, referenceNumber, actualPaid, isMismatch, notes || 'Verified via GCash OCR', orderId]
        );
        return;
      }
    }

    // If order was not yet placed, but items are in cart and customer exists
    if (session.cart && session.cart.length > 0 && psid) {
      const { createOrder } = require('./orderService');
      const orderItems = session.cart.map(c => ({
        menuItemId: c.menuItemId,
        quantity: c.quantity || 1
      }));

      let quoteToken = session.quote?.quoteToken || session.quoteToken || null;
      if (!quoteToken && (session.order_type === 'delivery' || session.orderType === 'delivery')) {
        const jwt = require('jsonwebtoken');
        const config = require('../config/config');
        quoteToken = jwt.sign(
          {
            lat: Number(config.store?.lat) || 14.6042,
            lng: Number(config.store?.lng) || 120.9822,
            address: session.delivery_address || '123 Main St',
            distanceKm: session.distance_km || 1.4,
            vehicleType: 'motorcycle',
            weatherCondition: 'sunny',
            deliveryFee: session.delivery_fee !== null && session.delivery_fee !== undefined ? session.delivery_fee : 50.00
          },
          config.jwtSecret,
          {
            audience: 'delivery-quote',
            expiresIn: config.delivery?.quoteTtlSec || 900
          }
        );
      }

      const newOrder = await createOrder(psid, {
        customerName: session.customer_name || session.details?.name || 'Customer',
        customerPhone: session.contact_number || session.details?.phone || '',
        deliveryAddress: session.order_type === 'pickup' ? 'Store Pickup' : (session.delivery_address || session.details?.address || '123 Main St'),
        orderType: session.order_type || 'delivery',
        paymentMethod: 'gcash',
        amountPaid: actualPaid,
        referenceNo: referenceNumber,
        items: orderItems,
        deliveryFee: session.delivery_fee !== null && session.delivery_fee !== undefined ? session.delivery_fee : (session.deliveryFee || session.checkout?.deliveryFee || 0),
        totalAmount: orderTotal,
        customerNotes: notes || '',
        quoteToken
      });

      const newOrderNum = newOrder.orderNumber || newOrder.order_number;
      session.activeOrderNumber = newOrderNum;

      await db.query(
        `UPDATE orders SET status = ?, gcash_ref = ?, receipt_url = ? WHERE order_number = ?`,
        [effectiveOrderStatus, referenceNumber, receiptUrl, newOrderNum]
      );
      if (session.cart && session.cart.length > 0) {
        session.ordered_items = [...session.cart];
      }
      session.cart = [];
    }
  } catch (err) {
    console.error('[PaymentVerification] Order status update error:', err.message);
  }
}

module.exports = {
  verifyPaymentTransaction,
  resolveOrderTotal,
  formatAmount
};
