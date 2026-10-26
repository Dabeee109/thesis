/**
 * Order Management Service (FR3, FR4, FR6, FR7, FR11)
 * Handles customer order placement, order lifecycle states, inventory deductions,
 * delivery creation, and status transitions.
 */

const db = require('../../database/db');
const { calculateDeliveryFare } = require('./fareCalculator');
const { verifyStockAvailability, deductStockForOrder } = require('./inventoryService');
const { processPayment } = require('./paymentService');
const { broadcastSSE, sendNotification } = require('./notificationService');
const { verifyQuote } = require('./geoService');
const { sendFeedbackPrompt, sendTextMessage } = require('./messengerService');
const { getSession, saveSession } = require('./sessionManager');
const feedbackService = require('./feedbackService');

/**
 * Generate unique order number (e.g. DNR-20260901-004)
 */
function generateOrderNumber() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const randomSuffix = Math.floor(100 + Math.random() * 900);
  return `DNR-${year}${month}${day}-${randomSuffix}`;
}

/**
 * Ensure customer exists or update customer record by PSID
 */
async function upsertCustomer({ psid, firstName = '', lastName = '', phone = '', address = '', distanceKm = 1.0 }) {
  const [rows] = await db.query(`SELECT id FROM customers WHERE psid = ?`, [psid]);
  let customerId;

  if (rows.length > 0) {
    customerId = rows[0].id;
    await db.query(
      `UPDATE customers 
       SET first_name = COALESCE(NULLIF(?, ''), first_name),
           last_name = COALESCE(NULLIF(?, ''), last_name),
           phone_number = COALESCE(NULLIF(?, ''), phone_number),
           delivery_address = COALESCE(NULLIF(?, ''), delivery_address),
           distance_km = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [firstName, lastName, phone, address, distanceKm, customerId]
    );
  } else {
    const [result] = await db.query(
      `INSERT INTO customers (psid, first_name, last_name, phone_number, delivery_address, distance_km)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [psid, firstName || 'Messenger', lastName || 'Customer', phone || '', address || '', distanceKm]
    );
    customerId = result.insertId;
  }

  return customerId;
}

/**
 * Create a new customer order
 * 
 * @param {Object} orderData
 * @param {string} orderData.psid - Facebook Messenger PSID
 * @param {string} [orderData.customerName]
 * @param {string} [orderData.customerPhone]
 * @param {string} orderData.orderType - 'delivery' | 'pickup'
 * @param {string} [orderData.deliveryAddress]
 * @param {number} [orderData.distanceKm=1.0]
 * @param {string} [orderData.vehicleType='motorcycle']
 * @param {string} [orderData.weatherCondition='sunny']
 * @param {Array<{menuItemId: number, quantity: number, specialInstructions?: string}>} orderData.items
 * @param {string} orderData.paymentMethod - 'cash' | 'gcash'
 * @param {number} [orderData.amountPaid=0]
 * @param {string} [orderData.referenceNo]
 * @param {string} [orderData.customerNotes]
 */
