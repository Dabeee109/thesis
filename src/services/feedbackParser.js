/**
 * Multilingual Feedback & Star Rating Parser (Module 1)
 * Extracts ratings (1–5) and explanations/comments from informal English, Tagalog, and Taglish text.
 * Persists feedback to database and triggers real-time SSE broadcasts.
 */

const db = require('../../database/db');
const { broadcastSSE } = require('./notificationService');
const { sendTextMessage } = require('./messengerService');

const RATING_WORDS = {
  // English number words
  'one': 1,
  'two': 2,
  'three': 3,
  'four': 4,
  'five': 5,
  // Tagalog number words
  'isa': 1,
  'isang': 1,
  'dalawa': 2,
  'dalawang': 2,
  'tatlo': 3,
  'tatlong': 3,
  'apat': 4,
  'lima': 5,
  'limang': 5
};

const INDICATOR_WORDS = [
  'dahil sa',
  'dahil',
  'kasi',
  'kaso lang',
  'kaso',
  'because',
  'since',
  'reason is',
  'pero',
  'subalit',
  'ngunit'
];

/**
 * Extracts explanation written after indicator words or trailing text after star/stars
 * @param {string} str 
 * @returns {string}
 */
function extractCommentAfterIndicators(str) {
  if (!str) return '';
  let trimmed = str.replace(/^[,\s:\-–—]+/, '').trim();
  if (!trimmed) return '';

  const lower = trimmed.toLowerCase();

  for (const indicator of INDICATOR_WORDS) {
    const regex = new RegExp(`^${indicator}\\s*[:,-]?\\s*`, 'i');
    if (regex.test(trimmed)) {
      return trimmed.replace(regex, '').trim();
    }
    const idx = lower.indexOf(indicator);
    if (idx >= 0) {
      const after = trimmed.slice(idx + indicator.length).replace(/^[,\s:\-–—]+/, '').trim();
      if (after) return after;
    }
  }

  return trimmed;
}

/**
 * Parse informal customer input into rating (1-5) and feedback reason/comment
 * @param {string} text 
 * @returns {{ isFeedback: boolean, rating: number|null, comment: string }}
 */
function parseCustomerFeedback(text) {
  if (!text || typeof text !== 'string') {
    return { isFeedback: false, rating: null, comment: '' };
  }

  const clean = text.trim();
  const lower = clean.toLowerCase();

  let rating = null;
  let matchIndex = -1;
  let matchLength = 0;

  // 1. Emoji star count (e.g., ⭐⭐⭐⭐⭐)
  const starCount = (clean.match(/[⭐★]/g) || []).length;
  if (starCount >= 1 && starCount <= 5 && !/[0-9]/.test(clean)) {
    rating = starCount;
    const remaining = clean.replace(/[⭐★]/g, '').trim();
    return {
      isFeedback: true,
      rating,
      comment: extractCommentAfterIndicators(remaining)
    };
  }

  // 2. Tagalog: "apat na stars", "apat na star"
  const tagalogApatNaRegex = /\b(apat\s+na)\s*(?:stars?|bituin|[⭐★])?\b/i;
  const apatMatch = lower.match(tagalogApatNaRegex);
  if (apatMatch) {
    rating = 4;
    matchIndex = apatMatch.index;
    matchLength = apatMatch[0].length;
  }

  // 3. Number words (English & Tagalog)
  if (rating === null) {
    const wordPattern = /\b(one|two|three|four|five|isa|isang|dalawa|dalawang|tatlo|tatlong|lima|limang)\s*(?:na\s+)?(?:stars?|bituin|[⭐★])?\b/i;
    const wordMatch = lower.match(wordPattern);
    if (wordMatch) {
      const wordKey = wordMatch[1].toLowerCase();
      if (RATING_WORDS[wordKey] !== undefined) {
        rating = RATING_WORDS[wordKey];
        matchIndex = wordMatch.index;
        matchLength = wordMatch[0].length;
      }
    }
  }

  // 4. Digit patterns: "1 star", "2 stars", "3 stars", "4 stars", "5 stars", "5 ⭐", "5/5"
  if (rating === null) {
    const digitStarPattern = /(?:^|\b)([1-5])\s*(?:stars?|bituin|[⭐★]|\/5|\s*out\s+of\s+5)?(?:\b|\s|$)/i;
    const digitMatch = lower.match(digitStarPattern);
    if (digitMatch) {
      const hasStarWord = /(?:stars?|bituin|[⭐★]|\/5|grade|rating)/i.test(lower);
      const isStandaloneDigit = /^[1-5]$/.test(clean);
      const hasFeedbackIndicator = INDICATOR_WORDS.some(ind => lower.includes(ind));

      if (hasStarWord || isStandaloneDigit || hasFeedbackIndicator) {
        rating = parseInt(digitMatch[1], 10);
        matchIndex = digitMatch.index;
        matchLength = digitMatch[0].length;
      }
    }
  }

  if (rating === null || rating < 1 || rating > 5) {
    return { isFeedback: false, rating: null, comment: '' };
  }

  let commentCandidate = '';
  if (matchIndex >= 0) {
    commentCandidate = clean.slice(matchIndex + matchLength).trim();
  } else {
    commentCandidate = clean;
  }

  const extractedComment = extractCommentAfterIndicators(commentCandidate);

  return {
    isFeedback: true,
    rating,
    comment: extractedComment
  };
}

