/**
 * Multi-Item Removal & Fuzzy Tolerance Service (Issue 1 & Issue 3)
 * Handles multi-item atomic removal in a single turn with slang, typo tolerance, and number words.
 */

const { peso } = require('./textMatch');

// Comprehensive regex for removal keywords, affixes, slang, and typo variations
const REMOVAL_REGEX = /\b(?:pa\s*tanggal|patanggal|pa\s*tangal|patangal|tanggal(?:in)?|tangal(?:in)?|tatanggalin|tnggal|pa\s*alis|paalis|alis(?:in|en)?|pa\s*bawas|pabawas|bawas(?:an)?|remove|remov|delete|del|drop|minus|wag\s*na(?:\s*yung)?|huwag\s*na(?:\s*yung)?|ayaw\s*ko\s*na\s*ng)\b/i;

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
  'sampu': 10, 'sampung': 10, 'ten': 10, '10': 10,
  'lahat': 999, 'all': 999
};

function levenshteinDistance(s1, s2) {
  const a = String(s1 || '').toLowerCase().trim();
  const b = String(s2 || '').toLowerCase().trim();
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const d = [];
  for (let i = 0; i <= a.length; i++) d[i] = [i];
  for (let j = 0; j <= b.length; j++) d[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
    }
  }
  return d[a.length][b.length];
}

/**
 * Check if the text expresses a removal intent
 */
function isRemovalIntent(text) {
  if (!text || typeof text !== 'string') return false;
  return REMOVAL_REGEX.test(text.toLowerCase());
}

/**
 * Match a query string against items currently in the cart
 * Supports exact match, substring match, word overlap, and Levenshtein distance <= 2
 */
function matchCartItem(query, cart) {
  if (!query || !cart || cart.length === 0) return null;
  const qClean = query.toLowerCase().trim().replace(/^(?:yung|ang|mga|na|ng|po)\s+/gi, '').trim();
  if (!qClean) return null;

  let bestMatch = null;
  let bestScore = -1;

  for (const item of cart) {
    const itemName = String(item.name || '').toLowerCase().trim();

    // 1. Exact match
    if (itemName === qClean) {
      return item;
    }

    // 2. Substring containment
    if (itemName.includes(qClean) || qClean.includes(itemName)) {
      const score = 0.9 - Math.abs(itemName.length - qClean.length) * 0.01;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = item;
      }
      continue;
    }

    // 3. Significant word token overlap
    const qTokens = qClean.split(/\s+/).filter(t => t.length > 2);
    const itemTokens = itemName.split(/\s+/).filter(t => t.length > 2);
    const matchedTokens = qTokens.filter(t => itemTokens.some(it => it.includes(t) || it === t || levenshteinDistance(it, t) <= 1));

    if (matchedTokens.length > 0) {
      const tokenScore = (matchedTokens.length / Math.max(qTokens.length, 1)) * 0.85;
      if (tokenScore > bestScore) {
        bestScore = tokenScore;
        bestMatch = item;
      }
    }

    // 4. Levenshtein edit distance on entire phrase (threshold <= 2)
    const dist = levenshteinDistance(qClean, itemName);
    if (dist <= 2) {
      const levScore = 0.88 - (dist * 0.05);
      if (levScore > bestScore) {
        bestScore = levScore;
        bestMatch = item;
      }
    }
  }

  return bestScore >= 0.4 ? bestMatch : null;
}

/**
 * Extract multiple removal requests from freeform text
 * Example: "Pa tanggal po ng 2 qwertys 1 signature spanish latte 2 caramel macchiato and 2 grilled chicken"
 */
function parseRemovalRequests(text, cart = []) {
  if (!text || typeof text !== 'string') return [];

  let clean = text.trim();

  // Strip leading polite markers and removal keywords
  clean = clean.replace(REMOVAL_REGEX, ' ');
  clean = clean.replace(/\b(?:po|paki|pakisuyo|pakitanggal|pwede(?:\s+po)?(?:\s+pa)?)\b/gi, ' ');
  clean = clean.replace(/^\s*(?:ng|yung|mga)\s+/gi, ' ').trim();

  // Split into multi-item segments using conjunctions, commas, OR numbers followed by item words
  const splitRegex = /(?:,\s*|\s+(?:and|tsaka|saka|tapos|pati|\bat\b|\+)\s*|(?<=\S)\s+(?=(?:\d+|isang?|dalawang?|tatlong?|apat(?: na)?|limang?|anim(?: na)?|pitong?|walong?|siyam(?: na)?|sampung?|one|two|three|four|five|six|seven|eight|nine|ten|lahat|all)\b))/i;

  const segments = clean.split(splitRegex)
    .map(s => s.trim())
    .filter(Boolean);

  const results = [];

  for (const seg of segments) {
    let rawSeg = seg.trim();
    if (!rawSeg) continue;

    // Check for number words or digits at the beginning of the segment
    let qty = 1;
    const qtyMatch = rawSeg.match(/^(\d+|isang?|dalawang?|tatlong?|apat(?: na)?|limang?|anim(?: na)?|pitong?|walong?|siyam(?: na)?|sampung?|one|two|three|four|five|six|seven|eight|nine|ten|lahat|all)\s*(?:x|na|ng)?\s*(.*)$/i);

    let itemQuery = rawSeg;

    if (qtyMatch) {
      const wordKey = qtyMatch[1].toLowerCase().trim();
      qty = NUMBER_WORDS[wordKey] || parseInt(wordKey, 10) || 1;
      itemQuery = (qtyMatch[2] || '').trim();
    }

    // Clean up filler words from itemQuery
    itemQuery = itemQuery.replace(/\b(?:po|ng|yung|mga|ko|na)\b/gi, ' ').replace(/\s+/g, ' ').trim();

    if (!itemQuery && cart.length === 1) {
      results.push({ name: cart[0].name, item: cart[0], qty });
      continue;
    }

    const matchedCartItem = matchCartItem(itemQuery, cart);
    if (matchedCartItem) {
      results.push({ name: matchedCartItem.name, item: matchedCartItem, qty });
    } else if (itemQuery) {
      results.push({ name: itemQuery, item: null, qty });
    }
  }

  return results;
}

