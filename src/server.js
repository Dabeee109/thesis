/**
 * Diner's Cafe Ordering & Delivery System - Server Bootstrap
 */

const config = require('./config/config');
process.env.TZ = config.timezone || 'Asia/Manila';

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const db = require('../database/db');
const { initDatabase } = db;
const { addSSEClient, broadcastSSE } = require('./services/notificationService');

const webhookRoutes = require('./routes/webhook');
const apiRoutes = require('./routes/api');

const app = express();

// Trust reverse proxy (Render, Cloudflare, Heroku, etc.)
app.set('trust proxy', 1);

// Auto-detect public URL on Render or cloud host from incoming requests
app.use((req, res, next) => {
  const host = req.get('x-forwarded-host') || req.get('host');
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
    const detectedUrl = `${proto}://${host}`.replace(/\/+$/, '');
    if (!config.appUrl || config.appUrl.includes('localhost') || config.appUrl.includes('127.0.0.1')) {
      config.appUrl = detectedUrl;
    }
  }
  next();
});

// Ngrok warning bypass middleware
app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});

// Middleware
app.use(cors());
app.use((req, res, next) => {
  if (!req.url.startsWith('/api/events') && !req.url.startsWith('/favicon.ico')) {
    console.log(`[HTTP ${req.method}] ${req.url}`);
  }
  next();
});
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Explicit Favicon handler to prevent 404 loops
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/favicon.ico'));
});

// Router Guard: Strict Role-Based Isolation for Riders accessing Admin Dashboard
app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  if (p === '/dashboard.html' || p === '/dashboard') {
    const authHeader = req.headers.authorization;
    const token = (authHeader && authHeader.startsWith('Bearer '))
      ? authHeader.split(' ')[1]
      : (req.query && req.query.token ? req.query.token : null);
    if (token) {
      try {
        const decoded = jwt.verify(token, config.jwtSecret);
        const role = (decoded.role || '').toLowerCase();
        if (role === 'rider' || role === 'delivery_rider') {
          return res.redirect('/rider-portal.html');
        }
      } catch (e) {}
    }
  }
  next();
});

// Rider Portal Route Aliases (Supports /rider-portal.html and /rider.html)
app.get(['/rider-portal.html', '/rider-portal', '/rider.html', '/rider'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.sendFile(path.join(__dirname, '../public/rider-portal.html'));
});

