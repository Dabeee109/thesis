/**
 * Batch Cart Mutation Service (Issue 2)
 * Handles silent & atomic batch adding and removing of multiple items
 * with zero intermediate confirmation questions.
 */

const { peso, matchItems } = require('./textMatch');
const { parseRemovalRequests, executeMultiItemRemoval, isRemovalIntent } = require('./removalService');

const BATCH_ADD_REGEX = /\b(?:pa[- ]?order|order|pa[- ]?dagdag|dagdag|padagdag|pabili|add|pa[- ]?add|gusto\s*ko\s*ng|paki[- ]?add)\b/i;
const BATCH_REMOVE_REGEX = /\b(?:pa\s*tanggal|patanggal|pa\s*tangal|patangal|tanggal(?:in)?|tangal(?:in)?|tatanggalin|tnggal|pa\s*alis|paalis|alis(?:in|en)?|pa\s*bawas|pabawas|bawas(?:an)?|remove|remov|delete|del|drop|minus|wag\s*na(?:\s*yung)?|huwag\s*na(?:\s*yung)?|ayaw\s*ko\s*na\s*ng)\b/i;

const NUMBER_WORDS = {
  'isa': 1, 'isang': 1, 'one': 1, '1': 1,
  'dalawa': 2, 'dalawang': 2, 'two': 2, '2': 2,
  'tatlo': 3, 'tatlong': 3, 'three': 3, '3': 3,
  'apat': 4, 'apat na': 4, 'four': 4, '4': 4,
  'lima': 5, 'limang': 5, 'five': 5, '5': 5,
  'anim': 6, 'anim na': 6, 'six': 6, '6': 6,
  'pito': 7, 'pitong': 7, 'seven': 7, '7': 7,
  'walo': 8, 'walong': 8, 'eight': 8, '8': 8,
  'siyam': 9, 'siyam na': 9, 'nine': 9, '9': 9,
  'sampu': 10, 'sampung': 10, 'ten': 10, '10': 10
};

function isBatchRemoveIntent(text) {
  if (!text || typeof text !== 'string') return false;
  return BATCH_REMOVE_REGEX.test(text.toLowerCase());
}

/**
 * Detect multi-item ordering queries (comma separated items, conjunctions like "and", "tsaka",
 * or multiple quantity markers)
 */
function isMultiItemOrderText(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  if (!t) return false;

  const foodKeywords = /\b(?:pizza|burger|fries|ribs|matcha|tea|coffee|latte|milktea|nachos|chicken|wings|pasta|spaghetti|carbonara|rice|silog|steak|quesadilla|nuggets|drinks?|meals?|ulam|kape|order|pa-?order|pabili|add|x|\d+|isa|isang|dalawa|dalawang|tatlo|tatlong|apat|lima|one|two|three|four|five)\b/i;

  const commaSegments = t.split(',').map(s => s.trim()).filter(Boolean);
  if (commaSegments.length >= 2) {
    const foodSegmentCount = commaSegments.filter(seg => foodKeywords.test(seg)).length;
    if (foodSegmentCount >= 2) {
      return true;
    }
  }

  // Conjunctions connecting multiple items (e.g., "1 burger and 1 fries", "pizza tsaka milktea")
  if (/\b(?:and|tsaka|saka|tapos|pati|\+)\b/i.test(t)) {
    const conjParts = t.split(/\b(?:and|tsaka|saka|tapos|pati|\+)\b/i).map(s => s.trim()).filter(Boolean);
    const foodCount = conjParts.filter(p => foodKeywords.test(p)).length;
    if (foodCount >= 2) {
      return true;
    }
  }

  // Multiple quantity markers followed by item words, e.g. "1 burger 2 fries"
  const qtyMatches = t.match(/\b(?:\d+|isang?|dalawang?|tatlong?|apat(?: na)?|limang?|anim(?: na)?|pitong?|walong?|siyam(?: na)?|sampung?|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:x|pcs|pieces|orders?|cups?|servings?)?\s+[a-zA-Z]/gi);
  if (qtyMatches && qtyMatches.length >= 2) {
    return true;
  }

  return false;
}

function isBatchAddIntent(text) {
  if (!text || typeof text !== 'string') return false;
  // If remove keyword is present, it's NOT an add intent
  if (isBatchRemoveIntent(text)) return false;
  return BATCH_ADD_REGEX.test(text.toLowerCase()) || isMultiItemOrderText(text);
}

/**
 * Parse and atomically add multiple items to the session cart
 * @param {Array} cart - Active session cart
 * @param {string} text - Raw user message
 * @param {Array} menuItems - Live menu catalog from database
 * @returns {Array} addedItems - [{ name, qty, price, lineTotal }]
 */
