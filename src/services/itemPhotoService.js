/**
 * On-Demand Item Photo Request Service
 *
 * Detects customer photo/appearance inquiries in Taglish & English,
 * extracts the requested menu item name, queries `menu_items` with
 * fuzzy fallback, and prepares Messenger image + quick-order responses.
 */

const db = require('../../database/db');
const config = require('../config/config');

const PHOTO_KEYWORD_REGEX =
  /\b(?:picture|pictures|pic|pics|photo|photos|itsura|hitsura|patingin|pa-?tingin|tingin|image|images|look\s*like|looks\s*like|mukha)\b/i;

const NON_ITEM_PHOTO_BLOCKLIST =
  /\b(?:menu|catalog|listahan|receipt|resibo|gcash|proof|payment|senior|pwd)\b/i;

/**
 * Determine if incoming customer message is asking to see a photo of a menu item.
 * Excludes menu browsing, receipt uploads, and ID verification phrases.
 *
 * @param {string} rawText
 * @returns {boolean}
 */
function isItemPhotoRequest(rawText) {
  const clean = String(rawText || '').trim();
  if (!clean) return false;
  if (NON_ITEM_PHOTO_BLOCKLIST.test(clean)) return false;
  return PHOTO_KEYWORD_REGEX.test(clean);
}

/**
 * Extract the target dish or drink name from a photo inquiry message.
 * Example: "Patingin ng picture ng Biscoff Cheesecake" -> "Biscoff Cheesecake"
 *
 * @param {string} rawText
 * @returns {string}
 */
function extractPhotoItemQuery(rawText) {
  let s = String(rawText || '').trim();
  if (!s) return '';

  // Remove punctuation
  s = s.replace(/[?!.,:;"'()[\]{}]+/g, ' ').replace(/\s+/g, ' ').trim();

  // Strip common conversational prefixes and photo inquiry phrases
  const fillerWords = [
    'pwedeng', 'pwede', 'pde', 'can i see', 'could i see', 'may i see',
    'show me', 'send me', 'send', 'what does', 'what do', 'how does',
    'ano bang', 'anong', 'ano', 'mayroon bang', 'mayroon', 'meron bang', 'meron',
    'may', 'patingin', 'pa-tingin', 'tingin', 'picture', 'pictures', 'pic', 'pics',
    'photo', 'photos', 'image', 'images', 'itsura', 'hitsura', 'mukha',
    'looks like', 'look like', 'ka ba', 'po ba', 'ba', 'po', 'please', 'pls',
    'nga', 'naman', 'lang', 'para sa', 'tungkol sa', 'yung', 'ung', 'ang',
    'ng', 'na', 'sa', 'of', 'the', 'an', 'a', 'it'
  ];

  // Sort longest phrases first to strip multi-word expressions cleanly
  const sorted = [...fillerWords].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`\\b(?:${sorted.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');

  s = s.replace(pattern, ' ').replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Score candidate menu item name match when SQL LIKE returns no exact substring match.
 */
function findBestFuzzyMenuMatch(candidates, query) {
  const qLower = String(query || '').toLowerCase().trim();
  if (!qLower || !Array.isArray(candidates) || candidates.length === 0) return null;

  const qTokens = qLower.split(/\s+/).filter(t => t.length >= 2);
  if (qTokens.length === 0) return null;

  let bestItem = null;
  let bestScore = 0;

  for (const item of candidates) {
    const nameLower = String(item.name || '').toLowerCase();
    const synLower = String(item.synonyms || '').toLowerCase();
    const hay = `${nameLower} ${synLower}`;

    let matchedTokens = 0;
    for (const tok of qTokens) {
      if (hay.includes(tok)) {
        matchedTokens++;
      }
    }

    const score = matchedTokens / qTokens.length;
    if (score > bestScore && score >= 0.5) {
      bestScore = score;
      bestItem = item;
    }
  }

  return bestItem;
}

/**
 * Look up requested menu item in `menu_items` (joined with `inventory` for stock).
 *
 * @param {string} targetName
 * @returns {Promise<Object|null>}
 */
async function lookupMenuItemForPhoto(targetName) {
  const cleanTarget = String(targetName || '').trim();
  if (!cleanTarget) return null;

  const likePattern = `%${cleanTarget}%`;

  const [rows] = await db.query(
    `SELECT m.id, m.name, m.price, m.description, m.image_url, m.synonyms,
            COALESCE(i.stock_quantity, m.stock_quantity, 0) AS stock,
            m.is_available
     FROM menu_items m
     LEFT JOIN inventory i ON i.menu_item_id = m.id
     WHERE (LOWER(m.name) LIKE LOWER(?) OR LOWER(COALESCE(m.synonyms, '')) LIKE LOWER(?))
       AND COALESCE(m.is_deleted, 0) = 0
     ORDER BY
       CASE WHEN LOWER(m.name) = LOWER(?) THEN 0 ELSE 1 END,
       m.is_available DESC,
       COALESCE(i.stock_quantity, m.stock_quantity, 0) DESC,
       LENGTH(m.name) ASC
     LIMIT 1`,
    [likePattern, likePattern, cleanTarget]
  );

  if (rows && rows.length > 0) {
    return rows[0];
  }

  // Token-based fuzzy fallback across non-deleted items
  const [allRows] = await db.query(
    `SELECT m.id, m.name, m.price, m.description, m.image_url, m.synonyms,
            COALESCE(i.stock_quantity, m.stock_quantity, 0) AS stock,
            m.is_available
     FROM menu_items m
     LEFT JOIN inventory i ON i.menu_item_id = m.id
     WHERE COALESCE(m.is_deleted, 0) = 0
     ORDER BY m.is_available DESC, COALESCE(i.stock_quantity, m.stock_quantity, 0) DESC, m.name ASC`
  );

  return findBestFuzzyMenuMatch(allRows, cleanTarget);
}

/**
 * Resolve stored `image_url` to a public URL suitable for Messenger Image Attachment.
 * Returns null if `image_url` is missing/empty.
 */
function resolvePhotoAttachmentUrl(rawImageUrl) {
  const raw = String(rawImageUrl || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  const baseUrl = (process.env.APP_BASE_URL || config.appUrl || 'http://localhost:3000')
    .trim()
    .replace(/\/+$/, '');
  const cleanPath = raw.startsWith('/') ? raw : `/${raw}`;
  return `${baseUrl}${cleanPath}`;
}

module.exports = {
  isItemPhotoRequest,
  extractPhotoItemQuery,
  lookupMenuItemForPhoto,
  resolvePhotoAttachmentUrl,
  findBestFuzzyMenuMatch
};
