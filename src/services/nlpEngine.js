/**
 * Conversational AI & NLP Intent Engine (FR2, FR3, FR5, FR7, FR11)
 * Manages customer conversation state machine, intent recognition,
 * menu browsing, order placement, GCash validation, and post-delivery feedback.
 */

const db = require('../../database/db');
const config = require('../config/config');
const { calculateDeliveryFare } = require('./fareCalculator');
const { createOrder, getOrderDetails } = require('./orderService');
const {
  sendTextMessage,
  sendQuickReplies,
  sendGenericTemplate,
  sendButtonTemplate,
  sendFeedbackPrompt
} = require('./messengerService');
const { broadcastSSE } = require('./notificationService');
const { queryWitAi } = require('./witAiService');

// In-memory active customer conversation sessions (backed up to DB customers table)
const userSessions = new Map();

// Global AI Chatbot operational status
let isChatbotActive = true;
let lastToggledBy = 'System';
let lastToggledAt = new Date().toISOString();

function getChatbotStatus() {
  return {
    isEnabled: isChatbotActive,
    lastToggledBy,
    lastToggledAt
  };
}

function setChatbotStatus(enabled, user = 'Admin') {
  isChatbotActive = Boolean(enabled);
  lastToggledBy = user;
  lastToggledAt = new Date().toISOString();
  return getChatbotStatus();
}

/**
 * Get or initialize user conversation session state
 */
async function getSession(psid) {
  if (userSessions.has(psid)) {
    return userSessions.get(psid);
  }

  // Load from database if exists
  const [rows] = await db.query(
    `SELECT id, first_name, last_name, phone_number, delivery_address, distance_km, conversation_state, cart_json 
     FROM customers WHERE psid = ?`,
    [psid]
  );

  let session = {
    psid,
    customerId: null,
    name: 'Customer',
    phone: '',
    address: '',
    distanceKm: 1.2,
    state: 'IDLE', // IDLE, BROWSING, ADDING_ITEM, AWAITING_ADDRESS, AWAITING_PAYMENT, AWAITING_GCASH_AMOUNT, AWAITING_FEEDBACK_COMMENT
    cart: [],
    pendingItem: null,
    activeOrderNumber: null,
    lastInteraction: Date.now()
  };

  if (rows.length > 0) {
    const cust = rows[0];
    session.customerId = cust.id;
    session.name = `${cust.first_name || ''} ${cust.last_name || ''}`.trim() || 'Customer';
    session.phone = cust.phone_number || '';
    session.address = cust.delivery_address || '';
    session.distanceKm = parseFloat(cust.distance_km) || 1.2;
    session.state = cust.conversation_state || 'IDLE';
    if (cust.cart_json) {
      try {
        session.cart = JSON.parse(cust.cart_json);
      } catch (e) {
        session.cart = [];
      }
    }
  }

  userSessions.set(psid, session);
  return session;
}

/**
 * Persist session changes to database
 */
async function saveSession(session) {
  userSessions.set(session.psid, session);
  try {
    await db.query(
      `UPDATE customers 
       SET conversation_state = ?, cart_json = ?, delivery_address = ?, distance_km = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE psid = ?`,
      [session.state, JSON.stringify(session.cart), session.address, session.distanceKm, session.psid]
    );
  } catch (err) {
    // Ignore if customer record doesn't exist yet
  }
}

/**
 * Main Message & Event Handler for Facebook Messenger Webhook
 */
