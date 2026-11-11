/**
 * Smart Delivery Management Controller (FR6)
 * Handles rider assignments, live delivery monitoring, fare calculations, and manual fare overrides.
 */

const db = require('../../database/db');
const { calculateDeliveryFare } = require('../services/fareCalculator');
const fareEngine = require('../services/fareEngine');
const { broadcastSSE } = require('../services/notificationService');
const orderService = require('../services/orderService');
const systemSettingsService = require('../services/systemSettingsService');

/**
 * Get all active and recent deliveries
 */
async function getDeliveries(req, res) {
  try {
    const [deliveries] = await db.query(`
      SELECT 
        d.*,
        o.order_number,
        o.total_amount,
        o.delivery_address,
        o.customer_notes,
        CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, '')) AS customer_name,
        c.phone_number AS customer_phone,
        dp.full_name AS rider_name,
        dp.phone_number AS rider_phone,
        dp.vehicle_type AS rider_vehicle_type
      FROM deliveries d
      JOIN orders o ON d.order_id = o.id
      JOIN customers c ON o.customer_id = c.id
      LEFT JOIN delivery_personnel dp ON d.rider_id = dp.id
      ORDER BY 
        CASE d.status 
          WHEN 'dispatched' THEN 1
          WHEN 'assigned' THEN 2
          WHEN 'pending' THEN 3
          WHEN 'delivered' THEN 4
          ELSE 5
        END,
        d.created_at DESC
    `);

    return res.json({ success: true, count: deliveries.length, deliveries });
  } catch (err) {
    console.error('[Delivery List Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve deliveries.' });
  }
}

/**
 * Get all delivery riders
 */
async function getRiders(req, res) {
  try {
    const [riders] = await db.query(`
      SELECT 
        dp.*,
        (SELECT COUNT(*) FROM deliveries WHERE rider_id = dp.id AND status IN ('assigned', 'dispatched')) AS active_trips,
        (SELECT COUNT(*) FROM deliveries WHERE rider_id = dp.id AND status = 'delivered') AS completed_trips
      FROM delivery_personnel dp
      WHERE dp.is_active = 1
      ORDER BY dp.full_name ASC
    `);

    return res.json({ success: true, riders });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to retrieve riders.' });
  }
}

/**
 * Compute Delivery Fare (FR6 Engine Endpoint)
 */
