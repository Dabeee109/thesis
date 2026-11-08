/**
 * Item Match Engine (Fuzzy Matching & Typo Tolerance)
 * Replaces naive bidirectional includes() to eliminate substring collisions (e.g. "ok" -> Cookie).
 * 
 * Decision Rules:
 * - Similarity >= 0.78: Direct match (accept & add/remove)
 * - Similarity 0.55 to 0.77: Ask confirmation ("Did you mean [Item Name]?")
 * - Two items within 0.08: Disambiguate ("Which one did you mean?")
 * - Similarity < 0.55: No match
 */

const db = require('../../database/db');

// Standard synonyms / alias mappings for cafe menu items
const ITEM_ALIASES = {
  1: [
    'signature spanish latte', 'spanish latte', 'signature spanish', 'spanish', 'spanish coffee',
    'iced spanish latte', 'spanis latte', 'spanis late', 'spanish late', 'iced spanish', 'spanish lateh'
  ],
  2: [
    'caramel macchiato', 'macchiato', 'caramel', 'iced caramel macchiato', 'machiatto', 'makiato',
    'caramel coffee', 'caramel kape'
  ],
  3: [
    'iced americano', 'americano', 'americano coffee', 'iced coffee', 'cold brew', 'black coffee',
    'amerikano', 'kapeng itim', 'iced amerikano'
  ],
  4: [
    'kyoto uji matcha latte', 'uji matcha latte', 'matcha latte', 'matcha', 'kyoto matcha',
    'iced matcha', 'macha', 'macha latte', 'green tea latte'
  ],
  5: [
    'hibiscus berry iced tea', 'hibiscus tea', 'berry iced tea', 'berry tea', 'iced tea',
    'hibiscus berry', 'red tea', 'berry juice'
  ],
  6: [
    'classic beef tapa rice bowl', 'beef tapa rice bowl', 'beef tapa bowl', 'beef tapa',
    'tapa rice bowl', 'tapa bowl', 'tapa', 'tapsilog', 'beef bowl', 'beef rice'
  ],
  7: [
    'creamy truffle bacon carbonara', 'truffle bacon carbonara', 'truffle carbonara',
    'carbonara', 'bacon carbonara', 'truffle pasta', 'carbo', 'white pasta', 'carbonara pasta'
  ],
  8: [
    'almond butter croissant', 'almond croissant', 'croissant', 'butter croissant',
    'croisant', 'croisnt', 'almond bread'
  ],
  9: [
    'dark chocolate chunk cookie', 'chocolate chunk cookie', 'dark chocolate cookie',
    'chocolate cookie', 'cookie', 'choco cookie', 'kuki', 'tsokolate cookie', 'choc cookie'
  ],
  10: [
    'grilled chicken pesto panini', 'chicken pesto panini', 'pesto panini', 'chicken panini',
    'panini', 'pesto sandwich', 'chicken sandwich', 'grilled panini'
  ]
};

// Conversational affirmations, category queries, and filler words that should NEVER match menu items
const STOP_OR_AFFIRMATION_WORDS = new Set([
  'ok', 'okay', 'k', 'yes', 'yep', 'yeah', 'sure', 'go', 'ahead', 'proceed',
  'sige', 'opo', 'oo', 'cge', 'game', 'tara', 'no', 'nope', 'wait', 'hindi',
  'hi', 'hello', 'hey', 'menu', 'cart', 'checkout', 'orders', 'order', 'please',
  'na', 'pa', 'po', 'ng', 'nang', 'ang', 'sa', 'ba', 'ko', 'mo', 'naman', 'nga',
  'kape', 'coffee', 'bestseller', 'bestsellers', 'recommend', 'recommendation',
  'suggest', 'tinapay', 'meals', 'drinks', 'pastries', 'snacks', 'food'
]);

/**
 * Compute Levenshtein distance between two strings
 */
