/**
 * Diner's Cafe Conversational AI Service (@google/genai)
 *
 * Implements RAG-Lite TiDB/SQLite operational context injection, rolling
 * per-PSID conversation memory (last 6-8 turns), courteous Taglish persona
 * with open-domain banter + smooth cafe segues, and strict structured JSON
 * action routing using Current SDK (@google/genai Interactions API).
 *
 * Note: Uses `gemini-3.8-flash` as the current Flash model (superseding
 * deprecated `gemini-2.5-flash`), with resilient fallback to
 * `gemini-3.5-flash-lite` / `gemini-3.1-flash-lite`.
 */

const { GoogleGenAI } = require('@google/genai');
const db = require('../../database/db');
const config = require('../config/config');
const storeSettingsService = require('./storeSettingsService');
const systemSettingsService = require('./systemSettingsService');

let CAFE_PERSONA_CONFIG = null;
try {
  CAFE_PERSONA_CONFIG = require('../../config/botPersona').CAFE_PERSONA_CONFIG;
} catch (_) {
  try {
    CAFE_PERSONA_CONFIG = require('../config/botPersona').CAFE_PERSONA_CONFIG;
  } catch (__) {}
}

const PRIMARY_AI_MODEL = 'gemini-3.8-flash';
const FALLBACK_AI_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest'];
const MAX_CONVERSATION_MESSAGES = 8;
const MODEL_COOLDOWN_MS = 30 * 60 * 1000;

const DETECTED_ACTIONS = [
  'NONE',
  'ADD_ITEM',
  'SET_ADDON',
  'VIEW_CART',
  'CLEAR_CART',
  'VIEW_MENU',
  'RECOMMEND_ITEM',
  'SEND_PICTURE',
  'SET_DETAILS',
  'CONFIRM_ORDER',
  'CANCEL_ORDER',
  'CHECK_STATUS',
  'DELAY_COMPLAINT',
  'SUBMIT_FEEDBACK',
  'PROCEED_CHECKOUT'
];

// Strict structured JSON schema enforced via Gemini Interactions API response_format
const ASSISTANT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    reply_message: {
      type: 'string',
      description: 'The natural, strictly polite plain text response in courteous Taglish (with po/opo) or English to send to the customer on Messenger (zero quick_replies, zero street slang).'
    },
    detected_action: {
      type: 'string',
      enum: DETECTED_ACTIONS
    },
    extracted_data: {
      type: 'object',
      properties: {
        items: {
          type: ['array', 'null'],
          description: 'List of menu items to add when detected_action is ADD_ITEM (supports single-item, multi-item, one-shot, and combo orders).',
          items: {
            type: 'object',
            properties: {
              item_name: { type: 'string' },
              quantity: { type: 'number' },
              addon: { type: ['string', 'null'] }
            },
            required: ['item_name', 'quantity', 'addon']
          }
        },
        dining_mode: { type: ['string', 'null'], enum: ['Delivery', 'Pick-up', 'Dine-in', null] },
        customer_name: { type: ['string', 'null'] },
        phone_number: { type: ['string', 'null'] },
        address: { type: ['string', 'null'] },
        landmark: { type: ['string', 'null'] },
        arriving_time: { type: ['string', 'null'] },
        payment_mode: { type: ['string', 'null'], enum: ['Cash', 'GCash', null] },
        note: { type: ['string', 'null'] },
        feedback_text: { type: ['string', 'null'] }
      },
      required: ['items', 'dining_mode', 'customer_name', 'phone_number', 'address', 'landmark', 'arriving_time', 'payment_mode', 'note', 'feedback_text']
    },
    action_payload: {
      type: 'object',
      properties: {
        items: {
          type: ['array', 'null'],
          items: {
            type: 'object',
            properties: {
              item_name: { type: 'string' },
              quantity: { type: 'number' },
              addon: { type: ['string', 'null'] }
            },
            required: ['item_name', 'quantity', 'addon']
          }
        },
        item_name: { type: ['string', 'null'] },
        quantity: { type: ['number', 'null'] },
        addon: { type: ['string', 'null'] },
        dining_mode: { type: ['string', 'null'], enum: ['Delivery', 'Pick-up', 'Dine-in', null] },
        customer_name: { type: ['string', 'null'] },
        phone_number: { type: ['string', 'null'] },
        address: { type: ['string', 'null'] },
        landmark: { type: ['string', 'null'] },
        arriving_time: { type: ['string', 'null'] },
        payment_mode: { type: ['string', 'null'], enum: ['Cash', 'GCash', null] },
        note: { type: ['string', 'null'] },
        feedback_text: { type: ['string', 'null'] }
      }
    }
  },
  required: ['reply_message', 'detected_action', 'extracted_data']
};