async function computeFare(req, res) {
  try {
    const { distanceKm, vehicleType = 'motorcycle', weatherCondition = 'sunny', currentTime = null } = req.body;

    if (distanceKm === undefined || distanceKm === null) {
      return res.status(400).json({ success: false, message: 'distanceKm is required.' });
    }

    // Dynamic Database Rates Query (Requirement 2)
    const fareSettings = await systemSettingsService.getFareSettings();
    const fare = calculateDeliveryFare(parseFloat(distanceKm), vehicleType, weatherCondition, currentTime, null, fareSettings);
    return res.json({ success: true, fare, fareSettings });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

/**
 * Assign Rider to Delivery
 */
async function assignRider(req, res) {
  try {
    const { deliveryId, riderId, vehicleType, weatherCondition, overrideFare, overrideReason } = req.body;

    const [delRows] = await db.query(`SELECT * FROM deliveries WHERE id = ?`, [deliveryId]);
    if (delRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Delivery record not found.' });
    }

    const del = delRows[0];
    const vType = vehicleType || del.vehicle_type;
    const wCondition = weatherCondition || del.weather_condition;
    const fareCalc = calculateDeliveryFare(del.distance_km, vType, wCondition, new Date());

    let finalFare = fareCalc.finalFare;
    let isOverridden = 0;
    let reason = null;

    if (overrideFare !== undefined && overrideFare !== null && overrideFare !== '') {
      finalFare = parseFloat(overrideFare);
      isOverridden = 1;
      reason = overrideReason || 'Manual Admin Override';
    }

    await db.query(
      `UPDATE deliveries 
       SET rider_id = ?, vehicle_type = ?, weather_condition = ?, computed_fare = ?, final_fare = ?, 
           is_fare_overridden = ?, override_reason = ?, status = 'dispatched', dispatched_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [riderId, vType, wCondition, fareCalc.rawFinalFare, finalFare, isOverridden, reason, deliveryId]
    );

    // Update rider status to on_delivery
    await db.query(`UPDATE delivery_personnel SET status = 'on_delivery' WHERE id = ?`, [riderId]);

    // Advance order status to dispatched
    const { updateOrderStatus } = require('../services/orderService');
    await updateOrderStatus(del.order_id, 'dispatched', { riderId });

    broadcastSSE('DELIVERY_ASSIGNED', {
      deliveryId,
      orderId: del.order_id,
      riderId,
      finalFare,
      status: 'dispatched'
    });

    return res.json({ success: true, message: 'Rider assigned and fare updated.', finalFare });
  } catch (err) {
    console.error('[Assign Rider Error]', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to assign rider.' });
  }
}

/**
 * Override Fare Manually
 */
async function overrideFare(req, res) {
  try {
    const { id } = req.params;
    const { finalFare, overrideReason } = req.body;

    if (finalFare === undefined || !overrideReason) {
      return res.status(400).json({ success: false, message: 'finalFare and overrideReason are required.' });
    }

    await db.query(
      `UPDATE deliveries 
       SET final_fare = ?, is_fare_overridden = 1, override_reason = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [parseFloat(finalFare), overrideReason.trim(), id]
    );

    broadcastSSE('FARE_OVERRIDDEN', { deliveryId: id, finalFare, overrideReason });

    return res.json({ success: true, message: 'Delivery fare manually overridden.', finalFare });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to override fare.' });
  }
}

/**
 * Get active orders assigned to rider (Requirement 3: Rider Active Queue)
 * Visible orders: In Kitchen Preparation ('preparing') AND Dispatched / On Delivery ('dispatched')
 * Sorted chronologically by updated_at ASC (FIFO queue)
 */
async function getActiveRiderOrders(req, res) {
  try {
    const riderId = req.query.riderId ? parseInt(req.query.riderId, 10) : null;
    let query = `
      SELECT 
        d.id AS delivery_id,
        d.order_id,
        d.rider_id,
        d.vehicle_type,
        d.distance_km,
        d.weather_condition,
        d.final_fare,
        d.status AS delivery_status,
        d.dispatched_at,
        d.created_at AS delivery_created_at,
        o.order_number,
        o.order_type AS dining_mode,
        o.status AS order_status,
        o.total_amount,
        o.delivery_address,
        COALESCE(o.customer_lat, d.customer_lat) AS customer_lat,
        COALESCE(o.customer_lng, d.customer_lng) AS customer_lng,
        o.customer_notes,
        o.updated_at AS order_updated_at,
        CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, '')) AS customer_name,
        c.phone_number AS customer_phone,
        dp.full_name AS rider_name,
        dp.phone_number AS rider_phone
      FROM orders o
      JOIN deliveries d ON d.order_id = o.id
      JOIN customers c ON o.customer_id = c.id
      LEFT JOIN delivery_personnel dp ON d.rider_id = dp.id
      WHERE LOWER(o.order_type) = 'delivery'
        AND (
          LOWER(o.status) IN ('preparing', 'dispatched')
          OR o.status IN ('In Kitchen Preparation', 'Dispatched / On Delivery')
        )
        AND LOWER(d.status) IN ('pending', 'assigned', 'dispatched')
    `;

    const params = [];
    if (riderId) {
      query += ` AND d.rider_id = ?`;
      params.push(riderId);
    }

    query += ` ORDER BY o.updated_at ASC, d.created_at ASC`;

    const [orders] = await db.query(query, params);

    const formattedOrders = orders.map(ord => {
      let friendlyStatus = ord.order_status;
      if (ord.order_status === 'preparing') friendlyStatus = 'In Kitchen Preparation';
      else if (ord.order_status === 'dispatched') friendlyStatus = 'Dispatched / On Delivery';
      else if (ord.order_status === 'delivered') friendlyStatus = 'Delivered';

      return {
        ...ord,
        order_status: friendlyStatus,
        raw_status: ord.order_status
      };
    });

    return res.json({
      success: true,
      count: formattedOrders.length,
      orders: formattedOrders,
      deliveries: formattedOrders.map(ord => ({
        ...ord,
        id: ord.delivery_id,
        status: ord.order_status
      }))
    });
  } catch (err) {
    console.error('[Rider Active Orders Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve active rider orders.' });
  }
}

/**
 * Delivery Completion Gatekeeper (POST /api/rider/orders/:id/complete) (Requirement 3.2)
 */
async function completeRiderDelivery(req, res) {
  try {
    const orderId = parseInt(req.params.id, 10);
    const [orderRows] = await db.query('SELECT id, status, order_number, order_type FROM orders WHERE id = ?', [orderId]);
    if (!orderRows || orderRows.length === 0) {
      return res.status(404).json({ success: false, message: `Order #${orderId} not found.` });
    }

    const order = orderRows[0];
    const currentStatus = (order.status || '').toLowerCase();

    // 1. Gatekeeper check: Reject if in kitchen preparation
    if (currentStatus === 'preparing' || currentStatus === 'in kitchen preparation') {
      return res.status(403).json({
        success: false,
        message: 'Cannot complete delivery while order is still in kitchen preparation.'
      });
    }

    // 2. Must be dispatched / on delivery
    if (currentStatus !== 'dispatched' && currentStatus !== 'dispatched / on delivery') {
      return res.status(400).json({
        success: false,
        message: `Order cannot be marked as delivered from status: ${order.status}`
      });
    }

    // 3. Mark as delivered and unlock customer feedback gate
    const updated = await orderService.updateOrderStatus(orderId, 'delivered', {
      riderId: req.user?.riderId || req.body?.riderId
    });

    return res.json({
      success: true,
      message: 'Order marked as delivered successfully. Customer feedback gate unlocked.',
      order: updated
    });
  } catch (err) {
    console.error('[Complete Rider Delivery Error]', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to complete delivery.' });
  }
}

/**
 * FEATURE 1: Rider Delivered History
 * Returns only orders where order_type = 'delivery' AND status = 'delivered'
 */
async function getRiderHistory(req, res) {
  try {
    const riderId = req.query.riderId ? parseInt(req.query.riderId, 10) : null;
    let query = `
      SELECT 
        d.id AS delivery_id,
        d.order_id,
        d.rider_id,
        d.distance_km,
        d.final_fare,
        d.status AS delivery_status,
        d.delivered_at,
        o.order_number,
        o.order_type AS dining_mode,
        o.status AS order_status,
        o.total_amount,
        o.delivery_address,
        COALESCE(o.customer_lat, d.customer_lat) AS customer_lat,
        COALESCE(o.customer_lng, d.customer_lng) AS customer_lng,
        o.customer_notes,
        CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, '')) AS customer_name,
        c.phone_number AS customer_phone,
        dp.full_name AS rider_name
      FROM orders o
      JOIN deliveries d ON d.order_id = o.id
      JOIN customers c ON o.customer_id = c.id
      LEFT JOIN delivery_personnel dp ON d.rider_id = dp.id
      WHERE LOWER(o.order_type) = 'delivery'
        AND LOWER(o.status) = 'delivered'
    `;

    const params = [];
    if (riderId) {
      query += ` AND d.rider_id = ?`;
      params.push(riderId);
    }

    query += ` ORDER BY d.delivered_at DESC, o.updated_at DESC LIMIT 50`;

    const [history] = await db.query(query, params);

    return res.json({
      success: true,
      count: history.length,
      history,
      deliveries: history.map(h => ({
        ...h,
        id: h.delivery_id,
        status: h.order_status
      }))
    });
  } catch (err) {
    console.error('[Rider History Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve rider history.' });
  }
}

/**
 * Compute Delivery Fare from Address & Optional Landmark (Nominatim + OSRM Engine)
 * POST /api/delivery/calculate-fare
 */
async function calculateFareFromAddress(req, res) {
  try {
    const { address = '', landmark = '' } = req.body || {};

    if (!String(address || '').trim() && !String(landmark || '').trim()) {
      return res.status(400).json({
        success: false,
        message: 'address or landmark is required.'
      });
    }

    const result = await fareEngine.calculateFareForAddress(address, landmark);
    return res.json({
      success: true,
      distanceKm: result.distanceKm,
      isOutOfBounds: result.isOutOfBounds,
      maxRadiusKm: result.maxRadiusKm,
      coordinates: result.coordinates,
      formattedAddress: result.formattedAddress,
      breakdown: result.breakdown
    });
  } catch (err) {
    const status = err.code === 'GEOCODE_NOT_FOUND' ? 422 : 400;
    return res.status(status).json({
      success: false,
      code: err.code || 'FARE_CALCULATION_ERROR',
      message: err.message || 'Unable to compute delivery fare.'
    });
  }
}

module.exports = {
  getDeliveries,
  getRiders,
  computeFare,
  calculateFareFromAddress,
  assignRider,
  overrideFare,
  getActiveRiderOrders,
  getRiderHistory,
  completeRiderDelivery
};
