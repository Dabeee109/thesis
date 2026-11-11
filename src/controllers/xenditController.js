/**
 * Xendit Webhook Controller
 * Handles Invoice Paid / Expired callbacks from Xendit and updates order & kitchen status.
 */

const db = require('../../database/db');
const xenditService = require('../services/xenditService');
const orderService = require('../services/orderService');
const { sendTextMessage } = require('../services/messengerService');

/**
 * POST /api/payment/xendit/webhook
 */
async function handleWebhook(req, res) {
  try {
    const providedToken = req.headers['x-callback-token'] || req.headers['X-CALLBACK-TOKEN'];
    if (!xenditService.verifyCallbackToken(providedToken)) {
      console.warn('[Xendit Webhook] Rejected request with invalid X-CALLBACK-TOKEN.');
      return res.status(401).json({ success: false, message: 'Unauthorized callback token' });
    }

    const body = req.body || {};
    const externalId = body.external_id;
    const invoiceStatus = String(body.status || '').toUpperCase();
    const invoiceId = body.id || '';
    const paidAmount = Number(body.paid_amount ?? body.amount ?? 0);
    const paymentChannel = body.payment_channel || body.bank_code || body.ewallet_type || body.payment_method || 'Xendit';

    if (!externalId) {
      return res.status(200).json({ received: true, ignored: true, reason: 'Missing external_id' });
    }

    // Look up matching order in database
    const [orders] = await db.query(
      `SELECT o.id, o.order_number, o.payment_status, o.status, c.psid
       FROM orders o
       LEFT JOIN customers c ON o.customer_id = c.id
       WHERE o.order_number = ?
       LIMIT 1`,
      [externalId]
    );

    if (!orders || orders.length === 0) {
      // Return 200 so Xendit dashboard test pings ("invoice_123124123") succeed cleanly
      console.log(`[Xendit Webhook] No matching order for external_id="${externalId}" (status=${invoiceStatus}). Acknowledging.`);
      return res.status(200).json({
        received: true,
        matched: false,
        external_id: externalId
      });
    }

    const order = orders[0];

    if (invoiceStatus === 'PAID' || invoiceStatus === 'SETTLED') {
      if (String(order.payment_status || '').toLowerCase() === 'paid') {
        return res.status(200).json({ received: true, alreadyPaid: true, orderNumber: order.order_number });
      }

      const refNote = invoiceId ? `${paymentChannel} (${invoiceId})` : String(paymentChannel);

      await db.query(
        `UPDATE orders
         SET payment_ref_number = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [refNote.slice(0, 100), order.id]
      );

      await db.query(
        `UPDATE payments
         SET payment_method = 'xendit',
             amount_paid = ?,
             reference_no = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE order_id = ?`,
        [paidAmount, refNote.slice(0, 100), order.id]
      );

      await orderService.verifyOrderPayment(order.id, { username: 'Xendit Gateway' });

      return res.status(200).json({
        received: true,
        verified: true,
        orderNumber: order.order_number
      });
    }

    if (invoiceStatus === 'EXPIRED' && String(order.payment_status || '').toLowerCase() !== 'paid') {
      await db.query(
        `UPDATE payments
         SET mismatch_notes = 'Xendit payment link expired.', updated_at = CURRENT_TIMESTAMP
         WHERE order_id = ?`,
        [order.id]
      );

      if (order.psid && !String(order.psid).startsWith('POS_MANUAL_')) {
        await sendTextMessage(
          order.psid,
          `Paalala: Nag-expire na po ang Xendit payment link para sa Order #${order.order_number}. Mag-type ng "Menu" kung nais ninyong mag-order muli.`
        ).catch(() => {});
      }
    }

    return res.status(200).json({ received: true, status: invoiceStatus });
  } catch (err) {
    console.error('[Xendit Webhook Error]', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  handleWebhook,
  getStatus(req, res) {
    const hasSecretKey = Boolean((process.env.XENDIT_SECRET_KEY || '').trim());
    const hasCallbackToken = Boolean((process.env.XENDIT_CALLBACK_TOKEN || '').trim());
    const baseUrl = (process.env.APP_BASE_URL || process.env.APP_URL || '').trim() || null;
    return res.json({
      success: true,
      configured: hasSecretKey,
      hasCallbackToken,
      baseUrl
    });
  }
};

