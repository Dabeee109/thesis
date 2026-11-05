/**
 * Facebook Messenger Platform API Service (Task 9)
 * Connects to Facebook Graph Send API and provides rich conversational templates
 * (Quick replies, Generic Carousels, Action Buttons).
 */

const config = require('../config/config');
const { broadcastSSE } = require('./notificationService');

/**
 * Format order summary receipts into distinct lines if received squashed
 */
function formatOrderSummaryReceipt(text) {
  if (!text || typeof text !== 'string') return text;

  if (
    /summary\s+ng\s+(?:inyong\s+)?order/i.test(text) ||
    (/\bName\s*:/i.test(text) && /\bLocation\s*:/i.test(text) && /\bTotal\s*:/i.test(text)) ||
    (/\bName\s*:/i.test(text) && /\bOrder\s*:/i.test(text) && /\bTotal\s*:/i.test(text))
  ) {
    let formatted = text.trim();

    // 1. Protect and separate introductory sentence
    formatted = formatted.replace(
      /(Eto po ang summary ng inyong order:?)\s*/i,
      '__INTRO_RECEIPT__\n'
    );

    // 2. Separate each key field onto its own line
    formatted = formatted.replace(/\s*(Name\s*:)/gi, '\n$1');
    formatted = formatted.replace(/\s*(Location\s*:)/gi, '\n$1');
    formatted = formatted.replace(/\s*(Payment option\s*:)/gi, '\n$1');
    formatted = formatted.replace(/\s*(Dining mode\s*:)/gi, '\n$1');
    formatted = formatted.replace(/\s*(Discount\s*:)/gi, '\n$1');
    formatted = formatted.replace(/\s*(Order\s*:)/gi, '\n$1');

    // In case items are squashed onto a single line like: Order: - 1x item1 - 2x item2
    formatted = formatted.replace(/((?:Order:|-\s*\d+x[^\n]+))\s+([-\u2022*]\s*\d+x\s+)/gi, '$1\n$2');

    formatted = formatted.replace(/\s*(Total\s*:)/gi, '\n$1');
    formatted = formatted.replace(/\s*(Tama po ba (?:lahat ng )?details\?)/gi, '\n\n$1');

    // Restore protected intro
    formatted = formatted.replace('__INTRO_RECEIPT__', 'Eto po ang summary ng inyong order:');

    // 3. Normalize newlines
    formatted = formatted
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n');

    return formatted;
  }

  return text;
}

/**
 * Clean redundant horizontal whitespace from text while preserving newlines and emojis
 */
function cleanText(str) {
  if (!str || typeof str !== 'string') return '';
  const formatted = formatOrderSummaryReceipt(str);
  return formatted.replace(/[^\S\r\n]{2,}/g, ' ').trim();
}

/**
 * Send an outbound message payload to Facebook Messenger Graph API
 * (and simultaneously stream to the web simulator for local testing)
 * 
 * @param {string} recipientPsid 
 * @param {Object} messagePayload 
 * @param {Object} options { messagingType = 'RESPONSE', throwOnError = false }
 */
