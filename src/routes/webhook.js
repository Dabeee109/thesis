const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

// Standardized API Webhook Endpoints (/api/webhook) for Cloudflare Tunnel & Messaging Platforms
router.get('/api/webhook', webhookController.verifyWebhook);
router.post('/api/webhook', webhookController.verifyWebhookSignature, webhookController.processWebhookEvents);

// Legacy / Root Facebook Messenger Webhook Endpoints (/webhook) for backward compatibility
router.get('/webhook', webhookController.verifyWebhook);
router.post('/webhook', webhookController.verifyWebhookSignature, webhookController.processWebhookEvents);

// GCash App Deep Link Redirect Endpoint
router.get('/pay/gcash', webhookController.gcashRedirect);

// GCash App Online Payment Confirmation Endpoint
router.post('/pay/gcash/confirm', webhookController.confirmGcashPayment);

module.exports = router;