// Dedicated Payment Proof Image Route (recovers from DB or generates digital receipt if wiped on Render disk)
app.get('/uploads/payments/:filename', async (req, res) => {
  const filename = path.basename(req.params.filename || '');
  const uploadDir = path.join(__dirname, '../public/uploads/payments');
  const filePath = path.join(uploadDir, filename);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');

  // 1. Serve from local disk if valid image file (> 64 bytes, not legacy 32-byte mock text)
  try {
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.size > 64) {
        const buf = fs.readFileSync(filePath);
        const headStr = buf.slice(0, 64).toString('utf8').trim();
        if (headStr.startsWith('<svg') || headStr.startsWith('<?xml')) {
          res.setHeader('Content-Type', 'image/svg+xml');
          return res.send(buf);
        }
        return res.sendFile(filePath);
      }
    }
  } catch (fsErr) {
    console.warn('[PaymentProofRoute] Disk check error:', fsErr.message);
  }

  // 2. Recover from payment_proof_blobs table in DB
  try {
    const [blobRows] = await db.query(
      `SELECT mime_type, base64_data FROM payment_proof_blobs WHERE filename = ? LIMIT 1`,
      [filename]
    );
    if (blobRows && blobRows.length > 0 && blobRows[0].base64_data) {
      const buf = Buffer.from(blobRows[0].base64_data, 'base64');
      if (buf.length > 64) {
        try {
          if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
          fs.writeFileSync(filePath, buf);
        } catch (_) {}
        const headStr = buf.slice(0, 64).toString('utf8').trim();
        const mime = (headStr.startsWith('<svg') || headStr.startsWith('<?xml'))
          ? 'image/svg+xml'
          : (blobRows[0].mime_type || 'image/jpeg');
        res.setHeader('Content-Type', mime);
        return res.send(buf);
      }
    }
  } catch (blobErr) {
    // Table may not exist yet on older instances
  }

  // 3. Fallback: Lookup order details in DB and render a high-resolution GCash Digital Receipt SVG
  let orderNum = 'DNR-ORDER';
  let refNum = 'Submitted via Messenger';
  let amountStr = '0.00';
  let customerName = 'Valued Customer';
  let dateStr = new Date().toLocaleString('en-PH');
  let payStatus = 'Submitted';

  try {
    const likePattern = `%${filename}%`;
    const idMatch = filename.match(/payment_proof_(\d+)_/i);
    const extractedId = idMatch ? parseInt(idMatch[1], 10) : -1;

    const [ordRows] = await db.query(
      `SELECT o.order_number, o.total_amount, o.payment_ref_number, o.gcash_ref, o.payment_status, o.created_at,
              c.first_name, c.last_name, p.reference_no
       FROM orders o
       LEFT JOIN customers c ON o.customer_id = c.id
       LEFT JOIN payments p ON o.id = p.order_id
       WHERE o.payment_proof_image LIKE ? OR o.receipt_url LIKE ? OR o.id = ?
       ORDER BY o.id DESC LIMIT 1`,
      [likePattern, likePattern, extractedId]
    );

    if (ordRows && ordRows.length > 0) {
      const ord = ordRows[0];
      orderNum = ord.order_number || orderNum;
      refNum = ord.payment_ref_number || ord.gcash_ref || ord.reference_no || refNum;
      amountStr = parseFloat(ord.total_amount || 0).toFixed(2);
      const fullName = `${ord.first_name || ''} ${ord.last_name || ''}`.trim();
      if (fullName) customerName = fullName;
      if (ord.created_at) dateStr = new Date(ord.created_at).toLocaleString('en-PH');
      if (ord.payment_status) payStatus = ord.payment_status;
    }
  } catch (ordErr) {
    console.warn('[PaymentProofRoute] Order lookup fallback notice:', ordErr.message);
  }

  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const receiptSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="540" height="720" viewBox="0 0 540 720">
  <defs>
    <linearGradient id="gcashBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0057e7"/>
      <stop offset="100%" stop-color="#0039a6"/>
    </linearGradient>
  </defs>
  <rect width="540" height="720" rx="24" fill="url(#gcashBg)"/>
  <text x="270" y="52" text-anchor="middle" font-family="Arial, sans-serif" font-size="26" font-weight="bold" fill="#ffffff">GCash Digital Payment Receipt</text>
  <rect x="30" y="78" width="480" height="602" rx="20" fill="#ffffff"/>
  <circle cx="270" cy="134" r="34" fill="#10b981"/>
  <text x="270" y="146" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" font-weight="bold" fill="#ffffff">✓</text>
  <text x="270" y="198" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" font-weight="bold" fill="#0f172a">Diner's Cafe - Tondo Branch</text>
  <text x="270" y="224" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" fill="#64748b">Express Send • Proof of Payment</text>
  <text x="270" y="276" text-anchor="middle" font-family="Arial, sans-serif" font-size="36" font-weight="bold" fill="#0057e7">PHP ${esc(amountStr)}</text>
  <line x1="60" y1="306" x2="480" y2="306" stroke="#cbd5e1" stroke-width="1.5" stroke-dasharray="6,6"/>
  <text x="65" y="352" font-family="Arial, sans-serif" font-size="15" fill="#64748b">Order Number</text>
  <text x="475" y="352" text-anchor="end" font-family="monospace" font-size="16" font-weight="bold" fill="#0f172a">#${esc(orderNum)}</text>
  <text x="65" y="398" font-family="Arial, sans-serif" font-size="15" fill="#64748b">Reference No.</text>
  <text x="475" y="398" text-anchor="end" font-family="monospace" font-size="17" font-weight="bold" fill="#0057e7">${esc(refNum)}</text>
  <text x="65" y="444" font-family="Arial, sans-serif" font-size="15" fill="#64748b">Customer</text>
  <text x="475" y="444" text-anchor="end" font-family="Arial, sans-serif" font-size="15" font-weight="bold" fill="#0f172a">${esc(customerName)}</text>
  <text x="65" y="490" font-family="Arial, sans-serif" font-size="15" fill="#64748b">Payment Status</text>
  <text x="475" y="490" text-anchor="end" font-family="Arial, sans-serif" font-size="15" font-weight="bold" fill="#10b981">${esc(payStatus)}</text>
  <text x="65" y="536" font-family="Arial, sans-serif" font-size="15" fill="#64748b">Date &amp; Time</text>
  <text x="475" y="536" text-anchor="end" font-family="Arial, sans-serif" font-size="14" fill="#334155">${esc(dateStr)}</text>
  <rect x="60" y="574" width="420" height="72" rx="12" fill="#f8fafc" stroke="#e2e8f0"/>
  <text x="270" y="605" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" font-weight="bold" fill="#1e293b">Messenger Pay-First Verification Record</text>
  <text x="270" y="627" text-anchor="middle" font-family="monospace" font-size="11" fill="#64748b">${esc(filename)}</text>
