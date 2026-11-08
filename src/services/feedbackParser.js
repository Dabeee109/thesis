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

const STRICT_RATING_ANCHOR_REGEX = /(?:isa(?:ng)?|dalawa(?:ng)?|tatlo(?:ng)?|apat|lima(?:ng)?|one|two|three|four|five|\d+)\s*(?:na\s*)?(?:stars?|bituin|ratings?|rate\b)/i;

/**
 * Parse informal customer input into rating (1-5) and feedback reason/comment
 * Enforces Feature 5 Strict Anchor Check: Numbers only parse as ratings if explicitly anchored to rating words or emojis
 * @param {string} text 
 * @param {Object} [session=null] - Active conversation session for contextual disambiguation
 * @returns {{ isFeedback: boolean, rating: number|null, comment: string }}
 */
function parseCustomerFeedback(text, session = null) {
  if (!text || typeof text !== 'string') {
    return { isFeedback: false, rating: null, comment: '' };
  }

  const clean = text.trim();
  const lower = clean.toLowerCase();

  // Strict Anchor Check (Feature 5)
  // Prevents quantity words like "dalawang Spanish Latte" or "3 cookies" from colliding with ratings
  const hasEmojiStar = /[⭐★]/.test(clean);
  const hasRatingAnchor = STRICT_RATING_ANCHOR_REGEX.test(lower);
  const isAwaitingRatingState = Boolean(session && (session.state === 'AWAITING_FEEDBACK_RATING' || session.state === 'awaiting_feedback'));

  if (!hasEmojiStar && !hasRatingAnchor && !isAwaitingRatingState) {
    return { isFeedback: false, rating: null, comment: '' };
  }

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
  const tagalogApatNaRegex = /\b(apat\s+na)\s*(?:stars?|bituin|ratings?|rate|[⭐★])\b/i;
  const apatMatch = lower.match(tagalogApatNaRegex);
  if (apatMatch) {
    rating = 4;
    matchIndex = apatMatch.index;
    matchLength = apatMatch[0].length;
  }

  // 3. Number words anchored to rating words: "isang star", "dalawang stars", "tatlong bituin", "five stars"
  if (rating === null) {
    const wordPattern = /\b(one|two|three|four|five|isa|isang|dalawa|dalawang|tatlo|tatlong|lima|limang)\s*(?:na\s+)?(?:stars?|bituin|ratings?|rate|[⭐★])\b/i;
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

  // 4. Digit patterns strictly anchored: "1 star", "2 stars", "3 stars", "4 stars", "5 stars", "5 ⭐", "5/5"
  if (rating === null) {
    const digitStarPattern = /(?:^|\b)([1-5])\s*(?:stars?|bituin|ratings?|rate|[⭐★]|\/5|\s*out\s+of\s+5)(?:\b|\s|$)/i;
    const digitMatch = lower.match(digitStarPattern);
    if (digitMatch) {
      rating = parseInt(digitMatch[1], 10);
      matchIndex = digitMatch.index;
      matchLength = digitMatch[0].length;
    } else if (isAwaitingRatingState && /^[1-5]$/.test(clean)) {
      // Direct 1-5 digit response only permitted when bot explicitly asked for a rating
      rating = parseInt(clean, 10);
      matchIndex = 0;
      matchLength = clean.length;
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

  // 1. Identify order to attach feedback to and verify eligibility (Feature 2)
  let order = null;
  let orderId = session.pendingFeedbackOrderId || null;
  let orderNumber = session.pendingFeedbackOrderNumber || session.activeOrderNumber || null;
  let customerId = session.customerId || null;

  if (orderId) {
    const [rows] = await db.query(`SELECT id, order_number, customer_id, status FROM orders WHERE id = ?`, [orderId]);
    if (rows && rows.length > 0) order = rows[0];
  }

  if (!order && orderNumber) {
    const [rows] = await db.query(`SELECT id, order_number, customer_id, status FROM orders WHERE order_number = ?`, [orderNumber]);
    if (rows && rows.length > 0) order = rows[0];
  }

  if (!order && psid) {
    const [orders] = await db.query(
      `SELECT o.id, o.order_number, o.customer_id, o.status
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       WHERE c.psid = ?
       ORDER BY o.created_at DESC LIMIT 1`,
      [psid]
    );
    if (orders && orders.length > 0) {
      order = orders[0];
    }
  }

  // Feature 2: Eligibility Guardrails (Prevent premature ratings before delivery)
  if (!order) {
    const reply = "Maaari lamang po kayong mag-iwan ng feedback kapag natanggap na ang inyong order. Salamat po sa paghihintay!";
    await sendTextMessage(psid, reply);
    return { success: false, eligible: false, reason: 'no_order', botReply: reply };
  }

  const normalizedStatus = String(order.status || '').toLowerCase();

  // Ineligible: In-progress orders (pending, preparing, dispatched)
  if (['pending', 'preparing', 'dispatched'].includes(normalizedStatus)) {
    const reply = "Maaari lamang po kayong mag-iwan ng feedback kapag natanggap na ang inyong order. Salamat po sa paghihintay!";
    await sendTextMessage(psid, reply);
    return {
      success: false,
      eligible: false,
      reason: 'order_in_progress',
      orderStatus: normalizedStatus,
      botReply: reply
    };
  }

  // Ineligible: Cancelled orders
  if (['cancelled', 'voided'].includes(normalizedStatus)) {
    const reply = "Paumanhin po, hindi maaaring mag-iwan ng review para sa na-cancel na order. Kung kailangan niyo po ng tulong, narito po ang aming customer support.";
    await sendTextMessage(psid, reply);
    return {
      success: false,
      eligible: false,
      reason: 'order_cancelled',
      orderStatus: normalizedStatus,
      botReply: reply
    };
  }

  // Eligible order verified
  orderId = order.id;
  orderNumber = order.order_number;
  customerId = order.customer_id || customerId;

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
  const acknowledgmentMessage = "Maraming salamat po sa inyong rating at feedback! Malaking tulong po ito sa amin. Enjoy your meal and see you again soon!";
  await sendTextMessage(psid, acknowledgmentMessage);

  return {
    success: true,
    eligible: true,
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