async function handleMessageEvent(psid, incomingText = '', payload = null) {
  const session = await getSession(psid);
  const text = (incomingText || '').trim();
  const eventPayload = payload || '';

  // Log incoming message in database audit trail
  let detectedIntent = 'UNKNOWN';
  let botReplyLog = '';

  try {
    // If AI Chatbot is turned OFF by admin, send the offline message
    if (!isChatbotActive) {
      detectedIntent = 'CHATBOT_OFFLINE';
      botReplyLog = 'Chatbot offline message sent';
      const offlineText = `⏸️ [AI CHATBOT CURRENTLY PAUSED]\n\nOur automated AI Assistant is currently turned off by the cafe administration for maintenance or live assistance.\n\n📞 Store Contact: ${config.store.phone}\n📍 Address: ${config.store.address}\n⏰ Hours: ${config.store.hours}\n\nA cafe staff member will attend to you as soon as possible. Thank you for your patience!`;
      await sendQuickReplies(psid, offlineText, [{ title: 'ℹ️ Store Info', payload: 'STORE_INFO' }]);
      return;
    }

    // 1. Handle Postback and Quick Reply Payloads first
    if (eventPayload) {
      if (eventPayload === 'GET_STARTED' || eventPayload === 'MENU_HOME') {
        detectedIntent = 'GET_STARTED';
        await sendWelcomeMenu(psid, session);
      } else if (eventPayload.startsWith('CATEGORY_')) {
        detectedIntent = 'BROWSE_CATEGORY';
        const categorySlug = eventPayload.replace('CATEGORY_', '');
        await sendCategoryMenu(psid, categorySlug);
      } else if (eventPayload.startsWith('ADD_ITEM_')) {
        detectedIntent = 'ADD_ITEM';
        const menuItemId = parseInt(eventPayload.replace('ADD_ITEM_', ''), 10);
        await promptItemQuantity(psid, session, menuItemId);
      } else if (eventPayload.startsWith('QTY_')) {
        detectedIntent = 'SET_QUANTITY';
        const qty = parseInt(eventPayload.replace('QTY_', ''), 10);
        await addItemToCart(psid, session, qty);
      } else if (eventPayload === 'VIEW_CART') {
        detectedIntent = 'VIEW_CART';
        await sendCartSummary(psid, session);
      } else if (eventPayload === 'CLEAR_CART') {
        detectedIntent = 'CLEAR_CART';
        session.cart = [];
        session.state = 'IDLE';
        await saveSession(session);
        await sendTextMessage(psid, '🗑️ Your cart has been cleared.');
        await sendWelcomeMenu(psid, session);
      } else if (eventPayload === 'CHECKOUT_DELIVERY') {
        detectedIntent = 'CHECKOUT_DELIVERY';
        session.orderType = 'delivery';
        session.state = 'AWAITING_ADDRESS';
        await saveSession(session);
        await sendTextMessage(psid, `🛵 Delivery Selected!\n\nPlease enter your complete delivery address (and landmark):\n(Note: We deliver within 3.0 km of the cafe)`);
      } else if (eventPayload === 'CHECKOUT_PICKUP') {
        detectedIntent = 'CHECKOUT_PICKUP';
        session.orderType = 'pickup';
        session.state = 'AWAITING_PAYMENT';
        await saveSession(session);
        await sendPaymentOptions(psid, session);
      } else if (eventPayload === 'PAY_CASH') {
        detectedIntent = 'PAY_CASH';
        await completeOrderWithCash(psid, session);
      } else if (eventPayload === 'PAY_GCASH') {
        detectedIntent = 'PAY_GCASH';
        await promptGCashPayment(psid, session);
      } else if (eventPayload.startsWith('FEEDBACK_RATE_')) {
        detectedIntent = 'SUBMIT_RATING';
        await handleFeedbackRating(psid, session, eventPayload);
      } else if (eventPayload === 'TRACK_LATEST_ORDER') {
        detectedIntent = 'TRACK_ORDER';
        await handleTrackOrder(psid);
      } else if (eventPayload === 'STORE_INFO') {
        detectedIntent = 'STORE_INFO';
        await sendStoreInfo(psid);
      }
      return;
    }

    // 2. Handle Text Input with Natural Language Intent Classification
    const lower = text.toLowerCase();

    // Check if user is in an active multi-turn state
    if (session.state === 'AWAITING_FEEDBACK_COMMENT') {
      detectedIntent = 'FEEDBACK_COMMENT';
      await handleFeedbackComment(psid, session, text);
      return;
    }

    if (session.state === 'AWAITING_GCASH_AMOUNT') {
      detectedIntent = 'GCASH_AMOUNT_INPUT';
      await handleGCashAmountInput(psid, session, text);
      return;
    }

    if (session.state === 'AWAITING_ADDRESS') {
      detectedIntent = 'ADDRESS_INPUT';
      await handleAddressInput(psid, session, text);
      return;
    }

    if (session.state === 'ADDING_ITEM' && /^\d+$/.test(text)) {
      detectedIntent = 'QUANTITY_INPUT';
      const qty = parseInt(text, 10);
      await addItemToCart(psid, session, qty);
      return;
    }

    // 2. Wit.ai NLU Intent & Entity Processing
    const nlu = await queryWitAi(text);
    detectedIntent = nlu.intent;

    if (nlu.intent === 'GREETING') {
      await sendWelcomeMenu(psid, session);
    } else if (nlu.intent === 'BROWSE_MENU') {
      await sendCategorySelector(psid);
    } else if (nlu.intent === 'VIEW_CART') {
      await sendCartSummary(psid, session);
    } else if (nlu.intent === 'TRACK_ORDER') {
      await handleTrackOrder(psid);
    } else if (nlu.intent === 'STORE_INFO') {
      await sendStoreInfo(psid);
    } else if (nlu.intent === 'CLEAR_CART') {
      session.cart = [];
      session.state = 'IDLE';
      await saveSession(session);
      await sendTextMessage(psid, '🔄 Conversation reset. How can we help you today?');
      await sendWelcomeMenu(psid, session);
    } else {
      // Fuzzy search against menu items (using text or NLU extracted entity)
      const searchQuery = nlu.menuItem || text;
      const matchedItem = await findMenuItemByName(searchQuery);
      if (matchedItem) {
        detectedIntent = 'MENU_ITEM_SEARCH';
        session.pendingItem = matchedItem;
        if (nlu.quantity && nlu.quantity > 0 && nlu.quantity !== 1) {
          // If quantity was explicitly extracted by NLU (e.g. "2 Caramel Macchiato")
          await addItemToCart(psid, session, nlu.quantity);
        } else {
          session.state = 'ADDING_ITEM';
          await saveSession(session);
          await promptItemQuantity(psid, session, matchedItem.id);
        }
      } else {
        detectedIntent = 'FALLBACK';
        await sendFallbackResponse(psid, text);
      }
    }
  } catch (err) {
    console.error('[NLP Engine Error]', err);
    await sendTextMessage(psid, "Sorry, I had a momentary hiccup. Please tap 'Browse Menu' or type 'menu' to continue!");
  } finally {
    // Log interaction to DB
    try {
      await db.query(
        `INSERT INTO chatbot_logs (customer_id, psid, incoming_message, detected_intent, bot_response)
         VALUES (?, ?, ?, ?, ?)`,
        [session.customerId || null, psid, text || eventPayload, detectedIntent, botReplyLog || 'Response sent']
      );
    } catch (e) {
      // Ignore log error
    }
  }
}