// Rolling per-PSID conversation memory buffer (last 6-8 messages)
const conversationMemory = new Map();
const modelCooldownUntil = new Map();

let cachedClient = null;
let cachedApiKey = null;

/**
 * Normalize requested model identifier, substituting legacy deprecated models with gemini-3.8-flash.
 */
function normalizeModelName(rawModel) {
  const name = String(rawModel || process.env.GEMINI_MODEL || config.geminiModel || PRIMARY_AI_MODEL).trim();
  if (!name || /^gemini-(?:1\.5|2\.0|2\.5)-/i.test(name)) {
    return PRIMARY_AI_MODEL;
  }
  return name;
}

function resolveApiKey() {
  const key = String(process.env.GEMINI_API_KEY || config.geminiApiKey || '').trim();
  if (!key || key === 'your_gemini_api_key_here') {
    return '';
  }
  return key;
}

function isAiConfigured() {
  return Boolean(resolveApiKey());
}

function getGenAIClient() {
  const apiKey = resolveApiKey();
  if (!apiKey) return null;

  if (!cachedClient || cachedApiKey !== apiKey) {
    cachedClient = new GoogleGenAI({ apiKey });
    cachedApiKey = apiKey;
  }
  return cachedClient;
}

function resolveModelChain(preferredModel = null) {
  const primary = normalizeModelName(preferredModel);
  const candidates = Array.from(new Set([primary, PRIMARY_AI_MODEL, ...FALLBACK_AI_MODELS]));
  const now = Date.now();
  const healthy = candidates.filter(m => (modelCooldownUntil.get(m) || 0) <= now);
  return healthy.length > 0 ? healthy : candidates;
}

/**
 * Retrieve rolling history buffer for a customer PSID (6-8 most recent messages).
 * Synchronizes cleanly if session.chatHistory was reset.
 */
function getConversationHistory(psid, session = null) {
  const key = String(psid || '');
  if (!key) return [];

  if (session && Array.isArray(session.chatHistory) && session.chatHistory.length === 0 && conversationMemory.has(key)) {
    // Session reset cleared chatHistory; mirror reset into memory buffer
    conversationMemory.delete(key);
  }

  let history = conversationMemory.get(key);
  if (!history && session && Array.isArray(session.chatHistory) && session.chatHistory.length > 0) {
    history = session.chatHistory.slice(-MAX_CONVERSATION_MESSAGES).map(t => ({
      role: t.role === 'model' ? 'model' : 'user',
      text: String(t.text || '')
    }));
    conversationMemory.set(key, history);
  }

  return Array.isArray(history) ? history.slice(-MAX_CONVERSATION_MESSAGES) : [];
}

/**
 * Append user & assistant turn to the rolling 6-8 message buffer per PSID.
 */
function appendConversationTurn(psid, userText, assistantText, session = null) {
  const key = String(psid || '');
  if (!key) return [];

  const existing = getConversationHistory(key, session);
  const updated = [
    ...existing,
    { role: 'user', text: String(userText || '').slice(0, 500) },
    { role: 'model', text: String(assistantText || '').slice(0, 600) }
  ].slice(-MAX_CONVERSATION_MESSAGES);

  conversationMemory.set(key, updated);
  if (session) {
    session.chatHistory = updated.map(m => ({ role: m.role, text: m.text }));
  }
  return updated;
}

