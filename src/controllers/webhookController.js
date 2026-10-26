/**
 * Facebook Messenger Webhook Controller (FR2, FR3, FR5, FR7)
 * Handles webhook verification (GET) and incoming event payloads (POST).
 */

const config = require('../config/config');
const { handleMessageEvent } = require('../services/nlpEngine');

/**
 * Facebook Webhook Verification (GET /webhook)
 * Verifies hub.verify_token and returns hub.challenge to Meta
 */
function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  console.log(`[Webhook Handshake] Received GET /webhook from Meta: mode=${mode}, token=${token}`);

  if (mode && token) {
    if (mode === 'subscribe' && token === config.facebook.verifyToken) {
      console.log('[Webhook] Webhook successfully verified with Facebook challenge handshake.');
      return res.status(200).send(challenge);
    } else {
      console.warn(`[Webhook] Verification token mismatch! Expected "${config.facebook.verifyToken}", got "${token}"`);
      return res.sendStatus(403);
    }
  }

  res.sendStatus(400);
}

/**
 * Facebook Webhook Event Handler (POST /webhook)
 * Processes incoming Messenger messages, postbacks, and quick replies
 */
async function processWebhookEvents(req, res) {
  const body = req.body;
  console.log('[Webhook POST] Incoming payload received from Meta:', JSON.stringify(body, null, 2));

  if (body.object === 'page') {
    // Acknowledge receipt to Facebook within 20 seconds
    res.status(200).send('EVENT_RECEIVED');

    for (const entry of body.entry) {
      const webhookEvent = entry.messaging ? entry.messaging[0] : null;
      if (!webhookEvent) continue;

      const senderPsid = webhookEvent.sender ? webhookEvent.sender.id : null;
      if (!senderPsid) continue;

      if (webhookEvent.message) {
        const message = webhookEvent.message;
        if (message.attachments?.[0]?.type === 'location') {
          const coords = message.attachments[0].payload?.coordinates;
          const lat = coords ? coords.lat : null;
          const lng = coords ? coords.long : null;
          await handleMessageEvent(senderPsid, '', null, { lat, lng });
        } else if (message.quick_reply) {
          // User clicked a Quick Reply button
          await handleMessageEvent(senderPsid, message.text, message.quick_reply.payload);
        } else if (message.text) {
          // User typed text
          await handleMessageEvent(senderPsid, message.text, null);
        }
      } else if (webhookEvent.postback) {
        // User clicked a Card Postback button
        const postback = webhookEvent.postback;
        await handleMessageEvent(senderPsid, postback.title, postback.payload);
      }
    }
  } else {
    res.sendStatus(404);
  }
}

module.exports = {
  verifyWebhook,
  processWebhookEvents
};
