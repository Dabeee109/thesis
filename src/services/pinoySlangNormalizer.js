/**
 * Pinoy Slang and SMS Shorthand Normalizer (Module 7)
 * Normalizes colloquial Philippine texting slang, abbreviations, and common phonetic typos
 * without destroying entity names or conversational intent.
 */

const PINOY_SLANG_MAP = [
  // Greetings & Friendly Slang (Lods, Matsala, Paps)
  { regex: /\bmatsala\b/gi, replacement: 'salamat' },
  { regex: /\b(?:lods|lodi|paps|idol|bossing)\b/gi, replacement: '' }, // Treat as polite vocatives
  
  // Pricing & Questions
  { regex: /\b(?:hm\s*po|hm|mgkno\s*po|mgkno|magkano\s*po)\b/gi, replacement: 'magkano po' },
  { regex: /\b(?:petot|pesos|php)\b/gi, replacement: 'pesos' },
  { regex: /\b(?:pde\s*b|pde\s*ba|pwede\s*b)\b/gi, replacement: 'pwede ba' },
  
  // Food & Menu Typos
  { regex: /\b(?:chzckake|chzcake|chzkake)\b/gi, replacement: 'cheesecake' },
  { regex: /\b(?:latet|latteh)\b/gi, replacement: 'latte' },
  
  // Common Texting Shorthand
  { regex: /\b(?:sn\s*n\s*po|san\s*na\s*po|nasan\s*na)\b/gi, replacement: 'nasaan na po' },
  { regex: /\b(?:w8\s*lng|w8)\b/gi, replacement: 'wait lang' },
  { regex: /\b(?:wla\s*n\s*b|wala\s*na\s*b)\b/gi, replacement: 'wala na ba' },
  { regex: /\b(?:bka\s*nmn|baka\s*nmn)\b/gi, replacement: 'baka naman' },
  { regex: /\bg\s*n\s*g\b/gi, replacement: 'game na game' },
  { regex: /\bkht\b/gi, replacement: 'kahit' },
  { regex: /\bbwal\b/gi, replacement: 'bawal' },
  { regex: /\b(?:kse|kze)\b/gi, replacement: 'kasi' },
  { regex: /\bdyn\b/gi, replacement: 'diyan' },
  { regex: /\bbkt\b/gi, replacement: 'bakit' },
  { regex: /\baq\b/gi, replacement: 'ako' },
  { regex: /\bkau\b/gi, replacement: 'kayo' },
  { regex: /\bkme\b/gi, replacement: 'kami' },
  { regex: /\b(?:plss|pls)\b/gi, replacement: 'please' },
  { regex: /\bsan\s*loc\b/gi, replacement: 'saan location' }
];

/**
 * Normalizes input text containing slang, shorthand, and phonetic typos
 * @param {string} text
 * @returns {string}
 */
function normalizePinoySlang(text) {
  if (!text || typeof text !== 'string') return '';
  let cleaned = text;

  for (const { regex, replacement } of PINOY_SLANG_MAP) {
    cleaned = cleaned.replace(regex, replacement);
  }

  return cleaned.replace(/\s+/g, ' ').trim();
}

module.exports = {
  PINOY_SLANG_MAP,
  normalizePinoySlang
};