// ----------------------------------------------------------------------------
// Conversational Sub-flows
// ----------------------------------------------------------------------------

async function sendWelcomeMenu(psid, session) {
  const greeting = `👋 Welcome to ${config.store.name}!\n\nI'm your AI Barista Assistant. How can I treat you today?`;
  const quickReplies = [
    { title: '☕ Browse Menu', payload: 'MENU_HOME' },
    { title: '🛒 View Cart', payload: 'VIEW_CART' },
    { title: '🛵 Track Order', payload: 'TRACK_LATEST_ORDER' },
    { title: 'ℹ️ Cafe Info', payload: 'STORE_INFO' }
  ];
  await sendQuickReplies(psid, greeting, quickReplies);
}

async function sendCategorySelector(psid) {
  const [categories] = await db.query(
    `SELECT name, slug FROM categories WHERE is_active = 1 ORDER BY display_order ASC`
  );

  const quickReplies = categories.map(c => ({
    title: c.name.length > 20 ? c.name.substring(0, 20) : c.name,
    payload: `CATEGORY_${c.slug}`
  }));
  quickReplies.push({ title: '🛒 View Cart', payload: 'VIEW_CART' });

  await sendQuickReplies(psid, '📖 Choose a menu category to explore:', quickReplies);
}

async function sendCategoryMenu(psid, categorySlug) {
  const [rows] = await db.query(`
    SELECT m.id, m.name, m.description, m.price, m.image_url, i.stock_quantity
    FROM menu_items m
    JOIN categories c ON m.category_id = c.id
    JOIN inventory i ON m.id = i.menu_item_id
    WHERE c.slug = ? AND m.is_available = 1
    ORDER BY m.is_bestseller DESC, m.name ASC
    LIMIT 10
  `, [categorySlug]);

  if (rows.length === 0) {
    await sendTextMessage(psid, 'No items currently available in this category.');
    return sendCategorySelector(psid);
  }

  const elements = rows.map(item => ({
    title: `${item.name} - ₱${parseFloat(item.price).toFixed(2)}`,
    image_url: item.image_url || 'https://images.unsplash.com/photo-1541167760496-1628856ab772?w=500',
    subtitle: `${item.description ? item.description.substring(0, 75) : ''} (${item.stock_quantity} left in stock)`,
    buttons: [
      {
        type: 'postback',
        title: '➕ Add to Order',
        payload: `ADD_ITEM_${item.id}`
      }
    ]
  }));

  await sendGenericTemplate(psid, elements);
}

