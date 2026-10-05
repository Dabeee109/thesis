/**
 * Facebook Messenger Platform API Service (FR2, FR3, FR5, FR7, FR11)
 * Connects to Facebook Graph Send API and provides rich conversational templates
 * (Quick replies, Generic Carousels, Action Buttons, and Receipt cards).
 */

const config = require('../config/config');
const { broadcastSSE } = require('./notificationService');

/**
 * Remove emojis and decorative icons from messages and buttons
 */
function stripIcons(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{2B55}\u{200D}\u{FE0F}\u{FE0E}]/gu, '')
    .replace(/[❌✅☕🥐🍝🍳⭐🌟🛒🛵🛍️🗑️➕➖ℹ️❤️📶💳💵📱👋🎉⏸️⏳⚠️😋]/g, '')
    .replace(/^[ \t\r\n\-\•]+/gm, (match) => match.includes('•') ? '• ' : '')
    .replace(/[ ]{2,}/g, ' ')
    .trim();
}

/**
 * Send an outbound message payload to Facebook Messenger Graph API
 * (and simultaneously stream to the web simulator for local testing)
 * 
 * @param {string} recipientPsid 
 * @param {Object} messagePayload 
 */
async function callSendAPI(recipientPsid, messagePayload) {
  const psidStr = String(recipientPsid);
  const requestBody = {
    recipient: { id: psidStr },
    message: messagePayload,
    messaging_type: 'RESPONSE'
  };

  // Always broadcast to local interactive Web Simulator via SSE
  broadcastSSE('SIMULATOR_MESSAGE', {
    psid: psidStr,
    sender: 'bot',
    payload: requestBody,
    timestamp: new Date().toISOString()
  });

  // If live Facebook Page Access Token is configured and PSID is a real Facebook user ID (numeric string)
  const isRealFacebookUser = /^\d+$/.test(psidStr);
  if (isRealFacebookUser && config.facebook.pageAccessToken && config.facebook.pageAccessToken.startsWith('EAA')) {
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

  return { recipient_id: psidStr, message_id: `mid.simulated.${Date.now()}` };
}

/**
 * Send plain text message
 */
async function sendTextMessage(psid, text) {
  return callSendAPI(psid, { text: stripIcons(text) });
}

/**
 * Send message with Quick Reply buttons
 */
async function sendQuickReplies(psid, text, quickReplies = []) {
  const formattedReplies = quickReplies.map(qr => {
    const rawTitle = typeof qr === 'string' ? qr : qr.title;
    const cleanTitle = stripIcons(rawTitle);
    const title = cleanTitle.length > 20 ? cleanTitle.substring(0, 20) : cleanTitle || 'Option';
    const payload = typeof qr === 'string' ? qr : (qr.payload || qr.title);

    return {
      content_type: 'text',
      title,
      payload
    };
  });

  return callSendAPI(psid, {
    text: stripIcons(text),
    quick_replies: formattedReplies
  });
}

/**
 * Send Generic Template Carousel (Menu browsing / Best sellers)
 */
async function sendGenericTemplate(psid, elements = []) {
  const cleanedElements = elements.slice(0, 10).map(el => ({
    ...el,
    title: stripIcons(el.title),
    subtitle: stripIcons(el.subtitle),
    buttons: (el.buttons || []).map(b => ({
      ...b,
      title: stripIcons(b.title)
    }))
  }));

  return callSendAPI(psid, {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'generic',
        elements: cleanedElements
      }
    }
  });
}

/**
 * Send Button Template
 */
async function sendButtonTemplate(psid, text, buttons = []) {
  const cleanedButtons = buttons.slice(0, 3).map(b => ({
    ...b,
    title: stripIcons(b.title)
  }));

  return callSendAPI(psid, {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'button',
        text: stripIcons(text),
        buttons: cleanedButtons
      }
    }
  });
}

/**
 * Send Post-Delivery Feedback Request Prompt (FR11)
 */
async function sendFeedbackPrompt(psid, orderNumber) {
  const text = `Order #${orderNumber} has been delivered!\n\nHow was your food and delivery experience with Diner's Cafe? Please rate us:`;
  const quickReplies = [
    { title: '5 - Excellent', payload: `FEEDBACK_RATE_5_${orderNumber}` },
    { title: '4 - Very Good', payload: `FEEDBACK_RATE_4_${orderNumber}` },
    { title: '3 - Average', payload: `FEEDBACK_RATE_3_${orderNumber}` },
    { title: '2 - Poor', payload: `FEEDBACK_RATE_2_${orderNumber}` },
    { title: '1 - Terrible', payload: `FEEDBACK_RATE_1_${orderNumber}` }
  ];

  return sendQuickReplies(psid, text, quickReplies);
}

module.exports = {
  stripIcons,
  callSendAPI,
  sendTextMessage,
  sendQuickReplies,
  sendGenericTemplate,
  sendButtonTemplate,
  sendFeedbackPrompt
};
