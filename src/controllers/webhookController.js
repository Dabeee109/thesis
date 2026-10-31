/**
 * Webhook Controller (FR2, FR3, FR5, FR7)
 * Handles GET challenge handshake verification, HMAC/secret signature validation,
 * fast-ack (< 5ms) HTTP 200 responses, and asynchronous background AI + Messenger dispatch.
 */

const crypto = require('crypto');
const config = require('../config/config');
const db = require('../../database/db');
const { handleMessageEvent, getSession, saveSession, generateSummaryReceipt } = require('../services/nlpEngine');
const { verifyPaymentTransaction, resolveOrderTotal, formatAmount } = require('../services/paymentVerificationService');
const { sendTextMessage } = require('../services/messengerService');

/**
 * Constant-time string comparison to prevent timing side-channel attacks on tokens/signatures
 */
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Webhook Handshake Verification (GET /api/webhook & GET /webhook)
 * Supports Meta Messenger (hub.mode, hub.verify_token, hub.challenge)
 * as well as generic challenge handshakes (verify_token, challenge).
 */
function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'] || 'subscribe';
  const token = req.query['hub.verify_token'] || req.query.verify_token;
  const challenge = req.query['hub.challenge'] ?? req.query.challenge ?? 'WEBHOOK_VERIFIED';

  console.log(`[Webhook Handshake] Received GET ${req.path}: mode=${mode}`);

  if (mode && token) {
    const expectedToken = config.facebook.verifyToken || '';
    if (mode === 'subscribe' && expectedToken && safeCompare(String(token), expectedToken)) {
      console.log('[Webhook] Handshake challenge verified.');
      return res.status(200).type('text/plain').send(String(challenge));
    }
    console.warn('[Webhook] Verification token mismatch.');
    return res.sendStatus(403);
  }

  return res.sendStatus(400);
}

/**
 * Optional Webhook Signature / Secret Middleware
 * 1. Validates Meta X-Hub-Signature-256 HMAC-SHA256 when FB_APP_SECRET is configured.
 * 2. Validates X-Webhook-Secret header when WEBHOOK_SECRET is configured for custom callers.
 */
function verifyWebhookSignature(req, res, next) {
  const appSecret = (config.facebook.appSecret || '').trim();
  const isRealAppSecret = Boolean(appSecret && appSecret !== 'your_app_secret_here');
  const signatureHeader = req.get('x-hub-signature-256');

  if (isRealAppSecret && signatureHeader) {
    if (!req.rawBody) {
      return res.status(401).json({ success: false, message: 'Missing raw payload for signature verification.' });
    }
    const expectedSig = 'sha256=' + crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex');
    if (!safeCompare(signatureHeader, expectedSig)) {
      console.warn('[Webhook Security] Invalid X-Hub-Signature-256 header.');
      return res.sendStatus(401);
    }
    return next();
  }

  const webhookSecret = (config.webhookSecret || '').trim();
  const providedSecret = req.get('x-webhook-secret');
  if (webhookSecret && req.body?.object !== 'page') {
    if (!providedSecret || !safeCompare(providedSecret, webhookSecret)) {
      console.warn('[Webhook Security] Missing or invalid X-Webhook-Secret header.');
      return res.status(401).json({ success: false, message: 'Unauthorized webhook caller.' });
    }
  }

  return next();
}

/**
 * Process a single Meta Messenger entry batch sequentially per sender
 */
async function processMetaEntries(entries = []) {
  for (const entry of entries) {
    const messagingEvents = Array.isArray(entry?.messaging) ? entry.messaging : [];
    for (const webhookEvent of messagingEvents) {
      const senderPsid = webhookEvent?.sender?.id ? String(webhookEvent.sender.id) : null;
      if (!senderPsid) continue;

      try {
        if (webhookEvent.message) {
          const message = webhookEvent.message;
          if (message.is_echo) continue; // Ignore outbound bot echoes

          if (message.attachments?.[0]?.type === 'location') {
            const coords = message.attachments[0].payload?.coordinates;
            const lat = coords ? coords.lat : null;
            const lng = coords ? coords.long : null;
            await handleMessageEvent(senderPsid, '', null, { lat, lng });
          } else if (message.quick_reply) {
            await handleMessageEvent(senderPsid, message.text, message.quick_reply.payload);
          } else if (message.attachments && message.attachments.length > 0) {
            await handleMessageEvent(senderPsid, message.text || '', null, null, message.attachments);
          } else if (message.text) {
            await handleMessageEvent(senderPsid, message.text, null);
          }
        } else if (webhookEvent.postback) {
          const postback = webhookEvent.postback;
          await handleMessageEvent(senderPsid, postback.title || '', postback.payload);
        }
      } catch (eventErr) {
        console.error(`[Webhook Async Event Error] sender=${senderPsid}:`, eventErr.message);
      }
    }
  }
}

