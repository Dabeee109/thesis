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

// ----------------------------------------------------------------------------
// Reliable Food & Beverage Fallback Images for Messenger Platform
// ----------------------------------------------------------------------------

const FALLBACK_MENU_IMAGES = {
  // Specific item signatures
  'biscoff cheesecake': 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?w=600&auto=format&fit=crop&q=80',
  'choco java chips': 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?w=600&auto=format&fit=crop&q=80',
  "diner's signature drink": 'https://images.unsplash.com/photo-1517256064527-09c73fc73e38?w=600&auto=format&fit=crop&q=80',
  'oreo blast': 'https://images.unsplash.com/photo-1582293041079-7814c2f12063?w=600&auto=format&fit=crop&q=80',
  'two two': 'https://images.unsplash.com/photo-1579954115545-a95591f28bfc?w=600&auto=format&fit=crop&q=80',
  'purple alcapone': 'https://images.unsplash.com/photo-1541167760496-1628856ab772?w=600&auto=format&fit=crop&q=80',
  'strawberries & cream': 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?w=600&auto=format&fit=crop&q=80',
  'blueberries & cream': 'https://images.unsplash.com/photo-1570696516188-ade861b84a49?w=600&auto=format&fit=crop&q=80',
  'caramel macchiato': 'https://images.unsplash.com/photo-1485808191679-5f86510681a2?w=600&auto=format&fit=crop&q=80',

  // Beverage Category signatures
  'drinks & milktea': 'https://images.unsplash.com/photo-1525385133512-2f3bdd039054?w=600&auto=format&fit=crop&q=80',
  'milktea': 'https://images.unsplash.com/photo-1525385133512-2f3bdd039054?w=600&auto=format&fit=crop&q=80',
  'fruit tea': 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=600&auto=format&fit=crop&q=80',
  'yakult': 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=600&auto=format&fit=crop&q=80',

  // Food Category signatures
  'burgers & sandwiches': 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&auto=format&fit=crop&q=80',
  'starters & fries': 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=600&auto=format&fit=crop&q=80',
  'pizza & flat bread': 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600&auto=format&fit=crop&q=80',
  'meals & steaks': 'https://images.unsplash.com/photo-1544025162-d76694265947?w=600&auto=format&fit=crop&q=80',
  'pasta & platters': 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?w=600&auto=format&fit=crop&q=80',
  'chicken wings & boneless': 'https://images.unsplash.com/photo-1567620832903-9fc6debc209f?w=600&auto=format&fit=crop&q=80',
  'add-ons': 'https://images.unsplash.com/photo-1525385133512-2f3bdd039054?w=600&auto=format&fit=crop&q=80',

  // Universal Default (clean cafe espresso cup matching admin default)
  'default': 'https://images.unsplash.com/photo-1541167760496-1628856ab772?w=600&auto=format&fit=crop&q=80'
};

/**
 * Returns a high-resolution, secure fallback image URL matched by item name or category
 */
function getFallbackFoodImageUrl(meta = {}) {
  const name = String(meta.name || meta.title || '').toLowerCase().trim();
  const category = String(meta.category || meta.category_name || meta.subtitle || '').toLowerCase().trim();

  // 1. Direct name match or exact item match
  for (const [key, url] of Object.entries(FALLBACK_MENU_IMAGES)) {
    if (key !== 'default' && (name === key || (name.length > 3 && name.includes(key)))) {
      return url;
    }
  }

  // 2. Keyword match in name
  if (name.includes('cheesecake') || name.includes('biscoff')) {
    return FALLBACK_MENU_IMAGES['biscoff cheesecake'];
  }
  if (name.includes('blueberries') || name.includes('blueberry')) {
    return FALLBACK_MENU_IMAGES['blueberries & cream'];
  }
  if (name.includes('strawberries') || name.includes('strawberry')) {
    return FALLBACK_MENU_IMAGES['strawberries & cream'];
  }
  if (name.includes('macchiato') || name.includes('caramel')) {
    return FALLBACK_MENU_IMAGES['caramel macchiato'];
  }
  if (name.includes('yakult') || name.includes('fruit tea')) {
    return FALLBACK_MENU_IMAGES['fruit tea'];
  }
  if (name.includes('milktea') || name.includes('milk tea')) {
    return FALLBACK_MENU_IMAGES['milktea'];
  }
  if (name.includes('burger') || name.includes('sandwich') || name.includes('dog')) {
    return FALLBACK_MENU_IMAGES['burgers & sandwiches'];
  }
  if (name.includes('pizza') || name.includes('flat bread')) {
    return FALLBACK_MENU_IMAGES['pizza & flat bread'];
  }
  if (name.includes('wing') || name.includes('wings') || name.includes('chicken') || name.includes('sisig')) {
    return FALLBACK_MENU_IMAGES['chicken wings & boneless'];
  }
  if (name.includes('fries') || name.includes('nachos') || name.includes('starter') || name.includes('nugget') || name.includes('quesadilla') || name.includes('stick')) {
    return FALLBACK_MENU_IMAGES['starters & fries'];
  }
  if (name.includes('pasta') || name.includes('spaghetti') || name.includes('carbonara') || name.includes('lasagna') || name.includes('macaroni') || name.includes('platter')) {
    return FALLBACK_MENU_IMAGES['pasta & platters'];
  }
  if (name.includes('steak') || name.includes('meal') || name.includes('rice') || name.includes('cheelog') || name.includes('ribs') || name.includes('bowl') || name.includes('lunch pack')) {
    return FALLBACK_MENU_IMAGES['meals & steaks'];
  }
  if (name.includes('tea') || name.includes('coffee') || name.includes('drink') || name.includes('brew')) {
    return FALLBACK_MENU_IMAGES['drinks & milktea'];
  }

  // 3. Category match
  for (const [key, url] of Object.entries(FALLBACK_MENU_IMAGES)) {
    if (key !== 'default' && category.includes(key)) {
      return url;
    }
  }

  return FALLBACK_MENU_IMAGES['default'];
}

