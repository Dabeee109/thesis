/**
 * Facebook Messenger Platform API Service (Task 9)
 * Connects to Facebook Graph Send API and provides rich conversational templates
 * (Quick replies, Generic Carousels, Action Buttons).
 */

const fs = require('fs');
const path = require('path');
const config = require('../config/config');
const { broadcastSSE } = require('./notificationService');

// In-memory cache for uploaded attachment IDs: { [cacheKey]: { attachmentId, timestamp } }
const attachmentCache = new Map();

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
    formatted = formatted.replace(/\s*(Phone(?:\s*Number)?\s*:)/gi, '\nPhone number:');
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
  const { messagingType = 'RESPONSE', tag, throwOnError = false } = options;
  const psidStr = String(recipientPsid);
  const requestBody = {
    recipient: { id: psidStr },
    message: messagePayload,
    messaging_type: messagingType
  };
  if (tag) {
    requestBody.tag = tag;
  }

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
        if (data.error.code === 10) {
          console.warn(`[Facebook Send API] Recipient ${psidStr} is outside the standard 24-hour messaging window.`);
        } else {
          console.error('[Facebook Graph API Error]', data.error.code, data.error.message);
        }

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
  const text = "Natanggap niyo na po ba ang inyong order? Maraming salamat po sa pag-tangkilik sa Diner's Cafe! Pa-rate naman po ng inyong experience from 1 to 5 stars at pa-share ng inyong feedback para mapaganda pa ang aming serbisyo.";

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
 * Upload an attachment (image poster, banner, etc.) to Facebook Graph API
 * via POST /me/message_attachments using native FormData
 * 
 * Returns attachment_id string on success, or null on failure.
 */
async function uploadAttachment(fileSource, type = 'image') {
  const pageToken = config.facebook?.pageAccessToken;
  if (!pageToken || !pageToken.startsWith('EAA')) {
    return null;
  }

  try {
    let buffer;
    let filename = 'attachment.jpg';
    let mimeType = 'image/jpeg';
    let cacheKey = null;

    if (Buffer.isBuffer(fileSource)) {
      buffer = fileSource;
      cacheKey = `buffer_${buffer.length}_${buffer.slice(0, 32).toString('hex')}`;
    } else if (typeof fileSource === 'string') {
      if (fileSource.startsWith('data:image/')) {
        const matches = fileSource.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
        if (matches) {
          const ext = matches[1].includes('png') ? 'png' : (matches[1].includes('webp') ? 'webp' : 'jpg');
          mimeType = `image/${matches[1]}`;
          filename = `image.${ext}`;
          buffer = Buffer.from(matches[2], 'base64');
          cacheKey = `datauri_${buffer.length}_${buffer.slice(0, 32).toString('hex')}`;
        }
      } else {
        // Local relative path (e.g. /uploads/promotions/...) or absolute path
        let resolvedPath = fileSource;
        if (resolvedPath.startsWith('/uploads/') || resolvedPath.startsWith('\\uploads\\') || resolvedPath.startsWith('uploads/')) {
          const cleanRel = resolvedPath.replace(/^[\/\\]+/, '');
          resolvedPath = path.join(__dirname, '../../public', cleanRel);
        } else if (!fs.existsSync(resolvedPath)) {
          // Check if it's relative to public directory
          const inPublic = path.join(__dirname, '../../public', resolvedPath.replace(/^[\/\\]+/, ''));
          if (fs.existsSync(inPublic)) {
            resolvedPath = inPublic;
          }
        }

        if (fs.existsSync(resolvedPath)) {
          buffer = fs.readFileSync(resolvedPath);
          filename = path.basename(resolvedPath);
          const ext = path.extname(resolvedPath).toLowerCase();
          mimeType = ext === '.png' ? 'image/png' : (ext === '.webp' ? 'image/webp' : 'image/jpeg');
          cacheKey = `file_${resolvedPath}_${fs.statSync(resolvedPath).mtimeMs}`;
        }
      }
    }

    if (!buffer) {
      return null;
    }

    // Check memory cache
    if (cacheKey && attachmentCache.has(cacheKey)) {
      const cached = attachmentCache.get(cacheKey);
      if (Date.now() - cached.timestamp < 3 * 24 * 60 * 60 * 1000) {
        return cached.attachmentId;
      }
    }

    const blob = new Blob([buffer], { type: mimeType });
    const formData = new FormData();
    formData.append('message', JSON.stringify({
      attachment: {
        type: type,
        payload: { is_reusable: true }
      }
    }));
    formData.append('filedata', blob, filename);

    const response = await fetch(
      `https://graph.facebook.com/v19.0/me/message_attachments?access_token=${encodeURIComponent(pageToken)}`,
      {
        method: 'POST',
        body: formData
      }
    );

    const data = await response.json();
    if (data.error) {
      console.error('[Facebook Upload Attachment Error]', data.error.code, data.error.message);
      return null;
    }

    if (data.attachment_id) {
      if (cacheKey) {
        attachmentCache.set(cacheKey, {
          attachmentId: data.attachment_id,
          timestamp: Date.now()
        });
      }
      return data.attachment_id;
    }

    return null;
  } catch (err) {
    console.error('[Facebook Upload Attachment Exception]', err.message);
    return null;
  }
}

/**
 * Send an image attachment
 * Supports:
 * 1. attachment_id (numeric string or object { attachment_id })
 * 2. local file path (/uploads/promotions/xxx.jpg) -> auto-uploads to get attachment_id
 * 3. data URI (data:image/...) -> auto-uploads to get attachment_id
 * 4. public HTTP/HTTPS URL -> sends via payload.url
 */
async function sendImageAttachment(psid, imageSource, options = {}) {
  let attachmentId = null;
  let imageUrl = null;

  if (typeof imageSource === 'object' && imageSource !== null && imageSource.attachment_id) {
    attachmentId = imageSource.attachment_id;
  } else if (typeof imageSource === 'string') {
    if (/^\d+$/.test(imageSource.trim())) {
      attachmentId = imageSource.trim();
    } else if (imageSource.startsWith('data:image/') || imageSource.startsWith('/uploads/') || imageSource.startsWith('uploads/') || !imageSource.startsWith('http')) {
      // It's a local file or data URI: try uploading directly to Meta
      attachmentId = await uploadAttachment(imageSource, 'image');
      if (!attachmentId && !imageSource.startsWith('data:image/')) {
        const baseUrl = (config.appUrl || 'http://localhost:3000').replace(/\/+$/, '');
        const cleanPath = imageSource.startsWith('/') ? imageSource : `/${imageSource}`;
        imageUrl = `${baseUrl}${cleanPath}`;
      }
    } else {
      // Remote HTTP/HTTPS URL
      imageUrl = imageSource;
    }
  }

  if (attachmentId) {
    return module.exports.callSendAPI(psid, {
      attachment: {
        type: 'image',
        payload: {
          attachment_id: attachmentId
        }
      }
    }, options);
  }

  if (imageUrl) {
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

  console.warn('[Messenger Send Image] Could not resolve imageSource into attachment_id or valid URL.');
  return null;
}

module.exports = {
  callSendAPI,
  formatOrderSummaryReceipt,
  sendTextMessage,
  sendImageAttachment,
  uploadAttachment,
  sendQuickReplies,
  sendGenericTemplate,
  sendButtonTemplate,
  sendFeedbackPrompt
};