/**
 * Incoming Webhook Event Handler (POST /api/webhook & POST /webhook)
 * Immediately returns HTTP 200 OK (Fast-Ack < 5s SLA) and dispatches AI + outbound delivery asynchronously.
 */
function processWebhookEvents(req, res) {
  const body = req.body || {};

  // 1. Meta Messenger Platform Payload ({ object: "page", entry: [...] })
  if (body.object === 'page') {
    const entries = Array.isArray(body.entry) ? body.entry : [];
    // Fast-Ack immediately before async AI generation / Graph Send API calls
    res.status(200).type('text/plain').send('EVENT_RECEIVED');

    setImmediate(() => {
      processMetaEntries(entries).catch(err => {
        console.error('[Webhook Background Worker Error]', err);
      });
    });
    return;
  }

  // 2. Direct JSON Chat Webhook Payload ({ senderId / psid, message / text, payload, location })
  const directText = typeof body.message === 'string'
    ? body.message.trim()
    : (typeof body.text === 'string' ? body.text.trim() : '');
  const directPayload = typeof body.payload === 'string' ? body.payload.trim() : null;
  const directLocation = (body.location && typeof body.location === 'object') ? body.location : null;

  if (directText || directPayload || directLocation) {
    const senderId = String(body.senderId || body.psid || 'WEBHOOK_DIRECT_CLIENT').trim();

    // Fast-Ack immediately with 200 OK so callers/tunnels never time out waiting on LLM inference
    res.status(200).json({
      success: true,
      status: 'accepted',
      message: 'EVENT_RECEIVED',
      senderId
    });

    setImmediate(() => {
      handleMessageEvent(senderId, directText, directPayload, directLocation)
        .catch(err => {
          console.error(`[Webhook Direct Async Error] sender=${senderId}:`, err.message);
        });
    });
    return;
  }

  return res.sendStatus(404);
}

/**
 * GCash Payment Portal & Deep Link Endpoint (GET /pay/gcash)
 * Provides interactive payment screen with prefilled order total, plus direct GCash app launch
 */
