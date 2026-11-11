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
    const payload = (body.data && typeof body.data === 'object') ? body.data : body;
    const externalId = payload.external_id || payload.reference_id;
    const invoiceStatus = String(payload.status || '').toUpperCase();
    const invoiceId = payload.id || body.id || '';
    const paidAmount = Number(
      payload.paid_amount ?? payload.capture_amount ?? payload.charge_amount ?? payload.amount ?? 0
    );
    const paymentChannel =
      payload.payment_channel ||
      payload.channel_code ||
      payload.bank_code ||
      payload.ewallet_type ||
      payload.payment_method ||
      'PH_GCASH';

    if (!externalId) {
      return res.status(200).json({ received: true, ignored: true, reason: 'Missing external_id/reference_id' });
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
      // Return 200 so Xendit dashboard test pings succeed cleanly
      console.log(`[Xendit Webhook] No matching order for external_id="${externalId}" (status=${invoiceStatus}). Acknowledging.`);
      return res.status(200).json({
        received: true,
        matched: false,
        external_id: externalId
      });
    }

    const order = orders[0];

    if (invoiceStatus === 'PAID' || invoiceStatus === 'SETTLED' || invoiceStatus === 'SUCCEEDED') {
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

    if ((invoiceStatus === 'EXPIRED' || invoiceStatus === 'FAILED') && String(order.payment_status || '').toLowerCase() !== 'paid') {
      await db.query(
        `UPDATE payments
         SET mismatch_notes = ?, updated_at = CURRENT_TIMESTAMP
         WHERE order_id = ?`,
        [`Xendit GCash payment ${invoiceStatus.toLowerCase()}.`, order.id]
      );

      if (order.psid && !String(order.psid).startsWith('POS_MANUAL_')) {
        await sendTextMessage(
          order.psid,
          `Paalala: Hindi nakumpleto (${invoiceStatus}) ang Xendit GCash payment link para sa Order #${order.order_number}. Mag-type ng "Menu" kung nais ninyong mag-order muli.`
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

