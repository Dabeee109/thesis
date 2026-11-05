/**
 * DINER'S CAFE ENTERPRISE AI ARCHITECTURE & NLP CORPUS
 * Master Conversational Dataset & NLP Training Matrix (800 Production Examples)
 * 8 Categories with exactly 100 verified examples each.
 */

const corpus = require('./enterprise800Dataset.json');

const CATEGORIES = [
  'Greetings',
  'Shop Ambience & Dining Mode Filtering',
  'Multi-Item Order Taking & Customizations',
  'Senior Citizen & PWD Verification & Discount Rules Details',
  'Final Receipt Format & Confirmation',
  'Proactive Order Status Updates & Cancellation Gatekeeping',
  'Disambiguation: Order Quantities vs. Star Ratings',
  'Edge Cases, Typos, Slang & General Inquiries'
];

/**
 * Retrieve items by category index (1 to 8) or slug
 */
function getByCategory(cat) {
  if (typeof cat === 'number') {
    return corpus.filter(i => i.categoryIndex === cat);
  }
  return corpus.filter(i => i.categorySlug === cat || i.category.toLowerCase().includes(String(cat).toLowerCase()));
}

/**
 * Find top-k most relevant examples based on token overlap score
 */
function findTopRelevantExamples(userQuery, limit = 4, categorySlug = null) {
  if (!userQuery || typeof userQuery !== 'string') {
    return corpus.slice(0, limit);
  }

  const queryTokens = userQuery.toLowerCase().split(/[\s,!?.-]+/).filter(t => t.length > 2);
  let candidates = corpus;
  if (categorySlug) {
    candidates = corpus.filter(i => i.categorySlug === categorySlug);
  }

  const scored = candidates.map(item => {
    const itemTokens = item.user.toLowerCase().split(/[\s,!?.-]+/).filter(t => t.length > 2);
    let matchScore = 0;
    for (const q of queryTokens) {
      if (itemTokens.includes(q)) matchScore += 3;
      else if (item.user.toLowerCase().includes(q)) matchScore += 1;
    }
    return { item, matchScore };
  });

  scored.sort((a, b) => b.matchScore - a.matchScore);
  const selected = scored.filter(s => s.matchScore > 0).slice(0, limit).map(s => s.item);

  if (selected.length < limit) {
    const fallback = candidates.slice(0, limit - selected.length);
    selected.push(...fallback);
  }

  return selected;
}

module.exports = {
  corpus,
  CATEGORIES,
  getByCategory,
  findTopRelevantExamples
};