async function createOrder(orderDataOrPsid, maybeOrderData) {
  let orderData = orderDataOrPsid;
  if (typeof orderDataOrPsid === 'string' && maybeOrderData && typeof maybeOrderData === 'object') {
    orderData = { psid: orderDataOrPsid, ...maybeOrderData };
  } else if (!orderData || typeof orderData !== 'object') {
    orderData = {};
  }

  const {
    psid,
    customerName = '',
    customerPhone = '',
    orderType = 'delivery',
    deliveryAddress = '',
    distanceKm = 1.0,
    vehicleType = 'motorcycle',
    weatherCondition = 'sunny',
    items = [],
    paymentMethod = 'cash',
    amountPaid = 0,
    referenceNo = null,
    customerNotes = '',
    quoteToken = null
  } = orderData;

  if (!items || items.length === 0) {
    throw new Error('Order must contain at least one item.');
  }

  // Delivery orders require a valid delivery quote
  let effectiveDistanceKm = distanceKm;
  let effectiveVehicleType = vehicleType;
  let effectiveWeatherCondition = weatherCondition;
  let effectiveDeliveryAddress = deliveryAddress;
  let deliveryFee = 0.00;
  let fareDetails = null;

  if (orderType === 'delivery') {
    if (!quoteToken) {
      throw new Error('Delivery orders require a valid delivery quote.');
    }
    const claims = verifyQuote(quoteToken);
    effectiveDistanceKm = claims.distanceKm;
    effectiveVehicleType = claims.vehicleType;
    effectiveWeatherCondition = claims.weatherCondition;
    effectiveDeliveryAddress = claims.address || deliveryAddress;
    deliveryFee = claims.deliveryFee;
    fareDetails = {
      rawFinalFare: claims.deliveryFee,
      finalFare: claims.deliveryFee,
      distanceKm: claims.distanceKm,
      vehicleType: claims.vehicleType,
      weatherCondition: claims.weatherCondition
    };
  }

  // 1. Verify stock availability
  const stockCheck = await verifyStockAvailability(items);
  if (!stockCheck.isAvailable) {
    const details = stockCheck.unavailableItems.map(i => `${i.name}: ${i.reason}`).join('; ');
    throw new Error(`Item availability error: ${details}`);
  }

  // 2. Upsert customer
  const nameParts = (customerName || '').trim().split(' ');
  const firstName = nameParts[0] || 'Customer';
  const lastName = nameParts.slice(1).join(' ') || '';
  const effectivePsid = psid || `POS_MANUAL_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  const customerId = await upsertCustomer({
    psid: effectivePsid,
    firstName,
    lastName,
    phone: customerPhone,
    address: effectiveDeliveryAddress,
    distanceKm: effectiveDistanceKm
  });

  // 3. Calculate line items subtotal and enrich with menu details
  let subtotal = 0;
  const enrichedItems = [];

  for (const item of items) {
    const [menuRows] = await db.query(
      `SELECT id, name, price FROM menu_items WHERE id = ?`,
      [item.menuItemId]
    );
    if (menuRows.length === 0) {
      throw new Error(`Menu item #${item.menuItemId} not found.`);
    }
    const menuItem = menuRows[0];
    const unitPrice = parseFloat(menuItem.price);
    const qty = parseInt(item.quantity, 10) || 1;
    const itemSubtotal = unitPrice * qty;
    subtotal += itemSubtotal;

    enrichedItems.push({
      menuItemId: menuItem.id,
      name: menuItem.name,
      unitPrice,
      quantity: qty,
      subtotal: itemSubtotal,
      specialInstructions: item.specialInstructions || ''
    });
  }

  // 4. Delivery fare is set from verified quote for delivery orders (or 0 for pickup)
  const totalAmount = subtotal + deliveryFee;
  const orderNumber = generateOrderNumber();

  // 5. Insert order record
  const [orderResult] = await db.query(
    `INSERT INTO orders 
     (order_number, customer_id, order_type, status, subtotal, delivery_fee, total_amount, delivery_address, distance_km, customer_notes)
     VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
    [orderNumber, customerId, orderType, subtotal, deliveryFee, totalAmount, effectiveDeliveryAddress, effectiveDistanceKm, customerNotes]
  );
  const orderId = orderResult.insertId;

  // 6. Insert line items
  for (const item of enrichedItems) {
    await db.query(
      `INSERT INTO order_items (order_id, menu_item_id, item_name, unit_price, quantity, subtotal, special_instructions)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [orderId, item.menuItemId, item.name, item.unitPrice, item.quantity, item.subtotal, item.specialInstructions]
    );
  }

  // 7. Deduct inventory stock
  await deductStockForOrder(items, orderNumber);

  // 8. Process payment (validate GCash amount or record cash)
  const paymentResult = await processPayment({
    orderId,
    paymentMethod,
    amountPaid: paymentMethod === 'gcash' ? amountPaid : totalAmount,
    referenceNo
  });

  // 9. Create delivery record if order is delivery
  let deliveryId = null;
  if (orderType === 'delivery') {
    const [delResult] = await db.query(
      `INSERT INTO deliveries 
       (order_id, vehicle_type, distance_km, weather_condition, computed_fare, final_fare, status, estimated_time_min)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        orderId,
        effectiveVehicleType,
        effectiveDistanceKm,
        effectiveWeatherCondition,
        fareDetails.rawFinalFare,
        fareDetails.finalFare,
        effectiveVehicleType === 'motorcycle' ? 20 : 30
      ]
    );
    deliveryId = delResult.insertId;
  }

  // 10. Broadcast real-time order event to Admin Dashboard
  broadcastSSE('NEW_ORDER', {
    orderId,
    orderNumber,
    customerName: `${firstName} ${lastName}`.trim(),
    orderType,
    totalAmount,
    status: 'pending',
    paymentMethod,
    isMismatch: paymentResult.isMismatch,
    itemCount: enrichedItems.length
  });

  // 11. Send notification record
  await sendNotification(
    effectivePsid,
    'order_confirmation',
    `Order Confirmed: ${orderNumber}`,
    `Thank you! Your order #${orderNumber} for ₱${totalAmount.toFixed(2)} has been received and is waiting for kitchen preparation.`
  );

  return {
    orderId,
    orderNumber,
    order_number: orderNumber,
    customerId,
    orderType,
    subtotal,
    deliveryFee,
    totalAmount,
    status: 'pending',
    items: enrichedItems,
    payment: paymentResult,
    deliveryId,
    fareDetails
  };
}

