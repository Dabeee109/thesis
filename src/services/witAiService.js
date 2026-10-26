/**
 * Wit.ai Natural Language Understanding (NLU) Service (Task 3)
 * Detects customer intents and extracts structured entities (items, quantities, payment, order type).
 */

const config = require('../config/config');

const NLP_MAX_TEXT_LEN = parseInt(process.env.NLP_MAX_TEXT_LEN, 10) || 500;

const INTENT_MAP = {
  greet: 'GREETING',
  browse_menu: 'BROWSE_MENU',
  place_order: 'ORDER_ITEM',
  remove_item: 'REMOVE_ITEM',
  view_cart: 'VIEW_CART',
  clear_cart: 'CLEAR_CART',
  checkout: 'CHECKOUT',
  confirm_yes: 'CONFIRM_YES',
  confirm_no: 'CONFIRM_NO',
  track_order: 'TRACK_ORDER',
  store_info: 'STORE_INFO',
  request_agent: 'REQUEST_AGENT',
  out_of_scope: 'OUT_OF_SCOPE'
};

/**
 * Maps Wit.ai intent name using exact match
 * @param {string} witIntent 
 * @returns {string} System intent constant or 'UNKNOWN'
 */
function mapWitIntent(witIntent) {
  if (!witIntent || typeof witIntent !== 'string') return 'UNKNOWN';
  const clean = witIntent.trim().toLowerCase();
  return INTENT_MAP[clean] || 'UNKNOWN';
}

/**
 * Query Wit.ai NLU API for intent and entity extraction
 * Truncates text longer than NLP_MAX_TEXT_LEN
 * @param {string} message - Customer input text
 * @returns {Promise<Object>} - Parsed intent and entities
 */
async function queryWitAi(message) {
  const token = config.witAi?.serverAccessToken;
  const rawText = String(message || '').trim();
  const text = rawText.length > NLP_MAX_TEXT_LEN ? rawText.substring(0, NLP_MAX_TEXT_LEN) : rawText;

  if (token && typeof fetch !== 'undefined') {
    try {
      const url = `https://api.wit.ai/message?v=20240304&q=${encodeURIComponent(text)}`;
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });

      if (res.ok) {
        const data = await res.json();
        return parseWitResponse(data, text);
      }
    } catch (err) {
      console.warn('[Wit.ai NLU] API request failed, switching to local intent parser:', err.message);
    }
  }

  // Fallback: Local rule-based NLU parser
  return localNluParse(text);
}

/**
 * Retrieve entity object from Wit.ai entities dictionary.
 * Matches exact name or name:role (e.g. 'menu_item' matches 'menu_item:menu_item').
 * Also handles number roles (e.g. wit$number:number, wit$number:quantity).
 * 
 * @param {Object} entities 
 * @param {string} name 
 * @returns {Object|null} { value, confidence, start, end } or null
 */
function getEntity(entities, name) {
  if (!entities || typeof entities !== 'object' || !name) return null;

  const target = String(name).toLowerCase().trim();

  for (const [key, arr] of Object.entries(entities)) {
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const kLower = key.toLowerCase().trim();
    const isMatch = (
      kLower === target ||
      kLower.startsWith(`${target}:`) ||
      (target === 'quantity' && (kLower === 'wit$number' || kLower.startsWith('wit$number:') || kLower === 'number')) ||
      (target === 'number' && (kLower === 'wit$number' || kLower.startsWith('wit$number:')))
    );

    if (isMatch) {
      const ent = arr[0];
      const val = ent.value !== undefined ? ent.value : ent.body;
      return {
        value: val,
        confidence: ent.confidence !== undefined ? ent.confidence : 1.0,
        start: ent.start ?? 0,
        end: ent.end ?? 0
      };
    }
  }

  return null;
}

/**
 * Get entity value string/number or null
 */
function getEntityValue(entities, name) {
  const ent = getEntity(entities, name);
  return ent ? ent.value : null;
}

/**
 * Format Wit.ai API Response into standardized structure.
 * Supports multi-item pairing with nearest preceding numbers.
 */
