/**
 * Customer Feedback & Ratings Controller (FR11)
 * Analyzes post-delivery ratings, comments, customer sentiments, and ratings distribution.
 */

const db = require('../../database/db');
const { broadcastSSE } = require('../services/notificationService');

/**
 * Get all customer feedback and rating metrics
 */
async function getFeedback(req, res) {
  try {
    const [feedbackList] = await db.query(`
      SELECT 
        f.*,
        o.order_number,
        o.total_amount,
        CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, '')) AS customer_name,
        c.psid,
        dp.full_name AS rider_name
      FROM feedback f
      JOIN orders o ON f.order_id = o.id
      JOIN customers c ON f.customer_id = c.id
      LEFT JOIN deliveries d ON o.id = d.order_id
      LEFT JOIN delivery_personnel dp ON d.rider_id = dp.id
      ORDER BY f.created_at DESC
    `);

    // Calculate rating counts (1 to 5 stars)
    const breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    let totalScore = 0;

    feedbackList.forEach(item => {
      const r = item.rating;
      if (breakdown[r] !== undefined) {
        breakdown[r]++;
      }
      totalScore += r;
    });

    const totalCount = feedbackList.length;
    const averageRating = totalCount > 0 ? parseFloat((totalScore / totalCount).toFixed(2)) : 5.0;

    // Calculate NPS / Satisfaction percentage (Ratings 4 & 5 vs 1 & 2)
    const promoters = (breakdown[5] + breakdown[4]);
    const detractors = (breakdown[1] + breakdown[2]);
    const satisfactionRate = totalCount > 0 ? Math.round((promoters / totalCount) * 100) : 100;

    return res.json({
      success: true,
      metrics: {
        totalFeedback: totalCount,
        averageRating,
        satisfactionRate,
        breakdown
      },
      feedback: feedbackList
    });
  } catch (err) {
    console.error('[Feedback Controller Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve feedback.' });
  }
}

/**
 * Submit feedback directly (e.g. from Web / Simulator)
 */
async function submitFeedback(req, res) {
  try {
    const { orderId, rating, comments = '' } = req.body;

    if (!orderId || !rating) {
      return res.status(400).json({ success: false, message: 'orderId and rating are required.' });
    }

    const [orders] = await db.query(`SELECT id, customer_id, order_number, status FROM orders WHERE id = ?`, [orderId]);
    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const order = orders[0];
    const orderStatus = String(order.status || '').toLowerCase();

    // Feature 2: Eligibility Guardrails (Prevent premature review entry)
    if (['pending', 'preparing', 'dispatched'].includes(orderStatus)) {
      return res.status(400).json({
        success: false,
        eligible: false,
        orderStatus,
        message: 'Maaari lamang po kayong mag-iwan ng feedback kapag natanggap na ang inyong order. Salamat po sa paghihintay!'
      });
    }

    if (['cancelled', 'voided'].includes(orderStatus)) {
      return res.status(400).json({
        success: false,
        eligible: false,
        orderStatus,
        message: 'Paumanhin po, hindi maaaring mag-iwan ng review para sa na-cancel na order. Kung kailangan niyo po ng tulong, narito po ang aming customer support.'
      });
    }

    if (orderStatus !== 'delivered') {
      return res.status(400).json({
        success: false,
        eligible: false,
        orderStatus,
        message: 'Maaari lamang po kayong mag-iwan ng feedback kapag natanggap na ang inyong order. Salamat po sa paghihintay!'
      });
    }
    const starRating = parseInt(rating, 10);
    const sentiment = starRating >= 4 ? 'positive' : starRating === 3 ? 'neutral' : 'negative';

    const [existing] = await db.query(`SELECT id FROM feedback WHERE order_id = ?`, [order.id]);
    if (existing.length > 0) {
      await db.query(
        `UPDATE feedback SET rating = ?, comments = ?, sentiment = ? WHERE order_id = ?`,
        [starRating, comments, sentiment, order.id]
      );
    } else {
      await db.query(
        `INSERT INTO feedback (order_id, customer_id, rating, comments, sentiment)
         VALUES (?, ?, ?, ?, ?)`,
        [order.id, order.customer_id, starRating, comments, sentiment]
      );
    }

    broadcastSSE('NEW_FEEDBACK', {
      orderId: order.id,
      orderNumber: order.order_number,
      rating: starRating,
      comments,
      sentiment
    });

    return res.status(201).json({ success: true, message: 'Thank you for your feedback!' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to submit feedback.' });
  }
}

module.exports = {
  getFeedback,
  submitFeedback
};