/**
 * Update order status (pending -> preparing -> dispatched -> delivered -> cancelled)
 * Automatically triggers notifications, delivery sync, and post-delivery feedback prompt (FR11)
 * 
 * @param {number} orderId 
 * @param {string} newStatus 
 * @param {Object} [extraData] - riderId, cancellationReason, etc.
 */
async function updateOrderStatus(orderId, newStatus, extraData = {}) {
  const [orderRows] = await db.query(
    `SELECT o.*, c.psid, c.first_name, c.last_name, c.phone_number 
     FROM orders o 
     JOIN customers c ON o.customer_id = c.id 
     WHERE o.id = ?`,
    [orderId]
  );

  if (orderRows.length === 0) {
    throw new Error(`Order #${orderId} not found.`);
  }

  const order = orderRows[0];
  const prevStatus = order.status;

  await db.query(
    `UPDATE orders SET status = ?, cancellation_reason = COALESCE(?, cancellation_reason), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [newStatus, extraData.cancellationReason || null, orderId]
  );

  // Handle stock restoration if order is cancelled
  if (newStatus === 'cancelled' && prevStatus !== 'cancelled') {
    const [items] = await db.query(
      `SELECT menu_item_id, quantity FROM order_items WHERE order_id = ?`,
      [orderId]
    );
    for (const it of items) {
      await db.query(
        `UPDATE inventory 
         SET stock_quantity = stock_quantity + ?, updated_at = CURRENT_TIMESTAMP 
         WHERE menu_item_id = ?`,
        [it.quantity, it.menu_item_id]
      );
      const [invRows] = await db.query(`SELECT id FROM inventory WHERE menu_item_id = ?`, [it.menu_item_id]);
      if (invRows.length > 0) {
        await db.query(
          `INSERT INTO inventory_logs (inventory_id, change_amount, reason, reference_id) 
           VALUES (?, ?, ?, ?)`,
          [invRows[0].id, it.quantity, `Stock restored from cancelled order #${order.order_number}`, order.order_number]
        );
      }
    }
    broadcastSSE('INVENTORY_UPDATED', { orderNumber: order.order_number, reason: 'Restored from cancellation' });
  }

  // Sync delivery status if delivery exists
  if (order.order_type === 'delivery') {
    if (newStatus === 'dispatched') {
      await db.query(
        `UPDATE deliveries 
         SET status = 'dispatched', rider_id = COALESCE(?, rider_id), dispatched_at = CURRENT_TIMESTAMP 
         WHERE order_id = ?`,
        [extraData.riderId || null, orderId]
      );
    } else if (newStatus === 'delivered') {
      await db.query(
        `UPDATE deliveries 
         SET status = 'delivered', delivered_at = CURRENT_TIMESTAMP 
         WHERE order_id = ?`,
        [orderId]
      );
    } else if (newStatus === 'cancelled') {
      await db.query(
        `UPDATE deliveries 
         SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP 
         WHERE order_id = ?`,
        [orderId]
      );
    }
  }

  // Broadcast status change to real-time dashboard and rider views
  broadcastSSE('ORDER_STATUS_CHANGED', {
    orderId,
    orderNumber: order.order_number,
    prevStatus,
    newStatus,
    customerName: `${order.first_name || ''} ${order.last_name || ''}`.trim()
  });

  // Automated customer notifications based on status
  let notifMessage = '';
  if (newStatus === 'preparing') {
    notifMessage = `🍳 Our kitchen has started preparing your order #${order.order_number}! We'll notify you once it's on the way.`;
    await sendNotification(order.psid, 'preparing', `Order #${order.order_number} is Preparing`, notifMessage);
  } else if (newStatus === 'dispatched') {
    notifMessage = `🛵 Great news! Your order #${order.order_number} has been dispatched and is currently on its way to ${order.delivery_address}.`;
    await sendNotification(order.psid, 'dispatched', `Order #${order.order_number} Dispatched`, notifMessage);
  } else if (newStatus === 'delivered') {
    notifMessage = `Order #${order.order_number} delivered.`;
    await sendNotification(order.psid, 'delivered', `Order #${order.order_number} Delivered`, notifMessage);

    // Asynchronously request feedback via feedbackService (without blocking status change)
    feedbackService.requestFeedback(orderId).catch(err => {
      console.warn('[orderService] feedback request failed:', err.message);
    });

    // Keep existing FEEDBACK_PROMPT_TRIGGERED SSE event for dashboard
    broadcastSSE('FEEDBACK_PROMPT_TRIGGERED', {
      orderId,
      orderNumber: order.order_number,
      psid: order.psid
    });
  } else if (newStatus === 'cancelled') {
    const reasonText = extraData.cancellationReason ? `Reason: ${extraData.cancellationReason}` : 'Cancelled by cafe staff.';
    notifMessage = `⚠️ Your order #${order.order_number} has been cancelled/voided. ${reasonText} If you paid via GCash or have questions, our team will assist you shortly.`;
    await sendNotification(order.psid, 'cancelled', `Order #${order.order_number} Cancelled`, notifMessage);
  }

  return {
    orderId,
    orderNumber: order.order_number,
    prevStatus,
    newStatus,
    psid: order.psid
  };
}