function parseWitResponse(witData, originalText) {
  const intents = witData?.intents || [];
  const topIntentName = intents.length > 0 ? intents[0].name : '';
  const confidence = intents.length > 0 ? (intents[0].confidence || 0) : 0;
  const intent = mapWitIntent(topIntentName);

  const entities = witData?.entities || {};

  // Extract all menu_item entities
  const allMenuItems = [];
  for (const [key, arr] of Object.entries(entities)) {
    if (!Array.isArray(arr)) continue;
    const kLower = key.toLowerCase();
    if (kLower === 'menu_item' || kLower.startsWith('menu_item:') || kLower === 'food' || kLower.startsWith('food:')) {
      for (const ent of arr) {
        const val = ent.value !== undefined ? ent.value : ent.body;
        if (val) {
          allMenuItems.push({
            value: val,
            start: ent.start ?? 0,
            end: ent.end ?? 0,
            confidence: ent.confidence ?? 1.0
          });
        }
      }
    }
  }
  allMenuItems.sort((a, b) => a.start - b.start);

  // Extract all number / quantity entities
  const allNumbers = [];
  for (const [key, arr] of Object.entries(entities)) {
    if (!Array.isArray(arr)) continue;
    const kLower = key.toLowerCase();
    if (
      kLower === 'quantity' || kLower.startsWith('quantity:') ||
      kLower === 'number' || kLower.startsWith('number:') ||
      kLower === 'wit$number' || kLower.startsWith('wit$number:')
    ) {
      for (const ent of arr) {
        const numVal = parseInt(ent.value !== undefined ? ent.value : ent.body, 10);
        if (!isNaN(numVal) && numVal > 0) {
          allNumbers.push({
            value: numVal,
            start: ent.start ?? 0,
            end: ent.end ?? 0,
            confidence: ent.confidence ?? 1.0
          });
        }
      }
    }
  }
  allNumbers.sort((a, b) => a.start - b.start);

  // Pair each menu_item with the nearest preceding number entity in the same clause
  const menuItems = allMenuItems.map((item, idx) => {
    const prevItemEnd = idx > 0 ? allMenuItems[idx - 1].end : 0;
    // Numbers between previous item and this item
    const candidateNums = allNumbers.filter(n => n.start >= prevItemEnd && n.start < item.start);
    let pairedQty = null;
    if (candidateNums.length > 0) {
      // Pick the nearest preceding number
      const nearest = candidateNums[candidateNums.length - 1];
      pairedQty = nearest.value;
    }
    return {
      value: item.value,
      quantity: pairedQty
    };
  });

  // Top-level quantity: null when absent
  let quantity = null;
  if (menuItems.length > 0) {
    quantity = menuItems[0].quantity;
  } else if (allNumbers.length > 0) {
    quantity = allNumbers[0].value;
  }

  const paymentMethod = getEntityValue(entities, 'payment_method');
  const orderType = getEntityValue(entities, 'order_type');

  return {
    intent,
    confidence,
    menuItems,
    menuItem: menuItems[0]?.value || null,
    quantity,
    paymentMethod,
    orderType,
    raw: witData
  };
}

/**
 * Local Rule-based NLU Engine (Taglish High-Precision Fallback Parser)
 * Confidence scoring:
 * - 0.6 for regex hits
 * - 0.0 for menu-item fallback
 * - Added new intents: remove_item, checkout
 */