async function callSendAPI(recipientPsid, messagePayload, options = {}) {
  const { messagingType = 'RESPONSE', throwOnError = false } = options;
  const psidStr = String(recipientPsid);
  const requestBody = {
    recipient: { id: psidStr },
    message: messagePayload,
    messaging_type: messagingType
  };

  // Always broadcast to local interactive Web Simulator via SSE
  broadcastSSE('SIMULATOR_MESSAGE', {
    psid: psidStr,
    sender: 'bot',
    payload: requestBody,
    timestamp: new Date().toISOString()
  });

  const isRealFacebookUser = /^\d+$/.test(psidStr);
  const pageToken = config.facebook?.pageAccessToken;

  if (isRealFacebookUser && pageToken && pageToken.startsWith('EAA')) {
    try {
      const response = await fetch(
        `https://graph.facebook.com/v19.0/me/messages?access_token=${encodeURIComponent(pageToken)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        }
      );

      const data = await response.json();
      if (data.error) {
        console.error('[Facebook Graph API Error]', data.error.code, data.error.message);
        if (throwOnError) {
          const err = new Error(data.error.message || 'Facebook Graph API error');
          err.code = data.error.code || 'GRAPH_API_ERROR';
          throw err;
        }
      }
      return data;
    } catch (err) {
      if (throwOnError) {
        const sanitizedErr = new Error(err.message?.replace(/access_token=[^&]*/gi, 'access_token=REDACTED') || 'Facebook API Request Failed');
        sanitizedErr.code = err.code || 'GRAPH_REQUEST_FAILED';
        throw sanitizedErr;
      }
      console.error('[Facebook Graph API Request Failed]', err.code || err.message);
    }
  }

  // Simulator or non-page-token mode: success
  return { recipient_id: psidStr, message_id: `mid.simulated.${Date.now()}` };
}

/**
 * Send plain text message
 */
async function sendTextMessage(psid, text, options = {}) {
  return module.exports.callSendAPI(psid, { text: cleanText(text) }, options);
}

/**
 * Send message with Quick Reply buttons
 */
async function sendQuickReplies(psid, text, quickReplies = [], options = {}) {
  const formattedReplies = quickReplies.slice(0, 13).map(qr => {
    if (qr && qr.content_type === 'location') {
      return { content_type: 'location' };
    }
    const rawTitle = typeof qr === 'string' ? qr : qr.title;
    const title = String(rawTitle).substring(0, 20);
    const payload = typeof qr === 'string' ? qr : (qr.payload || qr.title);

    return {
      content_type: 'text',
      title,
      payload
    };
  });

  return module.exports.callSendAPI(psid, {
    text: cleanText(text),
    quick_replies: formattedReplies
  }, options);
}

/**
 * Send Generic Template Carousel (Menu browsing / Best sellers)
 */
async function sendGenericTemplate(psid, elements = [], options = {}) {
  const cleanedElements = elements.slice(0, 10).map(el => ({
    ...el,
    title: String(el.title || '').substring(0, 80),
    subtitle: String(el.subtitle || '').substring(0, 80),
    buttons: (el.buttons || []).slice(0, 3).map(b => ({
      ...b,
      title: String(b.title || '').substring(0, 20)
    }))
  }));

  const payload = {
    template_type: 'generic',
    elements: cleanedElements
  };

  const imageAspectRatio = typeof options === 'string'
    ? options
    : (options?.image_aspect_ratio || options?.imageAspectRatio);

  if (imageAspectRatio) {
    payload.image_aspect_ratio = imageAspectRatio;
  }

  return module.exports.callSendAPI(psid, {
    attachment: {
      type: 'template',
      payload
    }
  }, options);
}

/**
 * Send Button Template
 */
async function sendButtonTemplate(psid, text, buttons = [], options = {}) {
  const cleanedButtons = buttons.slice(0, 3).map(b => ({
    ...b,
    title: String(b.title || '').substring(0, 20)
  }));

  return module.exports.callSendAPI(psid, {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'button',
        text: cleanText(text),
        buttons: cleanedButtons
      }
    }
  }, options);
}

/**
 * Send Post-Delivery Feedback Request Prompt (Task 9)
 */
async function sendFeedbackPrompt(psid, orderNumber, orderType = 'delivery') {
  const isPickup = orderType === 'pickup';
  const text = isPickup
    ? 'Thanks for picking up! How was your experience today?'
    : 'Your order has been delivered! How was your experience today?';

  const quickReplies = [
    { title: '5 ⭐', payload: `FEEDBACK_RATE_5_${orderNumber}` },
    { title: '4 ⭐', payload: `FEEDBACK_RATE_4_${orderNumber}` },
    { title: '3 ⭐', payload: `FEEDBACK_RATE_3_${orderNumber}` },
    { title: '2 ⭐', payload: `FEEDBACK_RATE_2_${orderNumber}` },
    { title: '1 ⭐', payload: `FEEDBACK_RATE_1_${orderNumber}` }
  ];

  return sendQuickReplies(psid, text, quickReplies, {
    messagingType: 'UPDATE',
    throwOnError: true
  });
}

/**
 * Send an image attachment
 */
async function sendImageAttachment(psid, imageUrl, options = {}) {
  return module.exports.callSendAPI(psid, {
    attachment: {
      type: 'image',
      payload: {
        url: imageUrl,
        is_reusable: true
      }
    }
  }, options);
}

module.exports = {
  callSendAPI,
  formatOrderSummaryReceipt,
  sendTextMessage,
  sendImageAttachment,
  sendQuickReplies,
  sendGenericTemplate,
  sendButtonTemplate,
  sendFeedbackPrompt
};
