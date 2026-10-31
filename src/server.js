/**
 * Diner's Cafe Ordering & Delivery System - Server Bootstrap
 */

const config = require('./config/config');
process.env.TZ = config.timezone || 'Asia/Manila';

const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('../database/db');
const { addSSEClient, broadcastSSE } = require('./services/notificationService');

const webhookRoutes = require('./routes/webhook');
const apiRoutes = require('./routes/api');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static frontend assets
app.use(express.static(path.join(__dirname, '../public')));

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

// Catch-all route to serve portal
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path === '/webhook' || req.path.startsWith('/pay')) {
    return next();
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
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
    throw new Error('JWT_SECRET must be set to a secure secret in production.');
  }

  // Maps provider resolution & boot validation
  if (!config.maps.provider && !config.maps.googleKey) {
    if (config.nodeEnv === 'production') {
      throw new Error('GOOGLE_MAPS_API_KEY is required in production.');
    } else {
      console.warn('[Maps Warning] MAPS_PROVIDER is unset and no GOOGLE_MAPS_API_KEY found. Defaulting to mock provider for development.');
    }
  } else if ((config.maps.provider === 'google' || !config.maps.provider) && !config.maps.googleKey && config.nodeEnv === 'production') {
    throw new Error('GOOGLE_MAPS_API_KEY is required in production.');
  }

  await initDatabase();

  app.listen(config.port, () => {
    console.log(`================================================================`);
    console.log(`☕ Diner's Cafe Ordering & Delivery System is running!`);
    console.log(`🌐 Application URL: ${config.appUrl}`);
    console.log(`📋 Admin Dashboard: ${config.appUrl}/dashboard.html`);
    console.log(`🛵 Delivery Rider View: ${config.appUrl}/rider.html`);
    console.log(`💬 Messenger Simulator: ${config.appUrl}/simulator.html`);
    console.log(`🔗 Webhook Endpoint: ${config.appUrl}/webhook`);
    console.log(`================================================================`);
  });
}

startServer();

module.exports = app;
