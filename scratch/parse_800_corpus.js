const fs = require('fs');
const path = require('path');

const xmlPath = 'C:/Users/USER/.gemini/antigravity/brain/7c316e1b-82ab-49f2-aea8-8027b9a42a45/docx_extracted/word/document.xml';
const xml = fs.readFileSync(xmlPath, 'utf8');

const tables = xml.match(/<w:tbl\b[\s\S]*?<\/w:tbl>/g) || [];
console.log(`Found ${tables.length} tables in document.xml`);

const CATEGORY_NAMES = [
  'Greetings',
  'Shop Ambience & Dining Mode Filtering',
  'Multi-Item Order Taking & Customizations',
  'Senior Citizen & PWD Verification & Discount Rules Details',
  'Final Receipt Format & Confirmation',
  'Proactive Order Status Updates & Cancellation Gatekeeping',
  'Disambiguation: Order Quantities vs. Star Ratings',
  'Edge Cases, Typos, Slang & General Inquiries'
];

const CATEGORY_SLUGS = [
  'greetings',
  'ambience_dining_mode',
  'multi_item_orders',
  'discounts_senior_pwd',
  'receipt_confirmation',
  'order_status_cancellation',
  'quantity_rating_disambiguation',
  'edge_cases_slang'
];

const corpus = [];

tables.forEach((tableXml, catIdx) => {
  const catName = CATEGORY_NAMES[catIdx] || `Category ${catIdx + 1}`;
  const catSlug = CATEGORY_SLUGS[catIdx] || `category_${catIdx + 1}`;
  const rows = tableXml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || [];

  console.log(`Category ${catIdx + 1} (${catName}): ${rows.length - 1} data rows`);

  // Skip row 0 (headers)
  for (let r = 1; r < rows.length; r++) {
    const rowXml = rows[r];
    const cells = rowXml.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) || [];
    if (cells.length < 3) continue;

    const cellTexts = cells.map(c => {
      const pList = c.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) || [];
      return pList.map(p => {
        const textRuns = p.match(/<w:t\b[^>]*>([^<]*)<\/w:t>/g) || [];
        return textRuns.map(m => m.replace(/<[^>]+>/g, '')).join('');
      }).filter(Boolean).join('\n');
    });

    const indexNum = parseInt(cellTexts[0].replace(/\D/g, ''), 10) || r;
    let userInput = (cellTexts[1] || '').trim();
    if (userInput.startsWith('"') && userInput.endsWith('"')) {
      userInput = userInput.slice(1, -1);
    }

    const rawResponse = (cellTexts[2] || '').trim();

    // Separate conversational response from system metadata/payload
    let assistantReply = rawResponse;
    let payload = null;

    const payloadMatch = rawResponse.match(/\n?\[(.*?)\]\s*$/s);
    if (payloadMatch) {
      payload = payloadMatch[1].trim();
      assistantReply = rawResponse.slice(0, payloadMatch.index).trim();
    }

    corpus.push({
      globalId: corpus.length + 1,
      categoryIndex: catIdx + 1,
      category: catName,
      categorySlug: catSlug,
      itemNumber: indexNum,
      user: userInput,
      assistant: assistantReply,
      payload: payload
    });
  }
});

console.log(`Total parsed items: ${corpus.length}`);

// Save to JSON
const jsonOutputPath = path.join(__dirname, '../src/services/enterprise800Dataset.json');
fs.writeFileSync(jsonOutputPath, JSON.stringify(corpus, null, 2), 'utf8');
console.log(`Saved corpus to ${jsonOutputPath}`);

// Generate JS module wrapper
const jsContent = `/**
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

  const queryTokens = userQuery.toLowerCase().split(/[\\s,!?.-]+/).filter(t => t.length > 2);
  let candidates = corpus;
  if (categorySlug) {
    candidates = corpus.filter(i => i.categorySlug === categorySlug);
  }

  const scored = candidates.map(item => {
    const itemTokens = item.user.toLowerCase().split(/[\\s,!?.-]+/).filter(t => t.length > 2);
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
`;

const jsOutputPath = path.join(__dirname, '../src/services/enterprise800Dataset.js');
fs.writeFileSync(jsOutputPath, jsContent, 'utf8');
console.log(`Saved JS module to ${jsOutputPath}`);
