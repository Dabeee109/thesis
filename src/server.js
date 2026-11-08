/**
 * Diner's Cafe Ordering & Delivery System - Server Bootstrap
 */

const config = require('./config/config');
process.env.TZ = config.timezone || 'Asia/Manila';

const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const { initDatabase } = require('../database/db');
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
app.get(['/rider-portal.html', '/rider-portal'], (req, res) => {
  res.sendFile(path.join(__dirname, '../public/rider.html'));
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
