/**
 * Diner's Cafe Ordering & Delivery System - Server Bootstrap
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config/config');
const { initDatabase } = require('../database/db');
const { addSSEClient, broadcastSSE } = require('./services/notificationService');

const webhookRoutes = require('./routes/webhook');
const apiRoutes = require('./routes/api');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
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
  if (req.path.startsWith('/api') || req.path === '/webhook') {
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
