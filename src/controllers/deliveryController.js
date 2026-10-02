/**
 * Smart Delivery Management Controller (FR6)
 * Handles rider assignments, live delivery monitoring, fare calculations, and manual fare overrides.
 */

const db = require('../../database/db');
const { calculateDeliveryFare } = require('../services/fareCalculator');
const { broadcastSSE } = require('../services/notificationService');

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

    const fare = calculateDeliveryFare(parseFloat(distanceKm), vehicleType, weatherCondition, currentTime);
    return res.json({ success: true, fare });
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
           is_fare_overridden = ?, override_reason = ?, status = 'assigned', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [riderId, vType, wCondition, fareCalc.rawFinalFare, finalFare, isOverridden, reason, deliveryId]
    );

    // Update rider status to on_delivery
    await db.query(`UPDATE delivery_personnel SET status = 'on_delivery' WHERE id = ?`, [riderId]);

    broadcastSSE('DELIVERY_ASSIGNED', {
      deliveryId,
      orderId: del.order_id,
      riderId,
      finalFare,
      status: 'assigned'
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

module.exports = {
  getDeliveries,
  getRiders,
  computeFare,
  assignRider,
  overrideFare
};