/**
 * Dispatch delivery feedback prompt push notification to customer via Messenger Send API (Deliverable 4)
 * Transitions customer conversation session state from 'order_placed' to 'awaiting_feedback'.
 * @param {string} psid - Customer Facebook PSID
 * @param {string} orderNumber - Order reference number
 * @param {number|string} orderId - Database order ID
 */
async function dispatchDeliveryFeedbackNotification(psid, orderNumber, orderId) {
  if (!psid) return;

  // 1. Transition customer conversation state to 'awaiting_feedback'
  try {
    const session = await getSession(psid);
    session.state = 'awaiting_feedback';
    session.pendingFeedbackOrderId = orderId;
    session.pendingFeedbackOrderNumber = orderNumber;
    await saveSession(session);
  } catch (sessErr) {
    console.error('[Delivery Push Notification Session Error]', sessErr.message);
  }

  // 2. Explicitly call Messenger Send API with rating buttons (⭐ to ⭐⭐⭐⭐⭐ / 1 to 5)
  try {
    await sendFeedbackPrompt(psid, orderNumber);
  } catch (sendErr) {
    console.error('[Delivery Push Notification Send API Error]', sendErr.message);
  }
}

/**
 * Get comprehensive list of orders with joins for admin dashboard
 */
async function getOrdersList(filters = {}) {
  let sql = `
    SELECT 
      o.id,
      o.order_number,
      o.customer_id,
      c.psid,
      CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, '')) AS customer_name,
      c.phone_number AS customer_phone,
      o.order_type,
      o.status,
      o.subtotal,
      o.delivery_fee,
      o.total_amount,
      o.delivery_address,
      o.distance_km,
      o.customer_notes,
      o.cancellation_reason,
      o.void_status,
      o.void_requested_by,
      o.void_reason,
      o.void_requested_at,
      o.created_at,
      p.payment_method,
      p.status AS payment_status,
      p.is_mismatch AS payment_mismatch,
      p.amount_paid AS payment_amount_paid,
      p.reference_no AS payment_reference_no,
      p.mismatch_notes,
      d.id AS delivery_id,
      d.rider_id,
      dp.full_name AS rider_name,
      d.vehicle_type AS delivery_vehicle,
      d.weather_condition,
      d.final_fare AS delivery_final_fare,
      d.status AS delivery_status,
      f.rating AS customer_rating,
      f.comments AS customer_feedback
    FROM orders o
    JOIN customers c ON o.customer_id = c.id
    LEFT JOIN payments p ON o.id = p.order_id
    LEFT JOIN deliveries d ON o.id = d.order_id
    LEFT JOIN delivery_personnel dp ON d.rider_id = dp.id
    LEFT JOIN feedback f ON o.id = f.order_id
    WHERE 1=1
  `;
  const params = [];

  if (filters.status) {
    sql += ` AND o.status = ?`;
    params.push(filters.status);
  }
  if (filters.orderType) {
    sql += ` AND o.order_type = ?`;
    params.push(filters.orderType);
  }
  if (filters.paymentMismatch === true || filters.paymentMismatch === '1') {
    sql += ` AND p.is_mismatch = 1`;
  }

  sql += ` ORDER BY o.created_at DESC LIMIT 100`;

  const [orders] = await db.query(sql, params);

  // Fetch line items for each order
  for (const order of orders) {
    const [items] = await db.query(
      `SELECT id, menu_item_id, item_name, unit_price, quantity, subtotal, special_instructions 
       FROM order_items WHERE order_id = ?`,
      [order.id]
    );
    order.items = items;
  }

  return orders;
}

/**
 * Get detailed order by ID or order number
 */
