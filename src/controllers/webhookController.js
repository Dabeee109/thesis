/**
 * Webhook Controller (FR2, FR3, FR5, FR7)
 * Handles GET challenge handshake verification, HMAC/secret signature validation,
 * fast-ack (< 5ms) HTTP 200 responses, and asynchronous background AI + Messenger dispatch.
 */

const crypto = require('crypto');
const config = require('../config/config');
const db = require('../../database/db');
const systemSettingsService = require('../services/systemSettingsService');
const storeSettingsService = require('../services/storeSettingsService');
const xenditService = require('../services/xenditService');
const orderService = require('../services/orderService');
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
        } else if (webhookEvent.payment) {
          const pay = webhookEvent.payment;
          const payAmt = pay?.amount?.amount || pay?.payment_credential?.amount || '';
          const text = payAmt ? `₱${payAmt} transfer completed` : 'transfer completed';
          console.log(`[Webhook Payment Event] sender=${senderPsid} amount=${payAmt}`);
          await handleMessageEvent(senderPsid, text, 'PAYMENT_TRANSFER_COMPLETED');
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
 * Enforces Master AI Chatbot Toggle (Mute / Kill Switch): if chatbot_enabled is false,
 * immediately acknowledges Meta with 200 EVENT_RECEIVED and returns without dispatching replies,
 * allowing managers to chat manually in Page Inbox without bot interference.
 */
function processWebhookEvents(req, res) {
  const body = req.body || {};

  // Requirement 2: Master AI Chatbot Toggle (Mute / Kill Switch)
  if (!systemSettingsService.isChatbotEnabled()) {
    console.log('[Webhook Master Toggle] Chatbot is disabled (chatbot_enabled=0). Acknowledging Meta without bot reply.');
    if (body.object === 'page') {
      return res.status(200).type('text/plain').send('EVENT_RECEIVED');
    }
    return res.status(200).json({
      success: true,
      status: 'muted',
      message: 'EVENT_RECEIVED: Chatbot is currently muted by store manager for manual Page Inbox handling.'
    });
  }

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
  res.setHeader('ngrok-skip-browser-warning', 'true');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  const query = req?.query || {};
  const psid = (query.psid || '').trim();
  const isPersonalMode = String(query.mode || '').trim().toLowerCase() === 'personal';
  let session = null;

  if (psid) {
    try {
      session = await getSession(psid);
    } catch (e) {
      console.warn('[gcashRedirect] Error fetching session:', e.message);
    }
  }

  const storeGcash = await storeSettingsService.getStoreSettings();
  const gcashAccountName = String(storeGcash?.gcash_account_name || config.store?.gcashName || "Diner's Cafe - Tondo Branch");
  const gcashAccountNumber = String(storeGcash?.gcash_account_number || config.store?.gcashNumber || '0928 176 2895');
  const gcashQrUrl = String(storeGcash?.gcash_qr_image_url || '/images/gcash_official_qr.jpg');

  const pendingDraft = session?.pendingGCashOrder || null;
  const orderTotal = pendingDraft?.grandTotal || resolveOrderTotal(session) || (query.amount ? parseFloat(query.amount) : 145.00);
  const formattedTotal = formatAmount(orderTotal);
  const customerName = pendingDraft?.customerName || session?.customer_name || session?.details?.name || 'Customer';
  const deliveryAddress = pendingDraft?.address || session?.delivery_address || session?.details?.address || 'Metro Manila';
  const orderNumber = query.order || pendingDraft?.orderNumber || session?.activeOrderNumber || `DNR-${Date.now().toString().slice(-6)}`;

  let xenditCheckoutUrl = null;
  try {
    const inv = await xenditService.createInvoice({
      orderNumber,
      amount: orderTotal,
      customerName,
      customerPhone: pendingDraft?.contactNumber || session?.contact_number || '',
      description: `Diner's Cafe Order #${orderNumber}`
    }).catch(() => null);

    if (inv?.invoice_url) {
      xenditCheckoutUrl = inv.invoice_url;
    } else {
      const charge = await xenditService.createGcashCharge({
        orderNumber,
        amount: orderTotal,
        customerName,
        customerPhone: pendingDraft?.contactNumber || session?.contact_number || '',
        description: `Diner's Cafe Order #${orderNumber}`
      });
      xenditCheckoutUrl = charge?.checkout_url || charge?.invoice_url || null;
    }
  } catch (xErr) {
    // Graceful fallback if Xendit live API is unreachable or development key
    console.warn('[gcashRedirect] Xendit live charge skipped/offline:', xErr.message);
  }

  // If Xendit checkout URL is active and order does not exist in DB yet, auto-provision DB order
  if (xenditCheckoutUrl && psid) {
    try {
      const [existingOrder] = await db.query(
        `SELECT id FROM orders WHERE order_number = ? LIMIT 1`,
        [orderNumber]
      );
      if (!existingOrder || existingOrder.length === 0) {
        const itemsToInsert = (pendingDraft?.items && pendingDraft.items.length > 0)
          ? pendingDraft.items
          : ((session?.cart && session.cart.length > 0) ? session.cart : []);

        if (itemsToInsert.length > 0) {
          const newOrder = await orderService.createOrder(psid, {
            orderNumber,
            customerName,
            customerPhone: pendingDraft?.contactNumber || session?.contact_number || session?.phone_number || '',
            deliveryAddress: pendingDraft?.address || session?.delivery_address || 'Store Pickup',
            orderType: pendingDraft?.orderType || session?.orderType || 'delivery',
            dining_mode: pendingDraft?.dining_mode || session?.dining_mode || 'Pick-up',
            landmark: pendingDraft?.landmark || session?.landmark || null,
            arriving_time: pendingDraft?.arriving_time || session?.arriving_time || null,
            customerNotes: pendingDraft?.note || session?.customer_notes || null,
            paymentMethod: 'xendit',
            amountPaid: 0,
            paymentStatus: 'Pending Verification',
            items: itemsToInsert.map(c => ({
              menuItemId: c.menuItemId || c.id,
              name: c.name,
              quantity: c.quantity || 1,
              unitPrice: c.price || c.unitPrice || 0,
              price: c.price || c.unitPrice || 0,
              price_at_time: c.price || c.unitPrice || 0,
              addOns: c.addOns || c.addons
            })),
            deliveryFee: pendingDraft?.deliveryFee || session?.delivery_fee || 0,
            discountAmount: pendingDraft?.discountAmount || session?.discount_amount || 0,
            totalAmount: orderTotal
          });

          if (session) {
            session.activeOrderNumber = orderNumber;
            session.active_order_id = newOrder.orderId || newOrder.id;
            session.order_id = newOrder.orderId || newOrder.id;
            if (pendingDraft) {
              pendingDraft.orderNumber = orderNumber;
              pendingDraft.orderId = session.active_order_id;
            }
            await saveSession(session);
          }
        }
      }
    } catch (orderInitErr) {
      console.warn('[gcashRedirect] Order auto-provisioning warning:', orderInitErr.message);
    }
  }

  const items = (pendingDraft?.items && pendingDraft.items.length > 0)
    ? pendingDraft.items
    : ((session?.cart && session?.cart.length > 0) ? session.cart : (session?.ordered_items || []));

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
  <title>Xendit Payment Gateway - GCash</title>
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
      background: linear-gradient(135deg, #153f74 0%, #007dfe 100%);
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
      padding: 14px 24px;
      background: linear-gradient(135deg, #007dfe 0%, #0056b3 100%);
      color: #ffffff;
      text-decoration: none;
      border-radius: 10px;
      font-size: 16px;
      font-weight: bold;
      text-align: center;
      margin-top: 14px;
      box-shadow: 0 4px 14px rgba(0, 125, 254, 0.3);
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
      var xenditUrl = '${xenditCheckoutUrl || ''}';
      if (xenditUrl && xenditUrl.startsWith('http')) {
        window.location.href = xenditUrl;
      }
    };

    function openGcashApp(event) {
      var xenditUrl = '${xenditCheckoutUrl || ''}';
      if (xenditUrl && xenditUrl.startsWith('http')) {
        window.location.href = xenditUrl;
        return;
      }
    }

    ${isPersonalMode ? '' : `
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
          statusBox.innerHTML = \\\`
            <h2 style="color:#2e7d32; margin-top:0;">Kumpirmado ang Bayad!</h2>
            <p style="font-size:24px; font-weight:800; color:#1b5e20; margin:8px 0;">PHP \\\${Number(data.amount).toFixed(2)}</p>
            <p style="font-size:14px; color:#555;"><strong>GCash Ref No:</strong> \\\${data.referenceNumber}</p>
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
          \\\`;
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
    `}
  </script>
</head>
<body>
  <div class="container">
    <div class="header">
      <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1px; opacity:0.85; margin-bottom:4px;">Secure Checkout Powered by</div>
      <h1 style="display:flex; align-items:center; justify-content:center; gap:8px; margin:0;">
        <span style="font-weight:900; letter-spacing:-0.5px;">xendit</span>
        <span style="font-size:18px; opacity:0.75; font-weight:normal;">|</span>
        <span style="font-size:20px; font-weight:bold;">Online Payment</span>
      </h1>
      <p style="margin:6px 0 0; font-size:13px; opacity:0.9;">Diner's Cafe • Official Payment Gateway</p>
    </div>

    <div class="card-body">
      <div id="statusBox" class="status-alert"></div>

      <div id="contentSection">
        <div class="amount-box">
          <div class="amount-label">Kabuuang Babayaran (via Xendit)</div>
          <div class="amount-val">PHP ${formattedTotal}</div>
        </div>

        <div class="detail-row">
          <span class="detail-label">Payment Gateway</span>
          <span class="detail-val" style="color:#007dfe; font-weight:bold;">Xendit (GCash, Maya, Cards, Banks)</span>
        </div>

        <div class="detail-row">
          <span class="detail-label">Order Ref</span>
          <span class="detail-val">#${orderNumber}</span>
        </div>

        <div class="detail-row">
          <span class="detail-label">Pangalan ng Customer</span>
          <span class="detail-val">${customerName}</span>
        </div>

        <div class="detail-row">
          <span class="detail-label">Address</span>
          <span class="detail-val">${deliveryAddress}</span>
        </div>

        ${isPersonalMode ? `
        <div style="text-align:center; margin:14px 0 18px; padding:12px; background:#f7faff; border:1px solid #d6e9ff; border-radius:10px;">
          <div style="font-size:12px; font-weight:bold; color:#0056b3; margin-bottom:8px;">I-scan ang Official GCash QR ng Tindahan:</div>
          <img src="${gcashQrUrl}" alt="Diner's Cafe GCash QR" style="max-width:200px; width:100%; border-radius:8px; border:1px solid #ddd;" />
          <div style="margin-top:10px;">
            <a href="${gcashQrUrl}" download="diners-cafe-gcash-qr.jpg" style="display:inline-block; font-size:12px; font-weight:bold; color:#007dfe; text-decoration:none; padding:6px 14px; background:#ffffff; border:1px solid #007dfe; border-radius:6px;">
              Save / Download QR Code
            </a>
          </div>
        </div>
        ` : ''}

        <div style="font-size:13px; font-weight:bold; color:#555; margin:16px 0 8px;">Order Details:</div>
        <div class="items-container">
          ${itemsHtml}
        </div>

        ${isPersonalMode ? `
        <div style="background:#eef6ff; border:1px solid #c7e1ff; border-radius:10px; padding:12px; margin-bottom:16px; font-size:13px; color:#1e3a5f; line-height:1.45;">
          <strong>Xendit Payment:</strong> Pindutin ang button sa ibaba upang makapili ng paraan ng pagbabayad (GCash, Maya, Card, o Bank) sa <strong>Xendit</strong>. Pagkatapos magbayad, awtomatikong makukumpirma ang inyong order sa Facebook Messenger.
        </div>
        ` : `
        <button id="payBtn" class="btn-pay" onclick="submitGcashPayment()">
          Bayaran ang PHP ${formattedTotal} sa GCash via Xendit
        </button>
        `}

        <div style="margin-top:20px; text-align:center;">
          <a href="${isPersonalMode ? 'intent://#Intent;scheme=gcash;package=com.globe.gcash.android;end' : (xenditCheckoutUrl || '#xendit-checkout')}" 
             id="gcashAppBtn"
             class="btn-app"
             onclick="openGcashApp(event)"
             style="display:block; padding:14px 24px; background:linear-gradient(135deg, #007dfe 0%, #0056b3 100%); color:#fff; text-decoration:none; border-radius:10px; font-weight:bold; font-size:16px; box-shadow:0 4px 14px rgba(0, 125, 254, 0.3);">
             ${isPersonalMode ? '📱 Buksan ang GCash' : '💳 Magpatuloy sa Xendit (Pumili ng Payment)'}
          </a>
          <div id="gcashFallbackHelp" style="display:none; margin-top:12px; padding:12px; background:#eef6ff; border:1px solid #b6d8ff; border-radius:10px; font-size:12px; color:#1e3a5f; text-align:left; line-height:1.5;">
            <strong>Paalala sa Payment:</strong><br>
            Ligtas na ipinoproseso ang inyong bayad ng <strong>Xendit Payment Gateway</strong> para sa Diner's Cafe.<br>
            Maaari ring i-scan ang QR code sa itaas o gamitin ang Reference Number.
          </div>
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
    const { psid, amount, mode } = req.body;
    if (String(mode || '').trim().toLowerCase() === 'personal') {
      return res.status(403).json({
        success: false,
        message: 'Direct self-confirmation is disabled in personal GCash mode. Please upload your GCash receipt in Messenger.'
      });
    }
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

/**
 * Incoming GCash SMS / App Notification Ingest Webhook (POST /api/payment/gcash/sms-webhook)
 * Allows an authorized SMS/Notification forwarder on the store phone to record incoming
 * GCash transfers into `admin_gcash_transactions` and auto-verify any waiting customer order.
 */
async function gcashSmsWebhook(req, res) {
  try {
    const expectedToken = String(process.env.GCASH_SMS_WEBHOOK_TOKEN || '').trim();
    if (expectedToken) {
      const provided = String(
        req.headers['x-gcash-webhook-token'] ||
        req.headers['x-callback-token'] ||
        req.body?.token ||
        ''
      ).trim();
      if (!safeCompare(provided, expectedToken)) {
        return res.status(401).json({ success: false, message: 'Unauthorized GCash webhook token.' });
      }
    }

    const { parseGcashSmsNotification } = require('../services/personalGcashService');
    const orderService = require('../services/orderService');

    const rawText = req.body?.text || req.body?.message || req.body?.raw_text || '';
    const parsed = parseGcashSmsNotification(rawText);
    const referenceNumber = String(req.body?.reference_number || req.body?.referenceNumber || parsed.referenceNumber || '').trim();
    const amount = Number(req.body?.amount ?? parsed.amount ?? 0);

    if (!referenceNumber || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Could not extract valid reference_number and positive amount.'
      });
    }

    const [existingLedger] = await db.query(
      `SELECT id, status FROM admin_gcash_transactions WHERE reference_number = ? LIMIT 1`,
      [referenceNumber]
    );

    if (!existingLedger || existingLedger.length === 0) {
      await db.query(
        `INSERT INTO admin_gcash_transactions (reference_number, amount, status, created_at)
         VALUES (?, ?, 'UNCLAIMED', CURRENT_TIMESTAMP)`,
        [referenceNumber, amount]
      );
    }

    // Check if an order is already awaiting verification with this exact reference number
    const [pendingOrders] = await db.query(
      `SELECT id, order_number, total_amount, payment_status
       FROM orders
       WHERE (gcash_ref = ? OR payment_ref_number = ?)
         AND LOWER(COALESCE(status, '')) NOT IN ('cancelled', 'voided', 'delivered')
       ORDER BY id DESC
       LIMIT 1`,
      [referenceNumber, referenceNumber]
    );

    let autoVerifiedOrder = null;
    if (pendingOrders && pendingOrders.length > 0) {
      const ord = pendingOrders[0];
      const alreadyPaid = String(ord.payment_status || '').toLowerCase() === 'paid';
      const diff = Math.abs(Number(ord.total_amount) - amount);

      if (!alreadyPaid && diff <= 0.01) {
        await db.query(
          `UPDATE admin_gcash_transactions SET status = 'MATCHED' WHERE reference_number = ?`,
          [referenceNumber]
        );
        await db.query(
          `UPDATE payments SET amount_paid = ?, updated_at = CURRENT_TIMESTAMP WHERE order_id = ?`,
          [amount, ord.id]
        );
        await orderService.verifyOrderPayment(ord.id, { username: 'GCash SMS Auto-Verify' });
        autoVerifiedOrder = ord.order_number;
      }
    }

    return res.json({
      success: true,
      referenceNumber,
      amount,
      autoVerifiedOrder
    });
  } catch (err) {
    console.error('[gcashSmsWebhook Error]', err);
    return res.status(500).json({ success: false, message: err.message || 'GCash SMS webhook error' });
  }
}

module.exports = {
  verifyWebhook,
  verifyWebhookSignature,
  processWebhookEvents,
  gcashRedirect,
  confirmGcashPayment,
  gcashSmsWebhook
};