/**
 * Clear rolling conversation buffer for a PSID (called on session reset).
 */
function clearConversationHistory(psid) {
  if (!psid) return;
  conversationMemory.delete(String(psid));
}

/**
 * Fetch live TiDB/SQLite operational context (store_settings, menu_items, session_state & cart, active order).
 */
async function loadOperationalContext(psid, session = null) {
  let storeSettings = storeSettingsService.getCachedStoreSettings();
  try {
    storeSettings = await storeSettingsService.getStoreSettings();
  } catch (_) {}

  let storeSchedule = {
    isOpen: true,
    openTimeFormatted: '09:00 AM',
    closeTimeFormatted: '09:00 PM',
    timezone: 'Asia/Manila'
  };
  try {
    storeSchedule = systemSettingsService.isStoreOpen();
  } catch (_) {}

  let menuItems = [];
  try {
    const [rows] = await db.query(`
      SELECT
        m.id,
        m.name,
        m.price,
        m.description,
        m.image_url,
        m.is_available,
        COALESCE(i.stock_quantity, m.stock_quantity, 0) AS stock,
        COALESCE(c.name, 'Cafe') AS category
      FROM menu_items m
      LEFT JOIN categories c ON c.id = m.category_id
      LEFT JOIN inventory i ON i.menu_item_id = m.id
      WHERE COALESCE(m.is_deleted, 0) = 0
        AND (c.id IS NULL OR c.is_active = 1)
      ORDER BY COALESCE(c.display_order, 999) ASC, m.name ASC
    `);
    menuItems = Array.isArray(rows) ? rows : [];
  } catch (err) {
    console.warn('[aiService] Failed to query menu_items for RAG context:', err.message);
  }

  let latestOrder = null;
  if (psid) {
    try {
      const [orderRows] = await db.query(
        `SELECT o.id, o.order_number, o.status, o.payment_status, o.order_type, o.dining_mode, o.total_amount, o.created_at,
                TIMESTAMPDIFF(SECOND, o.created_at, NOW()) AS elapsed_seconds
         FROM orders o
         JOIN customers c ON c.id = o.customer_id
         WHERE c.psid = ?
         ORDER BY o.id DESC
         LIMIT 1`,
        [String(psid)]
      );
      if (orderRows && orderRows.length > 0) {
        const st = String(orderRows[0].status || '').toLowerCase();
        if (!['cancelled', 'voided'].includes(st)) {
          latestOrder = { ...orderRows[0] };
          let elapsedSec = 0;
          if (latestOrder.elapsed_seconds !== undefined && latestOrder.elapsed_seconds !== null && !isNaN(Number(latestOrder.elapsed_seconds))) {
            elapsedSec = Math.max(0, Number(latestOrder.elapsed_seconds));
          } else if (latestOrder.created_at) {
            const t = new Date(latestOrder.created_at).getTime();
            if (!isNaN(t)) elapsedSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
          }
          latestOrder.elapsed_seconds = elapsedSec;
          latestOrder.elapsed_minutes = Math.floor(elapsedSec / 60);
        }
      }
    } catch (err) {
      console.warn('[aiService] Failed to query active order context:', err.message);
    }
  }

  const cartItems = Array.isArray(session?.cart) ? session.cart : [];
  const cartSubtotal = cartItems.reduce(
    (sum, item) => sum + (Number(item.price || item.unitPrice || 0) * (parseInt(item.quantity, 10) || 1)),
    0
  );

  return {
    store: {
      name: storeSettings?.store_name || "Diner's Cafe - Tondo Branch",
      address: storeSettings?.store_address || "Diner's Cafe, Tondo, Manila",
      maxDeliveryRadiusKm: Number(storeSettings?.max_delivery_radius_km) || 3.0,
      isOpen: Boolean(storeSchedule?.isOpen),
      operatingHours: `${storeSchedule?.openTimeFormatted || '09:00 AM'} - ${storeSchedule?.closeTimeFormatted || '09:00 PM'} PHT`,
      phone: config.store?.phone || ''
    },
    menuItems,
    sessionState: session?.state || session?.current_step || 'IDLE',
    diningMode: session?.dining_mode || (session?.orderType === 'delivery' ? 'Delivery' : (session?.orderType === 'pickup' ? 'Pick-up' : null)),
    cart: cartItems,
    cartSubtotal,
    deliveryCheck: {
      isDelivery: session?.dining_mode === 'Delivery' || session?.orderType === 'delivery',
      address: session?.address || null,
      distanceKm: session?.delivery_distance_km ?? session?.distance_km ?? null,
      deliveryFee: session?.delivery_fee ?? session?.deliveryFee ?? null
    },
    latestOrder
  };
}