async function getOrderDetails(orderIdentifier) {
  const isNumeric = /^\d+$/.test(orderIdentifier);
  const sql = `
    SELECT 
      o.*,
      c.psid,
      c.first_name,
      c.last_name,
      c.phone_number AS customer_phone,
      p.payment_method,
      p.status AS payment_status,
      p.is_mismatch AS payment_mismatch,
      p.amount_paid,
      p.reference_no,
      p.mismatch_notes,
      d.rider_id,
      dp.full_name AS rider_name,
      dp.phone_number AS rider_phone,
      d.vehicle_type AS delivery_vehicle,
      d.weather_condition,
      d.final_fare,
      d.status AS delivery_status,
      f.rating,
      f.comments AS feedback_comments
    FROM orders o
    JOIN customers c ON o.customer_id = c.id
    LEFT JOIN payments p ON o.id = p.order_id
    LEFT JOIN deliveries d ON o.id = d.order_id
    LEFT JOIN delivery_personnel dp ON d.rider_id = dp.id
    LEFT JOIN feedback f ON o.id = f.order_id
    WHERE ${isNumeric ? 'o.id = ?' : 'o.order_number = ?'}
  `;
  const [rows] = await db.query(sql, [orderIdentifier]);
  if (rows.length === 0) return null;

  const order = rows[0];
  const [items] = await db.query(
    `SELECT * FROM order_items WHERE order_id = ?`,
    [order.id]
  );
  order.items = items;
  return order;
}

/**
 * Barista submits a void request for Owner approval
 */
async function requestVoidOrder(orderId, staffUser, reason) {
  const [rows] = await db.query(`SELECT id, order_number, status FROM orders WHERE id = ?`, [orderId]);
  if (rows.length === 0) throw new Error(`Order #${orderId} not found.`);
  const order = rows[0];

  if (order.status === 'cancelled') {
    throw new Error('Order is already cancelled.');
  }

  await db.query(
    `UPDATE orders 
     SET void_status = 'pending_approval', 
         void_requested_by = ?, 
         void_reason = ?, 
         void_requested_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP 
     WHERE id = ?`,
    [staffUser.name || 'Barista', reason, orderId]
  );

  broadcastSSE('VOID_REQUEST_CREATED', {
    orderId,
    orderNumber: order.order_number,
    requestedBy: staffUser.name || 'Barista',
    reason,
    timestamp: new Date().toISOString()
  });

  return { orderId, orderNumber: order.order_number, void_status: 'pending_approval' };
}

/**
 * Owner approves void or directly voids an order
 */
async function authorizeVoidOrder(orderId, adminUser, reason) {
  const [rows] = await db.query(`SELECT id, order_number FROM orders WHERE id = ?`, [orderId]);
  if (rows.length === 0) throw new Error(`Order #${orderId} not found.`);
  const order = rows[0];

  await db.query(
    `UPDATE orders 
     SET void_status = 'approved', updated_at = CURRENT_TIMESTAMP 
     WHERE id = ?`,
    [orderId]
  );

  const updated = await updateOrderStatus(orderId, 'cancelled', {
    cancellationReason: reason || `Void authorized by Owner (${adminUser.name || 'Owner'})`
  });

  broadcastSSE('VOID_REQUEST_RESOLVED', {
    orderId,
    orderNumber: order.order_number,
    status: 'approved',
    resolvedBy: adminUser.name || 'Owner'
  });

  return updated;
}

/**
 * Owner rejects void request
 */
async function rejectVoidOrder(orderId, adminUser, rejectionNote) {
  const [rows] = await db.query(`SELECT id, order_number FROM orders WHERE id = ?`, [orderId]);
  if (rows.length === 0) throw new Error(`Order #${orderId} not found.`);
  const order = rows[0];

  await db.query(
    `UPDATE orders 
     SET void_status = 'rejected', updated_at = CURRENT_TIMESTAMP 
     WHERE id = ?`,
    [orderId]
  );

  broadcastSSE('VOID_REQUEST_RESOLVED', {
    orderId,
    orderNumber: order.order_number,
    status: 'rejected',
    rejectionNote: rejectionNote || 'Void request denied by Owner',
    resolvedBy: adminUser.name || 'Owner'
  });

  return { orderId, orderNumber: order.order_number, void_status: 'rejected' };
}

module.exports = {
  createOrder,
  updateOrderStatus,
  dispatchDeliveryFeedbackNotification,
  getOrdersList,
  getOrderDetails,
  generateOrderNumber,
  upsertCustomer,
  requestVoidOrder,
  authorizeVoidOrder,
  rejectVoidOrder
};
