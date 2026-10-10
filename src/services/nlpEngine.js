/**
 * Conversational AI & NLP Intent Engine (FR2, FR3, FR5, FR7, FR11)
 * Manages customer conversation state machine, intent recognition,
 * menu browsing, order placement, GCash validation, and post-delivery feedback.
 */

const db = require('../../database/db');
const { calculateDeliveryFare, MAX_DELIVERY_DISTANCE_KM } = require('./fareCalculator');
const { createOrder, getOrderDetails } = require('./orderService');
const { quoteDelivery, verifyQuote, GeoError } = require('./geoService');
const {
  sendTextMessage,
  sendQuickReplies,
  sendGenericTemplate,
  sendButtonTemplate,
  sendFeedbackPrompt
} = require('./messengerService');
const { broadcastSSE } = require('./notificationService');
const { queryWitAi } = require('./witAiService');
const { generateGeminiResponse } = require('./geminiService');

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
    deliveryFee: 0,
    quoteToken: null,
    lat: null,
    lng: null,
    vehicleType: 'motorcycle',
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
async function handleMessageEvent(psid, incomingText = '', payload = null, location = null) {
  const session = await getSession(psid);
  const text = (incomingText || '').trim();
  const eventPayload = payload || '';

  // Log incoming message in database audit trail
  let detectedIntent = 'UNKNOWN';
  let botReplyLog = '';

  try {
    // If location pin is provided, handle it before text or intent logic
    if (location && (location.lat !== undefined && location.lng !== undefined)) {
      if (session.state === 'AWAITING_ADDRESS' || session.orderType === 'delivery') {
        detectedIntent = 'LOCATION_INPUT';
        await handleLocationInput(psid, session, location);
      } else {
        await sendQuickReplies(
          psid,
          `📍 Thanks for sharing your location! We don't see an active delivery checkout in progress. Would you like to check out our menu?`,
          [{ title: '☕ Browse Menu', payload: 'MENU_HOME' }]
        );
      }
      return;
    }

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
      } else if (eventPayload.startsWith('REMOVE_ITEM_')) {
        detectedIntent = 'REMOVE_CART_ITEM';
        await handleRemoveCartItem(psid, session, '', eventPayload);
      } else if (eventPayload === 'PROMPT_REMOVE_ITEM') {
        detectedIntent = 'PROMPT_REMOVE_ITEM';
        await handleRemoveCartItem(psid, session, '');
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
        const maxRadius = Math.min(config.store.maxDeliveryKm || 3.0, MAX_DELIVERY_DISTANCE_KM);
        await sendQuickReplies(
          psid,
          `🛵 Delivery Selected!\n\nPlease share your delivery location, or type your address. We deliver within ${maxRadius.toFixed(1)} km of the cafe.`,
          [
            { content_type: 'location' },
            { title: 'Store pickup instead', payload: 'CHECKOUT_PICKUP' }
          ]
        );
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

    // 2. Cart Item Removal / Reduction (e.g. "remove 1 order on the cart", "remove 1 spanish latte", "tanggalin ang carbonara")
    if (/(remove|delete|cancel|tanggalin|bawasan|bawas|minus|alisin|tanggal|paki\s*tanggal)\b/i.test(lower)) {
      detectedIntent = 'REMOVE_CART_ITEM';
      await handleRemoveCartItem(psid, session, text);
      return;
    }

    // 3. Try Google Gemini AI Generative Barista if configured
    const [allMenuItems] = await db.query(
      `SELECT m.id, m.name, m.price, m.description, c.name as category_name 
       FROM menu_items m 
       JOIN categories c ON m.category_id = c.id 
       WHERE m.is_available = 1`
    );

    if (config.geminiApiKey && (session.state === 'IDLE' || session.state === 'BROWSING')) {
      const geminiRes = await generateGeminiResponse(text, session, allMenuItems);
      if (geminiRes && geminiRes.replyText) {
        detectedIntent = geminiRes.intent || 'GEMINI_CONVERSATION';
        botReplyLog = geminiRes.replyText;

        // If Gemini extracted items to add directly to cart
        if (geminiRes.extractedItems && geminiRes.extractedItems.length > 0) {
          const matchedFromGemini = [];
          for (const ext of geminiRes.extractedItems) {
            const mItem = allMenuItems.find(m => m.id === ext.menuItemId || m.name.toLowerCase() === (ext.name || '').toLowerCase());
            if (mItem) {
              matchedFromGemini.push({ item: mItem, quantity: Math.max(1, ext.quantity || 1) });
            }
          }
          if (matchedFromGemini.length > 0) {
            await handleMultiItemOrder(psid, session, matchedFromGemini);
            return;
          }
        }

        const formattedQuickReplies = (geminiRes.suggestedReplies || [
          'Browse Menu',
          'View Cart',
          'Order Delivery'
        ]).map(t => ({ title: t.substring(0, 20), payload: t.toUpperCase().replace(/\s+/g, '_') }));

        await sendQuickReplies(psid, geminiRes.replyText, formattedQuickReplies);
        return;
      }
    }

    // 4. Conversational FAQ, Recommendations & Cafe Banter Handler
    const handledFaq = await handleFaqAndBanter(psid, text);
    if (handledFaq) {
      detectedIntent = 'CONVERSATIONAL_FAQ';
      return;
    }

    // 5. Multi-Item Natural Language Order Extraction (e.g. "2 spanish latte and 1 carbonara")
    const extractedMultiItems = await extractMultipleItemsFromText(text);
    if (extractedMultiItems && extractedMultiItems.length > 0) {
      // If user typed only the item name or specified quantities
      if (extractedMultiItems.length > 1 || (extractedMultiItems.length === 1 && (extractedMultiItems[0].quantity > 1 || /order|pabili|buy|padeliver|gusto/i.test(text)))) {
        detectedIntent = 'MULTI_ITEM_ORDER';
        await handleMultiItemOrder(psid, session, extractedMultiItems);
        return;
      }
    }

    // 6. Wit.ai NLU Intent & Entity Processing
    const nlu = await queryWitAi(text);
    detectedIntent = nlu.intent;

    if (nlu.intent === 'GREETING') {
      await sendWelcomeMenu(psid, session);
    } else if (nlu.intent === 'THANK_YOU' || /^(thank\s*you|thanks|salamat|thank\s*u|ty)\b/i.test(text)) {
      detectedIntent = 'THANK_YOU';
      const tyText = `❤️ You're very welcome! Thank you for choosing Diner's Cafe. Is there anything else we can prepare for you today?`;
      const quickReplies = [
        { title: '☕ Browse Menu', payload: 'MENU_HOME' },
        { title: '🛒 View Cart', payload: 'VIEW_CART' },
        { title: '🛵 Track Order', payload: 'TRACK_LATEST_ORDER' },
        { title: 'ℹ️ Store Info', payload: 'STORE_INFO' }
      ];
      await sendQuickReplies(psid, tyText, quickReplies);
    } else if (nlu.intent === 'BROWSE_MENU') {
      // Check if text is actually inquiring about an item
      const matchedItem = await findMenuItemByName(text);
      if (matchedItem) {
        detectedIntent = 'MENU_ITEM_SEARCH';
        session.pendingItem = matchedItem;
        session.state = 'ADDING_ITEM';
        await saveSession(session);
        await promptItemQuantity(psid, session, matchedItem.id);
      } else {
        await sendCategorySelector(psid);
      }
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

  const text = `☕ Thank you for asking! Yes, we have "${item.name}" (₱${parseFloat(item.price).toFixed(2)}) available in our cafe! 😋\n\nHow many servings would you like to order?`;
  const quickReplies = [
    { title: '1 Serving', payload: 'QTY_1' },
    { title: '2 Servings', payload: 'QTY_2' },
    { title: '3 Servings', payload: 'QTY_3' },
    { title: 'Browse Menu', payload: 'MENU_HOME' }
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
  const replyText = `✅ Thank you! Added ${quantity}x "${item.name}" (₱${itemTotal.toFixed(2)}) to your cart!`;

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

  summaryText += `------------------------------\nSubtotal: ₱${subtotal.toFixed(2)}\n\nHow would you like to proceed with your order?`;

  const quickReplies = [
    { title: '🛵 Delivery', payload: 'CHECKOUT_DELIVERY' },
    { title: '🛍️ Store Pickup', payload: 'CHECKOUT_PICKUP' },
    { title: '❌ Remove Item', payload: 'PROMPT_REMOVE_ITEM' },
    { title: '➕ Add More Items', payload: 'MENU_HOME' },
    { title: '🗑️ Clear Cart', payload: 'CLEAR_CART' }
  ];

  await sendQuickReplies(psid, summaryText, quickReplies);
}

async function processDeliveryQuote(psid, session, quoteInput) {
  try {
    const quote = await quoteDelivery(quoteInput);
    session.address = quote.destination.formattedAddress;
    session.distanceKm = quote.distanceKm;
    session.deliveryFee = quote.fare.finalFare;
    session.quoteToken = quote.quoteToken;
    session.lat = quote.destination.lat;
    session.lng = quote.destination.lng;
    session.vehicleType = quote.vehicleType;
    session.state = 'AWAITING_PAYMENT';
    await saveSession(session);

    const summary = `📍 Delivery Address Confirmed:\n${session.address}\n\n🛵 Distance: ${session.distanceKm} km (${session.vehicleType})\n💵 Delivery Fee: ₱${session.deliveryFee.toFixed(2)}`;
    await sendTextMessage(psid, summary);
    await sendPaymentOptions(psid, session);
  } catch (err) {
    session.state = 'AWAITING_ADDRESS';
    await saveSession(session);

    if (err instanceof GeoError) {
      if (err.code === 'GEO_TOO_FAR') {
        const roadKm = err.details?.roadKm ? `${err.details.roadKm.toFixed(1)} km` : 'beyond our radius';
        const maxKm = err.details?.maxKm || config.store.maxDeliveryKm || 3.0;
        await sendQuickReplies(
          psid,
          `⚠️ Sorry, that location is ${roadKm} away, which exceeds our maximum delivery radius of ${maxKm} km.\n\nWould you like to switch to Store Pickup or try another address?`,
          [
            { title: '🛍️ Store Pickup', payload: 'CHECKOUT_PICKUP' },
            { content_type: 'location' },
            { title: '☕ View Cart', payload: 'VIEW_CART' }
          ]
        );
        return;
      }

      if (err.code === 'GEO_LOW_PRECISION' || err.code === 'GEO_NOT_FOUND') {
        await sendQuickReplies(
          psid,
          `📍 We couldn't pinpoint that exact address. Please share a GPS location pin or provide a more specific landmark and street name:`,
          [
            { content_type: 'location' },
            { title: '🛍️ Store Pickup', payload: 'CHECKOUT_PICKUP' }
          ]
        );
        return;
      }

      if (err.code === 'GEO_PROVIDER_ERROR') {
        await sendQuickReplies(
          psid,
          `⚠️ We are temporarily experiencing an issue with our mapping service. Please retry or choose store pickup:`,
          [
            { title: '🔄 Retry', payload: 'CHECKOUT_DELIVERY' },
            { title: '🛍️ Store Pickup', payload: 'CHECKOUT_PICKUP' }
          ]
        );
        return;
      }

      if (err.code === 'GEO_INVALID_COORDS' || err.code === 'GEO_OUT_OF_COUNTRY') {
        await sendQuickReplies(
          psid,
          `📍 The coordinates provided appear invalid or outside our Philippine service region. Please share your location again:`,
          [
            { content_type: 'location' },
            { title: '🛍️ Store Pickup', payload: 'CHECKOUT_PICKUP' }
          ]
        );
        return;
      }

      if (err.code === 'VALIDATION_ERROR') {
        await sendQuickReplies(
          psid,
          `⚠️ ${err.message}\n\nPlease share your location pin or enter a valid address:`,
          [
            { content_type: 'location' },
            { title: '🛍️ Store Pickup', payload: 'CHECKOUT_PICKUP' }
          ]
        );
        return;
      }
    }

    console.error('[Delivery Processing Error]', err);
    await sendQuickReplies(
      psid,
      `⚠️ An unexpected error occurred while calculating your delivery. Please share your location or switch to pickup:`,
      [
        { content_type: 'location' },
        { title: '🛍️ Store Pickup', payload: 'CHECKOUT_PICKUP' }
      ]
    );
  }
}

async function handleAddressInput(psid, session, addressText) {
  await processDeliveryQuote(psid, session, { address: addressText });
}

async function handleLocationInput(psid, session, location) {
  await processDeliveryQuote(psid, session, { lat: location.lat, lng: location.lng });
}

async function sendPaymentOptions(psid, session) {
  let subtotal = session.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  let deliveryFee = 0;
  let fareBreakdown = '';

  if (session.orderType === 'delivery') {
    // Before showing totals, verifyQuote(session.quoteToken); if expired, silently request a new quote
    try {
      verifyQuote(session.quoteToken);
    } catch (err) {
      if (err.code === 'QUOTE_EXPIRED' && session.lat && session.lng) {
        try {
          const newQuote = await quoteDelivery({ lat: session.lat, lng: session.lng });
          const oldFee = session.deliveryFee;
          session.quoteToken = newQuote.quoteToken;
          session.deliveryFee = newQuote.fare.finalFare;
          session.distanceKm = newQuote.distanceKm;
          session.vehicleType = newQuote.vehicleType;
          if (oldFee !== session.deliveryFee) {
            await sendTextMessage(
              psid,
              `ℹ️ Note: Delivery conditions updated. Your delivery fee is now ₱${session.deliveryFee.toFixed(2)}.`
            );
          }
        } catch (refreshErr) {
          console.error('[Quote Refresh Error]', refreshErr);
        }
      }
    }

    deliveryFee = session.deliveryFee || 0;
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
    quoteToken: session.quoteToken,
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
    quoteToken: session.quoteToken,
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
  if (!queryText) return null;
  const [items] = await db.query(
    `SELECT id, name, price, description FROM menu_items WHERE is_available = 1`
  );

  const clean = queryText.toLowerCase()
    .replace(/do\s+you\s+have|may\s+roon|meron\s+ba|meron\s+kayong|may\s+ba|is\s+there|available\s+ba|i\s+want|order|gusto\s+ko|pabili\s+ng|buy|please|\?|\!/gi, ' ')
    .trim();

  // 1. Direct or substring match on item name
  for (const item of items) {
    const name = item.name.toLowerCase();
    if (name === clean || name.includes(clean) || (clean.length >= 3 && clean.includes(name))) {
      return item;
    }
  }

  // 2. Iced coffee alias & beverage mapping
  if (/iced\s*coffee|cold\s*coffee|ice\s*coffee/i.test(clean)) {
    const icedCoffee = items.find(i => i.name.toLowerCase().includes('iced americano') || i.name.toLowerCase().includes('latte'));
    if (icedCoffee) return icedCoffee;
  }

  // 3. Keyword matching across name & description
  const words = clean.split(/\s+/).filter(w => w.length > 2);
  if (words.length > 0) {
    for (const item of items) {
      const target = `${item.name} ${item.description || ''}`.toLowerCase();
      if (words.every(w => target.includes(w))) {
        return item;
      }
    }
    for (const item of items) {
      const target = `${item.name} ${item.description || ''}`.toLowerCase();
      if (words.some(w => target.includes(w))) {
        return item;
      }
    }
  }

  return null;
}

function parseTagalogNumber(word) {
  const w = (word || '').toLowerCase();
  if (/^(\d+)$/.test(w)) return parseInt(w, 10);
  if (/^(isa|isang|one|single|1x)$/.test(w)) return 1;
  if (/^(dalawa|dalawang|two|pair|double|2x)$/.test(w)) return 2;
  if (/^(tatlo|tatlong|three|triple|3x)$/.test(w)) return 3;
  if (/^(apat|apat na|four|4x)$/.test(w)) return 4;
  if (/^(lima|limang|five|5x)$/.test(w)) return 5;
  return null;
}

async function extractMultipleItemsFromText(text) {
  const clean = text.toLowerCase()
    .replace(/^(pa\s*order|pabili|order|buy|i\s*want|give\s*me|padeliver|can\s*i\s*get|please|pwede\s*ba\s*order)\s*(ng|nang|of)?/i, '')
    .trim();

  const segments = clean.split(/\s*(?:and|at|tapos|tsaka|plus|,|&|\+)\s*/i);
  const foundItems = [];

  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;

    const qtyMatch = trimmed.match(/^(\d+|isa|isang|dalawa|dalawang|tatlo|tatlong|apat|lima|one|two|three|four|five)\s*(?:pcs|pieces|orders|order|cups|cup|serving|servings|x)?\s+(.+)$/i);
    let qty = 1;
    let queryPart = trimmed;

    if (qtyMatch) {
      const parsedQty = parseTagalogNumber(qtyMatch[1]);
      if (parsedQty && parsedQty > 0) {
        qty = parsedQty;
        queryPart = qtyMatch[2];
      }
    } else {
      const trailingMatch = trimmed.match(/^(.+?)\s+(\d+)$/i);
      if (trailingMatch) {
        qty = parseInt(trailingMatch[2], 10);
        queryPart = trailingMatch[1];
      }
    }

    const matched = await findMenuItemByName(queryPart);
    if (matched) {
      const existing = foundItems.find(f => f.item.id === matched.id);
      if (existing) {
        existing.quantity += qty;
      } else {
        foundItems.push({ item: matched, quantity: qty });
      }
    }
  }

  return foundItems;
}

async function handleMultiItemOrder(psid, session, itemsToAdd) {
  if (!itemsToAdd || itemsToAdd.length === 0) return false;

  let addedSummary = '';
  let runningSubtotal = 0;

  for (const entry of itemsToAdd) {
    const { item, quantity } = entry;
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
    const itemSub = parseFloat(item.price) * quantity;
    addedSummary += `• ${quantity}x "${item.name}" (₱${itemSub.toFixed(2)})\n`;
  }

  session.cart.forEach(c => {
    runningSubtotal += c.price * c.quantity;
  });

  session.state = 'IDLE';
  session.pendingItem = null;
  await saveSession(session);

  const replyText = `✅ Added to your cart:\n${addedSummary}\n🛒 Current Cart Total: ₱${runningSubtotal.toFixed(2)}\n\nWhat would you like to do next?`;
  const quickReplies = [
    { title: '🛒 View Cart & Checkout', payload: 'VIEW_CART' },
    { title: '🛵 Deliver Order', payload: 'CHECKOUT_DELIVERY' },
    { title: '➕ Add More Items', payload: 'MENU_HOME' },
    { title: '🗑️ Clear Cart', payload: 'CLEAR_CART' }
  ];

  await sendQuickReplies(psid, replyText, quickReplies);
  return true;
}

async function handleRemoveCartItem(psid, session, text = '', payload = '') {
  if (!session.cart || session.cart.length === 0) {
    const emptyReply = '🛒 Your cart is currently empty! There are no items to remove.';
    await sendQuickReplies(psid, emptyReply, [{ title: '☕ Browse Menu', payload: 'MENU_HOME' }]);
    return true;
  }

  // 1. Direct Payload Handling (e.g. REMOVE_ITEM_1)
  if (payload && payload.startsWith('REMOVE_ITEM_')) {
    const menuItemId = parseInt(payload.replace('REMOVE_ITEM_', ''), 10);
    const itemIndex = session.cart.findIndex(c => c.menuItemId === menuItemId);
    if (itemIndex >= 0) {
      const removedItem = session.cart[itemIndex];
      session.cart.splice(itemIndex, 1);
      await saveSession(session);
      return sendCartUpdateAfterRemoval(psid, session, `🗑️ Removed "${removedItem.name}" from your cart.`);
    }
  }

  const lower = text.toLowerCase().trim();

  // If user just says "remove item", prompt with buttons
  if (lower === '' || lower === 'remove' || lower === 'remove item' || lower === 'bawas' || lower === 'tanggalin') {
    const promptText = `Which item would you like to remove from your cart?`;
    const itemButtons = session.cart.map(c => ({
      title: `❌ ${c.name.substring(0, 15)}`,
      payload: `REMOVE_ITEM_${c.menuItemId}`
    }));
    itemButtons.push({ title: '🛒 Keep Cart', payload: 'VIEW_CART' });
    await sendQuickReplies(psid, promptText, itemButtons);
    return true;
  }

  // 2. Check for quantity or ordinal removal (e.g. "remove 1 order on the cart", "remove 1 order in the cart", "remove 1 item")
  let removeQty = 1;
  const qtyMatch = lower.match(/\b(\d+|isa|isang|dalawa|dalawang|tatlo|tatlong|one|two|three)\b/);
  if (qtyMatch) {
    const parsed = parseTagalogNumber(qtyMatch[1]);
    if (parsed && parsed > 0) removeQty = parsed;
  }

  // Clean the text to find item name
  const cleanItemQuery = lower
    .replace(/(?:on|in|from|to|into|sa)\s+(?:the\s+)?(?:cart|basket|order|bag|list)/gi, ' ')
    .replace(/\b(?:cart|basket)\b/gi, ' ')
    .replace(/\b(?:can\s+you|could\s+you|please|paki|pakisuyo|pwede|pakiusap|mo|ba|nga|naman|po|yung|ang|nang|ng|sa|mga|the|of|a|an)\b/gi, ' ')
    .replace(/\b(?:remove|delete|cancel|tanggalin|bawasan|bawas|minus|alisin|tanggal|alisan)\b/gi, ' ')
    .replace(/\b(?:order|orders|item|items|pieces|pcs|cup|cups|serving|servings|x|na|sa)\b/gi, ' ')
    .replace(/\b(?:one|two|three|four|five|isa|isang|dalawa|dalawang|tatlo|tatlong|apat|lima|\d+)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let matchedIndex = -1;
  if (cleanItemQuery.length > 0) {
    matchedIndex = session.cart.findIndex(c => {
      const cName = c.name.toLowerCase();
      return cName.includes(cleanItemQuery) || cleanItemQuery.includes(cName);
    });
  }

  // Check by index number (e.g., "item 1", "first item", or if only 1 item exists in cart)
  if (matchedIndex === -1) {
    const indexMatch = lower.match(/(?:item|order)\s*#?(\d+)/i);
    if (indexMatch) {
      const idx = parseInt(indexMatch[1], 10) - 1;
      if (idx >= 0 && idx < session.cart.length) {
        matchedIndex = idx;
      }
    }
  }

  // If there's only 1 item in the cart and the user asks to remove 1 order / item
  if (matchedIndex === -1 && session.cart.length === 1) {
    matchedIndex = 0;
  }

  if (matchedIndex >= 0) {
    const item = session.cart[matchedIndex];
    if (item.quantity > removeQty) {
      item.quantity -= removeQty;
      await saveSession(session);
      return sendCartUpdateAfterRemoval(psid, session, `➖ Reduced ${removeQty}x "${item.name}". Remaining: ${item.quantity} in your cart.`);
    } else {
      session.cart.splice(matchedIndex, 1);
      await saveSession(session);
      return sendCartUpdateAfterRemoval(psid, session, `🗑️ Removed "${item.name}" from your cart.`);
    }
  }

  // If multiple items and item couldn't be unambiguously matched, ask via buttons
  const promptText = `Which item would you like to remove from your cart?`;
  const itemButtons = session.cart.map(c => ({
    title: `❌ ${c.name.substring(0, 15)}`,
    payload: `REMOVE_ITEM_${c.menuItemId}`
  }));
  itemButtons.push({ title: '🛒 Keep Cart', payload: 'VIEW_CART' });

  await sendQuickReplies(psid, promptText, itemButtons);
  return true;
}

async function sendCartUpdateAfterRemoval(psid, session, headerMessage) {
  if (!session.cart || session.cart.length === 0) {
    const text = `${headerMessage}\n\n🛒 Your cart is now completely empty! Would you like to check out our menu?`;
    const quickReplies = [
      { title: '☕ Browse Menu', payload: 'MENU_HOME' },
      { title: '⭐ Best Sellers', payload: 'MENU_HOME' }
    ];
    await sendQuickReplies(psid, text, quickReplies);
    return true;
  }

  let runningSubtotal = 0;
  let summary = '';
  session.cart.forEach((c, idx) => {
    const itemSub = c.price * c.quantity;
    runningSubtotal += itemSub;
    summary += `${idx + 1}. ${c.name} (${c.quantity}x) = ₱${itemSub.toFixed(2)}\n`;
  });

  const text = `${headerMessage}\n\n🛒 UPDATED CART:\n${summary}------------------------------\nSubtotal: ₱${runningSubtotal.toFixed(2)}`;
  const quickReplies = [
    { title: '🛒 View Cart & Checkout', payload: 'VIEW_CART' },
    { title: '🛵 Deliver Order', payload: 'CHECKOUT_DELIVERY' },
    { title: '❌ Remove Another', payload: 'PROMPT_REMOVE_ITEM' },
    { title: '➕ Add More Items', payload: 'MENU_HOME' },
    { title: '🗑️ Clear Cart', payload: 'CLEAR_CART' }
  ];

  await sendQuickReplies(psid, text, quickReplies);
  return true;
}

async function handleFaqAndBanter(psid, text) {
  const lower = text.toLowerCase();

  // 1. Wi-Fi Inquiries
  if (/(wifi|internet|connection|pass|password)/i.test(lower)) {
    const reply = `📶 Yes po! We have high-speed complimentary Wi-Fi for all our cafe guests at ${config.store.name}. Feel free to study, work, or relax while enjoying your favorite coffee! ☕💻`;
    const quickReplies = [
      { title: '☕ Browse Menu', payload: 'MENU_HOME' },
      { title: '🛒 View Cart', payload: 'VIEW_CART' },
      { title: 'ℹ️ Store Info', payload: 'STORE_INFO' }
    ];
    await sendQuickReplies(psid, reply, quickReplies);
    return true;
  }

  // 2. Recommendations / Best Sellers / Cravings
  if (/(ano|anong|what)\s*(ang|yung)?\s*(masarap|best|bestseller|best\s*seller|reco|recommend|specialty|patok)/i.test(lower) || /^(recommend|reco|best\s*seller|bestseller|masarap)$/i.test(lower) || /(gutom|hungry|food reco|craving|meron kayo)/i.test(lower)) {
    const reply = `🌟 Here are our top customer favorites at Diner's Cafe!

☕ MUST-TRY COFFEE & DRINKS:
• Signature Spanish Latte (₱145.00) - Sweet & velvety double espresso
• Caramel Macchiato (₱150.00) - Fresh steamed milk & caramel drizzle
• Iced Americano (₱110.00) - Crisp & bold espresso on ice

🍝 FAVORITE MEALS & BITES:
• Creamy Truffle Bacon Carbonara (₱220.00) - Rich parmesan truffle pasta
• Classic Beef Tapa Rice Bowl (₱195.00) - Tender sirloin with garlic rice & egg
• Almond Butter Croissant (₱95.00) - Flaky French pastry

Which one would you like to taste today?`;

    const quickReplies = [
      { title: '☕ Spanish Latte', payload: 'ADD_ITEM_1' },
      { title: '🍝 Truffle Carbonara', payload: 'ADD_ITEM_7' },
      { title: '🍳 Beef Tapa Bowl', payload: 'ADD_ITEM_6' },
      { title: '📖 Browse Full Menu', payload: 'MENU_HOME' }
    ];
    await sendQuickReplies(psid, reply, quickReplies);
    return true;
  }

  // 3. Payment Inquiries
  if (/(payment|bayad|gcash|cod|cash on delivery|credit card|card|cash)/i.test(lower) && /(pwede|accept|tanggap|options|how to pay|how do i pay)/i.test(lower)) {
    const reply = `💳 We accept two hassle-free payment options:
1. 💵 Cash on Delivery (COD) / Cash on Pickup
2. 📱 GCash Instant Transfer (${config.store.gcashNumber} - ${config.store.gcashName})

You can choose your preferred payment method right during checkout!`;
    const quickReplies = [
      { title: '☕ Browse Menu', payload: 'MENU_HOME' },
      { title: '🛒 View Cart', payload: 'VIEW_CART' }
    ];
    await sendQuickReplies(psid, reply, quickReplies);
    return true;
  }

  // 4. Delivery Distance & Rules
  if (/(hanggang saan|saan abot|delivery range|delivery fee|fare|radius|how far|deliver ba kayo)/i.test(lower)) {
    const reply = `🛵 We offer fast internal delivery within a 3.0 km radius from the cafe!

• Motorcycle & Eco-Bicycle couriers
• Smart weather-adjusted fair rates starting at ₱35 (Bicycle) / ₱49 (Motorcycle)
• Average delivery time: 15–25 minutes!`;
    const quickReplies = [
      { title: '☕ Order Now', payload: 'MENU_HOME' },
      { title: 'ℹ️ Store Info', payload: 'STORE_INFO' }
    ];
    await sendQuickReplies(psid, reply, quickReplies);
    return true;
  }

  // 5. Friendly Persona & Jokes
  if (/(joke|joke ka|patawa|funny|make me laugh)/i.test(lower)) {
    const jokes = [
      "Bakit masarap ang kape sa umaga? Kasi may 'latte'-r in life! ☕😄",
      "Anong sabi ng espresso sa milk? You make me whole-milk! 🥛❤️",
      "Bakit malamig ang iced coffee? Kasi ice-olang niya ang init ng ulo mo! 🧊😆"
    ];
    const joke = jokes[Math.floor(Math.random() * jokes.length)];
    const reply = `☕ Here's a coffee joke for you:\n\n${joke}\n\nReady for some real handcrafted coffee or delicious food?`;
    await sendQuickReplies(psid, reply, [{ title: '☕ Browse Menu', payload: 'MENU_HOME' }, { title: '🛒 View Cart', payload: 'VIEW_CART' }]);
    return true;
  }

  if (/(who are you|sino ka|bot ka ba|are you a bot|are you real|are you human|ano pangalan mo)/i.test(lower)) {
    const reply = `👋 Hi! I'm Barista Dan, the smart AI assistant of Diner's Cafe! ☕\n\nI can take your orders, recommend bestsellers, calculate delivery fares, and make sure your coffee cravings are satisfied. How can I help you today?`;
    await sendQuickReplies(psid, reply, [{ title: '☕ Browse Menu', payload: 'MENU_HOME' }, { title: '⭐ Best Sellers', payload: 'MENU_HOME' }]);
    return true;
  }

  return false;
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