function localNluParse(text) {
  const rawText = (text || '').trim();
  const lower = rawText.toLowerCase();

  let intent = 'UNKNOWN';
  let confidence = 0.0;
  let menuItem = null;
  let quantity = null;
  let paymentMethod = null;
  let orderType = null;

  // Phone number
  const phoneMatch = rawText.match(/(?:\+63|0)9\d{9}/);
  const phone = phoneMatch ? phoneMatch[0] : null;

  // Payment method
  if (/\b(?:gcash|g-cash)\b/i.test(lower)) paymentMethod = 'gcash';
  if (/\b(?:cash|cod|cash on delivery)\b/i.test(lower)) paymentMethod = 'cash';

  // Order type
  if (/\b(?:delivery|deliver|i-deliver)\b/i.test(lower)) orderType = 'delivery';
  if (/\b(?:pickup|pick-up|takeout|pick up)\b/i.test(lower)) orderType = 'pickup';

  // Quantity detection from text
  const numMatch = lower.match(/\b([1-9][0-9]?)\b/);
  if (numMatch) {
    quantity = parseInt(numMatch[1], 10);
  }

  // Intent patterns (returns 0.6 for regex hits)
  if (/^(?:hi|hello|hey|good\s*morning|kamusta|musta|hola)\b/i.test(lower)) {
    intent = 'GREETING';
    confidence = 0.6;
  } else if (/^(?:yes|yep|yeah|sure|ok|okay|k|go\s*ahead|proceed|sige|opo|oo)\b/i.test(lower)) {
    intent = 'CONFIRM_YES';
    confidence = 0.6;
  } else if (/^(?:no|nope|not\s*yet|wait|hindi\s*pa|mamaya\s*na|hindi|ayaw|sandali)\b/i.test(lower)) {
    intent = 'CONFIRM_NO';
    confidence = 0.6;
  } else if (/\b(?:remove|take\s*out|delete|cancel\s+(?:the|my)|alisin|tanggalin)\b/i.test(lower)) {
    intent = 'REMOVE_ITEM';
    confidence = 0.6;
    const cleaned = lower
      .replace(/\b(?:remove|take\s*out|delete|cancel\s+(?:the|my)|alisin|tanggalin)\b/gi, ' ')
      .replace(/\b(?:the|a|an|ang|yung|ng|sa|item|orders?|\d+)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length >= 3) menuItem = cleaned;
  } else if (/\b(?:start\s*over|empty\s*(?:my\s*)?cart|clear\s*(?:my\s*)?cart|reset\s*cart|clear\s*everything)\b/i.test(lower)) {
    intent = 'CLEAR_CART';
    confidence = 0.6;
  } else if (/\b(?:checkout|check\s*out|pay\s*now|that's\s*all|i'm\s*done|bayad\s*na)\b/i.test(lower)) {
    intent = 'CHECKOUT';
    confidence = 0.6;
  } else if (/\b(?:my\s*cart|view\s*cart|cart|magkano\s*na|what did i order)\b/i.test(lower) || lower === 'cart') {
    intent = 'VIEW_CART';
    confidence = 0.6;
  } else if (/\b(?:menu|show\s*menu|what(?:'s|\s+is)\s+available|do you have|drinks|food|pastries)\b/i.test(lower)) {
    intent = 'BROWSE_MENU';
    confidence = 0.6;
  } else if (/\b(?:track|where(?:'s|\s+is)\s+my\s+order|order\s+status|asan\s+na)\b/i.test(lower)) {
    intent = 'TRACK_ORDER';
    confidence = 0.6;
  } else if (/\b(?:hours|location|address|contact\s+number|store\s+hours|wifi)\b/i.test(lower)) {
    intent = 'STORE_INFO';
    confidence = 0.6;
  } else if (/\b(?:talk\s+to\s+staff|human|agent|real\s+person|customer\s+service)\b/i.test(lower)) {
    intent = 'REQUEST_AGENT';
    confidence = 0.6;
  } else if (/\b(?:order|pabili|add|one\s+more|isa\s+pang)\b/i.test(lower)) {
    intent = 'ORDER_ITEM';
    confidence = 0.6;
    const cleaned = lower
      .replace(/\b(?:order|pabili|add|one\s+more|isa\s+pang|pa-order\s+po\s+ng)\b/gi, ' ')
      .replace(/\b(?:\d+|pcs|cups|servings)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length >= 3) menuItem = cleaned;
  } else if (rawText.length >= 3) {
    // Menu-item fallback guess with 0.0 confidence
    intent = 'ORDER_ITEM';
    confidence = 0.0;
    menuItem = rawText;
  }

  const menuItems = menuItem ? [{ value: menuItem, quantity }] : [];

  return {
    intent,
    confidence,
    menuItems,
    menuItem,
    quantity,
    paymentMethod,
    orderType,
    phone,
    raw: { text: rawText }
  };
}

module.exports = {
  INTENT_MAP,
  mapWitIntent,
  queryWitAi,
  getEntity,
  getEntityValue,
  parseWitResponse,
  localNluParse
};
