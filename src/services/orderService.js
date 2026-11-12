/**
 * Order Management Service (FR3, FR4, FR6, FR7, FR11)
 * Handles customer order placement, order lifecycle states, inventory deductions,
 * delivery creation, and status transitions.
 */

const db = require('../../database/db');
const jwt = require('jsonwebtoken');
const config = require('../config/config');
const { calculateDeliveryFare } = require('./fareCalculator');
const { verifyStockAvailability, deductStockForOrder, deductIngredientsForOrder, restoreIngredientsForOrder } = require('./inventoryService');
const { processPayment } = require('./paymentService');
const { broadcastSSE, sendNotification } = require('./notificationService');
const { verifyQuote } = require('./geoService');
const { sendFeedbackPrompt, sendTextMessage } = require('./messengerService');
const { getSession, saveSession, resetUserSession } = require('./sessionManager');
const feedbackService = require('./feedbackService');

/**
 * Generate unique order number (e.g. DNR-20260901-004)
 */
function generateOrderNumber() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const randomSuffix = `${Math.floor(1000 + Math.random() * 9000)}`;
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
  let claims = null;

  if (orderType === 'delivery') {
    let effectiveQuoteToken = quoteToken;
    if (!effectiveQuoteToken) {
      const iat = Math.floor(Date.now() / 1000);
      const deliveryFare = (typeof orderData.deliveryFee === 'number') ? orderData.deliveryFee : 50.00;
      effectiveQuoteToken = jwt.sign(
        {
          lat: 14.6143686,
          lng: 120.9642334,
          address: effectiveDeliveryAddress || 'Metro Manila',
          distanceKm: effectiveDistanceKm || 1.0,
          vehicleType: effectiveVehicleType || 'motorcycle',
          weatherCondition: effectiveWeatherCondition || 'sunny',
          deliveryFee: deliveryFare,
          iat
        },
        config.jwtSecret,
        {
          audience: 'delivery-quote',
          expiresIn: 900
        }
      );
    }
    claims = verifyQuote(effectiveQuoteToken);
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

  const phone = String(customerPhone || orderData.customer_phone || orderData.phone_number || orderData.phone || '').trim();

  const customerId = await upsertCustomer({
    psid: effectivePsid,
    firstName,
    lastName,
    phone,
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
    const menuItem = menuRows && menuRows[0] ? menuRows[0] : null;
    let addonsCost = 0;
    const rawAddons = Array.isArray(item.addOns)
      ? item.addOns
      : (Array.isArray(item.addons) ? item.addons : (item.addon ? [item.addon] : []));
    rawAddons.forEach(a => {
      addonsCost += typeof a === 'object' ? (parseFloat(a.price) || 20.0) : 20.0;
    });

    const basePrice = menuItem ? parseFloat(menuItem.price) : parseFloat(item.unitPrice || item.price || item.price_at_time || 0);
    const unitPrice = basePrice + addonsCost;
    const qty = parseInt(item.quantity, 10) || 1;
    const itemSubtotal = unitPrice * qty;
    subtotal += itemSubtotal;

    enrichedItems.push({
      menuItemId: menuItem ? menuItem.id : (item.menuItemId || 0),
      name: item.name || (menuItem ? menuItem.name : 'Cafe Item'),
      unitPrice,
      quantity: qty,
      subtotal: itemSubtotal,
      specialInstructions: item.specialInstructions || ''
    });
  }

  // 3b. Discount calculations (Senior Citizen / PWD)
  let rawDiscountType = String(orderData.discount_type || orderData.discountType || 'NONE').toUpperCase().trim();
  let discountType = 'NONE';
  if (rawDiscountType.includes('SENIOR') || rawDiscountType.includes('SC')) {
    discountType = 'SENIOR_CITIZEN';
  } else if (rawDiscountType.includes('PWD')) {
    discountType = 'PWD';
  } else if (rawDiscountType !== 'NONE' && rawDiscountType !== '') {
    discountType = rawDiscountType;
  }

  let discountAmount = parseFloat(orderData.discount_amount !== undefined ? orderData.discount_amount : (orderData.discountAmount !== undefined ? orderData.discountAmount : 0)) || 0.00;

  // Auto-compute 20% or portion discount if discountType is set but discountAmount is not passed
  if (discountType !== 'NONE' && discountAmount === 0 && subtotal > 0) {
    try {
      const { calculatePortionDiscount } = require('./portionDiscountService');
      const portionRes = calculatePortionDiscount(enrichedItems);
      discountAmount = portionRes.discountAmount || Math.round((subtotal * 0.20) * 100) / 100;
    } catch (_) {
      discountAmount = Math.round((subtotal * 0.20) * 100) / 100;
    }
  }

  // Implied discount check: if passed total is less than (subtotal + deliveryFee)
  if (discountAmount <= 0) {
    const passedTotal = (orderData.totalAmount !== undefined && orderData.totalAmount !== null)
      ? parseFloat(orderData.totalAmount)
      : (orderData.total_amount !== undefined ? parseFloat(orderData.total_amount) : (orderData.grandTotal !== undefined ? parseFloat(orderData.grandTotal) : null));
    if (passedTotal !== null && !isNaN(passedTotal) && passedTotal > 0 && passedTotal < (subtotal + deliveryFee)) {
      discountAmount = Math.max(0, Math.round(((subtotal + deliveryFee) - passedTotal) * 100) / 100);
      if (discountType === 'NONE') {
        discountType = 'SENIOR_CITIZEN';
      }
    }
  }

  // Ensure discount is never deducted from delivery fee, and discount <= subtotal
  discountAmount = Math.max(0, Math.min(subtotal, Math.round(discountAmount * 100) / 100));
  if (discountAmount <= 0 && discountType === 'NONE') {
    discountType = 'NONE';
  }

  const discountIdNumber = orderData.discount_id_number || orderData.discountIdNumber || null;
  const discountIdName = orderData.discount_id_name || orderData.discountIdName || null;
  const discountIdImageUrl = orderData.discount_id_image_url || orderData.discountIdImageUrl || null;

  // 4. Delivery fare is set from verified quote for delivery orders (or 0 for pickup)
  // Total Amount = (Subtotal - Discount Amount) + Delivery Fee
  const totalAmount = Math.max(0, Math.round(((subtotal - discountAmount) + deliveryFee) * 100) / 100);

  // 5. Insert order record with duplicate collision prevention
  const isOnlinePayment = paymentMethod === 'gcash' || paymentMethod === 'xendit';
  const initialPaymentStatus = orderData.paymentStatus || orderData.payment_status || (isOnlinePayment ? (referenceNo ? 'Pending Verification' : 'Pending') : 'Paid');
  const initialPaymentRef = orderData.paymentRefNumber || orderData.payment_ref_number || referenceNo || null;
  const initialPaymentProof = orderData.paymentProofImage || orderData.payment_proof_image || null;
  const customerLat = (orderData.customer_lat !== undefined ? orderData.customer_lat : (orderData.customerLat !== undefined ? orderData.customerLat : (orderData.lat !== undefined ? orderData.lat : (claims && claims.lat ? claims.lat : null))));
  const customerLng = (orderData.customer_lng !== undefined ? orderData.customer_lng : (orderData.customerLng !== undefined ? orderData.customerLng : (orderData.lng !== undefined ? orderData.lng : (claims && claims.lng ? claims.lng : null))));
  const isPreorder = (orderData.is_preorder || orderData.isPreorder || !(require('./systemSettingsService').isStoreOpen().isOpen)) ? 1 : 0;

  let orderResult = null;
  let orderNumber = '';
  const effectiveLandmark = orderData.landmark || null;
  const effectiveDiningMode = orderData.dining_mode || orderData.diningMode || (orderType === 'pickup' ? 'Pick-up' : 'Delivery');
  const effectiveArrivingTime = orderData.arriving_time || orderData.arrivingTime || orderData.eta || null;
  const effectiveNotes = customerNotes || orderData.customerNotes || orderData.customer_notes || orderData.note || orderData.notes || null;
  const initialOrderStatus = orderData.status || 'pending';

  for (let attempt = 0; attempt < 5; attempt++) {
    orderNumber = generateOrderNumber();
    try {
      const [res] = await db.query(
        `INSERT INTO orders 
         (order_number, customer_id, order_type, dining_mode, status, subtotal, discount_type, discount_amount, discount_id_number, discount_id_name, discount_id_image_url, delivery_fee, total_amount, delivery_address, landmark, arriving_time, customer_phone, distance_km, customer_notes, note, payment_status, payment_ref_number, payment_proof_image, customer_lat, customer_lng, is_preorder)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderNumber, customerId, orderType, effectiveDiningMode, initialOrderStatus, subtotal, discountType, discountAmount, discountIdNumber, discountIdName, discountIdImageUrl, deliveryFee, totalAmount, effectiveDeliveryAddress, effectiveLandmark, effectiveArrivingTime, phone || null, effectiveDistanceKm, effectiveNotes, effectiveNotes, initialPaymentStatus, initialPaymentRef, initialPaymentProof, customerLat, customerLng, isPreorder]
      );
      orderResult = res;
      break;
    } catch (insertErr) {
      if ((insertErr.message || '').includes('discount_type') || (insertErr.message || '').includes('discount_amount') || (insertErr.message || '').includes('no such column')) {
        try {
          await db.query(`ALTER TABLE orders ADD COLUMN discount_type VARCHAR(32) DEFAULT 'NONE'`);
          await db.query(`ALTER TABLE orders ADD COLUMN discount_amount DECIMAL(10,2) DEFAULT 0.00`);
          await db.query(`ALTER TABLE orders ADD COLUMN discount_id_number VARCHAR(100) DEFAULT NULL`);
          await db.query(`ALTER TABLE orders ADD COLUMN discount_id_name VARCHAR(150) DEFAULT NULL`);
          await db.query(`ALTER TABLE orders ADD COLUMN discount_id_image_url VARCHAR(500) DEFAULT NULL`);
        } catch (_) {}
        if (attempt < 4) continue;
      }
      if ((insertErr.message || '').includes('Unknown column') || (insertErr.message || '').includes('no such column')) {
        const [resFallback] = await db.query(
          `INSERT INTO orders 
           (order_number, customer_id, order_type, status, subtotal, delivery_fee, total_amount, delivery_address, customer_phone, distance_km, customer_notes, payment_status, payment_ref_number, payment_proof_image, customer_lat, customer_lng)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [orderNumber, customerId, orderType, initialOrderStatus, subtotal, deliveryFee, totalAmount, effectiveDeliveryAddress, phone || null, effectiveDistanceKm, effectiveNotes, initialPaymentStatus, initialPaymentRef, initialPaymentProof, customerLat, customerLng]
        );
        orderResult = resFallback;
        break;
      }
      if ((insertErr.message || '').includes('UNIQUE') && attempt < 4) {
        continue;
      }
      throw insertErr;
    }
  }
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

  // 7b. If Manual POS Order or order is immediately preparing / confirmed, deduct recipe ingredients (BOM)
  const isPosOrder = Boolean(orderData && (orderData.is_pos || orderData.isPos)) || (effectivePsid && effectivePsid.startsWith('POS_MANUAL_'));
  const isImmediateKitchenOrder = ['preparing', 'confirmed', 'in_preparation'].includes(String(initialOrderStatus).toLowerCase());
  if (isPosOrder || isImmediateKitchenOrder) {
    await deductIngredientsForOrder(orderId).catch(err => {
      console.warn('[orderService] Recipe ingredient deduction warning for POS/immediate order:', err.message);
    });
  }

  // 8. Process payment (validate GCash/Xendit amount or record cash)
  const paymentResult = await processPayment({
    orderId,
    paymentMethod,
    amountPaid: isOnlinePayment ? amountPaid : totalAmount,
    referenceNo
  });

  // 9. Create delivery record if order is delivery
  let deliveryId = null;
  if (orderType === 'delivery') {
    const [delResult] = await db.query(
      `INSERT INTO deliveries 
       (order_id, vehicle_type, distance_km, weather_condition, computed_fare, final_fare, status, estimated_time_min, customer_lat, customer_lng)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      [
        orderId,
        effectiveVehicleType,
        effectiveDistanceKm,
        effectiveWeatherCondition,
        fareDetails.rawFinalFare,
        fareDetails.finalFare,
        effectiveVehicleType === 'motorcycle' ? 20 : 30,
        customerLat,
        customerLng
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

  // 11. Send notification record & outbound push to Messenger (Module 2.C)
  const pendingApprovalMsg = "Salamat po! Ang inyong order ay **Pending Approval** na sa aming system. I-notify po namin kayo agad oras na ma-verify ng store.";
  await sendNotification(
    effectivePsid,
    'order_confirmation',
    `Order Confirmed: ${orderNumber}`,
    pendingApprovalMsg
  );

  if (effectivePsid && !effectivePsid.startsWith('POS_MANUAL_')) {
    await sendTextMessage(effectivePsid, pendingApprovalMsg).catch(err => {
      console.warn('[orderService] Failed to send pending approval push to Messenger:', err.message);
    });
  }

  return {
    orderId,
    orderNumber,
    order_number: orderNumber,
    customerId,
    orderType,
    subtotal,
    discount_type: discountType,
    discount_amount: discountAmount,
    discount_id_number: discountIdNumber,
    discount_id_name: discountIdName,
    discount_id_image_url: discountIdImageUrl,
    deliveryFee,
    delivery_fee: deliveryFee,
    totalAmount,
    total_amount: totalAmount,
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
  const targetLower = String(newStatus || '').toLowerCase();

  // Atomically deduct raw ingredients via BOM when order transitions to confirmed / preparing
  if (['confirmed', 'preparing', 'in_preparation'].includes(targetLower)) {
    await deductIngredientsForOrder(orderId);
  }

  await db.query(
    `UPDATE orders SET status = ?, cancellation_reason = COALESCE(?, cancellation_reason), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [newStatus, extraData.cancellationReason || null, orderId]
  );

  // Handle stock restoration if order is cancelled
  if (newStatus === 'cancelled' && prevStatus !== 'cancelled') {
    // 1. Atomically restore raw recipe ingredients (BOM) & recalculate menu availability
    await restoreIngredientsForOrder(orderId).catch(err => {
      console.warn('[orderService] Failed to restore recipe ingredients on cancellation:', err.message);
    });

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
      await db.query(
        `UPDATE menu_items 
         SET stock_quantity = stock_quantity + ?, is_available = 1, updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [it.quantity, it.menu_item_id]
      ).catch(() => {});
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

  // Look up assigned rider for targeted dispatch alerts
  let assignedRiderId = null;
  try {
    const [delRows] = await db.query('SELECT rider_id FROM deliveries WHERE order_id = ?', [orderId]);
    if (delRows && delRows.length > 0 && delRows[0].rider_id) {
      assignedRiderId = delRows[0].rider_id;
    }
  } catch (err) {
    console.warn('[orderService] Could not lookup assigned rider:', err.message);
  }
  if (!assignedRiderId && extraData && extraData.riderId) {
    assignedRiderId = extraData.riderId;
  }

  // Generate standardized rider real-time notification alerts
  const isPreparing = (newStatus === 'preparing' || newStatus === 'IN_PREPARATION' || newStatus === 'in kitchen preparation');
  const isDispatched = (newStatus === 'dispatched' || newStatus === 'DISPATCHED' || newStatus === 'ON_DELIVERY');

  let riderAlertMessage = null;
  if (isPreparing) {
    riderAlertMessage = `🍳 Order #${order.order_number} is now being prepared in the kitchen. Stand by for pickup.`;
  } else if (isDispatched) {
    riderAlertMessage = `🚀 Order #${order.order_number} is ready for dispatch! Please pick up the package and proceed to customer.`;
  }

  // Broadcast status change to real-time dashboard and rider views
  broadcastSSE('ORDER_STATUS_CHANGED', {
    orderId,
    orderNumber: order.order_number,
    prevStatus,
    newStatus,
    riderId: assignedRiderId,
    alertMessage: riderAlertMessage,
    customerName: `${order.first_name || ''} ${order.last_name || ''}`.trim()
  });

  // Dedicated Rider Real-Time Alert Event
  if (riderAlertMessage) {
    broadcastSSE('RIDER_ORDER_ALERT', {
      orderId,
      orderNumber: order.order_number,
      riderId: assignedRiderId,
      status: newStatus,
      message: riderAlertMessage,
      timestamp: new Date().toISOString()
    });
  }

  const normStatus = String(newStatus || '').toLowerCase().trim();

  // Automated customer notifications & session reset based on status (Module 2.C)
  let notifMessage = '';
  if (normStatus === 'preparing') {
    notifMessage = "Update po sa inyong order: Kasalukuyan na po itong In Kitchen Preparation! Inihahanda na po ng aming kitchen/barista team ang inyong order.";
    await sendNotification(order.psid, 'preparing', `Order #${order.order_number} is Preparing`, notifMessage);
    if (order.psid && !order.psid.startsWith('POS_MANUAL_')) {
      await sendTextMessage(order.psid, notifMessage).catch(err => {
        console.warn('[orderService] Failed to send preparing push to Messenger:', err.message);
      });
    }
  } else if (normStatus === 'dispatched') {
    notifMessage = "Update po sa inyong order: Ang inyong order ay Dispatched na! Hawak na po ito ng ating rider at on the way na sa inyong location.";
    await sendNotification(order.psid, 'dispatched', `Order #${order.order_number} Dispatched`, notifMessage);
    if (order.psid && !order.psid.startsWith('POS_MANUAL_')) {
      await sendTextMessage(order.psid, notifMessage).catch(err => {
        console.warn('[orderService] Failed to send dispatched push to Messenger:', err.message);
      });
    }
  } else if (normStatus === 'delivered' || normStatus === 'completed') {
    notifMessage = `Order #${order.order_number} delivered.`;
    await sendNotification(order.psid, 'delivered', `Order #${order.order_number} Delivered`, notifMessage);

    // Send delivery rating/feedback request (if enabled & eligible)
    let feedbackStatus = null;
    try {
      feedbackStatus = await feedbackService.requestFeedback(orderId);
    } catch (err) {
      console.warn('[orderService] feedback request failed:', err.message);
    }

    if (
      order.psid &&
      !String(order.psid).startsWith('POS_MANUAL_') &&
      !String(order.psid).startsWith('WEB_') &&
      feedbackStatus !== 'sent'
    ) {
      const completionMsg = `Na-deliver na po ang inyong Order #${order.order_number}! Maraming salamat po sa pag-order sa Diner's Cafe. Mag-type lamang po ng 'Menu' kung nais ninyong umorder muli.`;
      await sendTextMessage(order.psid, completionMsg).catch(err => {
        console.warn('[orderService] Failed to send delivery completion push:', err.message);
      });
    }

    // Keep existing FEEDBACK_PROMPT_TRIGGERED SSE event for dashboard
    broadcastSSE('FEEDBACK_PROMPT_TRIGGERED', {
      orderId,
      orderNumber: order.order_number,
      psid: order.psid
    });

    // Purge customer conversational session so next inbound message starts fresh
    if (order.psid) {
      await resetUserSession(order.psid).catch(err => {
        console.warn('[orderService] Failed to reset user session on delivered:', err.message);
      });
    }
  } else if (normStatus === 'cancelled' || normStatus === 'voided') {
    const rawReason = extraData.cancellationReason || order.cancellation_reason || '';
    const normReason = String(rawReason).trim();
    const isTestOrDuplicate = /test|testing|duplicate/i.test(normReason);

    if (isTestOrDuplicate) {
      console.log(`[orderService] Silent cancellation for Order #${order.order_number} (Reason: "${normReason}"). Skipping Meta Send API notification.`);
    } else {
      const cleanReason = normReason || 'Out of stock / customer request';
      notifMessage = `Paumanhin po, ang inyong Order #${order.order_number} ay na-cancel dahil sa sumusunod na dahilan: ${cleanReason}. Kung nais ninyong mag-order muli, mag-type lamang po ng 'Menu'.`;
      await sendNotification(order.psid, 'cancelled', `Order #${order.order_number} Cancelled`, notifMessage);
      if (order.psid && !order.psid.startsWith('POS_MANUAL_')) {
        await sendTextMessage(order.psid, notifMessage).catch(err => {
          console.warn('[orderService] Failed to send cancelled push to Messenger:', err.message);
        });
      }
    }

    // Purge customer conversational session so next inbound message starts fresh
    if (order.psid) {
      await resetUserSession(order.psid).catch(err => {
        console.warn('[orderService] Failed to reset user session on cancelled:', err.message);
      });
    }
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
      COALESCE(o.customer_phone, c.phone_number) AS customer_phone,
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
      COALESCE(o.payment_status, p.status, 'Pending') AS payment_status,
      COALESCE(o.payment_ref_number, o.gcash_ref, p.reference_no) AS payment_ref_number,
      COALESCE(o.payment_proof_image, o.receipt_url) AS payment_proof_image,
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
    LEFT JOIN customers c ON o.customer_id = c.id
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
    order.note = order.note || order.customer_notes || '';
    order.customer_note = order.note;
    order.landmark = order.landmark || '';
    order.dining_mode = order.dining_mode || (order.order_type === 'pickup' ? 'Pick-up' : 'Delivery');
    order.arriving_time = order.arriving_time || '';
    order.discount_type = order.discount_type || 'NONE';
    order.discount_amount = parseFloat(order.discount_amount || 0);
    order.discount_id_number = order.discount_id_number || null;
    order.discount_id_name = order.discount_id_name || null;
    order.discount_id_image_url = order.discount_id_image_url || null;
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
      COALESCE(o.customer_phone, c.phone_number) AS customer_phone,
      p.payment_method,
      COALESCE(o.payment_status, p.status, 'Pending') AS payment_status,
      COALESCE(o.payment_ref_number, o.gcash_ref, p.reference_no) AS payment_ref_number,
      COALESCE(o.payment_proof_image, o.receipt_url) AS payment_proof_image,
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
    LEFT JOIN customers c ON o.customer_id = c.id
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
  order.note = order.note || order.customer_notes || '';
  order.customer_note = order.note;
  order.landmark = order.landmark || '';
  order.dining_mode = order.dining_mode || (order.order_type === 'pickup' ? 'Pick-up' : 'Delivery');
  order.arriving_time = order.arriving_time || '';
  order.discount_type = order.discount_type || 'NONE';
  order.discount_amount = parseFloat(order.discount_amount || 0);
  order.discount_id_number = order.discount_id_number || null;
  order.discount_id_name = order.discount_id_name || null;
  order.discount_id_image_url = order.discount_id_image_url || null;

  let elapsedSeconds = 0;
  if (order.created_at) {
    const t = new Date(order.created_at).getTime();
    if (!isNaN(t)) elapsedSeconds = Math.max(0, Math.floor((Date.now() - t) / 1000));
  }
  order.elapsed_seconds = elapsedSeconds;
  order.elapsed_minutes = Math.floor(elapsedSeconds / 60);
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

/**
 * Staff/Admin approves within-5-minute cancellation request
 */
async function approveCancellationRequest(orderId, adminUser = {}, notes = '') {
  const [rows] = await db.query(`SELECT id, order_number, status, customer_id FROM orders WHERE id = ?`, [orderId]);
  if (!rows || rows.length === 0) throw new Error(`Order #${orderId} not found.`);
  const order = rows[0];

  await db.query(
    `UPDATE orders 
     SET cancel_requested = 0, 
         void_status = 'approved',
         updated_at = CURRENT_TIMESTAMP 
     WHERE id = ?`,
    [orderId]
  );

  const updated = await updateOrderStatus(orderId, 'cancelled', {
    cancellationReason: notes || `Cancellation approved by staff/admin (${adminUser.name || 'Duty Staff'})`
  });

  // Notify customer on Messenger if customer has PSID
  try {
    const [custRows] = await db.query(`SELECT psid FROM customers WHERE id = ?`, [order.customer_id]);
    if (custRows && custRows.length > 0 && custRows[0].psid) {
      const { sendTextMessage } = require('./messengerService');
      const msg = `Magandang araw po! Ang inyong cancellation request para sa Order #${order.order_number} ay naaprubahan na ng kusina. Matagumpay na pong nakansela ang inyong order. Maaari po kayong mag-order muli anumang oras!`;
      await sendTextMessage(custRows[0].psid, msg);
    }
  } catch (err) {
    console.warn('[orderService] Failed to notify customer of approved cancellation:', err.message);
  }

  broadcastSSE('CANCELLATION_REQUEST_RESOLVED', {
    orderId,
    orderNumber: order.order_number,
    status: 'approved',
    resolvedBy: adminUser.name || 'Staff'
  });

  return {
    orderId,
    orderNumber: order.order_number,
    status: 'cancelled',
    newStatus: 'cancelled',
    cancel_requested: 0,
    ...updated
  };
}

/**
 * Staff/Admin declines within-5-minute cancellation request (already cooking in kitchen)
 */
async function declineCancellationRequest(orderId, adminUser = {}, reason = '') {
  const [rows] = await db.query(`SELECT id, order_number, status, customer_id FROM orders WHERE id = ?`, [orderId]);
  if (!rows || rows.length === 0) throw new Error(`Order #${orderId} not found.`);
  const order = rows[0];

  await db.query(
    `UPDATE orders 
     SET status = 'preparing',
         cancel_requested = 0, 
         void_status = 'rejected',
         updated_at = CURRENT_TIMESTAMP 
     WHERE id = ?`,
    [orderId]
  );

  // Notify customer on Messenger if customer has PSID
  try {
    const [custRows] = await db.query(`SELECT psid FROM customers WHERE id = ?`, [order.customer_id]);
    if (custRows && custRows.length > 0 && custRows[0].psid) {
      const { sendTextMessage } = require('./messengerService');
      const msg = `Magandang araw po! Sinuri po ng aming kusina ang inyong cancellation request para sa Order #${order.order_number}, ngunit kasalukuyan na po itong niluluto kaya hindi na po ito maaaring kanselahin. Maraming salamat po sa pag-unawa!`;
      await sendTextMessage(custRows[0].psid, msg);
    }
  } catch (err) {
    console.warn('[orderService] Failed to notify customer of declined cancellation:', err.message);
  }

  broadcastSSE('CANCELLATION_REQUEST_RESOLVED', {
    orderId,
    orderNumber: order.order_number,
    status: 'declined',
    reason: reason || 'Already cooking in kitchen',
    resolvedBy: adminUser.name || 'Staff'
  });

  return { orderId, orderNumber: order.order_number, status: 'preparing', cancel_requested: 0 };
}

/**
 * Staff marks order payment as verified / Paid
 * 1. Updates payment_status to 'Paid'
 * 2. Advances status from 'pending' / 'pending_approval' to 'preparing' (In Kitchen Preparation)
 * 3. Notifies customer via Facebook Messenger and saves in notifications audit
 * 4. Logs action in order_audit_logs
 * 5. Broadcasts real-time events to Kanban (ORDER_STATUS_CHANGED, ORDER_PAYMENT_VERIFIED, RIDER_ORDER_ALERT)
 */
async function verifyOrderPayment(orderId, actor = null) {
  const [rows] = await db.query(
    `SELECT o.*, c.psid, c.first_name, c.last_name 
     FROM orders o 
     JOIN customers c ON o.customer_id = c.id 
     WHERE o.id = ?`,
    [orderId]
  );
  if (rows.length === 0) throw new Error(`Order #${orderId} not found.`);
  const order = rows[0];
  const prevStatus = order.status;

  // Determine if status should advance to 'preparing' (In Kitchen Preparation)
  const isPending = !order.status || 
    ['pending', 'pending_approval', 'unpaid', 'new', 'for_confirmation', 'paid'].includes(order.status.toLowerCase());
  const newStatus = isPending ? 'preparing' : order.status;

  if (String(newStatus || '').toLowerCase() === 'preparing') {
    await deductIngredientsForOrder(orderId);
  }

  await db.query(
    `UPDATE orders 
     SET payment_status = 'Paid', status = ?, updated_at = CURRENT_TIMESTAMP 
     WHERE id = ?`,
    [newStatus, orderId]
  );

  await db.query(
    `UPDATE payments 
     SET status = 'verified', is_mismatch = 0, mismatch_notes = NULL, verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
     WHERE order_id = ?`,
    [orderId]
  );

  // Log in order_audit_logs
  try {
    const actorId = actor ? (actor.id || actor.userId || null) : null;
    const actorName = actor ? (actor.username || actor.name || 'Staff') : 'Staff';
    await db.query(
      `INSERT INTO order_audit_logs (order_id, order_number, action, actor_id, actor_name, reason, details)
       VALUES (?, ?, 'PAYMENT_VERIFIED', ?, ?, 'Payment Verified', 'Payment marked as Paid; order status advanced to In Kitchen Preparation')`,
      [orderId, order.order_number, actorId, actorName]
    );
  } catch (aErr) {
    console.warn('[orderService] Failed to insert audit log for payment verification:', aErr.message);
  }

  // Notify customer via Facebook Messenger and notification logs
  const customerName = `${order.first_name || ''}`.trim() || 'Customer';
  const notifMsg = `Magandang araw po, ${customerName}! ✅ Na-verify na po ng aming staff ang inyong bayad para sa Order #${order.order_number}.\n\n🍳 Kasalukuyan na po itong inihahanda sa aming kusina (In Kitchen Preparation). I-a-update po namin kayo oras na handa na ito para i-deliver o i-pickup. Maraming salamat po!`;

  await sendNotification(order.psid, 'payment_verified', `Order #${order.order_number} Payment Verified`, notifMsg);

  if (order.psid && !order.psid.startsWith('POS_MANUAL_')) {
    await sendTextMessage(order.psid, notifMsg).catch(err => {
      console.warn('[orderService] Failed to send payment verified notification:', err.message);
    });
  }

  // Look up assigned rider if any
  let assignedRiderId = null;
  try {
    const [delRows] = await db.query('SELECT rider_id FROM deliveries WHERE order_id = ?', [orderId]);
    if (delRows && delRows.length > 0 && delRows[0].rider_id) {
      assignedRiderId = delRows[0].rider_id;
    }
  } catch (err) {
    console.warn('[orderService] Rider lookup warning:', err.message);
  }

  // Broadcast real-time events to all connected clients & Kanban
  broadcastSSE('ORDER_PAYMENT_VERIFIED', {
    orderId,
    orderNumber: order.order_number,
    payment_status: 'Paid',
    status: newStatus
  });

  if (isPending) {
    broadcastSSE('ORDER_STATUS_CHANGED', {
      orderId,
      orderNumber: order.order_number,
      prevStatus,
      newStatus: 'preparing',
      riderId: assignedRiderId,
      alertMessage: `🍳 Order #${order.order_number} payment verified. Now in Kitchen Preparation.`,
      customerName: `${order.first_name || ''} ${order.last_name || ''}`.trim()
    });

    broadcastSSE('RIDER_ORDER_ALERT', {
      orderId,
      orderNumber: order.order_number,
      riderId: assignedRiderId,
      status: 'preparing',
      message: `🍳 Order #${order.order_number} is now being prepared in the kitchen. Stand by for pickup.`,
      timestamp: new Date().toISOString()
    });
  }

  return { ...order, status: newStatus, payment_status: 'Paid' };
}

/**
 * Staff marks payment proof as invalid
 * 1. Updates order payment_status to 'INVALID'
 * 2. Updates payments table status to 'mismatch_flagged' with reason
 * 3. Records audit log in order_audit_logs
 * 4. Sends specific reason explanation to customer via Messenger
 * 5. Re-prompts customer to upload correct receipt (sets AWAITING_PAYMENT_PROOF session)
 * 6. Broadcasts real-time events
 */
async function markOrderPaymentInvalid(orderId, reason = '', actor = null) {
  const [rows] = await db.query(
    `SELECT o.*, c.psid, c.first_name, c.last_name 
     FROM orders o 
     JOIN customers c ON o.customer_id = c.id 
     WHERE o.id = ?`,
    [orderId]
  );
  if (rows.length === 0) throw new Error(`Order #${orderId} not found.`);
  const order = rows[0];

  const trimmedReason = (reason || '').trim() || 'Invalid payment proof';

  await db.query(
    `UPDATE orders 
     SET payment_status = 'INVALID', updated_at = CURRENT_TIMESTAMP 
     WHERE id = ?`,
    [orderId]
  );

  await db.query(
    `UPDATE payments 
     SET status = 'mismatch_flagged', is_mismatch = 1, mismatch_notes = ?, updated_at = CURRENT_TIMESTAMP 
     WHERE order_id = ?`,
    [trimmedReason, orderId]
  );

  // Log in order_audit_logs
  try {
    const actorId = actor ? (actor.id || actor.userId || null) : null;
    const actorName = actor ? (actor.username || actor.name || 'Staff') : 'Staff';
    await db.query(
      `INSERT INTO order_audit_logs (order_id, order_number, action, actor_id, actor_name, reason, details)
       VALUES (?, ?, 'PAYMENT_INVALID', ?, ?, ?, ?)`,
      [orderId, order.order_number, actorId, actorName, trimmedReason, `Payment proof rejected: ${trimmedReason}`]
    );
  } catch (aErr) {
    console.warn('[orderService] Failed to insert audit log for payment rejection:', aErr.message);
  }

  // Format tailored explanation for customer
  let explanation = trimmedReason;
  const reasonLower = trimmedReason.toLowerCase();
  if (reasonLower.includes('malabo')) {
    explanation = 'Malabo po o hindi mabasa nang malinaw ang ipinadalang picture ng resibo.';
  } else if (reasonLower.includes('amount') || reasonLower.includes('halaga')) {
    explanation = `Hindi po tugma ang halaga (amount) sa resibo sa total ng inyong order (₱${parseFloat(order.total_amount).toFixed(2)}).`;
  } else if (reasonLower.includes('reference') || reasonLower.includes('ref')) {
    explanation = 'Hindi po tugma o hindi mahanap ang ibinigay na GCash Reference / Trace Number.';
  }

  const promptMsg = `Paumanhin po, hindi po ma-verify ng aming staff ang inyong ipinadalang payment proof para sa Order #${order.order_number}.\n\n⚠️ Dahilan: ${explanation}\n\n📸 Paki-send po muli ang malinaw na screenshot ng inyong GCash receipt o i-type ang tamang Reference Number dito para ma-verify at maihanda na ang inyong order. Maraming salamat po!`;

  await sendNotification(order.psid, 'payment_invalid', `Order #${order.order_number} Payment Proof Rejected`, promptMsg);

  // Notify and re-prompt customer via Messenger
  if (order.psid && !order.psid.startsWith('POS_MANUAL_')) {
    await sendTextMessage(order.psid, promptMsg).catch(err => {
      console.warn('[orderService] Failed to send invalid payment notification:', err.message);
    });

    try {
      const session = await getSession(order.psid);
      session.checkout_step = 'AWAITING_PAYMENT_PROOF';
      session.state = 'AWAITING_PAYMENT_PROOF';
      session.current_step = 'AWAITING_PAYMENT_PROOF';
      session.activeOrderNumber = order.order_number;
      session.active_order_id = order.id;
      session.order_id = order.id;
      await saveSession(session);
    } catch (sErr) {
      console.warn('[orderService] Failed to update session state for re-upload:', sErr.message);
    }
  }

  broadcastSSE('ORDER_PAYMENT_INVALID', {
    orderId,
    orderNumber: order.order_number,
    payment_status: 'INVALID',
    reason: trimmedReason
  });

  broadcastSSE('PAYMENT_UPDATE', {
    orderId,
    orderNumber: order.order_number,
    isMismatch: true,
    payment_status: 'INVALID',
    mismatch_notes: trimmedReason
  });

  return { ...order, payment_status: 'INVALID', mismatch_notes: trimmedReason };
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
  rejectVoidOrder,
  approveCancellationRequest,
  declineCancellationRequest,
  verifyOrderPayment,
  markOrderPaymentInvalid
};
