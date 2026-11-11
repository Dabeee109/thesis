/**
 * Xendit Payment Gateway Service
 * Integrates Xendit Invoices API v2 for online payments (GCash, Maya, GrabPay, Banks, OTC).
 */

const crypto = require('crypto');
const config = require('../config/config');

const XENDIT_INVOICES_URL = 'https://api.xendit.co/v2/invoices';
const XENDIT_EWALLET_CHARGES_URL = 'https://api.xendit.co/ewallets/charges';

function getSecretKey() {
  return (process.env.XENDIT_SECRET_KEY || config.xendit?.secretKey || '').trim();
}

function getCallbackToken() {
  return (process.env.XENDIT_CALLBACK_TOKEN || config.xendit?.callbackToken || '').trim();
}

function getBaseUrl() {
  return (process.env.APP_BASE_URL || config.xendit?.baseUrl || config.appUrl || 'http://localhost:3000')
    .trim()
    .replace(/\/+$/, '');
}

function buildAuthHeader() {
  const secretKey = getSecretKey();
  if (!secretKey) {
    throw new Error('XENDIT_SECRET_KEY is not configured.');
  }
  const encoded = Buffer.from(`${secretKey}:`).toString('base64');
  return `Basic ${encoded}`;
}

/**
 * Verify Xendit webhook callback verification token (x-callback-token header).
 * @param {string} providedToken
 * @returns {boolean}
 */
function verifyCallbackToken(providedToken) {
  const expected = getCallbackToken();
  if (!expected) {
    return true;
  }
  if (!providedToken || typeof providedToken !== 'string') {
    return false;
  }
  const a = Buffer.from(providedToken.trim(), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/**
 * Create a Xendit Hosted Invoice URL for an order.
 * @param {Object} params
 * @param {string} params.orderNumber - Unique order number used as Xendit external_id
 * @param {number} params.amount - Total PHP amount to charge
 * @param {string} [params.customerName] - Customer display name
 * @param {string} [params.customerPhone] - Customer phone number
 * @param {string} [params.description] - Line description shown on checkout page
 * @param {number} [params.durationSeconds=3600] - Invoice validity duration in seconds
 * @returns {Promise<Object>} Xendit invoice object containing id and invoice_url
 */
async function createInvoice({
  orderNumber,
  amount,
  customerName = 'Customer',
  customerPhone = '',
  description = '',
  durationSeconds = 3600
}) {
  if (!orderNumber) {
    throw new Error('orderNumber is required to create a Xendit invoice.');
  }

  const numericAmount = Number(Number(amount).toFixed(2));
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error('Order amount must be greater than zero to create a Xendit invoice.');
  }

  const baseUrl = getBaseUrl();
  const cleanPhone = String(customerPhone || '').replace(/[^\d+]/g, '');
  const hasValidPhone = /\d{7,}/.test(cleanPhone);

  const payload = {
    external_id: String(orderNumber),
    amount: numericAmount,
    currency: 'PHP',
    description: (description || `Diner's Cafe Order #${orderNumber}`).slice(0, 255),
    invoice_duration: durationSeconds,
    customer: {
      given_names: String(customerName || 'Customer').slice(0, 100),
      ...(hasValidPhone ? { mobile_number: cleanPhone.slice(0, 30) } : {})
    },
    success_redirect_url: `${baseUrl}/payment/xendit/return?status=success&order=${encodeURIComponent(orderNumber)}`,
    failure_redirect_url: `${baseUrl}/payment/xendit/return?status=failed&order=${encodeURIComponent(orderNumber)}`
  };

  const response = await fetch(XENDIT_INVOICES_URL, {
    method: 'POST',
    headers: {
      Authorization: buildAuthHeader(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    const errMsg = data?.message || data?.error_code || `Xendit API error (${response.status})`;
    throw new Error(errMsg);
  }

  return data;
}

/**
 * Create a direct PH_GCASH eWallet Charge via Xendit eWallet Charges API.
 * Falls back to a GCash-only Xendit Invoice if eWallet callback URL is not configured on the merchant account.
 * @param {Object} params
 * @param {string} params.orderNumber - Unique order number used as reference_id
 * @param {number} params.amount - Total PHP amount to charge
 * @param {string} [params.customerName] - Customer display name
 * @param {string} [params.customerPhone] - Customer phone number
 * @param {string} [params.description] - Optional description
 * @returns {Promise<Object>} Normalized checkout payload containing id, checkout_url, invoice_url, actions
 */
async function createGcashCharge({
  orderNumber,
  amount,
  customerName = 'Customer',
  customerPhone = '',
  description = ''
}) {
  if (!orderNumber) {
    throw new Error('orderNumber is required to create a Xendit GCash charge.');
  }

  const numericAmount = Number(Number(amount).toFixed(2));
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error('Order amount must be greater than zero to create a Xendit GCash charge.');
  }

  const baseUrl = getBaseUrl();
  const payload = {
    reference_id: String(orderNumber),
    currency: 'PHP',
    amount: numericAmount,
    checkout_method: 'ONE_TIME_PAYMENT',
    channel_code: 'PH_GCASH',
    channel_properties: {
      success_redirect_url: `${baseUrl}/payment/xendit/return?status=success&order=${encodeURIComponent(orderNumber)}`,
      failure_redirect_url: `${baseUrl}/payment/xendit/return?status=failed&order=${encodeURIComponent(orderNumber)}`
    },
    metadata: {
      order_number: String(orderNumber),
      customer_name: String(customerName || 'Customer').slice(0, 100)
    }
  };

  const response = await fetch(XENDIT_EWALLET_CHARGES_URL, {
    method: 'POST',
    headers: {
      Authorization: buildAuthHeader(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    // Fallback to GCash-only Invoice if eWallet callback URL isn't configured yet
    if (data?.error_code === 'CALLBACK_URL_NOT_FOUND') {
      console.warn('[Xendit] eWallet callback URL not configured; falling back to GCash-only Invoice.');
      const inv = await createInvoice({
        orderNumber,
        amount: numericAmount,
        customerName,
        customerPhone,
        description
      });
      return {
        ...inv,
        checkout_url: inv.invoice_url
      };
    }
    const errMsg = data?.message || data?.error_code || `Xendit eWallet API error (${response.status})`;
    throw new Error(errMsg);
  }

  const checkoutUrl =
    data.actions?.mobile_web_checkout_url ||
    data.actions?.desktop_web_checkout_url ||
    data.actions?.mobile_deeplink_checkout_url ||
    null;

  if (!checkoutUrl) {
    throw new Error('Xendit did not return a GCash checkout URL.');
  }

  return {
    id: data.id,
    external_id: data.reference_id,
    status: data.status,
    channel_code: data.channel_code,
    actions: data.actions,
    checkout_url: checkoutUrl,
    invoice_url: checkoutUrl
  };
}

module.exports = {
  createInvoice,
  createGcashCharge,
  verifyCallbackToken
};