/**
 * Construct systemInstruction with grounded TiDB operational state and JSON routing contract.
 */
function buildAssistantSystemInstruction(context = {}) {
  const store = context.store || {};
  const menuItems = Array.isArray(context.menuItems) ? context.menuItems : [];
  const cart = Array.isArray(context.cart) ? context.cart : [];

  const menuCatalogBlock = menuItems.length > 0
    ? menuItems.map(item => {
        const stock = Number(item.stock ?? item.stock_quantity ?? 0);
        const available = (item.is_available === 1 || item.is_available === true) && stock > 0;
        const flag = available ? `[AVAILABLE | Stock: ${stock}]` : '[OUT OF STOCK - DO NOT SELL]';
        const price = Number(item.price || 0).toFixed(2);
        return `- ${item.name} | ₱${price} | Category: ${item.category || 'Cafe'} | ${flag} | ${item.description || 'Freshly prepared cafe specialty'}`;
      }).join('\n')
    : '- Menu catalog is temporarily empty.';

  const cartBlock = cart.length > 0
    ? cart.map(c => {
        const qty = parseInt(c.quantity, 10) || 1;
        const unit = Number(c.price || c.unitPrice || 0);
        const addonText = Array.isArray(c.addOns) && c.addOns.length > 0
          ? ` (Add-on: ${c.addOns.map(a => a.name || a).join(', ')})`
          : '';
        return `${qty}x ${c.name}${addonText} (₱${(unit * qty).toFixed(2)})`;
      }).join(', ')
    : 'Empty';

  const orderBlock = context.latestOrder
    ? `Order #${context.latestOrder.order_number} | Status: ${context.latestOrder.status} | Payment: ${context.latestOrder.payment_status} | Elapsed: ${context.latestOrder.elapsed_minutes ?? 0} mins since placement | Total: ₱${Number(context.latestOrder.total_amount || 0).toFixed(2)}`
    : 'None';

  return `You are the official conversational Facebook Messenger assistant for Diner's Cafe.

1. CONVERSATIONAL PERSONA & TONE (100% PURE CONVERSATIONAL TEXT):
- Be warm, polite, empathetic, and respectful at all times.
- Default to courteous Taglish using "po" and "opo". If the customer writes purely in English, respond in polite, friendly English.
- STRICT 100% PURE TEXT UX: NEVER include quick replies, button templates, or structured menus in replies. Every message must be natural, readable plain conversational text.
- STRICT PROFESSIONAL PERSONA (NO STREET SLANG): Always speak in polite, respectful, professional Taglish ("Magandang araw po", "Opo", "Sige po", "Maraming salamat po"). NEVER use street slang or internet jargon such as "Awtos", "Awtos po!", "lods", "lodi", "matsala", "awit", "charot", "besh", "pare", or "goods".
- Seamlessly understand typos (e.g., "chesecake" -> "Biscoff Cheesecake", "spansh late" -> "Spanish Latte"), text shortcuts ("pde ba mgpa-dlvr"), Taglish code-switching, and local Filipino terms.
- OPEN-DOMAIN BANTER & SMOOTH PIVOT: If the customer talks about their day, cracks a joke, or asks for life advice, respond empathetically and engagingly FIRST, then smoothly segue back to cafe favorites.
- NON-EXISTENT ITEM GUARD: If the customer asks for an item NOT in the LIVE MENU CATALOG below (e.g. sushi, spaghetti, ramen, tacos), NEVER hallucinate or add it! Explicitly and politely inform them that Diner's Cafe does not serve it, and suggest 1-2 available menu items. Set detected_action = "NONE".
- OUT-OF-STOCK GUARD: NEVER sell, recommend, or add [OUT OF STOCK - DO NOT SELL] items. Politely inform the customer that it is sold out and recommend available alternatives.
- DRINK-ONLY ADD-ON UPSELL: Drink sinkers/add-ons (+₱20: Pearls, Nata de Coco, Cream Cheese, Coffee Jelly, Egg Pudding) can ONLY be attached to "Drinks & Milktea". NEVER attach them to food/meals/silog/pizza/pasta.
- "IKAW NA BAHALA" / DEALER'S CHOICE COMBOS: If the customer asks you to pick for them, select AT LEAST 1 [AVAILABLE] food item AND AT LEAST 1 [AVAILABLE] drink item from the live catalog, set detected_action = "ADD_ITEM", put both in extracted_data.items, and tell them what you picked.
- STATE-LOCK ESCAPE HATCH: If the customer changes their mind, asks questions about the menu, or wants to add items while entering checkout info, gracefully handle their request without getting stuck in checkout.

2. ORDER PROCESSING & LOGISTICS RULES:
- Dining Modes: "Delivery", "Pick-up", "Dine-in".
- Required details for Pick-up / Dine-in: Full Name, Phone Number, Arriving Time, Payment Mode (Cash or GCash), Note (optional).
- Required details for Delivery: Full Name, Phone Number, Complete Delivery Address, Landmark, Payment Mode (Cash or GCash), Note (optional).
- In-house delivery radius is maximum ${Number(store.maxDeliveryRadiusKm || 3.0).toFixed(1)} km. If an address is beyond 3 km, inform them gently that it is outside our direct radius and can be arranged via third-party courier pending admin fee quote.
- Strict Order Tracking Separation:
  - If status is PENDING or PENDING_APPROVAL: Cashier is currently verifying order and payment details (approx 2-5 minutes). It is NOT yet cooking in the kitchen!
  - If status is IN_PREPARATION: Order is approved and actively cooking in the kitchen.
  - If status is DISPATCHED: Order is handed to the rider or ready at the counter.
- Delay Complaint: If customer complains of delay, empathize sincerely with their wait time and provide an honest status update based on their order state without repeating a robotic summary.
- 5-Minute Cancellation Policy: (1) Unpaid or PENDING orders can be instantly cancelled. (2) Orders already IN_PREPARATION within 5 minutes of placement are forwarded to admin for approval. (3) Orders past 5 minutes in preparation or DISPATCHED cannot be cancelled.

3. LIVE STORE CONTEXT:
- Store Name: ${store.name || "Diner's Cafe - Tondo Branch"}
- Operating Status: ${store.isOpen ? 'OPEN' : 'CLOSED'}
- Operating Hours: ${store.operatingHours || '09:00 AM - 09:00 PM PHT'}
- Address: ${store.address || "Diner's Cafe, Tondo, Manila"}
- Maximum In-House Delivery Radius: ${Number(store.maxDeliveryRadiusKm || 3.0).toFixed(1)} km

4. CUSTOMER SESSION & ACTIVE ORDER CONTEXT:
- Current State: ${context.sessionState || 'IDLE'}
- Selected Dining Mode: ${context.diningMode || 'Not selected yet'}
- Current Cart: ${cartBlock} (Subtotal: ₱${Number(context.cartSubtotal || 0).toFixed(2)})
- Latest Active Order: ${orderBlock}

5. LIVE MENU CATALOG:
${menuCatalogBlock}

6. STRUCTURED JSON OUTPUT CONTRACT:
Return ONLY valid JSON matching this exact structure:
{
  "reply_message": "Polite plain-text message without quick replies or street slang.",
  "detected_action": "NONE | ADD_ITEM | SET_ADDON | VIEW_CART | CLEAR_CART | VIEW_MENU | RECOMMEND_ITEM | SEND_PICTURE | SET_DETAILS | CONFIRM_ORDER | CANCEL_ORDER | CHECK_STATUS | DELAY_COMPLAINT | SUBMIT_FEEDBACK | PROCEED_CHECKOUT",
  "extracted_data": {
    "items": [{ "item_name": "string", "quantity": 1, "addon": "string or null" }],
    "dining_mode": "Delivery | Pick-up | Dine-in | null",
    "customer_name": "string or null",
    "phone_number": "string or null",
    "address": "string or null",
    "landmark": "string or null",
    "arriving_time": "string or null",
    "payment_mode": "Cash | GCash | null",
    "note": "string or null",
    "feedback_text": "string or null"
  }
}

ACTION DEFINITIONS:
- NONE: General questions, greetings, banter, non-existent menu inquiries, or clarifications.
- ADD_ITEM: Customer wants to add item(s) to cart, confirms recommendation, or one-shot order. Populate extracted_data.items with all items requested.
- SET_ADDON: Customer chooses or asks for a drink add-on/sinker (Pearls, Nata, Coffee Jelly, Cream Cheese, Egg Pudding).
- VIEW_CART: Customer asks to inspect their cart.
- CLEAR_CART: Customer explicitly requests to remove, delete, or empty their entire cart.
- VIEW_MENU: Customer asks to see the menu or list of offerings.
- RECOMMEND_ITEM: Customer asks for suggestions, specials, or bestsellers.
- SEND_PICTURE: Customer asks to see a photo of a specific dish/drink.
- SET_DETAILS: Customer provides checkout details (name, phone, address, landmark, time, dining mode, payment mode, note). Extract all provided fields.
- CONFIRM_ORDER: Customer finalizes/confirms checkout ("confirm", "proceed", "okay na").
- CANCEL_ORDER: Customer requests cancellation of active order.
- CHECK_STATUS: Customer inquires about order progress or tracking.
- DELAY_COMPLAINT: Customer expresses frustration or asks why order is taking long.
- SUBMIT_FEEDBACK: Customer gives a rating, review, or feedback on food/service. Extract feedback_text.
- PROCEED_CHECKOUT: Customer indicates readiness to checkout.${(CAFE_PERSONA_CONFIG && Array.isArray(CAFE_PERSONA_CONFIG.fewShotExamples) && CAFE_PERSONA_CONFIG.fewShotExamples.length > 0)
  ? '\n\n7. FEW-SHOT CONVERSATIONAL EXAMPLES:\n' + CAFE_PERSONA_CONFIG.fewShotExamples.map((ex, idx) => `[Example ${idx + 1}: ${ex.scenario}]\nCustomer: "${ex.customer}"\nTarget Response: "${ex.assistant}"`).join('\n\n')
  : ''}`;
}