function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = new Array(a.length + 1);
  for (let i = 0; i <= a.length; i++) row[i] = i;

  for (let j = 1; j <= b.length; j++) {
    let prev = row[0];
    row[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const temp = row[i];
      if (b[j - 1] === a[i - 1]) {
        row[i] = prev;
      } else {
        row[i] = Math.min(prev + 1, row[i] + 1, row[i - 1] + 1);
      }
      prev = temp;
    }
  }

  return row[a.length];
}

/**
 * Compute normalized Levenshtein similarity [0, 1]
 */
function levenshteinSimilarity(s1, s2) {
  if (s1 === s2) return 1.0;
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshteinDistance(s1, s2);
  return Math.max(0, 1 - dist / maxLen);
}

/**
 * Compute Sørensen-Dice bigram coefficient [0, 1]
 */
function diceCoefficient(s1, s2) {
  if (s1 === s2) return 1.0;
  if (s1.length < 2 || s2.length < 2) return 0.0;

  const bigrams1 = new Map();
  for (let i = 0; i < s1.length - 1; i++) {
    const bg = s1.substr(i, 2);
    bigrams1.set(bg, (bigrams1.get(bg) || 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < s2.length - 1; i++) {
    const bg = s2.substr(i, 2);
    const count = bigrams1.get(bg) || 0;
    if (count > 0) {
      bigrams1.set(bg, count - 1);
      intersection++;
    }
  }

  const total = (s1.length - 1) + (s2.length - 1);
  return total > 0 ? (2.0 * intersection) / total : 0.0;
}

/**
 * Clean and normalize search query text
 */
function cleanQueryText(queryText) {
  if (!queryText || typeof queryText !== 'string') return '';
  return queryText
    .toLowerCase()
    .replace(/^(?:pa-?order(?:\s*po)?(?:\s*ng)?|pabili(?:\s*ng)?|gusto\s*ko(?:\s*ng)?|i\s*want|can\s*i\s*get|order|padeliver|pwede\s*mag-?order(?:\s*ng)?|give\s*me|patingin\s*(?:ng)?|tingin\s*(?:ng)?)\s*/i, '')
    .replace(/(?:do\s+you\s+have|may\s+roon|meron\s+ba|meron\s+kayong|available\s+ba|is\s+there)\s*/gi, '')
    .replace(/\b(?:please|pls|plz|pakisuyo|paki|po|yung|ang|ng|nang|of|a|an|the|naman|nga|ba|ko|mo|sa|kay|pla|pala)\b/gi, ' ')
    .replace(/[?!.,;:'"()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Score similarity between cleaned query and a menu item
 */
function scoreItemMatch(cleanQuery, item) {
  if (!cleanQuery || cleanQuery.length < 3) {
    return 0.0; // Minimum character match threshold: reject short strings like "ok"
  }

  if (STOP_OR_AFFIRMATION_WORDS.has(cleanQuery)) {
    return 0.0; // Explicitly prevent affirmations from matching items
  }

  const itemNameLower = item.name.toLowerCase();
  const aliases = ITEM_ALIASES[item.id] || [];
  const targets = [itemNameLower, ...aliases];

  let bestScore = 0.0;

  for (const target of targets) {
    // 1. Exact match with title or alias
    if (cleanQuery === target) {
      return 1.0;
    }

    // 2. Tokenized word boundary check (e.g. "cookie" inside "Dark Chocolate Chunk Cookie")
    // Requires target to contain query as an exact whole-word token boundary
    const escapedQuery = cleanQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordBoundaryRegex = new RegExp(`\\b${escapedQuery}\\b`, 'i');
    if (wordBoundaryRegex.test(target)) {
      // Token coverage score
      const coverage = cleanQuery.length / target.length;
      const tokenScore = Math.max(0.85, 0.75 + (coverage * 0.25));
      if (tokenScore > bestScore) bestScore = tokenScore;
    }

    // 3. Normalized Levenshtein similarity (for typo tolerance)
    const lev = levenshteinSimilarity(cleanQuery, target);
    if (lev > bestScore) bestScore = lev;

    // 4. Dice bigram similarity
    const dice = diceCoefficient(cleanQuery, target);
    if (dice > bestScore) bestScore = dice;
  }

  // 5. Check if multi-word query tokens all appear in item name
  const queryWords = cleanQuery.split(/\s+/).filter(w => w.length >= 3 && !STOP_OR_AFFIRMATION_WORDS.has(w));
  if (queryWords.length > 1) {
    const allWordsPresent = queryWords.every(w => {
      const reg = new RegExp(`\\b${w}`, 'i');
      return reg.test(itemNameLower) || targets.some(t => reg.test(t));
    });
    if (allWordsPresent) {
      bestScore = Math.max(bestScore, 0.88);
    }
  }

  return Math.min(1.0, Math.round(bestScore * 100) / 100);
}

/**
 * Match query against list of menu items using Item Match Engine decision rules
 * @param {string} queryText - User input text
 * @param {Array} items - Available menu items
 * @returns {Object} - Match decision: { status, item, secondItem, similarity, candidates }
 */
function matchMenuItem(queryText, items = []) {
  const clean = cleanQueryText(queryText);
  if (!clean || clean.length < 3 || STOP_OR_AFFIRMATION_WORDS.has(clean)) {
    return {
      status: 'NONE',
      item: null,
      similarity: 0.0,
      candidates: []
    };
  }

  const scored = [];
  for (const item of items) {
    const similarity = scoreItemMatch(clean, item);
    if (similarity >= 0.50) {
      scored.push({ item, similarity });
    }
  }

  scored.sort((a, b) => b.similarity - a.similarity);

  if (scored.length === 0 || scored[0].similarity < 0.55) {
    return {
      status: 'NONE',
      item: null,
      similarity: scored.length > 0 ? scored[0].similarity : 0.0,
      candidates: []
    };
  }

  const top = scored[0];
  const second = scored.length > 1 ? scored[1] : null;

  // Disambiguation rule: Two items within 0.08 similarity
  if (second && second.similarity >= 0.55 && (top.similarity - second.similarity) <= 0.08) {
    return {
      status: 'DISAMBIGUATE',
      item: top.item,
      secondItem: second.item,
      similarity: top.similarity,
      scoreDiff: Math.round((top.similarity - second.similarity) * 100) / 100,
      candidates: [top.item, second.item]
    };
  }

  // Direct match rule: Similarity >= 0.78
  if (top.similarity >= 0.78) {
    return {
      status: 'DIRECT',
      item: top.item,
      secondItem: null,
      similarity: top.similarity,
      candidates: [top.item]
    };
  }

  // Confirmation rule: Similarity 0.55 to 0.77
  return {
    status: 'CONFIRM',
    item: top.item,
    secondItem: null,
    similarity: top.similarity,
    candidates: [top.item]
  };
}

/**
 * Find menu item by name with typo-tolerant fuzzy matching (Deliverable 1)
 * @param {string} queryText - User text query
 * @param {Object} options - { detailed: boolean, minScore: number }
 * @returns {Promise<Object|null>} - Matched item or detailed match object
 */
async function findMenuItemByName(queryText, options = {}) {
  if (!queryText) return null;

  let items = options.items;
  if (!items) {
    const [rows] = await db.query(
      `SELECT id, category_id, name, price, description, is_available, is_bestseller, stock_quantity, status 
       FROM menu_items 
       WHERE is_available = 1 
         AND COALESCE(is_deleted, 0) = 0
         AND (status != 'HIDDEN' OR status IS NULL)
         AND COALESCE(stock_quantity, 50) > 0`
    );
    items = rows || [];
  }

  const match = matchMenuItem(queryText, items);

  if (options.detailed) {
    return match;
  }

  // Default behavior: return matched item only if status is DIRECT (similarity >= 0.78)
  if (match.status === 'DIRECT') {
    return match.item;
  }

  return null;
}

module.exports = {
  findMenuItemByName,
  matchMenuItem,
  scoreItemMatch,
  cleanQueryText,
  levenshteinDistance,
  levenshteinSimilarity,
  diceCoefficient,
  ITEM_ALIASES,
  STOP_OR_AFFIRMATION_WORDS
};