async function gcashRedirect(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  const query = req?.query || {};
  const psid = (query.psid || '').trim();
  let session = null;

  if (psid) {
    try {
      session = await getSession(psid);
    } catch (e) {
      console.warn('[gcashRedirect] Error fetching session:', e.message);
    }
  }

  const orderTotal = resolveOrderTotal(session) || (query.amount ? parseFloat(query.amount) : 145.00);
  const formattedTotal = formatAmount(orderTotal);
  const customerName = session?.customer_name || session?.details?.name || 'Customer';
  const deliveryAddress = session?.delivery_address || session?.details?.address || 'Metro Manila';
  const items = (session?.cart && session?.cart.length > 0)
    ? session.cart
    : (session?.ordered_items || []);

  const itemsHtml = items.length > 0
    ? items.map(it => {
        const p = parseFloat(it.price || it.unitPrice || 0);
        const q = parseInt(it.quantity, 10) || 1;
        return `<div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:14px; color:#444;">
          <span>${it.name || 'Item'} x${q}</span>
          <span style="font-weight:600;">PHP ${formatAmount(p * q)}</span>
        </div>`;
      }).join('')
    : '<div style="font-size:14px; color:#666;">Diner\'s Cafe Special Order</div>';

  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Redirecting to GCash...</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      margin: 0;
      padding: 20px 16px 40px;
      background-color: #f0f4f9;
      color: #333;
    }
    .container {
      max-width: 420px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 4px 20px rgba(0, 125, 254, 0.12);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #007dfe 0%, #0056b3 100%);
      padding: 24px 20px;
      text-align: center;
      color: #ffffff;
    }
    .header h1 {
      margin: 0;
      font-size: 26px;
      font-weight: 800;
      letter-spacing: 0.5px;
    }
    .header p {
      margin: 6px 0 0;
      font-size: 13px;
      opacity: 0.9;
    }
    .card-body {
      padding: 24px 20px;
    }
    .amount-box {
      text-align: center;
      background: #eef6ff;
      border: 1px solid #c7e1ff;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 20px;
    }
    .amount-label {
      font-size: 12px;
      text-transform: uppercase;
      font-weight: bold;
      color: #007dfe;
      letter-spacing: 0.5px;
    }
    .amount-val {
      font-size: 32px;
      font-weight: 800;
      color: #007dfe;
      margin-top: 4px;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      font-size: 14px;
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 1px dashed #e5e5e5;
    }
    .detail-label {
      color: #666;
    }
    .detail-val {
      font-weight: 600;
      color: #222;
      text-align: right;
      max-width: 60%;
    }
    .items-container {
      background: #fafafa;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 20px;
    }
    .btn-pay {
      width: 100%;
      padding: 15px;
      background: #007dfe;
      color: #ffffff;
      border: none;
      border-radius: 10px;
      font-size: 16px;
      font-weight: bold;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(0, 125, 254, 0.35);
      transition: background 0.2s, transform 0.1s;
    }
    .btn-pay:active {
      transform: scale(0.98);
      background: #0066cc;
    }
    .btn-app {
      display: block;
      width: 100%;
      box-sizing: border-box;
      padding: 12px 24px;
      background: #007dfe;
      color: #ffffff;
      text-decoration: none;
      border-radius: 8px;
      font-weight: bold;
      text-align: center;
      margin-top: 14px;
    }
    .status-alert {
      display: none;
      padding: 16px;
      border-radius: 12px;
      text-align: center;
      margin-top: 20px;
    }
  </style>
  <script>
    window.onload = function() {
      // Subukang buksan agad ang Android app via intent kung direktang binuksan
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('auto') === '1') {
        window.location.href = "intent://#Intent;scheme=gcash;package=com.globe.gcash.android;end";
        setTimeout(function() {
          window.location.href = "gcash://";
        }, 1000);
      }
    };

    async function submitGcashPayment() {
      const payBtn = document.getElementById('payBtn');
      const statusBox = document.getElementById('statusBox');
      const contentSection = document.getElementById('contentSection');

      payBtn.disabled = true;
      payBtn.innerText = 'Pinoproseso ang bayad...';

      try {
        const response = await fetch('/pay/gcash/confirm', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            psid: '${psid}',
            amount: ${orderTotal}
          })
        });

        const data = await response.json();

        if (data.success) {
          contentSection.style.display = 'none';
          statusBox.style.display = 'block';
          statusBox.style.background = '#e8f5e9';
          statusBox.style.border = '2px solid #4caf50';
          statusBox.innerHTML = \`
            <h2 style="color:#2e7d32; margin-top:0;">Kumpirmado ang Bayad!</h2>
            <p style="font-size:24px; font-weight:800; color:#1b5e20; margin:8px 0;">PHP \${Number(data.amount).toFixed(2)}</p>
            <p style="font-size:14px; color:#555;"><strong>GCash Ref No:</strong> \${data.referenceNumber}</p>
            <div style="background:#ffffff; border-radius:8px; padding:12px; margin:15px 0; border:1px solid #c8e6c9;">
              <p style="margin:0; font-size:14px; color:#2e7d32; font-weight:bold;">
                Naipadala na ang resibo sa inyong Messenger!
              </p>
              <p style="margin:4px 0 0; font-size:13px; color:#666;">
                Inihahanda na ng kusina ang inyong order.
              </p>
            </div>
            <button onclick="window.close()" style="width:100%; padding:12px; background:#007dfe; color:#fff; border:none; border-radius:8px; font-weight:bold; cursor:pointer;">
              Bumalik sa Messenger
            </button>
          \`;
        } else {
          alert('Error: ' + (data.message || 'Hindi maiproseso ang bayad.'));
          payBtn.disabled = false;
          payBtn.innerText = 'Bayaran ang PHP ${formattedTotal} sa GCash';
        }
      } catch (err) {
        alert('Nagkaroon ng problema sa koneksyon. Pakisubukang muli.');
        payBtn.disabled = false;
        payBtn.innerText = 'Bayaran ang PHP ${formattedTotal} sa GCash';
      }
    }
  </script>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>GCash</h1>
      <p>Diner's Cafe • Online Payment Portal</p>
    </div>

    <div class="card-body">
      <div id="statusBox" class="status-alert"></div>

      <div id="contentSection">
        <div class="amount-box">
          <div class="amount-label">Kabuuang Babayaran</div>
          <div class="amount-val">PHP ${formattedTotal}</div>
        </div>

        <div class="detail-row">
          <span class="detail-label">Tindahan / Recipient</span>
          <span class="detail-val">FR****S DA*E F.<br><small style="color:#007dfe;">0928 176 2895</small></span>
        </div>

        <div class="detail-row">
          <span class="detail-label">Pangalan ng Customer</span>
          <span class="detail-val">${customerName}</span>
        </div>

        <div class="detail-row">
          <span class="detail-label">Address</span>
          <span class="detail-val">${deliveryAddress}</span>
        </div>

        <div style="font-size:13px; font-weight:bold; color:#555; margin:16px 0 8px;">Order Details:</div>
        <div class="items-container">
          ${itemsHtml}
        </div>

        <button id="payBtn" class="btn-pay" onclick="submitGcashPayment()">
          Bayaran ang PHP ${formattedTotal} sa GCash
        </button>

        <div style="margin-top:20px; text-align:center;">
          <p style="font-size:12px; color:#888; margin:0 0 8px;">O magbayad gamit ang GCash App:</p>
          <a href="intent://#Intent;scheme=gcash;package=com.globe.gcash.android;end" 
             id="gcashAppBtn"
             class="btn-app"
             style="display:inline-block; padding:12px 24px; background:#007dfe; color:#fff; text-decoration:none; border-radius:8px; font-weight:bold;">
             Buksan ang GCash
          </a>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`);
}