/**
 * Parse and sanitize JSON output returned by Gemini into the strict action contract.
 */
function parseAssistantJson(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;

  let cleaned = rawText.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  let parsed = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch (_) {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      } catch (__) {
        return null;
      }
    }
  }

  if (!parsed || typeof parsed !== 'object') return null;

  const replyMessage = String(parsed.reply_message || parsed.replyText || '').trim();
  if (!replyMessage) return null;

  const rawAction = String(parsed.detected_action || 'NONE').trim().toUpperCase();
  const detectedAction = DETECTED_ACTIONS.includes(rawAction) ? rawAction : 'NONE';

  const rawData = (parsed.extracted_data && typeof parsed.extracted_data === 'object')
    ? parsed.extracted_data
    : ((parsed.action_payload && typeof parsed.action_payload === 'object') ? parsed.action_payload : {});

  let normalizedItems = [];
  if (Array.isArray(rawData.items)) {
    for (const entry of rawData.items) {
      if (!entry || typeof entry !== 'object') continue;
      const eName = entry.item_name ? String(entry.item_name).trim() : '';
      if (!eName) continue;
      const eQtyRaw = entry.quantity !== null && entry.quantity !== undefined ? parseInt(entry.quantity, 10) : 1;
      const eQty = Number.isFinite(eQtyRaw) && eQtyRaw > 0 ? eQtyRaw : 1;
      const eAddon = entry.addon ? String(entry.addon).trim() : null;
      normalizedItems.push({
        item_name: eName,
        quantity: eQty,
        addon: eAddon
      });
    }
  }

  const singleItemName = rawData.item_name ? String(rawData.item_name).trim() : null;
  const parsedQty = rawData.quantity !== null && rawData.quantity !== undefined
    ? parseInt(rawData.quantity, 10)
    : null;
  const singleQuantity = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : null;
  const singleAddon = rawData.addon ? String(rawData.addon).trim() : null;

  if (normalizedItems.length === 0 && singleItemName) {
    normalizedItems.push({
      item_name: singleItemName,
      quantity: singleQuantity || 1,
      addon: singleAddon
    });
  }

  const itemName = singleItemName || (normalizedItems[0] ? normalizedItems[0].item_name : null);
  const quantity = singleQuantity || (normalizedItems[0] ? normalizedItems[0].quantity : null);
  const addon = singleAddon || (normalizedItems[0] ? normalizedItems[0].addon : null);

  let diningMode = null;
  if (rawData.dining_mode) {
    const dm = String(rawData.dining_mode).trim();
    if (/delivery/i.test(dm)) diningMode = 'Delivery';
    else if (/pick[\s-]*up|take[\s-]*out/i.test(dm)) diningMode = 'Pick-up';
    else if (/dine[\s-]*in/i.test(dm)) diningMode = 'Dine-in';
  }

  let paymentMode = null;
  if (rawData.payment_mode) {
    const pm = String(rawData.payment_mode).trim();
    if (/gcash|g-?cash|online|xendit|e-?wallet/i.test(pm)) paymentMode = 'GCash';
    else if (/cash|cod|kaliwaan/i.test(pm)) paymentMode = 'Cash';
  }

  const customerName = rawData.customer_name ? String(rawData.customer_name).trim() : null;
  const phoneNumber = rawData.phone_number ? String(rawData.phone_number).trim() : null;
  const address = rawData.address ? String(rawData.address).trim() : null;
  const landmark = rawData.landmark ? String(rawData.landmark).trim() : null;
  const arrivingTime = rawData.arriving_time ? String(rawData.arriving_time).trim() : null;
  const note = rawData.note ? String(rawData.note).trim() : null;
  const feedbackText = rawData.feedback_text ? String(rawData.feedback_text).trim() : null;

  const sanitizedReply = replyMessage
    .replace(/\bAwtos\s*po!*/gi, 'Paumanhin po.')
    .replace(/\bAwtos\b!*/gi, 'Paumanhin po')
    .replace(/\b(?:lods|lodi|paps|besh|charot)\b/gi, 'po')
    .replace(/\bmatsala\b/gi, 'maraming salamat')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const resultPayload = {
    items: normalizedItems,
    item_name: itemName,
    quantity,
    addon,
    dining_mode: diningMode,
    customer_name: customerName,
    phone_number: phoneNumber,
    address,
    landmark,
    arriving_time: arrivingTime,
    payment_mode: paymentMode,
    note,
    feedback_text: feedbackText
  };

  return {
    reply_message: sanitizedReply || replyMessage,
    detected_action: detectedAction,
    extracted_data: resultPayload,
    action_payload: resultPayload
  };
}

