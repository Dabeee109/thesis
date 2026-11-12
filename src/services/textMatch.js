/**
 * Text Matching and Validation Utilities (Task 2)
 * Handles text normalization, short reply classification, quantity parsing,
 * fuzzy item matching, input validators, and peso formatting.
 */

// 1. Normalization
function normalize(s) {
  if (!s || typeof s !== 'string') return '';
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // letters, digits, whitespace only
    .replace(/\s+/g, ' ')
    .trim();
}

// 2. Short Reply Classification (classifyShort)
const FILLER = new Set(['po', 'please', 'pls', 'plss', 'na', 'lang', 'naman', 'sir', 'maam', 'thanks', 'thank', 'you', 'ty']);
const YES = new Set(['yes', 'y', 'yep', 'yup', 'yeah', 'yea', 'ya', 'yah', 'sure', 'ok', 'okay', 'okey', 'k', 'kk', 'go', 'proceed', 'confirm', 'confirmed', 'sige', 'oo', 'opo', 'ge', 'g', 'game', 'tara', 'checkout']);
const YES_PHRASES = new Set(['go ahead', 'sounds good', 'do it', 'lets go', 'check out', 'ok na', 'sige na', 'go na', 'yes checkout', 'yes check out']);
const NO = new Set(['no', 'n', 'nope', 'nah', 'not', 'wait', 'stop', 'back', 'hindi', 'ayoko', 'ayaw', 'later', 'cancel']);
const NO_PHRASES = new Set(['not yet', 'hold on', 'never mind', 'nevermind', 'wag muna', 'mamaya na', 'add more', 'keep it', 'no thanks', 'hindi pa']);

const squash = w => w.replace(/(.)\1+/g, '$1'); // yesss -> yes
const collapsed = set => new Set([...set].filter(w => w.length >= 3).map(squash));
const YES_C = collapsed(YES);
const NO_C = collapsed(NO);

function oneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a === b) return true;
  let diff = 0;
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] !== b[j]) {
      diff++;
      if (diff > 1) return false;
      if (a.length > b.length) {
        i++;
      } else if (a.length < b.length) {
        j++;
      } else {
        i++;
        j++;
      }
    } else {
      i++;
      j++;
    }
  }
  return true;
}

function classifyShort(text, { fuzzy = true } = {}) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  // Emoji-only or emoji-containing reply when no letters exist
  if (!/\p{L}/u.test(raw)) {
    if (/[👍👌✅🙆]/u.test(raw)) return 'YES';
    if (/[👎❌🙅]/u.test(raw)) return 'NO';
    return null;
  }
  const norm = normalize(raw);
  const tokens = norm.split(' ').filter(t => t && !FILLER.has(t));
  if (!tokens.length) return null;
  const phrase = tokens.join(' ');
  if (YES_PHRASES.has(phrase)) return 'YES';
  if (NO_PHRASES.has(phrase)) return 'NO';

  const kind = t => {
    if (YES.has(t) || (t.length >= 3 && YES_C.has(squash(t)))) return 'YES';
    if (NO.has(t) || (t.length >= 3 && NO_C.has(squash(t)))) return 'NO';
    return null;
  };

  const kinds = tokens.map(kind);
  if (kinds.every(k => k === 'YES')) return 'YES';
  if (kinds.every(k => k === 'NO')) return 'NO';

  if (fuzzy && tokens.length === 1 && tokens[0].length >= 4) {
    if ([...YES].some(w => w.length >= 4 && oneEdit(tokens[0], w))) return 'YES';
    if ([...NO].some(w => w.length >= 4 && oneEdit(tokens[0], w))) return 'NO';
  }
  return null;
}

// 3. parseQuantity
const WORD_NUMBERS = {
  one: 1, a: 1, an: 1, another: 1, isa: 1, isang: 1, '1': 1,
  two: 2, dalawa: 2, dalawang: 2, '2': 2,
  three: 3, tatlo: 3, tatlong: 3, '3': 3,
  four: 4, apat: 4, 'apat na': 4, '4': 4,
  five: 5, lima: 5, limang: 5, '5': 5,
  six: 6, anim: 6, 'anim na': 6, '6': 6,
  seven: 7, pito: 7, pitong: 7, '7': 7,
  eight: 8, walo: 8, walong: 8, '8': 8,
  nine: 9, siyam: 9, 'siyam na': 9, '9': 9,
  ten: 10, sampu: 10, sampung: 10, '10': 10
};