async function promptItemQuantity(psid, session, menuItemId) {
  const [rows] = await db.query(
    `SELECT m.id, m.name, m.price, i.stock_quantity FROM menu_items m JOIN inventory i ON m.id = i.menu_item_id WHERE m.id = ?`,
    [menuItemId]
  );

  if (rows.length === 0) {
    return sendTextMessage(psid, 'Sorry, this item is not found or out of stock.');
  }

  const item = rows[0];
  session.pendingItem = item;
  session.state = 'ADDING_ITEM';
  await saveSession(session);

  const text = `How many servings of "${item.name}" (₱${parseFloat(item.price).toFixed(2)}) would you like?`;
  const quickReplies = [
    { title: '1', payload: 'QTY_1' },
    { title: '2', payload: 'QTY_2' },
    { title: '3', payload: 'QTY_3' },
    { title: '4', payload: 'QTY_4' },
    { title: 'Cancel', payload: 'MENU_HOME' }
  ];

  await sendQuickReplies(psid, text, quickReplies);
}

async function addItemToCart(psid, session, qty) {
  if (!session.pendingItem) {
    return sendWelcomeMenu(psid, session);
  }

  const item = session.pendingItem;
  const quantity = Math.max(1, qty);

  // Check if item already in cart
  const existingIndex = session.cart.findIndex(c => c.menuItemId === item.id);
  if (existingIndex >= 0) {
    session.cart[existingIndex].quantity += quantity;
  } else {
    session.cart.push({
      menuItemId: item.id,
      name: item.name,
      price: parseFloat(item.price),
      quantity,
      specialInstructions: ''
    });
  }

  session.pendingItem = null;
  session.state = 'IDLE';
  await saveSession(session);

  const itemTotal = parseFloat(item.price) * quantity;
  const replyText = `✅ Added ${quantity}x "${item.name}" (₱${itemTotal.toFixed(2)}) to your cart!`;

  const quickReplies = [
    { title: '🛒 View Cart & Checkout', payload: 'VIEW_CART' },
    { title: '➕ Add More Items', payload: 'MENU_HOME' },
    { title: '🗑️ Clear Cart', payload: 'CLEAR_CART' }
  ];

  await sendQuickReplies(psid, replyText, quickReplies);
}

async function sendCartSummary(psid, session) {
  if (!session.cart || session.cart.length === 0) {
    const text = '🛒 Your cart is currently empty!\n\nCheck out our handcrafted drinks and delicious meals:';
    const quickReplies = [{ title: '☕ Browse Menu', payload: 'MENU_HOME' }];
    return sendQuickReplies(psid, text, quickReplies);
  }

  let subtotal = 0;
  let summaryText = '🛒 YOUR ORDER SUMMARY:\n------------------------------\n';

  session.cart.forEach((item, index) => {
    const itemSub = item.price * item.quantity;
    subtotal += itemSub;
    summaryText += `${index + 1}. ${item.name}\n   Qty: ${item.quantity} × ₱${item.price.toFixed(2)} = ₱${itemSub.toFixed(2)}\n`;
  });

  summaryText += `------------------------------\nSubtotal: ₱${subtotal.toFixed(2)}\n\nHow would you like to receive your order?`;

  const quickReplies = [
    { title: '🛵 Delivery', payload: 'CHECKOUT_DELIVERY' },
    { title: '🛍️ Store Pickup', payload: 'CHECKOUT_PICKUP' },
    { title: '➕ Add More Items', payload: 'MENU_HOME' },
    { title: '🗑️ Clear Cart', payload: 'CLEAR_CART' }
  ];

  await sendQuickReplies(psid, summaryText, quickReplies);
}

