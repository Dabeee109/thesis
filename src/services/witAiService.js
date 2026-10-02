/**
 * Wit.ai Natural Language Understanding (NLU) Service (FR2, FR5)
 * Detects customer intents and extracts structured entities (items, quantities, addresses, contact info).
 * 
 * Supports both live Wit.ai HTTP API calls and high-precision local fallback parser.
 */

const config = require('../config/config');

/**
 * Query Wit.ai NLU API for intent and entity extraction
 * @param {string} message - Customer input text
 * @returns {Promise<Object>} - Parsed intent and entities
 */
async function queryWitAi(message) {
  const token = config.witAi?.serverAccessToken;

  if (token && typeof fetch !== 'undefined') {
    try {
      const url = `https://api.wit.ai/message?v=20240304&q=${encodeURIComponent(message)}`;
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });

      if (res.ok) {
        const data = await res.json();
        return parseWitResponse(data, message);
      }
    } catch (err) {
      console.warn('[Wit.ai NLU] API request failed, switching to local intent parser:', err.message);
    }
  }

  // Fallback: Local rule-based NLU parser
  return localNluParse(message);
}

/**
 * Format Wit.ai API Response into standardized structure
 */
function parseWitResponse(witData, originalText) {
  const intents = witData.intents || [];
  const topIntent = intents.length > 0 ? intents[0].name : 'UNKNOWN';
  const confidence = intents.length > 0 ? intents[0].confidence : 0;

  const entities = witData.entities || {};
  const extracted = {
    intent: mapWitIntent(topIntent, originalText),
    confidence,
    menuItem: getEntityValue(entities, 'menu_item') || getEntityValue(entities, 'food') || null,
    quantity: parseInt(getEntityValue(entities, 'wit$number:quantity') || getEntityValue(entities, 'number') || '1', 10),
    paymentMethod: getEntityValue(entities, 'payment_method') || null,
    address: getEntityValue(entities, 'wit$location:address') || getEntityValue(entities, 'location') || null,
    phone: getEntityValue(entities, 'wit$phone_number:phone') || getEntityValue(entities, 'phone_number') || null,
    raw: witData
  };

  return extracted;
}

function getEntityValue(entities, key) {
  if (entities[key] && entities[key].length > 0) {
    return entities[key][0].value || entities[key][0].body;
  }
  return null;
}

/**
 * Maps Wit.ai intent names to system intent constants
 */
function mapWitIntent(witIntent, text) {
  const lower = (witIntent || '').toLowerCase();
  if (lower.includes('order') || lower.includes('buy') || lower.includes('add')) return 'ORDER_ITEM';
  if (lower.includes('menu') || lower.includes('catalog') || lower.includes('browse')) return 'BROWSE_MENU';
  if (lower.includes('cart') || lower.includes('checkout') || lower.includes('bill')) return 'VIEW_CART';
  if (lower.includes('track') || lower.includes('status') || lower.includes('where')) return 'TRACK_ORDER';
  if (lower.includes('store') || lower.includes('hour') || lower.includes('location')) return 'STORE_INFO';
  if (lower.includes('greet') || lower.includes('hello') || lower.includes('hi')) return 'GREETING';
  if (lower.includes('clear') || lower.includes('cancel') || lower.includes('reset')) return 'CLEAR_CART';

  // Fallback to text inspection
  return localNluParse(text).intent;
}

/**
 * Local Rule-based NLU Engine (Zero external latency fallback)
 */
function localNluParse(text) {
  const lower = (text || '').toLowerCase().trim();

  let intent = 'UNKNOWN';
  let menuItem = null;
  let quantity = 1;
  let paymentMethod = null;
  let address = null;
  let phone = null;

  // Extract quantity (e.g. "2 iced caramel macchiato", "3 pcs")
  const qtyMatch = lower.match(/\b(\d+)\s*(?:pcs|pieces|orders|order|cups|cup|x)?\b/);
  if (qtyMatch) {
    quantity = parseInt(qtyMatch[1], 10);
  }

  // Extract Phone Number (e.g. 09171234567, +639171234567)
  const phoneMatch = text.match(/(?:\+63|0)9\d{9}/);
  if (phoneMatch) {
    phone = phoneMatch[0];
  }

  // Detect payment method
  if (/gcash|g-cash/i.test(lower)) paymentMethod = 'gcash';
  if (/cash|cod|cash on delivery/i.test(lower)) paymentMethod = 'cash';

  // Intent classification
  if (/^(hi|hello|hey|good morning|good afternoon|good evening|start|kamusta|hola)\b/i.test(lower)) {
    intent = 'GREETING';
  } else if (/(menu|food|drink|coffee|pastry|meal|snack|categories|catalog)/i.test(lower)) {
    intent = 'BROWSE_MENU';
  } else if (/(cart|basket|checkout|my order|bill|total)/i.test(lower)) {
    intent = 'VIEW_CART';
  } else if (/(track|status|where is my order|delivery status|asan na|nasaan)/i.test(lower)) {
    intent = 'TRACK_ORDER';
  } else if (/(hours|time|open|closing|location|address|contact|number|wifi)/i.test(lower)) {
    intent = 'STORE_INFO';
  } else if (/(clear|reset|cancel order|restart)/i.test(lower)) {
    intent = 'CLEAR_CART';
  } else {
    // Menu item matching pattern
    intent = 'MENU_ITEM_SEARCH';
    menuItem = text;
  }

  return {
    intent,
    confidence: 0.95,
    menuItem,
    quantity,
    paymentMethod,
    address,
    phone,
    raw: { text }
  };
}

module.exports = {
  queryWitAi,
  localNluParse
};