function parseQuantity(text) {
  if (!text || typeof text !== 'string') return null;
  const norm = normalize(text);
  if (!norm) return null;

  // Check for QTY_n format
  const qtyPayloadMatch = text.match(/\bQTY_([1-9][0-9]?)\b/i);
  if (qtyPayloadMatch) {
    return parseInt(qtyPayloadMatch[1], 10);
  }

  // Look for standalone digits 1 to 99
  const digitMatch = norm.match(/\b([1-9][0-9]?)\b/);
  if (digitMatch) {
    const val = parseInt(digitMatch[1], 10);
    if (val >= 1 && val <= 99) return val;
  }

  // Look for two-word numbers like 'apat na', 'anim na', 'siyam na'
  for (const [word, val] of Object.entries(WORD_NUMBERS)) {
    if (word.includes(' ') && norm.includes(word)) {
      return val;
    }
  }

  // Look for word numbers
  const tokens = norm.split(' ');
  for (const token of tokens) {
    if (WORD_NUMBERS[token] !== undefined) {
      return WORD_NUMBERS[token];
    }
  }

  return null;
}

// 4. matchItems (Fuzzy menu item matching)
const STOPWORDS = new Set(['the', 'a', 'an', 'po', 'please', 'pls', 'yung', 'ung', 'ang', 'ng', 'sa', 'my', 'item']);

function cleanQueryTokens(str) {
  return normalize(str)
    .split(' ')
    .filter(t => t && !STOPWORDS.has(t));
}

function levenshteinDistance(s1, s2) {
  if (s1 === s2) return 0;
  if (!s1.length) return s2.length;
  if (!s2.length) return s1.length;

  let row = Array.from({ length: s2.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s1.length; i++) {
    let nextRow = [i];
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      nextRow[j] = Math.min(
        nextRow[j - 1] + 1,       // insertion
        row[j] + 1,               // deletion
        row[j - 1] + cost         // substitution
      );
    }
    row = nextRow;
  }
  return row[s2.length];
}