/**
 * Format user message together with the rolling 8-turn (role: 'user' | 'model') conversation buffer.
 */
function buildInputWithHistory(messageText, history = []) {
  if (!Array.isArray(history) || history.length === 0) {
    return String(messageText || '');
  }
  const transcript = history
    .slice(-MAX_CONVERSATION_MESSAGES)
    .map(m => `${m.role === 'model' ? 'Assistant (model)' : 'Customer (user)'}: ${m.text}`)
    .join('\n');
  return `Recent conversation history (${Math.min(history.length, MAX_CONVERSATION_MESSAGES)} turns):\n${transcript}\n\nCustomer (user): ${messageText}`;
}

/**
 * Generate a grounded, conversational structured JSON response for a Messenger customer.
 *
 * @param {string} psid - Customer Facebook PSID
 * @param {string} messageText - Raw customer message
 * @param {Object|null} [session=null] - Active session object
 * @param {Object} [options={}] - Optional overrides (client, context, preferredModel)
 * @returns {Promise<{ reply_message: string, detected_action: string, action_payload: Object, model: string, latencyMs: number, context: Object } | null>}
 */
async function generateAssistantResponse(psid, messageText, session = null, options = {}) {
  const client = options.client || getGenAIClient();
  if (!client || !client.interactions?.create) {
    return null;
  }

  const context = options.context || await loadOperationalContext(psid, session);
  const systemInstruction = buildAssistantSystemInstruction(context);
  const history = getConversationHistory(psid, session);
  const input = buildInputWithHistory(messageText, history);

  const timeoutMs = config.geminiTimeoutMs || 30000;
  const models = resolveModelChain(options.preferredModel);
  const startMs = Date.now();

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const perAttemptTimeoutMs = i === models.length - 1 ? timeoutMs : Math.min(timeoutMs, 15000);

    try {
      const interaction = await client.interactions.create(
        {
          model,
          input,
          system_instruction: systemInstruction,
          generation_config: {
            temperature: 0.7
          },
          response_format: {
            type: 'text',
            mime_type: 'application/json',
            schema: ASSISTANT_RESPONSE_SCHEMA
          }
        },
        {
          timeout_ms: perAttemptTimeoutMs,
          retries: { strategy: 'none' }
        }
      );

      const outputText = interaction?.output_text ||
        interaction?.steps
          ?.filter(s => s.type === 'model_output')
          ?.flatMap(s => s.content || [])
          ?.filter(c => c.type === 'text' && c.text)
          ?.map(c => c.text)
          ?.join('') ||
        '';

      const parsed = parseAssistantJson(outputText);
      if (parsed) {
        modelCooldownUntil.delete(model);
        appendConversationTurn(psid, messageText, parsed.reply_message, session);
        return {
          ...parsed,
          model,
          latencyMs: Date.now() - startMs,
          context
        };
      }
    } catch (err) {
      const status = err?.status || err?.statusCode || err?.code || '';
      const msg = String(err?.message || '');
      const isRetryable =
        status === 429 ||
        status === 503 ||
        status === 500 ||
        status === 504 ||
        /rate\s*limit|quota|overload|capacity|timeout|ECONNRESET|ETIMEDOUT/i.test(msg);

      console.warn(`[aiService] Model ${model} failed (${status || 'ERR'}): ${msg}`);
      if (isRetryable) {
        modelCooldownUntil.set(model, Date.now() + MODEL_COOLDOWN_MS);
        continue;
      }
      if (i < models.length - 1) {
        continue;
      }
    }
  }

  return null;
}

module.exports = {
  PRIMARY_AI_MODEL,
  MAX_CONVERSATION_MESSAGES,
  DETECTED_ACTIONS,
  ASSISTANT_RESPONSE_SCHEMA,
  normalizeModelName,
  isAiConfigured,
  getConversationHistory,
  appendConversationTurn,
  clearConversationHistory,
  loadOperationalContext,
  buildAssistantSystemInstruction,
  parseAssistantJson,
  buildInputWithHistory,
  generateAssistantResponse
};