</svg>`;

  res.setHeader('Content-Type', 'image/svg+xml');
  return res.status(200).send(receiptSvg);
});

// Serve static frontend assets with CORS and cache headers for Facebook crawler
app.use(express.static(path.join(__dirname, '../public'), {
  setHeaders: (res, filePath) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (/\.(jpg|jpeg|png|webp|gif|svg)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));

// Fallback recovery for /uploads/:filename if missing on ephemeral Render disk
app.get('/uploads/:filename', (req, res) => {
  const filePath = path.join(__dirname, '../public/uploads', req.params.filename);
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  // Graceful fallback: Redirect to reliable cafe beverage image to prevent broken icons on Facebook
  return res.redirect('https://images.unsplash.com/photo-1541167760496-1628856ab772?w=600&auto=format&fit=crop&q=80');
});

// Server-Sent Events (SSE) Live Broadcast Stream Endpoint
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send initial connected confirmation
  res.write(`event: CONNECTED\ndata: ${JSON.stringify({ message: 'Connected to Diner Cafe real-time stream', timestamp: new Date().toISOString() })}\n\n`);

  addSSEClient(res);

  // Keep-alive heartbeat every 25 seconds to prevent browser disconnects
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch (e) {
      clearInterval(heartbeat);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
  });
});

// Mount Routes
app.use('/', webhookRoutes);
app.use('/api', apiRoutes);

// GCash Clickable Redirect & Payment Screen (Issue 5)
app.get('/pay/gcash', (req, res) => {
  const amount = req.query.amount ? parseFloat(req.query.amount).toFixed(2) : '0.00';
  const gcashNo = config.store.gcashNumber || '0928 176 2895';
  const gcashName = config.store.gcashName || "Diner's Cafe Official";

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GCash Payment | Diner's Cafe</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: #0d0906; color: #f5ebe0; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: #1c140e; border: 1px solid #3d2b1f; border-radius: 20px; max-width: 420px; width: 100%; padding: 28px; text-align: center; box-shadow: 0 12px 36px rgba(0,0,0,0.6); }
    .logo { width: 64px; height: 64px; border-radius: 16px; background: #007dfe; display: inline-flex; align-items: center; justify-content: center; font-size: 32px; font-weight: 800; color: #fff; margin-bottom: 16px; }
    h2 { font-size: 1.4rem; color: #fff; margin-bottom: 6px; }
    p.sub { font-size: 0.9rem; color: #b5a497; margin-bottom: 24px; }
    .amount-box { background: rgba(0, 125, 254, 0.12); border: 1px solid #007dfe; border-radius: 14px; padding: 18px; margin-bottom: 22px; }
    .amount-label { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 1px; color: #70b4ff; margin-bottom: 4px; }
    .amount-val { font-size: 2.2rem; font-weight: 800; color: #fff; }
    .info-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #2b1f16; font-size: 0.95rem; }
    .info-label { color: #8e7a6c; }
    .info-val { color: #f5ebe0; font-weight: 600; display: flex; align-items: center; gap: 8px; }
    .btn-copy { background: #3d2b1f; border: none; color: #d4a373; padding: 4px 10px; border-radius: 8px; font-size: 0.8rem; cursor: pointer; }
    .btn-gcash { display: block; width: 100%; background: #007dfe; color: #fff; text-decoration: none; padding: 15px; border-radius: 14px; font-size: 1.05rem; font-weight: 700; margin-top: 24px; border: none; cursor: pointer; transition: background 0.2s; }
    .btn-gcash:hover { background: #0066d1; }
    .note { margin-top: 16px; font-size: 0.82rem; color: #8e7a6c; line-height: 1.4; }
  </style>
  <script>
    window.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        window.location.href = 'gcash://';
      }, 300);
    });

    function copyText(val, btnId) {
      navigator.clipboard.writeText(val).then(() => {
        const btn = document.getElementById(btnId);
        if (btn) {
          const orig = btn.innerText;
          btn.innerText = 'Copied!';
          setTimeout(() => btn.innerText = orig, 2000);
        }
      });
    }
  </script>
</head>
<body>
  <div class="card">
    <div class="logo">G</div>
    <h2>Diner's Cafe GCash Transfer</h2>
    <p class="sub">Magbayad gamit ang GCash App</p>

    <div class="amount-box">
      <div class="amount-label">Halagang Dapat I-transfer</div>
      <div class="amount-val">&#8369;${amount}</div>
    </div>

    <div class="info-row">
      <span class="info-label">GCash Account Name</span>
      <span class="info-val">${gcashName}</span>
    </div>
    <div class="info-row">
      <span class="info-label">GCash Mobile Number</span>
      <span class="info-val">
        <span>${gcashNo}</span>
        <button class="btn-copy" id="btnNum" onclick="copyText('${gcashNo}', 'btnNum')">Copy</button>
      </span>
    </div>

    <a href="gcash://" class="btn-gcash">&#128241; Open GCash App</a>

    <p class="note">Pagkatapos mag-transfer, bumalik po sa Facebook Messenger at i-reply ang amount o reference number ng iyong resibo para ma-verify agad ang order!</p>
  </div>
</body>
</html>`);
});