async function handleAddressInput(psid, session, addressText) {
  session.address = addressText;
  // Estimate distance (defaulting to 1.5 km or simulated distance)
  session.distanceKm = 1.5;
  session.state = 'AWAITING_PAYMENT';
  await saveSession(session);

  await sendPaymentOptions(psid, session);
}

async function sendPaymentOptions(psid, session) {
  let subtotal = session.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  let deliveryFee = 0;
  let fareBreakdown = '';

  if (session.orderType === 'delivery') {
    const fare = calculateDeliveryFare(session.distanceKm, 'motorcycle', 'sunny', new Date());
    deliveryFee = fare.finalFare;
    fareBreakdown = `\n🛵 Delivery Fee (${session.distanceKm} km): ₱${deliveryFee.toFixed(2)}`;
  }

  const total = subtotal + deliveryFee;
  session.computedTotal = total;
  session.deliveryFee = deliveryFee;
  await saveSession(session);

  const text = `💳 CHECKOUT DETAILS:\nSubtotal: ₱${subtotal.toFixed(2)}${fareBreakdown}\nTOTAL AMOUNT: ₱${total.toFixed(2)}\n\nPlease choose your payment method:`;

  const quickReplies = [
    { title: '💵 Cash', payload: 'PAY_CASH' },
    { title: '📱 GCash', payload: 'PAY_GCASH' }
  ];

  await sendQuickReplies(psid, text, quickReplies);
}

async function completeOrderWithCash(psid, session) {
  const orderResult = await createOrder({
    psid,
    customerName: session.name,
    customerPhone: session.phone,
    orderType: session.orderType || 'delivery',
    deliveryAddress: session.address,
    distanceKm: session.distanceKm,
    items: session.cart,
    paymentMethod: 'cash'
  });

  // Clear cart and update active order
  session.cart = [];
  session.activeOrderNumber = orderResult.orderNumber;
  session.state = 'IDLE';
  await saveSession(session);

  const confirmMsg = `🎉 ORDER CONFIRMED!\n\nOrder Number: #${orderResult.orderNumber}\nTotal to Pay (Cash): ₱${orderResult.totalAmount.toFixed(2)}\nStatus: ⏳ Pending Kitchen Preparation\n\nWe will notify you here as soon as our barista begins preparing your order!`;
  const quickReplies = [
    { title: '🛵 Track Order', payload: 'TRACK_LATEST_ORDER' },
    { title: '☕ New Order', payload: 'MENU_HOME' }
  ];

  await sendQuickReplies(psid, confirmMsg, quickReplies);
}

async function promptGCashPayment(psid, session) {
  session.state = 'AWAITING_GCASH_AMOUNT';
  await saveSession(session);

  const total = session.computedTotal || 0;
  const msg = `📱 GCASH PAYMENT INSTRUCTIONS:\n------------------------------\n1. Send ₱${total.toFixed(2)} to:\n   GCash Number: ${config.store.gcashNumber}\n   Account Name: ${config.store.gcashName}\n\n2. Once sent, TYPE THE EXACT AMOUNT PAID here (e.g. "${total.toFixed(2)}" or "${total.toFixed(2)} ref 987654"):`;

  await sendTextMessage(psid, msg);
}

