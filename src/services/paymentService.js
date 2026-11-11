/**
 * Payment Module Service (FR4, FR9)
 * Handles Cash and GCash payments, validates paid amounts against order totals,
 * and flags discrepancies immediately.
 */

const db = require('../../database/db');
const { broadcastSSE } = require('./notificationService');

/**
 * Record a payment for an order and perform GCash amount validation
 * 
 * @param {Object} paymentData
 * @param {number} paymentData.orderId
 * @param {string} paymentData.paymentMethod - 'cash' | 'gcash'
 * @param {number} paymentData.amountPaid - Amount entered by customer
 * @param {string} [paymentData.referenceNo] - GCash Reference Number
 * @returns {Promise<Object>} Payment record status and validation result
 */
async function processPayment({ orderId, paymentMethod, amountPaid = 0, referenceNo = null }) {
  // Fetch order total amount
  const [orderRows] = await db.query(
    `SELECT id, order_number, total_amount, status FROM orders WHERE id = ?`,
    [orderId]
  );

  if (orderRows.length === 0) {
    throw new Error(`Order #${orderId} not found.`);
  }

  const order = orderRows[0];
  const amountExpected = parseFloat(order.total_amount);
  const paid = parseFloat(amountPaid) || 0.0;
  const pMethod = (paymentMethod || 'cash').toLowerCase();

  let isMismatch = 0;
  let mismatchNotes = null;
  let status = 'pending';

  if (pMethod === 'xendit') {
    if (paid <= 0) {
      isMismatch = 0;
      status = 'pending';
      mismatchNotes = 'Awaiting Xendit online payment completion.';
    } else {
      const diff = paid - amountExpected;
      if (Math.abs(diff) > 0.01) {
        isMismatch = 1;
        status = 'mismatch_flagged';
        mismatchNotes = diff < 0
          ? `Underpaid by ₱${Math.abs(diff).toFixed(2)}. Paid ₱${paid.toFixed(2)}, expected ₱${amountExpected.toFixed(2)}.`
          : `Overpaid by ₱${diff.toFixed(2)}. Paid ₱${paid.toFixed(2)}, expected ₱${amountExpected.toFixed(2)}.`;
      } else {
        isMismatch = 0;
        status = 'verified';
        mismatchNotes = 'Exact amount verified via Xendit gateway.';
      }
    }
  } else if (pMethod === 'gcash') {
    const diff = paid - amountExpected;
    if (Math.abs(diff) > 0.01) {
      isMismatch = 1;
      status = 'mismatch_flagged';
      if (diff < 0) {
        mismatchNotes = `Underpaid by ₱${Math.abs(diff).toFixed(2)}. Entered ₱${paid.toFixed(2)}, expected ₱${amountExpected.toFixed(2)}.`;
      } else {
        mismatchNotes = `Overpaid by ₱${diff.toFixed(2)}. Entered ₱${paid.toFixed(2)}, expected ₱${amountExpected.toFixed(2)}.`;
      }
    } else {
      isMismatch = 0;
      status = 'verified';
      mismatchNotes = 'Exact amount verified against order total.';
    }
  } else {
    // Cash on Pickup / Delivery
    status = 'pending';
    mismatchNotes = 'Cash collection upon handover.';
  }

  // Check if payment already exists
  const [existingPayment] = await db.query(
    `SELECT id FROM payments WHERE order_id = ?`,
    [orderId]
  );

  let paymentId;
  if (existingPayment.length > 0) {
    paymentId = existingPayment[0].id;
    await db.query(
      `UPDATE payments 
       SET payment_method = ?, amount_expected = ?, amount_paid = ?, reference_no = ?, 
           status = ?, is_mismatch = ?, mismatch_notes = ?, 
           verified_at = ${status === 'verified' ? 'CURRENT_TIMESTAMP' : 'NULL'}
       WHERE id = ?`,
      [pMethod, amountExpected, paid, referenceNo, status, isMismatch, mismatchNotes, paymentId]
    );
  } else {
    const [result] = await db.query(
      `INSERT INTO payments 
       (order_id, payment_method, amount_expected, amount_paid, reference_no, status, is_mismatch, mismatch_notes, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${status === 'verified' ? 'CURRENT_TIMESTAMP' : 'NULL'})`,
      [orderId, pMethod, amountExpected, paid, referenceNo, status, isMismatch, mismatchNotes]
    );
    paymentId = result.insertId;
  }

  // Broadcast payment update to real-time dashboard
  broadcastSSE('PAYMENT_UPDATE', {
    orderId,
    orderNumber: order.order_number,
    paymentMethod: pMethod,
    amountExpected,
    amountPaid: paid,
    referenceNo,
    status,
    isMismatch,
    mismatchNotes
  });

  return {
    paymentId,
    orderId,
    orderNumber: order.order_number,
    paymentMethod: pMethod,
    amountExpected,
    amountPaid: paid,
    referenceNo,
    status,
    isMismatch,
    mismatchNotes,
    isValidated: isMismatch === 0 && pMethod === 'gcash'
  };
}

module.exports = {
  processPayment
};