/**
 * Resolves any item image URL into a verified, secure URL for Facebook Messenger or Webhook Simulator.
 * Protects against relative paths (/uploads/...), empty/null values, and ngrok-free interstitial blocks.
 */
function resolveMessengerImageUrl(rawUrl, meta = {}, options = {}) {
  const isSimulator = !!(options.isSimulator || meta.isSimulator || (typeof meta.psid === 'string' && meta.psid.startsWith('sim_')));
  const fallback = getFallbackFoodImageUrl(meta);

  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim() || rawUrl.trim() === 'null') {
    return fallback;
  }

  let url = rawUrl.trim();

  // If in simulator mode (browser running on user machine):
  // Preserve uploaded / local images exactly as they are so the simulator displays the exact Menu Catalog picture!
  if (isSimulator) {
    if (url.startsWith('/')) {
      return url;
    }
    return url;
  }

  // If already a valid public HTTPS URL (e.g. Unsplash, Imgur, Cloudinary, AWS S3, etc.)
  if (url.startsWith('https://')) {
    // If it points to ngrok-free or localhost, external crawlers/mobile clients cannot render it
    // because ngrok-free intercepts with ERR_NGROK_6024 HTML warning page.
    if (url.includes('ngrok-free.dev') || url.includes('ngrok-free.app') || url.includes('localhost') || url.includes('127.0.0.1')) {
      return fallback;
    }
    return url;
  }

  // If HTTP, check domain
  if (url.startsWith('http://')) {
    if (url.includes('localhost') || url.includes('127.0.0.1') || url.includes('ngrok-free.dev') || url.includes('ngrok-free.app')) {
      return fallback;
    }
    // Upgrade to HTTPS for standard public hosts
    return url.replace(/^http:\/\//i, 'https://');
  }

  // If relative path (e.g. /uploads/...)
  const baseAppUrl = (config.appUrl || process.env.RENDER_EXTERNAL_URL || (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : '') || '').trim().replace(/\/+$/, '');
  if (baseAppUrl) {
    let absolute = url.startsWith('/') ? `${baseAppUrl}${url}` : `${baseAppUrl}/${url}`;
    // If appUrl is ngrok-free or localhost, Facebook Messenger client cannot fetch it without receiving HTML warning
    if (absolute.includes('ngrok-free.dev') || absolute.includes('ngrok-free.app') || absolute.includes('localhost') || absolute.includes('127.0.0.1')) {
      return fallback;
    }
    // Ensure https
    if (absolute.startsWith('http://')) {
      absolute = absolute.replace(/^http:\/\//i, 'https://');
    }
    return absolute;
  }

  return fallback;
}

/**
 * Send Generic Template Carousel (Menu browsing / Best sellers)
 */
async function sendGenericTemplate(psid, elements = [], options = {}) {
  const isSimulator = !!(options.isSimulator || (typeof psid === 'string' && psid.startsWith('sim_')));
  const cleanedElements = elements.slice(0, 10).map(el => {
    const finalImageUrl = resolveMessengerImageUrl(el.image_url, {
      name: el.title,
      category: el.subtitle,
      title: el.title,
      subtitle: el.subtitle,
      psid,
      isSimulator
    }, { isSimulator });

    return {
      ...el,
      title: String(el.title || '').substring(0, 80),
      subtitle: String(el.subtitle || '').substring(0, 80),
      image_url: finalImageUrl,
      buttons: (el.buttons || []).slice(0, 3).map(b => ({
        ...b,
        title: String(b.title || '').substring(0, 20)
      }))
    };
  });

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
  sendFeedbackPrompt,
  resolveMessengerImageUrl,
  getFallbackFoodImageUrl,
  FALLBACK_MENU_IMAGES
};
