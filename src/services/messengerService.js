/**
 * Facebook Messenger Platform API Service (FR2, FR3, FR5, FR7, FR11)
 * Connects to Facebook Graph Send API and provides rich conversational templates
 * (Quick replies, Generic Carousels, Action Buttons, and Receipt cards).
 */

const config = require('../config/config');
const { broadcastSSE } = require('./notificationService');

/**
 * Send an outbound message payload to Facebook Messenger Graph API
 * (and simultaneously stream to the web simulator for local testing)
 * 
 * @param {string} recipientPsid 
 * @param {Object} messagePayload 
 */
async function callSendAPI(recipientPsid, messagePayload) {
  const requestBody = {
    recipient: { id: recipientPsid },
    message: messagePayload,
    messaging_type: 'RESPONSE'
  };

  // Always broadcast to local interactive Web Simulator via SSE
  broadcastSSE('SIMULATOR_MESSAGE', {
    psid: recipientPsid,
    sender: 'bot',
    payload: requestBody,
    timestamp: new Date().toISOString()
  });

  // If live Facebook Page Access Token is configured, send to Meta Graph API
  if (config.facebook.pageAccessToken && config.facebook.pageAccessToken.startsWith('EAA')) {
    try {
      const response = await fetch(
        `https://graph.facebook.com/v19.0/me/messages?access_token=${encodeURIComponent(config.facebook.pageAccessToken)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        }
      );

      const data = await response.json();
      if (data.error) {
        console.error('[Facebook Graph API Error]', data.error);
      }
      return data;
    } catch (err) {
      console.error('[Facebook Graph API Request Failed]', err.message);
    }
  }

  return { recipient_id: recipientPsid, message_id: `mid.simulated.${Date.now()}` };
}

/**
 * Send plain text message
 */
async function sendTextMessage(psid, text) {
  return callSendAPI(psid, { text });
}

/**
 * Send message with Quick Reply buttons
 */
async function sendQuickReplies(psid, text, quickReplies = []) {
  const formattedReplies = quickReplies.map(qr => {
    if (typeof qr === 'string') {
      return {
        content_type: 'text',
        title: qr.length > 20 ? qr.substring(0, 20) : qr,
        payload: qr
      };
    }
    return {
      content_type: 'text',
      title: qr.title.length > 20 ? qr.title.substring(0, 20) : qr.title,
      payload: qr.payload || qr.title
    };
  });

  return callSendAPI(psid, {
    text,
    quick_replies: formattedReplies
  });
}

/**
 * Send Generic Template Carousel (Menu browsing / Best sellers)
 */
async function sendGenericTemplate(psid, elements = []) {
  return callSendAPI(psid, {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'generic',
        elements: elements.slice(0, 10) // Facebook limit 10 cards per carousel
      }
    }
  });
}

/**
 * Send Button Template
 */
async function sendButtonTemplate(psid, text, buttons = []) {
  return callSendAPI(psid, {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'button',
        text,
        buttons: buttons.slice(0, 3)
      }
    }
  });
}

/**
 * Send Post-Delivery Feedback Request Prompt (FR11)
 */
async function sendFeedbackPrompt(psid, orderNumber) {
  const text = `🎉 Order #${orderNumber} has been delivered!\n\nHow was your food and delivery experience with Diner's Cafe? Please rate us:`;
  const quickReplies = [
    { title: '⭐ 5 - Excellent', payload: `FEEDBACK_RATE_5_${orderNumber}` },
    { title: '⭐ 4 - Very Good', payload: `FEEDBACK_RATE_4_${orderNumber}` },
    { title: '⭐ 3 - Average', payload: `FEEDBACK_RATE_3_${orderNumber}` },
    { title: '⭐ 2 - Poor', payload: `FEEDBACK_RATE_2_${orderNumber}` },
    { title: '⭐ 1 - Terrible', payload: `FEEDBACK_RATE_1_${orderNumber}` }
  ];

  return sendQuickReplies(psid, text, quickReplies);
}

module.exports = {
  callSendAPI,
  sendTextMessage,
  sendQuickReplies,
  sendGenericTemplate,
  sendButtonTemplate,
  sendFeedbackPrompt
};
