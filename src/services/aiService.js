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
const geminiService = require('./geminiService');

let CAFE_PERSONA_CONFIG = null;
try {
  CAFE_PERSONA_CONFIG = require('../../config/botPersona').CAFE_PERSONA_CONFIG;
} catch (_) {
  try {
    CAFE_PERSONA_CONFIG = require('../config/botPersona').CAFE_PERSONA_CONFIG;
  } catch (__) { }
}

const PRIMARY_AI_MODEL = 'gemini-3.8-flash';
const FALLBACK_AI_MODELS = ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest'];
const MAX_CONVERSATION_MESSAGES = 8;
const MODEL_COOLDOWN_MS = 30 * 60 * 1000;

const DETECTED_ACTIONS = [
  'NONE',
  'ADD_ITEM',
  'REMOVE_ITEM',
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
        removed_items: {
          type: ['array', 'null'],
          description: 'List of menu items to remove when detected_action is REMOVE_ITEM.',
          items: {
            type: 'object',
            properties: {
              item_name: { type: 'string' },
              quantity: { type: 'number' }
            },
            required: ['item_name', 'quantity']
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
  const pool = geminiService.getHealthyApiKeys ? geminiService.getHealthyApiKeys() : [];
  if (pool.length > 0) return pool[0];
  const key = String(process.env.GEMINI_API_KEY || config.geminiApiKey || '').trim();
  if (!key || key === 'your_gemini_api_key_here') {
    return '';
  }
  return key;
}

function isAiConfigured() {
  const pool = geminiService.resolveApiKeyPool ? geminiService.resolveApiKeyPool() : [];
  return pool.length > 0 || Boolean(resolveApiKey());
}

function getGenAIClient() {
  const apiKey = resolveApiKey();
  if (!apiKey) return null;

  if (geminiService.getClientForKey) {
    return geminiService.getClientForKey(apiKey);
  }

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
  } catch (_) { }

  let storeSchedule = {
    isOpen: true,
    status: 'OPEN',
    is_manual_override: 0,
    openTimeFormatted: '09:00 AM',
    closeTimeFormatted: '09:00 PM',
    timezone: 'Asia/Manila'
  };
  try {
    await systemSettingsService.getSystemSettings();
    storeSchedule = systemSettingsService.isStoreOpen();
  } catch (_) { }

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
        COALESCE(c.name, 'Cafe') AS category
      FROM menu_items m
      LEFT JOIN categories c ON c.id = m.category_id
      WHERE COALESCE(m.is_deleted, 0) = 0
        AND (c.id IS NULL OR c.is_active = 1)
      ORDER BY COALESCE(c.display_order, 999) ASC, m.name ASC
    `);

    // Live Recipe-Driven Servings Calculation (BOM)
    let recipes = [];
    try {
      const [recipeRows] = await db.query(`
        SELECT 
          r.menu_id,
          r.quantity_required,
          i.stock_quantity AS ingredient_stock
        FROM recipe_items r
        JOIN ingredients i ON i.ingredient_id = r.ingredient_id
      `);
      recipes = Array.isArray(recipeRows) ? recipeRows : [];
    } catch (_) { }

    const recipesByMenu = new Map();
    for (const r of recipes) {
      if (!recipesByMenu.has(r.menu_id)) {
        recipesByMenu.set(r.menu_id, []);
      }
      recipesByMenu.get(r.menu_id).push(r);
    }

    menuItems = (Array.isArray(rows) ? rows : []).map(item => {
      const reqs = recipesByMenu.get(item.id);
      let maxServings;
      const hasRecipe = Boolean(reqs && reqs.length > 0);

      if (hasRecipe) {
        const servings = reqs.map(r => {
          const q = Number(r.quantity_required) || 0;
          const s = Number(r.ingredient_stock) || 0;
          return q > 0 ? Math.floor(s / q) : 9999;
        });
        maxServings = Math.max(0, Math.min(...servings));
      } else {
        // Fallback rule: default to AVAILABLE (50 servings) if visible
        maxServings = (item.is_available === 1 || item.is_available === true) ? 50 : 0;
      }

      return {
        ...item,
        stock: maxServings,
        max_servings: maxServings,
        has_recipe: hasRecipe
      };
    });
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
      status: storeSchedule?.status || (storeSchedule?.isOpen ? 'OPEN' : 'CLOSED'),
      isManualOverride: Boolean(storeSchedule?.is_manual_override),
      operatingHours: `${storeSchedule?.openTimeFormatted || '09:00 AM'} - ${storeSchedule?.closeTimeFormatted || '09:00 PM'} PHT`,
      phone: config.store?.phone || ''
    },
    menuItems,
    sessionState: session?.state || session?.current_step || 'IDLE',
    diningMode: session?.dining_mode || null,
    cart: cartItems,
    cartSubtotal,
    deliveryCheck: {
      isDelivery: session?.dining_mode === 'Delivery' || session?.orderType === 'delivery',
      address: session?.address || null,
      distanceKm: session?.delivery_distance_km ?? session?.distance_km ?? null,
      deliveryFee: session?.delivery_fee ?? session?.deliveryFee ?? null
    },
    lastRecommendedItems: Array.isArray(session?.last_recommended_items)
      ? session.last_recommended_items
      : (session?.last_recommended_item ? [session.last_recommended_item] : []),
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
      const maxServings = Number(item.max_servings ?? item.stock ?? 0);
      const isVisible = (item.is_available === 1 || item.is_available === true);
      const isOrderable = isVisible && maxServings > 0;
      let flag = '[OUT OF STOCK - DO NOT SELL]';
      if (isOrderable) {
        flag = maxServings < 15
          ? `[LOW ON STOCK | Servings: ${maxServings}]`
          : `[AVAILABLE | Servings: ${maxServings}]`;
      }
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
- CONCISE & DIRECT TO THE POINT: Keep all responses brief, direct, and straightforward (strictly 1 to 3 short sentences). Answer the question or confirm the action immediately without unnecessary conversational fluff or overly long paragraphs.
- Be warm, polite, empathetic, and respectful at all times.
- Default to courteous Taglish using "po" and "opo". If the customer writes purely in English, respond in polite, friendly English.
- STRICT 100% PURE TEXT UX: NEVER include quick replies, button templates, or structured menus in replies. Every message must be natural, readable plain conversational text.
- STRICT PROFESSIONAL PERSONA (NO STREET SLANG): Always speak in polite, respectful, professional Taglish ("Magandang araw po", "Opo", "Sige po", "Maraming salamat po"). NEVER use street slang or internet jargon such as "Awtos", "Awtos po!", "lods", "lodi", "matsala", "awit", "charot", "besh", "pare", or "goods".
- Seamlessly understand typos (e.g., "chesecake" -> "Biscoff Cheesecake", "spansh late" -> "Spanish Latte"), text shortcuts ("pde ba mgpa-dlvr"), Taglish code-switching, and local Filipino terms.
- CONVERSATIONAL CONTINUITY & ANAPHORA RESOLUTION (CRITICAL):
  - Last Recommended Items to customer: ${Array.isArray(context.lastRecommendedItems) && context.lastRecommendedItems.length > 0 ? context.lastRecommendedItems.join(', ') : 'None yet'}.
  - When the customer says agreement or acceptance phrases referring to previous suggestions or recommendations, such as:
    "sige lahat yan", "sige lahat", "lahat yan", "kunin ko yan", "sige yun", "isa nung una", "order ko na yan", "kunin ko lahat yan", "sige yan na lang", "sige":
    YOU MUST SET detected_action = "ADD_ITEM"!
    Populate extracted_data.items with ALL the recommended items (or the item referred to) with quantity: 1.
    Reply with warm confirmation like: "Sige po! Idinagdag ko na po sa inyong cart ang ating mga nirekomenda..."
  - STRICT NEGATIVE CONSTRAINT (NEVER CONFUSE NAMES/ADDRESSES WITH CONVERSATIONAL PHRASES):
    NEVER, EVER extract polite Filipino prefixes, honorifics, or conversational phrases (such as "pa", "paki", "pa-add", "pa add", "pa-order", "kuya", "ate", "kuya pa", "sir", "boss", "sige lahat yan", "lahat yan", "sige po", "oo", "patingin", "wait lang") as customer_name, address, or note!
    Words like "pa", "paki", "pa-add" are polite request markers ("paki-add"), NOT a person's name!
    A customer_name MUST be an actual person's real name (e.g. Francis, Maria, John). If unsure, leave customer_name as null!
- OPEN-DOMAIN BANTER & SMOOTH PIVOT: If the customer talks about their day, cracks a joke, or asks for life advice, respond empathetically and engagingly FIRST, then smoothly segue back to cafe favorites.
- NON-EXISTENT ITEM GUARD: If the customer asks for an item NOT in the LIVE MENU CATALOG below (e.g. sushi, spaghetti, ramen, tacos), NEVER hallucinate or add it! Explicitly and politely inform them that Diner's Cafe does not serve it, and suggest 1-2 available menu items. Set detected_action = "NONE".
- FULL MENU CATALOG AUTHORITY (CRITICAL):
  - Every single item listed in "5. LIVE MENU CATALOG" is an authentic, active, and valid menu item created by the cafe management—regardless of its name (even if unusual, test-like such as "qwertys", slang, or special promo) and regardless of its base price (even if ₱1.00, ₱5.00, or heavily discounted).
  - NEVER refuse, reject, or tell the customer that any item appearing in the catalog is a "test entry", "not served", or "not real".
  - If a customer orders any item that appears in the LIVE MENU CATALOG and is marked [AVAILABLE] or [LOW ON STOCK], YOU MUST ACCEPT IT! Set detected_action = "ADD_ITEM", include it in extracted_data.items with the specified quantity, and confirm adding it to their cart.
- OUT-OF-STOCK & QUANTITY LIMIT GUARD: Menu item availability is 100% recipe-driven based on raw ingredients. NEVER sell, recommend, or add [OUT OF STOCK - DO NOT SELL] items. Politely inform the customer that it is sold out and recommend available alternatives. If a customer orders more servings than currently available (e.g., ordering 4 when only 2 servings remain), politely inform them of the maximum servings available and offer to prepare up to the remaining amount.
- DRINK-ONLY ADD-ON UPSELL: Drink sinkers/add-ons (+₱20: Pearls, Nata de Coco, Cream Cheese, Coffee Jelly, Egg Pudding) can ONLY be attached to "Drinks & Milktea". NEVER attach them to food/meals/silog/pizza/pasta.
- "IKAW NA BAHALA" / DEALER'S CHOICE COMBOS: If the customer asks you to pick for them, select AT LEAST 1 [AVAILABLE] food item AND AT LEAST 1 [AVAILABLE] drink item from the live catalog, set detected_action = "ADD_ITEM", put both in extracted_data.items, and tell them what you picked.
- ITEM REMOVAL / CART EDITS: When the customer asks to remove, delete, take out, or cancel an item from their cart (e.g. "pa tanggal yung burger steak", "pa tanggal na pla ung burger steak", "pa tanggal ako ng burger steak", "pa remove ako ng burger steak", "alisin mo yung burger steak", "wag na pala yung steak"): Set detected_action = "REMOVE_ITEM". Include the item name and quantity in extracted_data.removed_items (e.g. [{ item_name: "Burger Steak (2 pcs)", quantity: 1 }]).
- RECOMMENDATION SWAP: If customer changes their mind or asks for different recommendations (e.g. 'iba na lang', 'ayaw ko ng pare-pareho'), replace previously suggested items rather than stacking duplicates in cart.
- STATE-LOCK ESCAPE HATCH: If the customer changes their mind, asks questions about the menu, or wants to add items while entering checkout info, gracefully handle their request without getting stuck in checkout.
- LIVE STORE STATUS & STORE OVERRIDE (PRIORITY RULE):
  - Always dynamically check Section 3 "LIVE STORE CONTEXT".
  - If Store Operating Status is "OPEN" (including when the admin pressed the Store OPEN button to activate Manual Override): The store is ACTIVELY OPEN and accepting orders right now! This manual override or open status completely overrides regular operating hours. You MUST accept live orders and treat the customer's arriving time as valid. NEVER tell the customer the store is closed or argue about schedule when Operating Status is OPEN!
  - If Store Operating Status is "CLOSED" (including when the admin pressed Store CLOSED): The store is currently closed. Politely inform the customer that the kitchen is closed, state the live operating hours (${store.operatingHours}), and offer to take an advance Pre-Order.
  - NEVER hardcode 9:00 AM - 9:00 PM. Always use the live configured operating hours (${store.operatingHours}) and current Operating Status (${store.isOpen ? 'OPEN' : 'CLOSED'}).

2. ORDER PROCESSING & LOGISTICS RULES:
- Dining Modes: "Delivery", "Pick-up", "Dine-in".
- DINING MODE FIRST (CRITICAL):
  When the customer wants to checkout (e.g. "checkout na", "yes po", "proceed", "ayon lang po", "sige checkout") and dining mode has NOT been selected yet:
  You MUST set detected_action = "PROCEED_CHECKOUT", set extracted_data.dining_mode = null, and ask:
  "Sige po! Para sa ating checkout, ano po ang gagamitin nating dining mode: Delivery, Pick-up, o Dine-in po?"
  NEVER guess, assume, or default dining_mode to "Delivery"!
  NEVER ask for Name/Phone/Address/Landmark/Arriving time until the customer has explicitly chosen their dining mode!

- EXACT DETAILS FORMAT TO REQUEST FROM GUEST (STRICT):
  When asking for customer checkout details, you MUST use the exact template below depending on the dining mode:
  For Delivery:
Pakibigay po ang sumusunod para sa inyong order:
Name:
Phone number:
Address:
Landmark:
note:

  For Dine-in and Pick up:
Pakibigay po ang sumusunod para sa inyong order:
Name:
Phone number:
Arriving time:
note:
  (NEVER ask for Address or Landmark when dining mode is Dine-in or Pick-up! NEVER mention "rider" or "dispatch" when dining mode is Dine-in or Pick-up!)

- DRINK ADD-ONS & DECLINE HANDLING (CRITICAL):
  When asked about add-ons (Pearls, Nata de Coco, Cream Cheese, etc.), if the customer declines using ANY phrase such as "Ayaw po", "ayaw", "ayoko po", "wag na", "wala po", "wala", "no", or "skip":
  - Strictly accept the decline immediately! NEVER repeat the add-on prompt or say "Paki-pili po".
  - Retain the base drink in the cart!
  - Proceed immediately to ask for Dining Mode if not yet chosen: "Sige po, walang add-ons. Para sa ating checkout, ano po ang gagamitin nating dining mode: Delivery, Pick-up, o Dine-in po?"

- PAYMENT MODE STEP (CRITICAL):
  Once the customer provides their name and contact number (and address/arriving time), if Payment Mode (Cash or GCash) is not yet given, you MUST ask:
  "Ano po ang gagamitin ninyong Payment Mode: Cash o GCash?"
  Do not default to Cash without asking the customer first.

- CUSTOMER PHONE FORMATTING (CRITICAL TO PREVENT MESSENGER P2P GCASH CARD):
  Always format Philippine customer contact numbers with hyphens: 09XX-XXX-XXXX (e.g. 0912-345-6789). NEVER output unbroken continuous 11 digits (e.g. 09123456789) because Meta Messenger will mistakenly parse the customer's personal number as a recipient and display a "Transfer with GCash" card to the customer's own number!

- ORDER SUMMARY FORMAT (MANDATORY STANDARDIZED TEMPLATE):
  - When presenting or updating the order summary, you MUST STRICTLY follow this exact structure with clean linebreaks between fields without conversational deviations:

  [For Dine In / Pick-up]:
--- ORDER SUMMARY ---
Name: {Customer Name}
Phone number: {Phone Number}
Dining-mode: {Dine In / Pick-up}
Address: Diner's Cafe, Tondo, Manila
Discount: {None or Senior Citizen / PWD 20%}
Payment Mode: {Cash or GCash}

Orders:
- {Qty}x {Item Name}{Add-ons} (₱{Line Total})

Note: {Customer's note or None}

Subtotal: ₱{Subtotal}
Discount: ₱{Discount Amount}
Delivery Fee: ₱0.00
TOTAL AMOUNT DUE: ₱{Total Amount Due}

Tama po ba?

  [For Delivery]:
--- ORDER SUMMARY ---
Name: {Customer Name}
Phone number: {Phone Number}
Dining-mode: Delivery
Address: {Customer's address}
Landmark: {Customer's landmark or None}
Discount: {None or Senior Citizen / PWD 20%}
Payment Mode: {Cash or GCash}

Orders:
- {Qty}x {Item Name}{Add-ons} (₱{Line Total})

Note: {Customer's note or None}

Subtotal: ₱{Subtotal}
Discount: ₱{Discount Amount}
Delivery Fee: ₱{Delivery Fee}
TOTAL AMOUNT DUE: ₱{Total Amount Due}

Tama po ba?

  - Whenever the customer changes or updates any detail (e.g. changing payment mode to GCash, changing items/quantities, changing delivery address, phone, or dining mode), ALWAYS confirm the change and present the UPDATED ORDER SUMMARY immediately in the exact format above so the customer can review the latest details!
  - When the customer confirms the order summary (e.g. "Tama po", "Tama", "Oo, tama", "1", "Confirm", "Yes po"): set detected_action = "CONFIRM_ORDER" to finalize and submit the order. NEVER repeat the Order Summary or ask them to confirm again!
- In-house delivery radius is maximum ${Number(store.maxDeliveryRadiusKm || 3.0).toFixed(1)} km. If an address is beyond 3 km, inform them gently that it is outside our direct radius and can be arranged via third-party courier pending admin fee quote.
- Strict Order Tracking Separation:
  - If status is PENDING or PENDING_APPROVAL: Cashier is currently verifying order and payment details (approx 2-5 minutes). It is NOT yet cooking in the kitchen!
  - If status is IN_PREPARATION: Order is approved and actively cooking in the kitchen.
  - If status is DISPATCHED: Order is handed to the rider or ready at the counter.
- Delay Complaint: If customer complains of delay, empathize sincerely with their wait time and provide an honest status update based on their order state without repeating a robotic summary.
- Cancellation Policy:
  - (1) PENDING / PENDING_APPROVAL: Can be cancelled at ANY TIME with NO TIME LIMIT since food is not yet cooking in the kitchen.
  - (2) IN_PREPARATION: Has a 5-minute grace period from placement (within 5 minutes = forward to admin for verification; past 5 minutes = non-cancellable).
  - (3) DISPATCHED: Cannot be cancelled.

3. LIVE STORE CONTEXT:
- Store Name: ${store.name || "Diner's Cafe - Tondo Branch"}
- Operating Status: ${store.isOpen ? 'OPEN (Accepting live orders now; manual override or schedule active)' : 'CLOSED (Not accepting live orders; advance pre-orders only)'}
- Operating Hours: ${store.operatingHours}
- Manual Override: ${store.isManualOverride ? `ACTIVE (Admin manually set the store to ${store.status}. This OVERRIDES regular operating hours!)` : 'INACTIVE (Following regular operating hours schedule)'}
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
  "detected_action": "NONE | ADD_ITEM | REMOVE_ITEM | SET_ADDON | VIEW_CART | CLEAR_CART | VIEW_MENU | RECOMMEND_ITEM | SEND_PICTURE | SET_DETAILS | CONFIRM_ORDER | CANCEL_ORDER | CHECK_STATUS | DELAY_COMPLAINT | SUBMIT_FEEDBACK | PROCEED_CHECKOUT",
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
- CLEAR_CART: Customer explicitly requests to remove, delete, or empty their entire cart (e.g. "clear cart", "empty cart", "burahin ang cart"). NEVER use CLEAR_CART for short negative responses like "wag na", "wala", "no", "skip", or "pass" — those simply decline an add-on or upsell, NOT clearing the cart!
- VIEW_MENU: Customer asks to see the menu or list of offerings.
- RECOMMEND_ITEM: Customer asks for suggestions, specials, or bestsellers.
- SEND_PICTURE: Customer asks to see a photo of a specific dish/drink.
- SET_DETAILS: Customer provides checkout details (name, phone, address, landmark, time, dining mode, payment mode, note). Extract all provided fields. NEVER say "Handa na po ang inyong order" or claim cooking is ready, as the order is still in checkout and awaiting final confirmation.
- CONFIRM_ORDER: Customer finalizes/confirms checkout ("confirm", "proceed", "okay na").
- CANCEL_ORDER: Customer explicitly requests cancellation of their active order (e.g. "cancel order", "pa-cancel", "kanselahin", "ayoko na"). NEVER choose CANCEL_ORDER for customer ratings, reviews, past order complaints, or feedback (such as "4 lang kasi...", "3", "5 lang").
- CHECK_STATUS: Customer inquires about order progress or tracking.
- DELAY_COMPLAINT: Customer expresses frustration or asks why order is taking long.
- SUBMIT_FEEDBACK: Customer gives a rating, review, or feedback on food/service (e.g. "4 lang kasi...", "5 stars", "3", "5 lang", "masarap ang food"). Extract feedback_text.
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

  let customerName = rawData.customer_name ? String(rawData.customer_name).trim() : null;
  if (customerName && (
    /^(?:pa|paki|pa[- ]?add|pa[- ]?order|paki[- ]?add|kuya|ate|kuya\s+pa|ate\s+pa|sir|boss|maam|mam|bossing|sige\s+lahat\s*yan|sige\s*lahat|lahat\s*yan|sige|oo|opo|patingin|cart|menu|wait|hello|hi|yes|no)\b/i.test(customerName) ||
    customerName.length < 2 ||
    customerName.toLowerCase() === 'pa' ||
    customerName.toLowerCase() === 'kuya pa'
  )) {
    customerName = null;
  }
  const phoneNumber = rawData.phone_number ? String(rawData.phone_number).trim() : null;
  let address = rawData.address ? String(rawData.address).trim() : null;
  if (address && /^(?:sige\s+lahat\s*yan|sige\s*lahat|lahat\s*yan|sige|oo|opo|kuya|patingin)\b/i.test(address)) {
    address = null;
  }
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
  const healthyKeys = geminiService.getHealthyApiKeys ? geminiService.getHealthyApiKeys() : [resolveApiKey()].filter(Boolean);
  if (healthyKeys.length === 0) {
    return null;
  }

  const context = options.context || await loadOperationalContext(psid, session);
  const systemInstruction = buildAssistantSystemInstruction(context);
  const history = getConversationHistory(psid, session);
  const input = buildInputWithHistory(messageText, history);

  const timeoutMs = config.geminiTimeoutMs || 30000;
  const models = resolveModelChain(options.preferredModel);
  const startMs = Date.now();

  for (let kIdx = 0; kIdx < healthyKeys.length; kIdx++) {
    const selectedKey = healthyKeys[kIdx];
    const client = options.client || (geminiService.getClientForKey ? geminiService.getClientForKey(selectedKey) : getGenAIClient());
    if (!client || (!client.interactions?.create && !client.models?.generateContent)) continue;
    let keyHitQuota = false;

    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      const perAttemptTimeoutMs = Math.min(timeoutMs, 6000);

      try {
        let outputText = '';
        if (client.interactions?.create) {
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

            outputText = interaction?.output_text ||
              interaction?.steps
                ?.filter(s => s.type === 'model_output')
                ?.flatMap(s => s.content || [])
                ?.filter(c => c.type === 'text' && c.text)
                ?.map(c => c.text)
                ?.join('') ||
              '';
          } catch (interactErr) {
            if (/429|RESOURCE_EXHAUSTED/i.test(interactErr.message)) {
              throw interactErr;
            }
          }
        }

        if (!outputText && client.models?.generateContent) {
          try {
            const genResponse = await client.models.generateContent({
              model,
              contents: input,
              config: {
                systemInstruction,
                responseMimeType: 'application/json',
                responseSchema: ASSISTANT_RESPONSE_SCHEMA,
                temperature: 0.7
              }
            });
            outputText = genResponse?.text || '';
          } catch (genErr) {
            if (/429|RESOURCE_EXHAUSTED/i.test(genErr.message)) {
              throw genErr;
            }
          }
        }

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
        if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate\s*limit/i.test(msg)) {
          console.warn(`[aiService Multi-Key] Key ending in ...${selectedKey.slice(-6)} hit 429. Failing over immediately.`);
          keyHitQuota = true;
          break;
        }
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
    if (!keyHitQuota) break;
  }

  return null;
}

const DISCOUNT_ID_SCHEMA = {
  type: 'object',
  properties: {
    is_valid: {
      type: 'boolean',
      description: 'True if genuine Philippine Senior Citizen (OSCA) or PWD ID, unexpired, and matching customer name'
    },
    id_type: {
      type: 'string',
      enum: ['SENIOR_CITIZEN', 'PWD', 'INVALID'],
      description: 'Detected ID type'
    },
    extracted_name: {
      type: ['string', 'null'],
      description: 'Full name printed on the ID'
    },
    id_number: {
      type: ['string', 'null'],
      description: 'Identification number (OSCA ID or PWD card number)'
    },
    is_expired: {
      type: 'boolean',
      description: 'True if explicitly expired before current year 2026'
    },
    rejection_reason: {
      type: ['string', 'null'],
      description: 'Detailed explanation if invalid, non-qualifying, expired, or name mismatch'
    },
    name_matches_customer: {
      type: 'boolean',
      description: 'True if the name on the ID reasonably matches the customer name'
    }
  },
  required: ['is_valid', 'id_type', 'extracted_name', 'id_number', 'is_expired', 'rejection_reason', 'name_matches_customer']
};

/**
 * Generate a conversational structured response using Gemini (alias for generateAssistantResponse).
 */
async function generateConversationalResponse(psid, userMessage, context = null, options = {}) {
  const session = options.session || null;
  const mergedOptions = { ...options };
  if (context) mergedOptions.context = context;
  return generateAssistantResponse(psid, userMessage, session, mergedOptions);
}

/**
 * Verify a Senior Citizen (OSCA) or PWD ID image using Gemini Vision OCR with structured JSON output
 * and TiDB Cloud anti-abuse verification (>2 uses/day).
 */
async function verifyDiscountIdImage(imageUrlOrBase64, customerName = '', options = {}) {
  const client = options.client || getGenAIClient();
  const cName = String(customerName || '').trim();

  let verification = {
    is_valid: false,
    id_type: 'INVALID',
    extracted_name: null,
    id_number: null,
    is_expired: false,
    rejection_reason: 'Unable to process ID image.',
    name_matches_customer: false,
    discount_rate: 0.00
  };

  if (!imageUrlOrBase64) {
    verification.rejection_reason = 'No image provided for verification.';
    return verification;
  }

  if (options.mockResult) {
    verification = { ...verification, ...options.mockResult };
  } else if (!client) {
    verification.rejection_reason = 'AI Vision service is temporarily unavailable.';
    return verification;
  } else if (client.interactions?.create || client.models?.generateContent) {
    const prompt = `You are an expert fraud-detection AI inspecting Philippine Senior Citizen (OSCA) or Person with Disabilities (PWD) identification cards for Diner's Cafe.
Current year: 2026.
Customer Name to cross-reference: "${cName}".

INSPECTION RULES:
1. Genuine OSCA / Senior Citizen ID: Issued by Republic of the Philippines Office of Senior Citizens Affairs (OSCA) or City/Municipality.
2. Genuine PWD ID: Issued by National Council on Disability Affairs (NCDA) or City/Municipal Social Welfare and Development Office (MSWDO/PDAO).
3. Extract the full name printed on the card and the ID number.
4. If the card explicitly shows an expiration date prior to 2026, flag is_expired = true and rejection_reason = "Expired ID card".
5. REJECT: Driver's licenses, student/school IDs, company badges, random selfies, blurry photos, or stock/sample photos found online. Set id_type = "INVALID", is_valid = false.
6. Verify whether extracted_name reasonably matches "${cName}". If names clearly do not match, set name_matches_customer = false, is_valid = false.`;

    try {
      const models = resolveModelChain(options.preferredModel || 'gemini-2.5-flash');
      for (const model of models) {
        try {
          let outputText = '';
          if (client.interactions?.create) {
            const interaction = await client.interactions.create({
              model,
              input: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: imageUrlOrBase64 } }
              ],
              generation_config: { temperature: 0.1 },
              response_format: {
                type: 'text',
                mime_type: 'application/json',
                schema: DISCOUNT_ID_SCHEMA
              }
            });
            outputText = interaction?.output_text || '';
          } else if (client.models?.generateContent) {
            const response = await client.models.generateContent({
              model,
              contents: [
                {
                  role: 'user',
                  parts: [
                    { text: prompt },
                    { text: `Image URL: ${imageUrlOrBase64}` }
                  ]
                }
              ]
            });
            outputText = response?.text || '';
          }

          if (outputText) {
            const parsed = parseAssistantJson(outputText);
            if (parsed && typeof parsed.is_valid === 'boolean') {
              verification = {
                is_valid: Boolean(parsed.is_valid),
                id_type: parsed.id_type || 'INVALID',
                extracted_name: parsed.extracted_name || null,
                id_number: parsed.id_number || null,
                is_expired: Boolean(parsed.is_expired),
                rejection_reason: parsed.rejection_reason || null,
                name_matches_customer: Boolean(parsed.name_matches_customer),
                discount_rate: parsed.is_valid ? 0.20 : 0.00
              };
              break;
            }
          }
        } catch (modelErr) {
          console.warn(`[verifyDiscountIdImage] Model ${model} failed:`, modelErr.message);
        }
      }
    } catch (err) {
      console.warn('[verifyDiscountIdImage Error]', err.message);
    }
  }

  // 3-Layer Check: Anti-abuse TiDB validation (>2 uses/day across accounts)
  if (verification.is_valid && verification.id_number) {
    try {
      const [rows] = await db.query(
        `SELECT COUNT(*) AS count FROM orders 
         WHERE (customer_notes LIKE ? OR note LIKE ?) 
           AND created_at >= datetime('now', 'start of day')`,
        [`%${verification.id_number}%`, `%${verification.id_number}%`]
      );
      const count = rows && rows[0] ? Number(rows[0].count) : 0;
      if (count >= 2) {
        verification.is_valid = false;
        verification.rejection_reason = 'Limit of 2 discount uses per day exceeded for this ID card.';
        verification.discount_rate = 0.00;
      }
    } catch (_) { }
  }

  return verification;
}

module.exports = {
  PRIMARY_AI_MODEL,
  MAX_CONVERSATION_MESSAGES,
  DETECTED_ACTIONS,
  ASSISTANT_RESPONSE_SCHEMA,
  DISCOUNT_ID_SCHEMA,
  normalizeModelName,
  isAiConfigured,
  getConversationHistory,
  appendConversationTurn,
  clearConversationHistory,
  loadOperationalContext,
  buildAssistantSystemInstruction,
  parseAssistantJson,
  buildInputWithHistory,
  generateAssistantResponse,
  generateConversationalResponse,
  verifyDiscountIdImage
};

