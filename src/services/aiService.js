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

const PRIMARY_AI_MODEL = 'gemini-3.8-flash';
const FALLBACK_AI_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
const MAX_CONVERSATION_MESSAGES = 8;
const MODEL_COOLDOWN_MS = 2 * 60 * 1000;

const DETECTED_ACTIONS = [
  'NONE',
  'ADD_ITEM',
  'VIEW_MENU',
  'VIEW_CART',
  'CLEAR_CART',
  'RECOMMEND_ITEM',
  'SEND_PICTURE',
  'CANCEL_ORDER',
  'CHECK_STATUS',
  'PROCEED_CHECKOUT'
];

// Strict structured JSON schema enforced via Gemini Interactions API response_format
const ASSISTANT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    reply_message: {
      type: 'string',
      description: 'The natural, strictly polite response in courteous Taglish (with po/opo) or English to send to the customer on Messenger.'
    },
    detected_action: {
      type: 'string',
      enum: DETECTED_ACTIONS
    },
    action_payload: {
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
        item_name: { type: ['string', 'null'] },
        quantity: { type: ['number', 'null'] },
        addon: { type: ['string', 'null'] },
        dining_mode: { type: ['string', 'null'], enum: ['Delivery', 'Pick-up', null] },
        payment_mode: { type: ['string', 'null'], enum: ['Cash', 'GCash', null] }
      },
      required: ['items', 'item_name', 'quantity', 'addon', 'dining_mode', 'payment_mode']
    }
  },
  required: ['reply_message', 'detected_action', 'action_payload']
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
        `SELECT o.id, o.order_number, o.status, o.payment_status, o.order_type, o.dining_mode, o.total_amount, o.created_at
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
          latestOrder = orderRows[0];
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
    ? `Order #${context.latestOrder.order_number} | Status: ${context.latestOrder.status} | Payment: ${context.latestOrder.payment_status} | Total: ₱${Number(context.latestOrder.total_amount || 0).toFixed(2)}`
    : 'None';

  return `You are the official conversational Facebook Messenger assistant for Diner's Cafe.

1. CONVERSATIONAL PERSONA & TONE:
- Be warm, polite, empathetic, and respectful at all times.
- Default to courteous Taglish using "po" and "opo". If the customer writes purely in English, respond in polite, friendly English.
- Seamlessly understand typos (e.g., "chesecake" -> "Biscoff Cheesecake", "spansh late" -> "Caramel Macchiato"), text shortcuts ("pde ba mgpa-dlvr"), Taglish code-switching, and local Filipino slang without ever failing or emitting robotic error messages.
- OPEN-DOMAIN CONVERSATION & SMOOTH SEGUES: If the customer talks about their day, cracks a joke, asks for life advice, or goes off-topic, respond empathetically and engagingly FIRST, then smoothly pivot/segue back to food or drinks available on the menu.
- STRICT PROFESSIONAL TONE (NO STREET SLANG): Always use polite, respectful, professional Taglish ("Magandang araw po", "Opo", "Sige po", "Maraming salamat po"). NEVER use street slang or internet jargon such as "Awtos", "Awtos po!", "lods", "matsala", "awit", "charot", "besh", or "pare".
- CONTEXTUAL AFFIRMATIVES ("oo", "yes", "sige", "oo ngani", "wala"): Always check the immediately preceding Assistant (model) turn! For example, if you just asked "May gusto pa ba kayong idagdag?" and the customer replies "oo" / "oo ngani" / "yes", reply politely asking "Ano po ang nais ninyong idagdag?" with detected_action = "NONE"; if they reply "wala" / "hindi na", transition to checkout (PROCEED_CHECKOUT).
- ONE-SHOT MULTI-INTENT EXTRACTION: When the customer sends a combined order (e.g., "pa order bacon burger isa take out gcash payment"), extract ALL entities at once: set detected_action = "ADD_ITEM", put the items in action_payload.items, set dining_mode ("Delivery" or "Pick-up"), and set payment_mode ("Cash" or "GCash").
- CUSTOMER NAME VALIDATION: Never accept conversational complaints, questions, or sarcasm (e.g., "binigay ko na sayo kanina ha") as a customer name; politely re-prompt for their real full name.
- "IKAW NA BAHALA" / DEALER'S CHOICE COMBOS: If the customer asks you to pick for them (e.g., "ikaw na bahala", "kahit ano", "ikaw na pumili basta may meal at drinks"), DO NOT just ask them what they want! Pick AT LEAST 1 [AVAILABLE] food/meal item AND AT LEAST 1 [AVAILABLE] drink item from the live menu catalog below, set detected_action = "ADD_ITEM", put ALL selected items inside action_payload.items, and enthusiastically tell the customer which food and drink you added!
- STRICT GROUNDING & ADD-ON CATEGORY GUARD: NEVER invent food items, prices, or modifiers not in LIVE MENU CATALOG. NEVER recommend or sell [OUT OF STOCK - DO NOT SELL] items. Drink sinkers/add-ons ("Pearls", "Nata de Coco", "Cream Cheese", "Coffee Jelly", "Crushed Oreo") are ONLY for "Drinks & Milktea" items—NEVER attach them (set addon: null) to meals, silog, burgers, pizza, pasta, or starters.
- PAYMENT MODES: Accepted payment modes are Cash or GCash only.

2. LIVE STORE CONTEXT (TiDB Grounded):
- Store Name: ${store.name || "Diner's Cafe - Tondo Branch"}
- Operating Status: ${store.isOpen ? 'OPEN' : 'CLOSED'}
- Operating Hours: ${store.operatingHours || '09:00 AM - 09:00 PM PHT'}
- Address: ${store.address || "Diner's Cafe, Tondo, Manila"}
- Delivery Coverage: Maximum ${Number(store.maxDeliveryRadiusKm || 3.0).toFixed(1)} km in-house delivery radius (over 3 km uses third-party Grab/Lalamove pending admin fee quote).

3. CUSTOMER SESSION & ACTIVE ORDER CONTEXT:
- Current State: ${context.sessionState || 'IDLE'}
- Selected Dining Mode: ${context.diningMode || 'Not selected yet'}
- Current Cart: ${cartBlock} (Subtotal: ₱${Number(context.cartSubtotal || 0).toFixed(2)})
- Latest Active Order: ${orderBlock}

4. LIVE MENU CATALOG:
${menuCatalogBlock}

5. STRUCTURED JSON OUTPUT CONTRACT:
Return ONLY valid JSON matching the schema:
{
  "reply_message": "Natural polite reply to send to the customer.",
  "detected_action": "NONE | ADD_ITEM | VIEW_MENU | VIEW_CART | CLEAR_CART | RECOMMEND_ITEM | SEND_PICTURE | CANCEL_ORDER | CHECK_STATUS | PROCEED_CHECKOUT",
  "action_payload": {
    "items": [{ "item_name": "string", "quantity": 1, "addon": null }],
    "item_name": "string or null",
    "quantity": "number or null",
    "addon": "string or null",
    "dining_mode": "Delivery | Pick-up | null",
    "payment_mode": "Cash | GCash | null"
  }
}

ACTION ROUTING RULES:
- NONE: General conversation, off-topic banter, empathy + segue, follow-up questions ("Ano po ang nais ninyong idagdag?"), or store FAQs.
- ADD_ITEM: Customer wants to add/order one OR multiple menu items, one-shot orders ("pa order bacon burger isa take out gcash payment"), resolves a prior recommendation ("add to cart mo nayan"), or asks for "ikaw na bahala" combo. Put EVERY ordered item inside action_payload.items (each with exact grounded item_name, numeric quantity defaulting to 1, and addon only for Drinks & Milktea or null). Mirror items[0] in item_name/quantity/addon. Also populate dining_mode and payment_mode if stated. Never set ADD_ITEM for an [OUT OF STOCK - DO NOT SELL] item.
- VIEW_CART: Customer asks to see or check their cart (e.g., "patingin ng cart", "ano laman ng cart ko", "view cart"). Never classify cart queries as SEND_PICTURE.
- CLEAR_CART: Customer asks to empty, delete, or clear their cart (e.g., "burahin mo yung nasa cart ko", "clear cart", "empty cart").
- RECOMMEND_ITEM: Customer asks for recommendations or bestsellers (e.g., "anong mare-recommend mo na drinks", "ano masarap"). NEVER trigger VIEW_MENU for recommendations—put 2 to 3 specific [AVAILABLE] items with brief descriptions & prices directly inside reply_message.
- VIEW_MENU: Customer explicitly asks to see the full menu, food list, or drink list.
- SEND_PICTURE: Customer asks to see a photo/picture of a specific menu dish or drink (NOT "cart" and NOT "menu"). Put the matched menu item name in action_payload.item_name.
- CANCEL_ORDER: Customer explicitly asks to cancel their order.
- CHECK_STATUS: Customer asks about their order status, delivery progress, or tracking.
- PROCEED_CHECKOUT: Customer confirms they are ready to check out or pay for their cart.`;
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

  const rawPayload = (parsed.action_payload && typeof parsed.action_payload === 'object')
    ? parsed.action_payload
    : {};

  let normalizedItems = [];
  if (Array.isArray(rawPayload.items)) {
    for (const entry of rawPayload.items) {
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

  const singleItemName = rawPayload.item_name ? String(rawPayload.item_name).trim() : null;
  const parsedQty = rawPayload.quantity !== null && rawPayload.quantity !== undefined
    ? parseInt(rawPayload.quantity, 10)
    : null;
  const singleQuantity = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : null;
  const singleAddon = rawPayload.addon ? String(rawPayload.addon).trim() : null;

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
  if (rawPayload.dining_mode) {
    const dm = String(rawPayload.dining_mode).trim();
    if (/delivery/i.test(dm)) diningMode = 'Delivery';
    else if (/pick[\s-]*up|take[\s-]*out|dine/i.test(dm)) diningMode = 'Pick-up';
  }

  let paymentMode = null;
  if (rawPayload.payment_mode) {
    const pm = String(rawPayload.payment_mode).trim();
    if (/gcash|g-?cash|online|xendit|e-?wallet/i.test(pm)) paymentMode = 'GCash';
    else if (/cash|cod|kaliwaan/i.test(pm)) paymentMode = 'Cash';
  }

  const sanitizedReply = replyMessage
    .replace(/\bAwtos\s*po!*/gi, 'Paumanhin po.')
    .replace(/\bAwtos\b!*/gi, 'Paumanhin po')
    .replace(/\b(?:lods|lodi|paps|besh|charot)\b/gi, 'po')
    .replace(/\bmatsala\b/gi, 'maraming salamat')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return {
    reply_message: sanitizedReply || replyMessage,
    detected_action: detectedAction,
    action_payload: {
      items: normalizedItems,
      item_name: itemName,
      quantity,
      addon,
      dining_mode: diningMode,
      payment_mode: paymentMode
    }
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