/**
 * Execute atomic multi-item removal from session cart
 * Mutates cart array directly by decrementing quantity and splicing when <= 0
 * @param {Array} cart - Active session cart array
 * @param {Array|string} requestsOrText - Parsed requests or raw message string
 * @returns {Array} removedSummary - [{ name, qty, remaining }]
 */
function executeMultiItemRemoval(cart, requestsOrText) {
  if (!Array.isArray(cart) || cart.length === 0) return [];

  const requests = typeof requestsOrText === 'string'
    ? parseRemovalRequests(requestsOrText, cart)
    : (Array.isArray(requestsOrText) ? requestsOrText : []);

  if (!requests || requests.length === 0) return [];

  const removedSummary = [];

  for (const req of requests) {
    const targetName = String(req.name || (req.item && req.item.name) || '').toLowerCase();
    const index = cart.findIndex(i => {
      if (req.item && req.item.menuItemId && i.menuItemId === req.item.menuItemId) return true;
      if (req.item && i.name.toLowerCase() === req.item.name.toLowerCase()) return true;
      const curName = i.name.toLowerCase();
      return curName.includes(targetName) || targetName.includes(curName) || (targetName && levenshteinDistance(curName, targetName) <= 2);
    });

    if (index !== -1) {
      const line = cart[index];
      const deductQty = req.qty >= 999 ? line.quantity : Math.min(line.quantity, req.qty);
      line.quantity -= deductQty;

      removedSummary.push({
        name: line.name,
        qty: deductQty,
        remaining: Math.max(0, line.quantity)
      });

      if (line.quantity <= 0) {
        cart.splice(index, 1);
      }
    }
  }

  return removedSummary;
}

/**
 * Format the single-turn atomic removal response
 */
function formatRemovalResponse(removedItems, remainingCart) {
  if (!removedItems || removedItems.length === 0) {
    return null;
  }

  let removedListStr = '';
  if (removedItems.length === 1) {
    removedListStr = `**${removedItems[0].qty}x ${removedItems[0].name}**`;
  } else if (removedItems.length === 2) {
    removedListStr = `**${removedItems[0].qty}x ${removedItems[0].name}** at **${removedItems[1].qty}x ${removedItems[1].name}**`;
  } else {
    const allExceptLast = removedItems.slice(0, -1).map(r => `**${r.qty}x ${r.name}**`).join(', ');
    const last = removedItems[removedItems.length - 1];
    removedListStr = `${allExceptLast}, at **${last.qty}x ${last.name}**`;
  }

  if (remainingCart.length > 0) {
    const updatedCartLines = remainingCart.map(c => `- ${c.quantity}x ${c.name} (${peso((c.price || 0) * c.quantity)})`).join('\n');
    const subtotal = remainingCart.reduce((sum, c) => sum + ((c.price || 0) * c.quantity), 0);
    const text = `Removed na po ang ${removedListStr} sa inyong cart!\n\n**Updated cart:**\n${updatedCartLines}\n**Total: ${peso(subtotal)}**\n\nGusto niyo pa po bang magdagdag o mag-checkout na?`;

    return {
      text,
      quickReplies: [
        { title: '🛒 Checkout', payload: 'CONFIRM_CHECKOUT' },
        { title: '➕ Magdagdag', payload: 'KEEP_SHOPPING' }
      ]
    };
  }

  const text = `Removed na po ang ${removedListStr} sa inyong cart! Wala na pong laman ang inyong cart.\n\nMag-browse po ulit sa menu kung nais mag-order!`;
  return {
    text,
    quickReplies: [
      { title: '📖 View Menu', payload: 'MENU' }
    ]
  };
}

module.exports = {
  isRemovalIntent,
  matchCartItem,
  parseRemovalRequests,
  executeMultiItemRemoval,
  formatRemovalResponse,
  levenshteinDistance
};