// Xendit Payment Return Screen
app.get('/payment/xendit/return', (req, res) => {
  const isSuccess = String(req.query.status || '').toLowerCase() !== 'failed';
  const rawOrder = String(req.query.order || '').replace(/[<>&"']/g, '');
  const title = isSuccess ? 'Payment Completed' : 'Payment Incomplete';
  const badgeColor = isSuccess ? '#22c55e' : '#ef4444';
  const icon = isSuccess ? '&#9989;' : '&#10060;';
  const message = isSuccess
    ? 'Matagumpay ang inyong online payment via Xendit! Paki-check ang Facebook Messenger para sa kumpirmasyon ng inyong order.'
    : 'Hindi nakumpleto ang inyong pagbabayad. Maaari kayong bumalik sa Facebook Messenger upang subukan muli.';

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | Diner's Cafe</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: #0d0906; color: #f5ebe0; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: #1c140e; border: 1px solid #3d2b1f; border-radius: 20px; max-width: 420px; width: 100%; padding: 28px; text-align: center; box-shadow: 0 12px 36px rgba(0,0,0,0.6); }
    .icon { font-size: 48px; margin-bottom: 12px; }
    h2 { font-size: 1.4rem; color: #fff; margin-bottom: 8px; }
    .order-tag { display: inline-block; background: rgba(255,255,255,0.06); border: 1px solid ${badgeColor}; color: ${badgeColor}; padding: 4px 12px; border-radius: 999px; font-size: 0.85rem; font-weight: 700; margin-bottom: 16px; }
    p { font-size: 0.95rem; color: #d5c5b8; line-height: 1.5; margin-bottom: 22px; }
    .btn { display: inline-block; background: #d4a373; color: #1c140e; text-decoration: none; padding: 12px 24px; border-radius: 12px; font-weight: 700; font-size: 0.95rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h2>${title}</h2>
    ${rawOrder ? `<div class="order-tag">Order #${rawOrder}</div>` : ''}
    <p>${message}</p>
    <a href="https://m.me" class="btn">Bumalik sa Messenger</a>
  </div>
</body>
</html>`);
});

// Health check endpoint for cloud hosting / Render
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Catch-all route to serve portal
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path === '/webhook' || req.path.startsWith('/pay')) {
    return next();
  }
  res.sendFile(path.join(__dirname, '../public/index.html'), (err) => {
    if (err) next(err);
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[Unhandled Server Error]', err);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

// Start Server
async function startServer() {
  if (!Number.isFinite(config.store.lat) || !Number.isFinite(config.store.lng)) {
    throw new Error('STORE_LAT and STORE_LNG must be set to enable delivery.');
  }

  if (config.nodeEnv === 'production' && config.jwtSecret === 'diners_cafe_super_secure_secret_key_2026_thesis') {
    console.warn('[Security Warning] JWT_SECRET is using the thesis placeholder secret.');
  }

  // Maps provider resolution & boot validation
  if (!config.maps.provider && !config.maps.googleKey) {
    console.warn('[Maps Warning] MAPS_PROVIDER is unset and no GOOGLE_MAPS_API_KEY found. Defaulting to mock provider.');
    config.maps.provider = 'mock';
  } else if ((config.maps.provider === 'google' || !config.maps.provider) && !config.maps.googleKey) {
    console.warn('[Maps Warning] Google Maps key not found. Defaulting to mock provider.');
    config.maps.provider = 'mock';
  }

  await initDatabase();
  const { startInactivityWorker } = require('./services/inactivityWorker');
  startInactivityWorker(60000);
  const { startStoreScheduleWorker } = require('./services/systemSettingsService');
  startStoreScheduleWorker(30000);

  // Keep Render service awake 24/7 by pinging /health every 8 minutes
  if (process.env.RENDER_EXTERNAL_URL || (config.appUrl && !config.appUrl.includes('localhost') && !config.appUrl.includes('ngrok'))) {
    const keepAliveUrl = `${(process.env.RENDER_EXTERNAL_URL || config.appUrl).replace(/\/+$/, '')}/health`;
    console.log(`[KeepAlive] Starting cloud keep-alive worker targeting ${keepAliveUrl} (every 8 mins)...`);
    const keepAliveTimer = setInterval(() => {
      fetch(keepAliveUrl)
        .then(r => console.log(`[KeepAlive] Pinged ${keepAliveUrl} (${r.status} ${r.statusText})`))
        .catch(err => console.warn(`[KeepAlive] Ping warning:`, err.message));
    }, 8 * 60 * 1000);
    if (keepAliveTimer.unref) keepAliveTimer.unref();
  }

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : (config.port || 10000);
  const host = '0.0.0.0';

  app.listen(port, host, () => {
    console.log(`================================================================`);
    console.log(`☕ Diner's Cafe Ordering & Delivery System is running on ${host}:${port}!`);
    console.log(`🌐 Application URL: ${config.appUrl || 'http://localhost:' + port}`);
    console.log(`📋 Admin Dashboard: /dashboard.html`);
    console.log(`🛵 Delivery Rider View: /rider.html`);
    console.log(`📍 Delivery Zone Checker: /delivery-check.html`);
    console.log(`🔗 Webhook Endpoint: /webhook`);
    console.log(`================================================================`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = app;