function executeBatchAdd(cart, text, menuItems = []) {
  if (!Array.isArray(cart)) return [];

  let clean = text.trim();
  clean = clean.replace(BATCH_ADD_REGEX, ' ');
  clean = clean.replace(/\b(?:po|paki|pakisuyo|pwede(?:\s+po)?(?:\s+pa)?)\b/gi, ' ');
  clean = clean.replace(/^\s*(?:ng|yung|mga)\s+/gi, ' ').trim();

  // Split on conjunctions, commas, OR lookaheads for digits/number words
  const splitRegex = /(?:,\s*|\s+(?:and|tsaka|saka|tapos|pati|\bat\b|\+)\s*|(?<=\S)\s+(?=(?:\d+|isang?|dalawang?|tatlong?|apat(?: na)?|limang?|anim(?: na)?|pitong?|walong?|siyam(?: na)?|sampung?|one|two|three|four|five|six|seven|eight|nine|ten)\b))/i;

  const segments = clean.split(splitRegex).map(s => s.trim()).filter(Boolean);
  const addedItems = [];

  for (const seg of segments) {
    let rawSeg = seg.trim();
    if (!rawSeg) continue;

    let qty = 1;
    const qtyMatch = rawSeg.match(/^(\d+|isang?|dalawang?|tatlong?|apat(?: na)?|limang?|anim(?: na)?|pitong?|walong?|siyam(?: na)?|sampung?|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:x|na|ng)?\s*(.*)$/i);

    let itemQuery = rawSeg;
    if (qtyMatch) {
      const wordKey = qtyMatch[1].toLowerCase().trim();
      qty = NUMBER_WORDS[wordKey] || parseInt(wordKey, 10) || 1;
      itemQuery = (qtyMatch[2] || '').trim();
    }

    itemQuery = itemQuery.replace(/\b(?:po|ng|yung|mga|ko|na)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    if (!itemQuery) continue;

    // Direct fuzzy match against menuItems
    const matchRes = matchItems(itemQuery, menuItems);
    if (matchRes && matchRes.matches && matchRes.matches.length > 0) {
      const matched = matchRes.matches[0];
      const targetItem = matched.item || matched;
      const unitPrice = parseFloat(targetItem.price || 0);

      // Guard: Check stock and availability (Requirement 4)
      const stock = targetItem.stock_quantity !== undefined ? targetItem.stock_quantity : 999;
      const isAvail = targetItem.is_available === undefined || targetItem.is_available === 1 || targetItem.is_available === true;
      if (stock <= 0 || !isAvail) {
        if (!addedItems.outOfStockItems) addedItems.outOfStockItems = [];
        addedItems.outOfStockItems.push(targetItem.name);
        continue;
      }

      // Mutate cart directly without intermediate questions
      const existingIdx = cart.findIndex(c => (c.menuItemId && c.menuItemId === targetItem.id) || c.name.toLowerCase() === targetItem.name.toLowerCase());
      if (existingIdx !== -1) {
        cart[existingIdx].quantity += qty;
      } else {
        cart.push({
          menuItemId: targetItem.id,
          id: targetItem.id,
          name: targetItem.name,
          price: unitPrice,
          quantity: qty
        });
      }

      addedItems.push({
        name: targetItem.name,
        qty,
        price: unitPrice,
        lineTotal: unitPrice * qty
      });
    }
  }

  return addedItems;
}

/**
 * Format the standard cart update response layout
 */
function formatUpdatedCartResponse(cart) {
  if (!Array.isArray(cart) || cart.length === 0) {
    return {
      text: `Updated na po ang inyong cart!\n\nWala na pong laman ang inyong cart.\n\nMag-browse po ulit sa menu kung nais mag-order!`,
      quickReplies: [
        { title: '📖 View Menu', payload: 'MENU' }
      ]
    };
  }

  const itemsList = cart.map(c => `- ${c.quantity}x ${c.name} (${peso((c.price || 0) * c.quantity)})`).join('\n');
  const cartTotal = cart.reduce((sum, c) => sum + ((c.price || 0) * (c.quantity || 1)), 0);

  const text = `Updated na po ang inyong cart!\n\n**Your cart:**\n${itemsList}\n**Total: ${peso(cartTotal)}**\n\nGusto niyo pa po bang magdagdag o mag-checkout na?`;

  return {
    text,
    quickReplies: [
      { title: '🛒 Checkout', payload: 'CONFIRM_CHECKOUT' },
      { title: '➕ Magdagdag', payload: 'KEEP_SHOPPING' }
    ]
  };
}

module.exports = {
  isBatchAddIntent,
  isBatchRemoveIntent,
  isMultiItemOrderText,
  executeBatchAdd,
  executeBatchRemove: executeMultiItemRemoval,
  formatUpdatedCartResponse
};