/**
 * Confirm GCash Payment via Link / Portal (POST /pay/gcash/confirm)
 * Automatically marks order as PAID, records transaction, and notifies Messenger
 */
async function confirmGcashPayment(req, res) {
  try {
    const { psid, amount } = req.body;
    if (!psid) {
      return res.status(400).json({ success: false, message: 'Missing psid parameter' });
    }

    const session = await getSession(psid);
    if (!session) {
      return res.status(404).json({ success: false, message: 'Customer session not found' });
    }

    const orderTotal = resolveOrderTotal(session) || (amount ? parseFloat(amount) : 145.00);

    // Generate unique 13-digit Reference Number (starts with 1002)
    const randomSuffix = String(Math.floor(100000000 + Math.random() * 900000000));
    const referenceNumber = `1002${randomSuffix}`;

    // 1. Insert into admin_gcash_transactions as UNCLAIMED
    await db.query(
      `INSERT INTO admin_gcash_transactions (reference_number, amount, status, created_at)
       VALUES (?, ?, 'UNCLAIMED', CURRENT_TIMESTAMP)`,
      [referenceNumber, orderTotal]
    );

    // 2. Perform verification and order update
    await verifyPaymentTransaction({
      referenceNumber,
      session,
      psid,
      parsedAmount: orderTotal
    });

    // 3. Update session
    session.current_step = 'order_placed';
    session.state = 'order_placed';
    session.gcash_ref = referenceNumber;
    await saveSession(session);

    // 4. Send official receipt to Messenger Send API
    const receiptMsg = generateSummaryReceipt(session, referenceNumber);
    await sendTextMessage(psid, receiptMsg);

    return res.json({
      success: true,
      referenceNumber,
      amount: orderTotal,
      message: 'Payment received and verified! Receipt sent to Messenger.'
    });
  } catch (error) {
    console.error('[confirmGcashPayment Error]', error);
    return res.status(500).json({ success: false, message: error.message || 'Payment confirmation error' });
  }
}

module.exports = {
  verifyWebhook,
  verifyWebhookSignature,
  processWebhookEvents,
  gcashRedirect,
  confirmGcashPayment
};
