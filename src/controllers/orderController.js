/**
 * Order Operations Controller (FR3, FR4, FR6, FR7, FR9)
 * Handles listing orders, status progression, summary KPIs, and order cancellations.
 */

const orderService = require('../services/orderService');
const { getOrdersList, getOrderDetails, updateOrderStatus, createOrder, verifyOrderPayment, markOrderPaymentInvalid } = orderService;
const db = require('../../database/db');

/**
 * Get orders list with optional filters
 */
async function getOrders(req, res) {
  try {
    const { status, orderType, paymentMismatch } = req.query;
    const orders = await getOrdersList({ status, orderType, paymentMismatch });
    return res.json({ success: true, count: orders.length, orders });
  } catch (err) {
    console.error('[Order List Error]', err);
    return res.status(500).json({ success: false, message: `Failed to retrieve orders: ${err.message}`, error: err.message });
  }
}

/**
 * Get specific order details
 */
async function getOrder(req, res) {
  try {
    const { id } = req.params;
    const order = await getOrderDetails(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    return res.json({ success: true, order });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to retrieve order details.' });
  }
}

/**
 * Update order status
 */
async function changeOrderStatus(req, res) {
  try {
    const { id } = req.params;
    let { status, riderId, cancellationReason } = req.body;

    if (typeof status === 'string') {
      const s = status.trim().toLowerCase();
      if (s === 'in_preparation' || s === 'in kitchen preparation' || s === 'preparing') status = 'preparing';
      else if (s === 'dispatched' || s === 'on_delivery' || s === 'dispatched / on delivery') status = 'dispatched';
      else if (s === 'delivered') status = 'delivered';
      else if (s === 'cancelled' || s === 'canceled') status = 'cancelled';
      else if (s === 'pending') status = 'pending';
    }

    const validStatuses = ['pending', 'preparing', 'dispatched', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const updated = await updateOrderStatus(parseInt(id, 10), status, { riderId, cancellationReason });
    return res.json({ success: true, message: `Order status updated to ${status}.`, order: updated });
  } catch (err) {
    console.error('[Order Status Update Error]', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to update order status.' });
  }
}

/**
 * Get Dashboard KPI Summary Cards
 */
async function getSummaryKPIs(req, res) {
  try {
    // Total Orders Today & Total Revenue Today
    const [salesToday] = await db.query(`
      SELECT 
        COUNT(*) AS total_orders,
        COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total_amount ELSE 0 END), 0) AS total_revenue
      FROM orders
      WHERE DATE(created_at) = DATE('now')
    `);

    // Pending Orders Count
    const [pendingOrders] = await db.query(`
      SELECT COUNT(*) AS count FROM orders WHERE status = 'pending'
    `);

    // Active Deliveries Count (dispatched / assigned)
    const [activeDeliveries] = await db.query(`
      SELECT COUNT(*) AS count FROM deliveries WHERE status IN ('assigned', 'dispatched')
    `);

    // GCash Mismatch Alerts Count
    const [paymentMismatches] = await db.query(`
      SELECT COUNT(*) AS count FROM payments WHERE is_mismatch = 1 AND status = 'mismatch_flagged'
    `);

    // Low Stock Items Count
    const [lowStock] = await db.query(`
      SELECT COUNT(*) AS count FROM inventory WHERE stock_quantity <= low_stock_threshold
    `);

    // Customer Satisfaction Rating
    const [ratings] = await db.query(`
      SELECT AVG(rating) AS avg_rating, COUNT(*) AS feedback_count FROM feedback
    `);

    return res.json({
      success: true,
      kpi: {
        totalOrdersToday: salesToday[0]?.total_orders || 0,
        totalRevenueToday: parseFloat(salesToday[0]?.total_revenue || 0),
        pendingOrders: pendingOrders[0]?.count || 0,
        activeDeliveries: activeDeliveries[0]?.count || 0,
        paymentMismatches: paymentMismatches[0]?.count || 0,
        lowStockItems: lowStock[0]?.count || 0,
        averageRating: ratings[0]?.avg_rating ? parseFloat(Number(ratings[0].avg_rating).toFixed(1)) : 5.0,
        totalFeedback: ratings[0]?.feedback_count || 0
      }
    });
  } catch (err) {
    console.error('[KPI Summary Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve summary statistics.' });
  }
}

/**
 * Create order directly from admin POS / dashboard
 */
async function createManualOrder(req, res) {
  try {
    const order = await createOrder(req.body);
    return res.status(201).json({ success: true, message: 'Order created successfully.', order });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

/**
 * Barista requests void authorization from Owner
 */
async function requestVoid(req, res) {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    if (!reason) {
      return res.status(400).json({ success: false, message: 'Cancellation reason is required.' });
    }

    const user = req.user || { name: 'Barista', role: 'staff' };
    const result = await require('../services/orderService').requestVoidOrder(parseInt(id, 10), user, reason);
    return res.json({
      success: true,
      message: `Void request for Order #${result.orderNumber} has been sent to the Owner for approval.`,
      result
    });
  } catch (err) {
    console.error('[Request Void Error]', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to request void.' });
  }
}

/**
 * Owner authorizes void OR barista authorizes with Owner Password/PIN
 */
async function authorizeVoid(req, res) {
  try {
    const { id } = req.params;
    const { reason, managerPassword } = req.body;

    const user = req.user || { name: 'Admin', role: 'admin' };

    // If user is staff/barista, verify Manager Password ('password123')
    if (user.role !== 'admin') {
      if (managerPassword !== 'password123' && managerPassword !== 'admin123') {
        return res.status(403).json({ success: false, message: 'Invalid Owner/Manager authorization password.' });
      }
    }

    const updated = await require('../services/orderService').authorizeVoidOrder(parseInt(id, 10), user, reason);
    return res.json({
      success: true,
      message: `Order #${updated.orderNumber} has been successfully cancelled and voided.`,
      order: updated
    });
  } catch (err) {
    console.error('[Authorize Void Error]', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to authorize void.' });
  }
}

/**
 * Owner rejects void request
 */
async function rejectVoid(req, res) {
  try {
    const { id } = req.params;
    const { rejectionNote } = req.body;
    const user = req.user || { name: 'Admin', role: 'admin' };

    if (user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only the Owner/Manager can reject void requests.' });
    }

    const result = await require('../services/orderService').rejectVoidOrder(parseInt(id, 10), user, rejectionNote);
    return res.json({
      success: true,
      message: `Void request for Order #${result.orderNumber} was rejected.`,
      result
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to reject void.' });
  }
}

/**
 * Cancel / Void Order endpoint
 * POST /api/admin/orders/:id/cancel
 * POST /api/orders/:id/cancel
 * Enforces Dynamic Order Cancellation Guard:
 * - IN_PREPARATION: Block cancellation ("kasalukuyan na pong inihahanda sa kusina")
 * - DISPATCHED / ON_DELIVERY: Block cancellation ("na-dispatch na po ang inyong order at kasalukuyan na pong papunta ang ating rider")
 * - PENDING: Allow cancellation, restore stock, inform kitchen dashboard
 */
async function cancelOrder(req, res) {
  try {
    const { id } = req.params;
    const { reason, cancellationReason, forceAdminOverride } = req.body;
    const finalReason = cancellationReason || reason || 'Cancelled by customer / admin request';

    const [rows] = await db.query('SELECT id, order_number, status FROM orders WHERE id = ?', [id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    const currentOrder = rows[0];
    const s = String(currentOrder.status).toLowerCase();
    const isAdminOverride = req.user && req.user.role === 'admin' && Boolean(forceAdminOverride);

    if (!isAdminOverride) {
      if (s === 'preparing' || s === 'in_preparation') {
        return res.status(400).json({
          success: false,
          code: 'CANCELLATION_BLOCKED_IN_PREPARATION',
          message: `Paumanhin po, kasalukuyan na pong inihahanda sa kusina ang inyong order #${currentOrder.order_number}. Hindi na po ito maaaring i-cancel upang maiwasan ang food waste. Maraming salamat po sa pag-unawa!`
        });
      }
      if (s === 'dispatched' || s === 'on_delivery') {
        return res.status(400).json({
          success: false,
          code: 'CANCELLATION_BLOCKED_DISPATCHED',
          message: `Paumanhin po, na-dispatch na po ang inyong order #${currentOrder.order_number} at kasalukuyan na pong papunta ang ating rider sa inyong lokasyon. Hindi na po ito maaaring i-cancel. Pakihanda na lang po ang inyong bayad o pagtanggap. Salamat po!`
        });
      }
    }

    const updated = await updateOrderStatus(parseInt(id, 10), 'cancelled', {
      cancellationReason: finalReason
    });

    return res.json({
      success: true,
      message: `Order #${updated.orderNumber} has been successfully cancelled.`,
      order: updated
    });
  } catch (err) {
    console.error('[Order Cancel Error]', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to cancel order.' });
  }
}

/**
 * Mark payment verified / paid
 * POST /api/orders/:id/verify-payment
 */
async function verifyPayment(req, res) {
  try {
    const { id } = req.params;
    const actor = req.user || { id: null, username: 'Staff' };
    const updated = await orderService.verifyOrderPayment(parseInt(id, 10), actor);
    return res.json({
      success: true,
      message: `Payment for Order #${updated.order_number} marked as Paid. Order moved to In Kitchen Preparation.`,
      order: updated
    });
  } catch (err) {
    console.error('[Verify Payment Error]', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to verify payment.' });
  }
}

/**
 * Mark payment invalid / prompt re-upload
 * POST /api/orders/:id/invalid-payment
 */
async function invalidPayment(req, res) {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const actor = req.user || { id: null, username: 'Staff' };
    const updated = await orderService.markOrderPaymentInvalid(parseInt(id, 10), reason, actor);
    return res.json({
      success: true,
      message: `Payment proof for Order #${updated.order_number} marked as invalid. Customer has been notified and prompted to re-upload.`,
      order: updated
    });
  } catch (err) {
    console.error('[Invalid Payment Error]', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to update payment status.' });
  }
}

module.exports = {
  getOrders,
  getOrder,
  changeOrderStatus,
  cancelOrder,
  verifyPayment,
  invalidPayment,
  getSummaryKPIs,
  createManualOrder,
  requestVoid,
  authorizeVoid,
  rejectVoid
};