function tokenSimilarity(t1, t2) {
  if (t1 === t2) return 1.0;
  const maxLen = Math.max(t1.length, t2.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshteinDistance(t1, t2);
  return Math.max(0, 1 - dist / maxLen);
}

function getBigrams(str) {
  const s = ' ' + str + ' ';
  const bigrams = new Set();
  for (let i = 0; i < s.length - 1; i++) {
    bigrams.add(s.substring(i, i + 2));
  }
  return bigrams;
}

function bigramSimilarity(s1, s2) {
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0;
  const bg1 = getBigrams(s1);
  const bg2 = getBigrams(s2);
  let intersection = 0;
  for (const b of bg1) {
    if (bg2.has(b)) intersection++;
  }
  const total = bg1.size + bg2.size;
  return total === 0 ? 0 : (2.0 * intersection) / total;
}

function scoreCandidateName(queryTokens, queryStr, targetName) {
  const targetNorm = normalize(targetName);
  const targetTokens = cleanQueryTokens(targetName);
  const targetStr = targetTokens.join(' ');

  if (!queryTokens.length || !targetTokens.length) return 0;

  // Exact equality
  if (queryStr === targetStr || normalize(queryStr) === targetNorm) {
    return 1.0;
  }

  // Query is a whole-word substring of the target, or all query tokens appear in target tokens
  const targetTokenSet = new Set(targetTokens);
  const allInTarget = queryTokens.every(q => targetTokenSet.has(q));
  const isWordSubstring = targetTokens.join(' ').includes(queryTokens.join(' '));

  if (allInTarget || isWordSubstring) {
    return 0.92;
  }

  // Token-aware fuzzy score
  let tokenScoreSum = 0;
  for (const q of queryTokens) {
    let best = 0;
    for (const t of targetTokens) {
      const sim = tokenSimilarity(q, t);
      if (sim > best) best = sim;
    }
    tokenScoreSum += best;
  }
  const avgTokenScore = tokenScoreSum / queryTokens.length;
  const biSim = bigramSimilarity(queryStr, targetStr);

  return 0.75 * avgTokenScore + 0.25 * biSim;
}

function matchItems(query, candidates, cfg = {}) {
  const fuzzyAccept = cfg.fuzzyAccept ?? 0.78;
  const fuzzyConfirm = cfg.fuzzyConfirm ?? 0.55;
  const gap = cfg.gap ?? 0.08;

  const rawTrimmed = String(query || '').trim();
  if (rawTrimmed.length < 3) {
    return { status: 'none', matches: [] };
  }

  const queryTokens = cleanQueryTokens(rawTrimmed);
  if (!queryTokens.length) {
    return { status: 'none', matches: [] };
  }
  const queryStr = queryTokens.join(' ');

  const scored = [];
  for (const cand of candidates) {
    let bestScore = scoreCandidateName(queryTokens, queryStr, cand.name);

    // Check aliases / synonyms
    const aliases = Array.isArray(cand.aliases) ? cand.aliases :
      typeof cand.synonyms === 'string' ? cand.synonyms.split(',').map(s => s.trim()) : [];

    for (const alias of aliases) {
      if (alias) {
        const s = scoreCandidateName(queryTokens, queryStr, alias);
        if (s > bestScore) bestScore = s;
      }
    }

    if (bestScore >= fuzzyConfirm) {
      scored.push({
        item: cand,
        ...cand,
        score: Math.round(bestScore * 1000) / 1000
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  if (!scored.length) {
    return { status: 'none', matches: [] };
  }

  const top = scored[0];
  const second = scored[1];

  // Ambiguous: two or more within gap and >= fuzzyConfirm
  if (second && (top.score - second.score) <= gap && second.score >= fuzzyConfirm) {
    return { status: 'ambiguous', matches: scored };
  }

  // Accept
  if (top.score >= fuzzyAccept) {
    return { status: 'accept', matches: scored };
  }

  // Confirm
  if (top.score >= fuzzyConfirm) {
    return { status: 'confirm', matches: scored };
  }

  return { status: 'none', matches: [] };
}

// 5. Validators
const NON_NAME_PHRASE_REGEX = /\b(?:binigay|ibinigay|nasabi|sinabi|kanina|kasi|naman|bakit|paano|pano|ano|anong|kelan|saan|san|hindi|ayoko|ayaw|wala|meron|mayroon|paulit|ulit|sayo|iyo|ninyo|nyo|ko\s+na|mo\s+na|na\s+po|ba\s+yan|haha+|lol|order|menu|cart|gcash|cash|delivery|pickup|take\s*out|cancel|teka|sandali|wait|none|skip)\b/i;

function validateName(s) {
  if (!s || typeof s !== 'string') return { ok: false };
  const cleaned = s
    .replace(/[\x00-\x1F\x7F]/g, '') // remove control chars
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length < 2 || cleaned.length > 80) return { ok: false };
  // Reject links or markup
  if (/<[^>]*>|http:\/\/|https:\/\//i.test(cleaned)) return { ok: false };
  // Reject conversational complaints, questions, or non-name phrases
  if (NON_NAME_PHRASE_REGEX.test(cleaned)) return { ok: false };
  if (cleaned.split(/\s+/).length > 4) return { ok: false };
  // Must have at least two letters
  const letters = cleaned.match(/\p{L}/gu);
  if (!letters || letters.length < 2) return { ok: false };
  // Only letters, spaces, ., ', -
  if (!/^[\p{L}\s.'-]+$/u.test(cleaned)) return { ok: false };

  return { ok: true, value: cleaned };
}

function normalizePhone(s) {
  if (!s || typeof s !== 'string') return null;
  const digitsOnly = s.replace(/[^0-9]/g, '');
  // Philippines mobile numbers:
  // 09XXXXXXXXX (11 digits)
  // 9XXXXXXXXX (10 digits)
  // 639XXXXXXXXX (12 digits)
  if (digitsOnly.length === 11 && digitsOnly.startsWith('09')) {
    return `+63${digitsOnly.substring(1)}`;
  }
  if (digitsOnly.length === 10 && digitsOnly.startsWith('9')) {
    return `+63${digitsOnly}`;
  }
  if (digitsOnly.length === 12 && digitsOnly.startsWith('639')) {
    return `+${digitsOnly}`;
  }
  return null;
}

function validateAddress(s) {
  if (!s || typeof s !== 'string') return { ok: false };
  const cleaned = s
    .replace(/[\x00-\x1F\x7F<>]/g, '') // remove control chars and < >
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length < 10 || cleaned.length > 200) return { ok: false };
  const words = cleaned.split(' ').filter(Boolean);
  if (words.length < 2) return { ok: false };

  return { ok: true, value: cleaned };
}

// 6. Peso Formatter
function peso(n) {
  const num = Number(n) || 0;
  return '₱' + num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

const { normalizePinoySlang } = require('./pinoySlangNormalizer');

module.exports = {
  normalize,
  normalizePinoySlang,
  classifyShort,
  parseQuantity,
  matchItems,
  validateName,
  normalizePhone,
  validateAddress,
  peso
};