/**
 * Persist parsed feedback to the database, trigger SSE broadcast, and reply with official acknowledgment
 * @param {Object} params
 * @param {string} params.psid - Facebook PSID
 * @param {Object} params.session - Active conversation session
 * @param {number} params.rating - Integer score 1-5
 * @param {string} params.comment - Captured feedback comment (or '')
 * @returns {Promise<{ success: boolean, orderId: number|null, botReply: string }>}
 */
async function processFeedbackSubmission({ psid, session, rating, comment = '' }) {
  const sanitizedComment = String(comment || '').replace(/[<>]/g, '').trim().substring(0, 500);

  // 1. Identify order to attach feedback to
  let orderId = session.pendingFeedbackOrderId || null;
  let orderNumber = session.pendingFeedbackOrderNumber || session.activeOrderNumber || null;
  let customerId = session.customerId || null;

  if (!orderId) {
    const [orders] = await db.query(
      `SELECT o.id, o.order_number, o.customer_id
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       WHERE c.psid = ?
       ORDER BY o.created_at DESC LIMIT 1`,
      [psid]
    );
    if (orders && orders.length > 0) {
      orderId = orders[0].id;
      orderNumber = orders[0].order_number;
      customerId = customerId || orders[0].customer_id;
    }
  }

  if (!customerId && psid) {
    const [custRows] = await db.query(`SELECT id FROM customers WHERE psid = ?`, [psid]);
    if (custRows && custRows.length > 0) customerId = custRows[0].id;
  }

  const sentiment = rating >= 4 ? 'positive' : rating === 3 ? 'neutral' : 'negative';

  // 2. Persist to database if order exists
  if (orderId && customerId) {
    try {
      const [existing] = await db.query(`SELECT id FROM feedback WHERE order_id = ?`, [orderId]);
      if (existing && existing.length > 0) {
        await db.query(
          `UPDATE feedback SET rating = ?, comments = ?, sentiment = ? WHERE order_id = ?`,
          [rating, sanitizedComment, sentiment, orderId]
        );
      } else {
        await db.query(
          `INSERT INTO feedback (order_id, customer_id, rating, comments, sentiment)
           VALUES (?, ?, ?, ?, ?)`,
          [orderId, customerId, rating, sanitizedComment, sentiment]
        );
      }

      // Broadcast real-time SSE event to admin dashboard
      broadcastSSE('NEW_FEEDBACK', {
        orderId,
        orderNumber,
        rating,
        comments: sanitizedComment,
        sentiment,
        createdAt: new Date().toISOString()
      });
    } catch (err) {
      console.error('[FeedbackParser DB Error]', err.message);
    }
  }

  // 3. Clear pending feedback flags on session
  session.pendingFeedbackOrderId = null;
  session.pendingFeedbackOrderNumber = null;
  session.pendingRating = null;
  if (session.state === 'AWAITING_FEEDBACK_COMMENT' || session.state === 'awaiting_feedback') {
    session.state = 'IDLE';
    session.current_step = 'IDLE';
  }

  // 4. Send official polite acknowledgment to customer
  const acknowledgmentMessage = "Maraming salamat po sa inyong feedback! Malaking tulong po ito para mapaganda pa ang aming serbisyo.";
  await sendTextMessage(psid, acknowledgmentMessage);

  return {
    success: true,
    orderId,
    orderNumber,
    rating,
    comment: sanitizedComment,
    botReply: acknowledgmentMessage
  };
}

module.exports = {
  RATING_WORDS,
  INDICATOR_WORDS,
  parseCustomerFeedback,
  extractCommentAfterIndicators,
  processFeedbackSubmission
};
