const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

// Facebook Messenger Webhook verification endpoint (handshake)
router.get('/webhook', webhookController.verifyWebhook);

// Facebook Messenger Webhook incoming event processor
router.post('/webhook', webhookController.processWebhookEvents);

module.exports = router;