async function handleGCashAmountInput(psid, session, text) {
  // Extract numbers from message
  const match = text.match(/(\d+(\.\d{1,2})?)/);
  if (!match) {
    return sendTextMessage(psid, `Please enter a valid amount paid (e.g. "${session.computedTotal.toFixed(2)}").`);
  }

  const enteredAmount = parseFloat(match[1]);
  // Extract reference number if present
  const refMatch = text.match(/(?:ref|reference|no|#)?\s*([0-9]{8,15})/i);
  const referenceNo = refMatch ? refMatch[1] : `GCASH-${Date.now()}`;

  const orderResult = await createOrder({
    psid,
    customerName: session.name,
    customerPhone: session.phone,
    orderType: session.orderType || 'delivery',
    deliveryAddress: session.address,
    distanceKm: session.distanceKm,
    items: session.cart,
    paymentMethod: 'gcash',
    amountPaid: enteredAmount,
    referenceNo
  });

  session.cart = [];
  session.activeOrderNumber = orderResult.orderNumber;
  session.state = 'IDLE';
  await saveSession(session);

  if (orderResult.payment.isMismatch) {
    const mismatchWarning = `⚠️ PAYMENT AMOUNT MISMATCH DETECTED:\n\nOrder Total: ₱${orderResult.totalAmount.toFixed(2)}\nAmount Entered: ₱${enteredAmount.toFixed(2)}\nDifference: ${orderResult.payment.mismatchNotes}\n\nYour order #${orderResult.orderNumber} has been logged. Our cafe staff has been flagged to manually verify your GCash transaction.`;
    await sendQuickReplies(psid, mismatchWarning, [{ title: '🛵 Track Order', payload: 'TRACK_LATEST_ORDER' }]);
  } else {
    const successMsg = `✅ GCASH PAYMENT VERIFIED!\n\nOrder Number: #${orderResult.orderNumber}\nAmount Paid: ₱${enteredAmount.toFixed(2)}\nReference: ${referenceNo}\nStatus: ⏳ Sent to Kitchen\n\nThank you for ordering from ${config.store.name}!`;
    await sendQuickReplies(psid, successMsg, [
      { title: '🛵 Track Order', payload: 'TRACK_LATEST_ORDER' },
      { title: '☕ Browse Menu', payload: 'MENU_HOME' }
    ]);
  }
}

async function handleTrackOrder(psid) {
  const [orders] = await db.query(`
    SELECT o.*, d.status AS delivery_status, dp.full_name AS rider_name, dp.vehicle_type
    FROM orders o
    JOIN customers c ON o.customer_id = c.id
    LEFT JOIN deliveries d ON o.id = d.order_id
    LEFT JOIN delivery_personnel dp ON d.rider_id = dp.id
    WHERE c.psid = ?
    ORDER BY o.created_at DESC
    LIMIT 1
  `, [psid]);

  if (orders.length === 0) {
    const text = "You don't have any active orders right now. Would you like to order something delicious?";
    return sendQuickReplies(psid, text, [{ title: '☕ Browse Menu', payload: 'MENU_HOME' }]);
  }

  const order = orders[0];
  let statusEmoji = '⏳';
  let statusText = 'Pending Confirmation';

  if (order.status === 'preparing') {
    statusEmoji = '🍳';
    statusText = 'Kitchen is Preparing Your Order';
  } else if (order.status === 'dispatched') {
    statusEmoji = '🛵';
    statusText = `On Delivery with Rider ${order.rider_name || 'Assigned Rider'} (${order.vehicle_type || 'Motorcycle'})`;
  } else if (order.status === 'delivered') {
    statusEmoji = '✅';
    statusText = 'Delivered & Completed';
  } else if (order.status === 'cancelled') {
    statusEmoji = '❌';
    statusText = 'Cancelled';
  }

  const trackMsg = `📋 ORDER STATUS:\n------------------------------\nOrder #: ${order.order_number}\nStatus: ${statusEmoji} ${statusText}\nType: ${order.order_type.toUpperCase()}\nTotal: ₱${parseFloat(order.total_amount).toFixed(2)}\nAddress: ${order.delivery_address || 'Store Pickup'}`;

  const quickReplies = [
    { title: '🔄 Refresh Status', payload: 'TRACK_LATEST_ORDER' },
    { title: '☕ Browse Menu', payload: 'MENU_HOME' }
  ];

  await sendQuickReplies(psid, trackMsg, quickReplies);
}

async function sendStoreInfo(psid) {
  const text = `ℹ️ ${config.store.name} INFO:\n------------------------------\n📍 Address: ${config.store.address}\n⏰ Hours: ${config.store.hours}\n📞 Contact: ${config.store.phone}\n🛵 Delivery: Up to 3.0 km\n💳 Payments: Cash & GCash (${config.store.gcashNumber})\n📶 Free High-Speed WiFi for Dine-in!`;
  const quickReplies = [
    { title: '☕ Browse Menu', payload: 'MENU_HOME' },
    { title: '🛵 Track Order', payload: 'TRACK_LATEST_ORDER' }
  ];
  await sendQuickReplies(psid, text, quickReplies);
}

// ----------------------------------------------------------------------------
// FR11: Post-Delivery Feedback Handlers
// ----------------------------------------------------------------------------

async function handleFeedbackRating(psid, session, payload) {
  // Payload format: FEEDBACK_RATE_<1-5>_<ORDER_NUMBER>
  const parts = payload.split('_');
  const rating = parseInt(parts[2], 10);
  const orderNumber = parts.slice(3).join('_');

  // Look up order
  const [orders] = await db.query(
    `SELECT id, customer_id FROM orders WHERE order_number = ?`,
    [orderNumber]
  );

  if (orders.length === 0) {
    return sendTextMessage(psid, 'Thank you for your rating!');
  }

  const order = orders[0];
  const sentiment = rating >= 4 ? 'positive' : rating === 3 ? 'neutral' : 'negative';

  const [existing] = await db.query(`SELECT id FROM feedback WHERE order_id = ?`, [order.id]);
  if (existing.length > 0) {
    await db.query(
      `UPDATE feedback SET rating = ?, sentiment = ? WHERE order_id = ?`,
      [rating, sentiment, order.id]
    );
  } else {
    await db.query(
      `INSERT INTO feedback (order_id, customer_id, rating, comments, sentiment)
       VALUES (?, ?, ?, '', ?)`,
      [order.id, order.customer_id, rating, sentiment]
    );
  }

  session.pendingFeedbackOrderId = order.id;
  session.state = 'AWAITING_FEEDBACK_COMMENT';
  await saveSession(session);

  // Broadcast to Admin Dashboard
  broadcastSSE('NEW_FEEDBACK', {
    orderId: order.id,
    orderNumber,
    rating,
    sentiment
  });

  const thankYouText = `🌟 Thank you for giving us a ${rating}-star rating!\n\nWould you like to leave an optional short comment or suggestions for our barista/rider? (Or type "skip")`;
  await sendTextMessage(psid, thankYouText);
}

async function handleFeedbackComment(psid, session, commentText) {
  if (session.pendingFeedbackOrderId && commentText.toLowerCase() !== 'skip') {
    await db.query(
      `UPDATE feedback SET comments = ? WHERE order_id = ?`,
      [commentText, session.pendingFeedbackOrderId]
    );
  }

  session.pendingFeedbackOrderId = null;
  session.state = 'IDLE';
  await saveSession(session);

  await sendTextMessage(psid, "❤️ Thank you so much for your feedback! We look forward to serving you again at Diner's Cafe.");
  await sendWelcomeMenu(psid, session);
}

async function findMenuItemByName(queryText) {
  const [items] = await db.query(
    `SELECT id, name, price FROM menu_items WHERE is_available = 1`
  );

  const q = queryText.toLowerCase();
  for (const item of items) {
    if (item.name.toLowerCase().includes(q) || q.includes(item.name.toLowerCase())) {
      return item;
    }
  }
  return null;
}

async function sendFallbackResponse(psid, text) {
  const reply = `I'm not quite sure about "${text}". But here are a few things I can help you with:`;
  const quickReplies = [
    { title: '☕ Browse Menu', payload: 'MENU_HOME' },
    { title: '🛒 View Cart', payload: 'VIEW_CART' },
    { title: '🛵 Track Order', payload: 'TRACK_LATEST_ORDER' },
    { title: 'ℹ️ Store Info', payload: 'STORE_INFO' }
  ];
  await sendQuickReplies(psid, reply, quickReplies);
}

module.exports = {
  handleMessageEvent,
  getSession,
  getChatbotStatus,
  setChatbotStatus
};
