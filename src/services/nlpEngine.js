/**
 * Conversational AI & NLP Intent Engine (Conversation Flow v2)
 * Implements full conversational state machine, whole menu carousel without category gate,
 * customer details collection before payment, order breakdown with delivery fee,
 * automatic post-delivery feedback, short reply understanding, and cart item removal.
 */

const db = require('../../database/db');
const config = require('../config/config');
const { createOrder } = require('./orderService');
const {
  sendTextMessage,
  sendQuickReplies,
  sendGenericTemplate
} = require('./messengerService');
const notificationService = require('./notificationService');
const { queryWitAi, localNluParse } = require('./witAiService');
const { getSession, saveSession, clearSessionCart } = require('./sessionManager');
const { botMessages, LABELS } = require('./botMessages');
const {
  normalize,
  classifyShort,
  parseQuantity,
  matchItems,
  validateName,
  normalizePhone,
  validateAddress,
  peso
} = require('./textMatch');
const { quoteForAddress, FALLBACK_KM } = require('./deliveryFeeAdapter');
const {
  addToCart,
  removeFromCart,
  getCartRemoveButtons,
  calculateCartSubtotal,
  priceCart
} = require('./cartService');

const MENU_MAX_ITEMS = parseInt(process.env.MENU_MAX_ITEMS, 10) || 50;
const NLP_STATE_TTL_MIN = parseInt(process.env.NLP_STATE_TTL_MIN, 10) || 30;

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
 * Report macro lifecycle state (idle | ordering | awaiting_checkout | order_placed | awaiting_feedback)
 * @param {Object} session 
 * @returns {string}
 */
function macroState(session) {
  if (!session) return 'idle';
  const state = session.state || 'IDLE';

  if (session.pendingRating || state === 'AWAITING_FEEDBACK_COMMENT') {
    return 'awaiting_feedback';
  }
  if ([
    'AWAITING_CHECKOUT_CONFIRM',
    'AWAITING_ORDER_TYPE',
    'AWAITING_DETAILS_REUSE',
    'AWAITING_NAME',
    'AWAITING_ADDRESS',
    'AWAITING_PHONE',
    'AWAITING_DETAILS_CONFIRM',
    'AWAITING_EDIT_FIELD',
    'AWAITING_PAYMENT',
    'AWAITING_GCASH_AMOUNT'
  ].includes(state)) {
    return 'awaiting_checkout';
  }
  if ([
    'BROWSING',
    'ADDING_ITEM',
    'AWAITING_REMOVE_ITEM',
    'AWAITING_CLEAR_CONFIRM'
  ].includes(state) || (session.cart && session.cart.length > 0)) {
    return 'ordering';
  }
  if (session.activeOrderNumber && (!session.cart || session.cart.length === 0)) {
    return 'order_placed';
  }
  return 'idle';
}

/**
 * Expire stale waiting state after NLP_STATE_TTL_MIN minutes of inactivity (Decision 4)
 * @param {Object} session 
 */
function expireStaleState(session) {
  if (!session) return;
  const now = Date.now();
  const lastTime = session.lastInteraction || now;
  const elapsedMin = (now - lastTime) / (60 * 1000);

  if (elapsedMin > NLP_STATE_TTL_MIN && session.state !== 'IDLE') {
    session.state = 'IDLE';
    session.pendingItem = null;
    session.pendingAction = null;
    session.failedAttempts = 0;
  }
}

/**
 * Main Message & Event Handler for Facebook Messenger Webhook & Simulator
 */
async function handleMessageEvent(psid, incomingText = '', payload = null, location = null) {
  const session = await getSession(psid);
  const text = (incomingText || '').trim();
  const eventPayload = (payload || '').trim();

  // Expire waiting state if stale
  expireStaleState(session);
  session.lastInteraction = Date.now();

  let detectedIntent = 'UNKNOWN';
  let confidence = 1.0;
  let botReplyLog = '';

  try {
    // 0. Handle Location Pin if shared
    if (location && location.lat !== undefined && location.lng !== undefined) {
      detectedIntent = 'LOCATION_INPUT';
      await handleLocationPin(psid, session, location);
      return;
    }

    // Chatbot Pause / Maintenance check
    if (!isChatbotActive) {
      detectedIntent = 'CHATBOT_OFFLINE';
      botReplyLog = 'Chatbot paused message sent.';
      await sendQuickReplies(
        psid,
        `Our automated assistant is temporarily paused by cafe staff. Please call ${config.store.phone} for assistance.`,
        [{ title: 'Store Info', payload: 'STORE_INFO' }]
      );
      return;
    }

    // 1. Handle Postback & Button Payloads (Decision 1a)
    if (eventPayload) {
      detectedIntent = `PAYLOAD_${eventPayload}`;
      await handlePayload(psid, session, eventPayload);
      return;
    }

    // 2. Handle Text Input (Decision 1b, 1c, 1d, and Wit.ai)
    const result = await handleTextInput(psid, session, text);
    if (result) {
      detectedIntent = result.intent || detectedIntent;
      confidence = result.confidence !== undefined ? result.confidence : confidence;
      botReplyLog = result.replyLog || '';
    }

  } catch (err) {
    console.error('[NLP Engine Error]', err);
    const fb = botMessages.fallback();
    await sendQuickReplies(psid, fb.text, fb.quickReplies);
  } finally {
    try {
      await saveSession(session);
      await db.query(
        `INSERT INTO chatbot_logs (customer_id, psid, incoming_message, detected_intent, confidence, bot_response)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [session.customerId || null, psid, text || eventPayload, detectedIntent, confidence, botReplyLog || 'Sent']
      );
    } catch (e) {
      // Ignore log insertion errors
    }
  }
}

/**
 * Handle Button & Postback Payloads (Decision 1a & Task 5-9)
 */
async function handlePayload(psid, session, payload) {
  // Hard session reset (used by simulator)
  if (payload === 'RESET_SESSION') {
    session.cart = [];
    session.state = 'IDLE';
    session.pendingItem = null;
    session.pendingAction = null;
    session.details = null;
    session.quote = null;
    session.checkout = null;
    session.activeOrderNumber = null;
    session.pendingRating = null;
    session.pendingFeedbackOrderId = null;
    session.pendingFeedbackOrderNumber = null;
    session.failedAttempts = 0;
    await saveSession(session);
    const msg = botMessages.cleared();
    await sendQuickReplies(psid, msg.text, msg.quickReplies);
    return;
  }

  // Welcome / Menu entry
  if (payload === 'GET_STARTED') {
    const welcome = botMessages.welcome();
    await sendQuickReplies(psid, welcome.text, welcome.quickReplies);
    return;
  }

  if (payload === 'MENU_HOME') {
    await sendFullMenu(psid, session);
    return;
  }

  // View Cart
  if (payload === 'VIEW_CART') {
    await renderCartSummary(psid, session);
    return;
  }

  // Start Checkout
  if (payload === 'CONFIRM_CHECKOUT') {
    await startCheckoutFlow(psid, session);
    return;
  }

  // Keep Shopping
  if (payload === 'KEEP_SHOPPING') {
    session.state = 'BROWSING';
    const outro = botMessages.menuOutro(session.cart && session.cart.length > 0);
    await sendQuickReplies(psid, outro.text, outro.quickReplies);
    return;
  }

  // Checkout order type selection
  if (payload === 'CHECKOUT_DELIVERY') {
    session.orderType = 'delivery';
    await proceedAfterOrderType(psid, session);
    return;
  }

  if (payload === 'CHECKOUT_PICKUP') {
    session.orderType = 'pickup';
    await proceedAfterOrderType(psid, session);
    return;
  }

  // Saved details reuse
  if (payload === 'USE_SAVED_DETAILS') {
    await handleSavedDetailsConfirmation(psid, session);
    return;
  }

  if (payload === 'CHANGE_DETAILS') {
    session.details = null;
    session.state = 'AWAITING_NAME';
    const askN = botMessages.askName();
    await sendQuickReplies(psid, askN.text, askN.quickReplies);
    return;
  }

  // Summary confirmation
  if (payload === 'CONFIRM_DETAILS') {
    await handleConfirmDetails(psid, session);
    return;
  }

  // Edit details
  if (payload === 'EDIT_DETAILS') {
    session.state = 'AWAITING_EDIT_FIELD';
    const editMsg = botMessages.editWhat(session.orderType === 'delivery');
    await sendQuickReplies(psid, editMsg.text, editMsg.quickReplies);
    return;
  }

  if (payload === 'EDIT_NAME') {
    session.editingField = 'name';
    session.state = 'AWAITING_NAME';
    const askN = botMessages.askName();
    await sendQuickReplies(psid, askN.text, askN.quickReplies);
    return;
  }

  if (payload === 'EDIT_ADDRESS') {
    if (session.orderType === 'delivery') {
      session.editingField = 'address';
      session.state = 'AWAITING_ADDRESS';
      const askA = botMessages.askAddress();
      await sendQuickReplies(psid, askA.text, askA.quickReplies);
    } else {
      await showOrderSummary(psid, session);
    }
    return;
  }

  if (payload === 'EDIT_PHONE') {
    session.editingField = 'phone';
    session.state = 'AWAITING_PHONE';
    const askP = botMessages.askPhone();
    await sendQuickReplies(psid, askP.text, askP.quickReplies);
    return;
  }

  if (payload === 'BACK_TO_SUMMARY') {
    await showOrderSummary(psid, session);
    return;
  }

  if (payload === 'BACK_TO_CART') {
    await renderCartSummary(psid, session);
    return;
  }

  // Payment selection
  if (payload === 'PAY_CASH') {
    await placeCustomerOrder(psid, session, 'cash');
    return;
  }

  if (payload === 'PAY_GCASH') {
    await initiateGCashPayment(psid, session);
    return;
  }

  // Add Item postback
  if (payload.startsWith('ADD_ITEM_')) {
    const menuItemId = parseInt(payload.replace('ADD_ITEM_', ''), 10);
    await handleAddItemPayload(psid, session, menuItemId);
    return;
  }

  // Quantity postback
  if (payload.startsWith('QTY_')) {
    const qty = parseInt(payload.replace('QTY_', ''), 10);
    await handleQuantitySelection(psid, session, qty);
    return;
  }

  // Remove Item
  if (payload === 'REMOVE_ITEM') {
    await promptRemoveItem(psid, session);
    return;
  }

  if (payload.startsWith('REMOVE_ITEM_')) {
    const menuItemId = parseInt(payload.replace('REMOVE_ITEM_', ''), 10);
    await handleRemoveItemById(psid, session, menuItemId, null);
    return;
  }

  // Clear Cart
  if (payload === 'CLEAR_CART') {
    if (!session.cart || session.cart.length === 0) {
      const empty = botMessages.cartEmpty();
      await sendQuickReplies(psid, empty.text, empty.quickReplies);
      return;
    }
    session.state = 'AWAITING_CLEAR_CONFIRM';
    const askClear = botMessages.clearAsk();
    await sendQuickReplies(psid, askClear.text, askClear.quickReplies);
    return;
  }

  if (payload === 'CLEAR_CART_YES') {
    session.cart = [];
    session.state = 'IDLE';
    const cleared = botMessages.cleared();
    await sendQuickReplies(psid, cleared.text, cleared.quickReplies);
    return;
  }

  // Feedback Rating: FEEDBACK_RATE_<n>_<orderNumber>
  if (payload.startsWith('FEEDBACK_RATE_')) {
    const parts = payload.split('_');
    const rating = parseInt(parts[2], 10);
    const orderNumber = parts.slice(3).join('_');
    await handleFeedbackRating(psid, session, rating, orderNumber);
    return;
  }

  // Feedback Skip: FEEDBACK_SKIP_<orderNumber>
  if (payload.startsWith('FEEDBACK_SKIP')) {
    const parts = payload.split('_');
    const orderNumber = parts[2] || session.pendingFeedbackOrderNumber;
    await handleFeedbackSkip(psid, session, orderNumber);
    return;
  }

  // Order tracking
  if (payload === 'TRACK_LATEST_ORDER') {
    await handleTrackOrder(psid, session);
    return;
  }

  // Store info
  if (payload === 'STORE_INFO') {
    const info = botMessages.agent(config.store.phone, config.store.hours);
    await sendQuickReplies(psid, info.text, info.quickReplies);
    return;
  }

  // Category browse backward compatibility
  if (payload.startsWith('CATEGORY_')) {
    session.state = 'BROWSING';
    await sendFullMenu(psid, session);
    return;
  }

  // Fallback for unknown / stale buttons
  const stale = botMessages.staleButton();
  await sendQuickReplies(psid, stale.text, stale.quickReplies);
}

/**
 * Handle Free Text Messages in Strict Priority Order (Decision 1)
 */
async function handleTextInput(psid, session, rawText) {
  const norm = normalize(rawText);

  // 1. States expecting free text (Decision 1b)
  if (session.state === 'AWAITING_FEEDBACK_COMMENT') {
    return handleFeedbackComment(psid, session, rawText);
  }

  if (session.state === 'AWAITING_GCASH_AMOUNT') {
    return handleGCashAmountInput(psid, session, rawText);
  }

  if (session.state === 'ADDING_ITEM') {
    const qty = parseQuantity(rawText);
    if (qty !== null) {
      await handleQuantitySelection(psid, session, qty);
      return { intent: 'SET_QUANTITY', confidence: 1.0 };
    }
  }

  // Details flow states: check for interruption words (cancel, back, stop, menu, cart, track, hi)
  const isDetailsState = [
    'AWAITING_NAME',
    'AWAITING_ADDRESS',
    'AWAITING_PHONE',
    'AWAITING_EDIT_FIELD',
    'AWAITING_PAYMENT'
  ].includes(session.state);

  if (isDetailsState) {
    if (['cancel', 'back', 'stop'].includes(norm)) {
      // Exit flow, details entered so far stay in session.details (Section 5.2)
      session.state = 'AWAITING_CHECKOUT_CONFIRM';
      const kept = botMessages.keptCart();
      await sendQuickReplies(psid, kept.text, kept.quickReplies);
      return { intent: 'CANCEL_CHECKOUT', confidence: 1.0 };
    }

    if (['menu', 'order', 'cart', 'track', 'hi', 'hello'].includes(norm)) {
      // Shortcut interrupts details flow (Section 5.2)
      session.state = 'IDLE';
      // Hand off to shortcut handler below
    } else {
      if (session.state === 'AWAITING_NAME') {
        return handleNameInput(psid, session, rawText);
      }
      if (session.state === 'AWAITING_ADDRESS') {
        return handleAddressInput(psid, session, rawText);
      }
      if (session.state === 'AWAITING_PHONE') {
        return handlePhoneInput(psid, session, rawText);
      }
      if (session.state === 'AWAITING_PAYMENT') {
        if (norm === 'cash' || norm === 'cod') {
          await placeCustomerOrder(psid, session, 'cash');
          return { intent: 'PAY_CASH', confidence: 1.0 };
        }
        if (norm === 'gcash') {
          await initiateGCashPayment(psid, session);
          return { intent: 'PAY_GCASH', confidence: 1.0 };
        }
      }
    }
  }

  // 2. Open Yes/No question states (Decision 1c)
  const openQuestionStates = [
    'AWAITING_CHECKOUT_CONFIRM',
    'AWAITING_CLEAR_CONFIRM',
    'AWAITING_DETAILS_REUSE',
    'AWAITING_DETAILS_CONFIRM',
    'AWAITING_REMOVE_ITEM',
    'AWAITING_ORDER_TYPE'
  ];

  if (openQuestionStates.includes(session.state)) {
    const classification = classifyShort(rawText);
    if (classification === 'YES') {
      return handleYesAnswer(psid, session);
    }
    if (classification === 'NO') {
      return handleNoAnswer(psid, session);
    }
    // classification === null: not a yes/no answer.
    // Reset open question state to IDLE/BROWSING and route normally (Decision 3).
    session.state = (session.cart && session.cart.length > 0) ? 'BROWSING' : 'IDLE';
  }

  // 3. Standalone Yes/No when no question is open
  const standaloneCheck = classifyShort(rawText);
  if (standaloneCheck === 'YES') {
    const yesMsg = botMessages.yesToWhat();
    const hasCart = session.cart && session.cart.length > 0;
    const qrs = [
      { title: 'Yes, checkout', payload: 'CONFIRM_CHECKOUT' },
      hasCart ? { title: 'Add more', payload: 'KEEP_SHOPPING' } : { title: '☕ Menu', payload: 'MENU_HOME' }
    ];
    await sendQuickReplies(psid, yesMsg.text, qrs);
    return { intent: 'STANDALONE_YES', confidence: 1.0 };
  }
  if (standaloneCheck === 'NO') {
    const kept = botMessages.keptCart();
    await sendQuickReplies(psid, kept.text, kept.quickReplies);
    return { intent: 'STANDALONE_NO', confidence: 1.0 };
  }

  // 4. Shortcut words (Decision 1d)
  if (['menu', 'order', 'browse', 'show menu', 'show me the menu', 'what do you have', 'what s available'].includes(norm)) {
    await sendFullMenu(psid, session);
    return { intent: 'BROWSE_MENU', confidence: 1.0 };
  }

  if (['cart', 'my cart', 'view cart', 'show cart', 'whats in my cart'].includes(norm)) {
    await renderCartSummary(psid, session);
    return { intent: 'VIEW_CART', confidence: 1.0 };
  }

  if (['checkout', 'check out', 'pay now', 'im done', 'thats all'].includes(norm)) {
    await startCheckoutFlow(psid, session);
    return { intent: 'CHECKOUT', confidence: 1.0 };
  }

  if (['track', 'track order', 'where is my order', 'status'].includes(norm)) {
    await handleTrackOrder(psid, session);
    return { intent: 'TRACK_ORDER', confidence: 1.0 };
  }

  if (['hi', 'hello', 'hey', 'good morning', 'kumusta'].includes(norm)) {
    const welcome = botMessages.welcome();
    await sendQuickReplies(psid, welcome.text, welcome.quickReplies);
    return { intent: 'GREETING', confidence: 1.0 };
  }

  if (['hours', 'info', 'where are you located', 'location', 'wifi'].includes(norm)) {
    const info = botMessages.agent(config.store.phone, config.store.hours);
    await sendQuickReplies(psid, info.text, info.quickReplies);
    return { intent: 'STORE_INFO', confidence: 1.0 };
  }

  if (['talk to staff', 'human', 'agent', 'real person', 'customer service', 'help'].includes(norm)) {
    const agentMsg = botMessages.agent(config.store.phone, config.store.hours);
    await sendQuickReplies(psid, agentMsg.text, agentMsg.quickReplies);
    return { intent: 'REQUEST_AGENT', confidence: 1.0 };
  }

  // Bare "cancel" with nothing open (Decision 6)
  if (norm === 'cancel') {
    if (session.cart && session.cart.length > 0) {
      await promptRemoveItem(psid, session);
      return { intent: 'REMOVE_ITEM', confidence: 1.0 };
    }
    if (session.activeOrderNumber) {
      await sendTextMessage(psid, `To cancel placed order #${session.activeOrderNumber}, please call the cafe at ${config.store.phone}.`);
      return { intent: 'CANCEL_PLACED_ORDER', confidence: 1.0 };
    }
    await sendTextMessage(psid, 'Nothing to cancel.');
    return { intent: 'CANCEL_EMPTY', confidence: 1.0 };
  }

  // 5. Query Wit.ai NLU for what remains
  const nlu = await queryWitAi(rawText);
  const intent = nlu.intent;
  const conf = nlu.confidence || 0;

  // Thresholds: act >= 0.80, confirm 0.55-0.80, fallback < 0.55 (Decision 8)
  if (conf < 0.55 && intent !== 'ORDER_ITEM' && intent !== 'REMOVE_ITEM') {
    const fb = botMessages.fallback();
    await sendQuickReplies(psid, fb.text, fb.quickReplies);
    return { intent: 'FALLBACK', confidence: conf };
  }

  if (intent === 'OUT_OF_SCOPE') {
    const oos = botMessages.outOfScope();
    await sendQuickReplies(psid, oos.text, oos.quickReplies);
    return { intent: 'OUT_OF_SCOPE', confidence: conf };
  }

  if (intent === 'REQUEST_AGENT') {
    const agentMsg = botMessages.agent(config.store.phone, config.store.hours);
    await sendQuickReplies(psid, agentMsg.text, agentMsg.quickReplies);
    return { intent: 'REQUEST_AGENT', confidence: conf };
  }

  if (intent === 'STORE_INFO') {
    const info = botMessages.agent(config.store.phone, config.store.hours);
    await sendQuickReplies(psid, info.text, info.quickReplies);
    return { intent: 'STORE_INFO', confidence: conf };
  }

  if (intent === 'TRACK_ORDER') {
    await handleTrackOrder(psid, session);
    return { intent: 'TRACK_ORDER', confidence: conf };
  }

  if (intent === 'VIEW_CART') {
    await renderCartSummary(psid, session);
    return { intent: 'VIEW_CART', confidence: conf };
  }

  if (intent === 'CLEAR_CART') {
    if (!session.cart || session.cart.length === 0) {
      const empty = botMessages.cartEmpty();
      await sendQuickReplies(psid, empty.text, empty.quickReplies);
      return { intent: 'CLEAR_CART', confidence: conf };
    }
    session.state = 'AWAITING_CLEAR_CONFIRM';
    const askClear = botMessages.clearAsk();
    await sendQuickReplies(psid, askClear.text, askClear.quickReplies);
    return { intent: 'CLEAR_CART', confidence: conf };
  }

  if (intent === 'CHECKOUT') {
    await startCheckoutFlow(psid, session);
    return { intent: 'CHECKOUT', confidence: conf };
  }

  if (intent === 'BROWSE_MENU') {
    await sendFullMenu(psid, session);
    return { intent: 'BROWSE_MENU', confidence: conf };
  }

  // REMOVE_ITEM intent
  if (intent === 'REMOVE_ITEM' || /^(?:remove|delete|alisin|tanggalin)\b/i.test(norm)) {
    return handleRemoveItemText(psid, session, rawText, nlu);
  }

  // ORDER_ITEM intent or item ordering by free text
  return handleOrderItemText(psid, session, rawText, nlu);
}

/**
 * Handle affirmative response for open yes/no question
 */
async function handleYesAnswer(psid, session) {
  const currentState = session.state;

  if (currentState === 'AWAITING_CHECKOUT_CONFIRM') {
    await startCheckoutFlow(psid, session);
    return { intent: 'CONFIRM_CHECKOUT_YES', confidence: 1.0 };
  }

  if (currentState === 'AWAITING_CLEAR_CONFIRM') {
    session.cart = [];
    session.state = 'IDLE';
    const cleared = botMessages.cleared();
    await sendQuickReplies(psid, cleared.text, cleared.quickReplies);
    return { intent: 'CLEAR_CART_YES', confidence: 1.0 };
  }

  if (currentState === 'AWAITING_DETAILS_REUSE') {
    await handleSavedDetailsConfirmation(psid, session);
    return { intent: 'USE_SAVED_DETAILS_YES', confidence: 1.0 };
  }

  if (currentState === 'AWAITING_DETAILS_CONFIRM') {
    await handleConfirmDetails(psid, session);
    return { intent: 'CONFIRM_DETAILS_YES', confidence: 1.0 };
  }

  if (currentState === 'AWAITING_REMOVE_ITEM') {
    await promptRemoveItem(psid, session);
    return { intent: 'REMOVE_ITEM_YES', confidence: 1.0 };
  }

  if (currentState === 'AWAITING_ORDER_TYPE') {
    session.orderType = 'delivery';
    await proceedAfterOrderType(psid, session);
    return { intent: 'ORDER_TYPE_YES', confidence: 1.0 };
  }

  return { intent: 'YES', confidence: 1.0 };
}

/**
 * Handle negative response for open yes/no question
 */
async function handleNoAnswer(psid, session) {
  const currentState = session.state;

  if (currentState === 'AWAITING_CHECKOUT_CONFIRM') {
    session.state = 'BROWSING';
    const kept = botMessages.keptCart();
    await sendQuickReplies(psid, kept.text, kept.quickReplies);
    return { intent: 'CONFIRM_CHECKOUT_NO', confidence: 1.0 };
  }

  if (currentState === 'AWAITING_CLEAR_CONFIRM') {
    session.state = 'BROWSING';
    const kept = botMessages.keptCart();
    await sendQuickReplies(psid, kept.text, kept.quickReplies);
    return { intent: 'CLEAR_CART_NO', confidence: 1.0 };
  }

  if (currentState === 'AWAITING_DETAILS_REUSE') {
    session.details = null;
    session.state = 'AWAITING_NAME';
    const askN = botMessages.askName();
    await sendQuickReplies(psid, askN.text, askN.quickReplies);
    return { intent: 'USE_SAVED_DETAILS_NO', confidence: 1.0 };
  }

  if (currentState === 'AWAITING_DETAILS_CONFIRM') {
    session.state = 'AWAITING_CHECKOUT_CONFIRM';
    await renderCartSummary(psid, session);
    return { intent: 'CONFIRM_DETAILS_NO', confidence: 1.0 };
  }

  if (currentState === 'AWAITING_REMOVE_ITEM') {
    session.state = 'AWAITING_CHECKOUT_CONFIRM';
    const kept = botMessages.keptCart();
    await sendQuickReplies(psid, kept.text, kept.quickReplies);
    return { intent: 'REMOVE_ITEM_NO', confidence: 1.0 };
  }

  if (currentState === 'AWAITING_ORDER_TYPE') {
    session.state = 'AWAITING_CHECKOUT_CONFIRM';
    await renderCartSummary(psid, session);
    return { intent: 'ORDER_TYPE_NO', confidence: 1.0 };
  }

  return { intent: 'NO', confidence: 1.0 };
}

/**
 * Task 5: Whole Menu immediately (R1)
 * One query for all available, in-stock items joined to active categories.
 * No category selector in main path.
 */
async function sendFullMenu(psid, session) {
  session.state = 'BROWSING';

  const [items] = await db.query(`
    SELECT m.id, m.name, m.description, m.price, m.image_url, m.is_bestseller,
           c.name AS category_name, c.display_order, i.stock_quantity, i.low_stock_threshold
    FROM menu_items m
    JOIN categories c ON c.id = m.category_id AND c.is_active = 1
    JOIN inventory i ON i.menu_item_id = m.id
    WHERE m.is_available = 1 AND i.stock_quantity > 0 AND COALESCE(m.is_deleted, 0) = 0
    ORDER BY c.display_order ASC, m.is_bestseller DESC, m.name ASC
  `);

  if (!items || items.length === 0) {
    await sendTextMessage(psid, "Our menu items are temporarily being restocked. Please check back shortly!");
    return;
  }

  // 1. Intro message
  const intro = botMessages.menuIntro();
  await sendTextMessage(psid, intro.text);

  // 2. Build cards and chunk into carousels of 10
  const displayedItems = items.slice(0, MENU_MAX_ITEMS);
  const elements = displayedItems.map(it => {
    const priceFormatted = peso(it.price);
    const title = `${it.name} · ${priceFormatted}`.substring(0, 80);

    let subtitle = `${it.category_name} · ${it.description || ''}`;
    if (it.stock_quantity <= it.low_stock_threshold) {
      subtitle += ` · Only ${it.stock_quantity} left`;
    }
    subtitle = subtitle.substring(0, 80);

    let imageUrl = it.image_url || 'https://images.unsplash.com/photo-1541167760496-1628856ab772?w=500&auto=format&fit=crop&q=60';
    if (imageUrl.startsWith('/')) {
      const base = (config.appUrl || '').replace(/\/$/, '');
      if (base) imageUrl = `${base}${imageUrl}`;
    }

    return {
      title,
      subtitle,
      image_url: imageUrl,
      buttons: [
        {
          type: 'postback',
          title: '➕ Add to order',
          payload: `ADD_ITEM_${it.id}`
        }
      ]
    };
  });

  const chunkSize = 10;
  for (let i = 0; i < elements.length; i += chunkSize) {
    const chunk = elements.slice(i, i + chunkSize);
    await sendGenericTemplate(psid, chunk);
  }

  if (items.length > MENU_MAX_ITEMS) {
    await sendTextMessage(psid, "Showing the first 50. Type an item name to order any item.");
  }

  // 3. Outro message with quick replies
  const hasCart = session.cart && session.cart.length > 0;
  const outro = botMessages.menuOutro(hasCart);
  await sendQuickReplies(psid, outro.text, outro.quickReplies);
}

/**
 * Backward compatibility category menu
 */
async function sendCategoryMenu(psid, slug) {
  const [items] = await db.query(`
    SELECT m.id, m.name, m.description, m.price, m.image_url, c.name as category_name
    FROM menu_items m
    JOIN categories c ON c.id = m.category_id
    JOIN inventory i ON i.menu_item_id = m.id
    WHERE c.slug = ? AND m.is_available = 1 AND i.stock_quantity > 0 AND COALESCE(m.is_deleted, 0) = 0
    ORDER BY m.is_bestseller DESC, m.name ASC
  `, [slug]);

  if (!items || items.length === 0) {
    await sendTextMessage(psid, "No items available in this category.");
    return;
  }

  const elements = items.slice(0, 10).map(it => {
    let imageUrl = it.image_url || 'https://images.unsplash.com/photo-1541167760496-1628856ab772?w=500&auto=format&fit=crop&q=60';
    if (imageUrl.startsWith('/')) {
      const base = (config.appUrl || '').replace(/\/$/, '');
      if (base) imageUrl = `${base}${imageUrl}`;
    }
    return {
      title: `${it.name} · ${peso(it.price)}`.substring(0, 80),
      subtitle: String(it.description || '').substring(0, 80),
      image_url: imageUrl,
      buttons: [{ type: 'postback', title: '➕ Add to order', payload: `ADD_ITEM_${it.id}` }]
    };
  });

  await sendGenericTemplate(psid, elements);
}

/**
 * Handle adding an item via button payload
 */
async function handleAddItemPayload(psid, session, menuItemId) {
  const [rows] = await db.query(
    `SELECT m.id, m.name, m.price, m.is_available, i.stock_quantity 
     FROM menu_items m JOIN inventory i ON i.menu_item_id = m.id 
     WHERE m.id = ?`,
    [menuItemId]
  );
  if (!rows || rows.length === 0 || rows[0].is_available !== 1 || rows[0].stock_quantity <= 0) {
    const outMsg = botMessages.outOfStock(rows[0]?.name || 'Item');
    await sendQuickReplies(psid, outMsg.text, outMsg.quickReplies);
    return;
  }

  const item = rows[0];
  session.state = 'ADDING_ITEM';
  session.pendingItem = { id: item.id, name: item.name, price: item.price };

  const ask = botMessages.askQty(item.name);
  await sendQuickReplies(psid, ask.text, ask.quickReplies);
}

/**
 * Handle quantity chosen for pending item
 */
async function handleQuantitySelection(psid, session, qty) {
  if (!session.pendingItem) {
    const empty = botMessages.cartEmpty();
    await sendQuickReplies(psid, empty.text, empty.quickReplies);
    return;
  }

  const quantity = Math.max(1, qty || 1);
  const item = session.pendingItem;

  // Add to cart
  if (!session.cart) session.cart = [];
  addToCart(session.cart, item, quantity);

  session.pendingItem = null;
  session.state = 'AWAITING_CHECKOUT_CONFIRM';

  const subtotal = calculateCartSubtotal(session.cart);
  const addedMsg = botMessages.added(quantity, item.name, peso(subtotal));
  await sendQuickReplies(psid, addedMsg.text, addedMsg.quickReplies);
}

/**
 * Handle free text item ordering
 */
async function handleOrderItemText(psid, session, rawText, nlu) {
  // Extract candidate query string
  const [candidates] = await db.query(`
    SELECT m.id, m.name, m.price, m.synonyms, m.is_available, i.stock_quantity
    FROM menu_items m
    JOIN inventory i ON i.menu_item_id = m.id
    WHERE m.is_available = 1 AND i.stock_quantity > 0
  `);

  let cleanQuery = (nlu.menuItem || rawText)
    .replace(/\b(?:i\s*want|can\s*i\s*get|order|add|one\s*more|another|isa\s*pang|dalawa\s*pang|gusto\s*ko\s*ng|pa-order\s*po\s*ng)\b/gi, '')
    .replace(/\b(?:the|a|an|po|please|pls|ang|yung|ng|sa)\b/gi, '')
    .replace(/\b\d+\s*(?:pcs|pieces|orders?|cups?|servings?|x)?\b/gi, '')
    .replace(/\b(?:one|two|three|four|five|six|seven|eight|nine|ten|isa|dalawa|tatlo|apat|lima|anim|pito|walo|siyam|sampu)\b/gi, '')
    .trim();
  if (!cleanQuery) cleanQuery = rawText;

  const matchResult = matchItems(cleanQuery, candidates);

  if (matchResult.status === 'accept') {
    const matchedItem = matchResult.matches[0];
    const qty = nlu.quantity || parseQuantity(rawText);

    if (qty !== null && qty > 0) {
      if (!session.cart) session.cart = [];
      addToCart(session.cart, matchedItem, qty);
      session.state = 'AWAITING_CHECKOUT_CONFIRM';
      const subtotal = calculateCartSubtotal(session.cart);
      const addedMsg = botMessages.added(qty, matchedItem.name, peso(subtotal));
      await sendQuickReplies(psid, addedMsg.text, addedMsg.quickReplies);
      return { intent: 'ORDER_ITEM', confidence: 1.0 };
    } else {
      session.state = 'ADDING_ITEM';
      session.pendingItem = { id: matchedItem.id, name: matchedItem.name, price: matchedItem.price };
      const ask = botMessages.askQty(matchedItem.name);
      await sendQuickReplies(psid, ask.text, ask.quickReplies);
      return { intent: 'ORDER_ITEM', confidence: 0.9 };
    }
  }

  if (matchResult.status === 'confirm') {
    const topCand = matchResult.matches[0];
    session.pendingItem = { id: topCand.id, name: topCand.name, price: topCand.price };
    session.state = 'ADDING_ITEM';
    const didYou = botMessages.didYouMean(topCand.name);
    await sendQuickReplies(psid, didYou.text, didYou.quickReplies);
    return { intent: 'ORDER_ITEM_CONFIRM', confidence: 0.7 };
  }

  if (matchResult.status === 'ambiguous') {
    const buttons = matchResult.matches.slice(0, 3).map(m => ({
      title: m.name.substring(0, 20),
      payload: `ADD_ITEM_${m.id}`
    }));
    buttons.push({ title: 'Cancel', payload: 'MENU_HOME' });
    await sendQuickReplies(psid, 'Which item did you mean?', buttons);
    return { intent: 'ORDER_ITEM_AMBIGUOUS', confidence: 0.6 };
  }

  // Fallback
  const fb = botMessages.fallback();
  await sendQuickReplies(psid, fb.text, fb.quickReplies);
  return { intent: 'FALLBACK', confidence: 0.3 };
}

/**
 * Task 8: Remove from cart (R6)
 */
async function promptRemoveItem(psid, session) {
  if (!session.cart || session.cart.length === 0) {
    const empty = botMessages.cartEmpty();
    await sendQuickReplies(psid, empty.text, empty.quickReplies);
    return;
  }

  session.state = 'AWAITING_REMOVE_ITEM';
  const removeMsg = botMessages.removeWhich(session.cart);
  await sendQuickReplies(psid, removeMsg.text, removeMsg.quickReplies);
}

async function handleRemoveItemById(psid, session, menuItemId, qty = null) {
  if (!session.cart || session.cart.length === 0) {
    const empty = botMessages.cartEmpty();
    await sendQuickReplies(psid, empty.text, empty.quickReplies);
    return;
  }

  const result = removeFromCart(session.cart, menuItemId, qty);
  if (!result) {
    const notIn = botMessages.notInCart('That item', session.cart);
    await sendQuickReplies(psid, notIn.text, notIn.quickReplies);
    return;
  }

  if (session.cart.length === 0) {
    session.state = 'IDLE';
    const remEmpty = botMessages.removedEmpty(result.removed, result.name);
    await sendQuickReplies(psid, remEmpty.text, remEmpty.quickReplies);
  } else {
    session.state = 'AWAITING_CHECKOUT_CONFIRM';
    const subtotal = calculateCartSubtotal(session.cart);
    const remMsg = botMessages.removed(result.removed, result.name, peso(subtotal));
    await sendQuickReplies(psid, remMsg.text, remMsg.quickReplies);
  }
}

async function handleRemoveItemText(psid, session, rawText, nlu) {
  if (!session.cart || session.cart.length === 0) {
    const empty = botMessages.cartEmpty();
    await sendQuickReplies(psid, empty.text, empty.quickReplies);
    return { intent: 'REMOVE_ITEM_EMPTY', confidence: 1.0 };
  }

  // If no specific item in text, ask which item
  const itemQuery = nlu.menuItem || rawText
    .replace(/\b(?:remove|delete|take\s*out|cancel\s*(?:the|my)?|alisin|tanggalin)\b/gi, '')
    .trim();

  if (!itemQuery || itemQuery.length < 3) {
    await promptRemoveItem(psid, session);
    return { intent: 'REMOVE_ITEM_PROMPT', confidence: 1.0 };
  }

  // Match ONLY against the cart
  const candidates = session.cart.map(c => ({
    id: c.menuItemId,
    name: c.name
  }));

  const matchRes = matchItems(itemQuery, candidates);
  const qty = nlu.quantity || parseQuantity(rawText);

  if (matchRes.status === 'accept') {
    const matched = matchRes.matches[0];
    await handleRemoveItemById(psid, session, matched.id, qty);
    return { intent: 'REMOVE_ITEM', confidence: 1.0 };
  }

  if (matchRes.status === 'confirm') {
    const matched = matchRes.matches[0];
    session.pendingItem = { id: matched.id, name: matched.name, qty };
    session.state = 'AWAITING_REMOVE_ITEM';
    const didYou = botMessages.didYouMean(`Remove ${matched.name}`);
    await sendQuickReplies(psid, didYou.text, didYou.quickReplies);
    return { intent: 'REMOVE_ITEM_CONFIRM', confidence: 0.7 };
  }

  if (matchRes.status === 'ambiguous') {
    const buttons = matchRes.matches.slice(0, 3).map(m => ({
      title: m.name.substring(0, 20),
      payload: `REMOVE_ITEM_${m.id}`
    }));
    buttons.push({ title: 'Cancel', payload: 'VIEW_CART' });
    await sendQuickReplies(psid, 'Which item would you like to remove?', buttons);
    return { intent: 'REMOVE_ITEM_AMBIGUOUS', confidence: 0.6 };
  }

  // Not in cart
  const notIn = botMessages.notInCart(itemQuery, session.cart);
  await sendQuickReplies(psid, notIn.text, notIn.quickReplies);
  return { intent: 'REMOVE_ITEM_NOT_FOUND', confidence: 0.5 };
}

/**
 * Render Cart Summary
 */
async function renderCartSummary(psid, session) {
  if (!session.cart || session.cart.length === 0) {
    const empty = botMessages.cartEmpty();
    await sendQuickReplies(psid, empty.text, empty.quickReplies);
    return;
  }

  const priceRes = await priceCart(session.cart);
  session.state = 'AWAITING_CHECKOUT_CONFIRM';

  const cartMsg = botMessages.cart(priceRes.lines, priceRes.subtotalFormatted);
  await sendQuickReplies(psid, cartMsg.text, cartMsg.quickReplies);
}

/**
 * Task 6: Customer Details, Breakdown, and Payment (R2, R3)
 */
async function startCheckoutFlow(psid, session) {
  if (!session.cart || session.cart.length === 0) {
    const empty = botMessages.cartEmpty();
    await sendQuickReplies(psid, empty.text, empty.quickReplies);
    return;
  }

  session.state = 'AWAITING_ORDER_TYPE';
  const otMsg = botMessages.orderType();
  await sendQuickReplies(psid, otMsg.text, otMsg.quickReplies);
}

async function proceedAfterOrderType(psid, session) {
  // Check if customer has saved details (Decision 10)
  const [custRows] = await db.query(
    `SELECT first_name, last_name, phone_number, delivery_address 
     FROM customers WHERE psid = ?`,
    [psid]
  );
  const cust = custRows && custRows[0];
  const hasRealName = cust && cust.first_name && cust.first_name !== 'Messenger';
  const hasPhone = cust && cust.phone_number;
  const hasAddress = cust && cust.delivery_address;

  const canReuse = session.orderType === 'delivery'
    ? (hasRealName && hasPhone && hasAddress)
    : (hasRealName && hasPhone);

  if (canReuse) {
    session.details = {
      name: `${cust.first_name || ''} ${cust.last_name || ''}`.trim(),
      phone: cust.phone_number,
      address: cust.delivery_address || ''
    };
    session.state = 'AWAITING_DETAILS_REUSE';
    const savedMsg = botMessages.savedDetails(
      session.details.name,
      session.details.phone,
      session.orderType === 'delivery' ? session.details.address : 'Store pickup'
    );
    await sendQuickReplies(psid, savedMsg.text, savedMsg.quickReplies);
    return;
  }

  // No saved details: ask name
  if (!session.details) session.details = {};
  session.state = 'AWAITING_NAME';
  const askN = botMessages.askName();
  await sendQuickReplies(psid, askN.text, askN.quickReplies);
}

async function handleSavedDetailsConfirmation(psid, session) {
  if (session.orderType === 'delivery') {
    try {
      const quoteRes = await quoteForAddress({ address: session.details.address });
      session.quote = quoteRes;
      session.details.address = quoteRes.formattedAddress || session.details.address;
      await showOrderSummary(psid, session);
    } catch (err) {
      // Fee lookup failed for saved address: ask for address
      session.state = 'AWAITING_ADDRESS';
      if (err.code === 'GEO_TOO_FAR') {
        const tooFarMsg = botMessages.tooFar(err.km, err.max);
        await sendQuickReplies(psid, tooFarMsg.text, tooFarMsg.quickReplies);
      } else {
        const retryMsg = botMessages.addressRetry();
        await sendQuickReplies(psid, retryMsg.text, [{ title: 'Back', payload: 'BACK_TO_CART' }]);
      }
    }
  } else {
    await showOrderSummary(psid, session);
  }
}

async function handleNameInput(psid, session, text) {
  const valid = validateName(text);
  if (!valid.ok) {
    session.failedAttempts = (session.failedAttempts || 0) + 1;
    const bad = botMessages.badName();
    const qrs = session.failedAttempts >= 3 ? [{ title: 'Back to cart', payload: 'BACK_TO_CART' }] : [];
    await sendQuickReplies(psid, bad.text, qrs);
    return { intent: 'BAD_NAME', confidence: 1.0 };
  }

  session.failedAttempts = 0;
  if (!session.details) session.details = {};
  session.details.name = valid.value;

  if (session.editingField) {
    session.editingField = null;
    await showOrderSummary(psid, session);
    return { intent: 'SET_NAME', confidence: 1.0 };
  }

  if (session.orderType === 'delivery') {
    session.state = 'AWAITING_ADDRESS';
    const askA = botMessages.askAddress();
    await sendQuickReplies(psid, askA.text, askA.quickReplies);
  } else {
    session.state = 'AWAITING_PHONE';
    const askP = botMessages.askPhone();
    await sendQuickReplies(psid, askP.text, askP.quickReplies);
  }

  return { intent: 'SET_NAME', confidence: 1.0 };
}

async function handleAddressInput(psid, session, text) {
  const valid = validateAddress(text);
  if (!valid.ok) {
    session.failedAttempts = (session.failedAttempts || 0) + 1;
    const bad = botMessages.badAddress();
    const qrs = session.failedAttempts >= 3 ? [{ title: 'Back to cart', payload: 'BACK_TO_CART' }] : [];
    await sendQuickReplies(psid, bad.text, qrs);
    return { intent: 'BAD_ADDRESS', confidence: 1.0 };
  }

  try {
    const quoteRes = await quoteForAddress({ address: valid.value });
    session.failedAttempts = 0;
    session.quote = quoteRes;
    session.details.address = quoteRes.formattedAddress || valid.value;

    if (session.editingField) {
      session.editingField = null;
      await showOrderSummary(psid, session);
      return { intent: 'SET_ADDRESS', confidence: 1.0 };
    }

    session.state = 'AWAITING_PHONE';
    const askP = botMessages.askPhone();
    await sendQuickReplies(psid, askP.text, askP.quickReplies);
    return { intent: 'SET_ADDRESS', confidence: 1.0 };
  } catch (err) {
    session.failedAttempts = (session.failedAttempts || 0) + 1;
    if (err.code === 'GEO_TOO_FAR') {
      const tooFar = botMessages.tooFar(err.km, err.max);
      await sendQuickReplies(psid, tooFar.text, tooFar.quickReplies);
      return { intent: 'GEO_TOO_FAR', confidence: 1.0 };
    }
    const retry = botMessages.addressRetry();
    const qrs = session.failedAttempts >= 3 ? [{ title: 'Back to cart', payload: 'BACK_TO_CART' }] : [];
    await sendQuickReplies(psid, retry.text, qrs);
    return { intent: 'BAD_ADDRESS_GEO', confidence: 1.0 };
  }
}

async function handleLocationPin(psid, session, location) {
  if (session.state !== 'AWAITING_ADDRESS') {
    await sendTextMessage(psid, "Thanks for sharing your location!");
    return;
  }

  try {
    const quoteRes = await quoteForAddress({ lat: location.lat, lng: location.lng, address: session.details?.address });
    session.quote = quoteRes;
    session.details.address = quoteRes.formattedAddress || `Pin (${location.lat.toFixed(4)}, ${location.lng.toFixed(4)})`;

    if (session.editingField) {
      session.editingField = null;
      await showOrderSummary(psid, session);
      return;
    }

    session.state = 'AWAITING_PHONE';
    const askP = botMessages.askPhone();
    await sendQuickReplies(psid, askP.text, askP.quickReplies);
  } catch (err) {
    if (err.code === 'GEO_TOO_FAR') {
      const tooFar = botMessages.tooFar(err.km, err.max);
      await sendQuickReplies(psid, tooFar.text, tooFar.quickReplies);
      return;
    }
    const retry = botMessages.addressRetry();
    await sendTextMessage(psid, retry.text);
  }
}

async function handlePhoneInput(psid, session, text) {
  const normalized = normalizePhone(text);
  if (!normalized) {
    session.failedAttempts = (session.failedAttempts || 0) + 1;
    const bad = botMessages.badPhone();
    const qrs = session.failedAttempts >= 3 ? [{ title: 'Back to cart', payload: 'BACK_TO_CART' }] : [];
    await sendQuickReplies(psid, bad.text, qrs);
    return { intent: 'BAD_PHONE', confidence: 1.0 };
  }

  session.failedAttempts = 0;
  if (!session.details) session.details = {};
  session.details.phone = normalized;
  session.editingField = null;

  await showOrderSummary(psid, session);
  return { intent: 'SET_PHONE', confidence: 1.0 };
}

/**
 * Task 6: Render Order Summary (R3)
 */
async function showOrderSummary(psid, session) {
  const priceRes = await priceCart(session.cart);

  if (priceRes.unavailable.length > 0) {
    const unavNames = priceRes.unavailable.map(u => u.name).join(', ');
    const oos = botMessages.outOfStock(unavNames);
    await sendQuickReplies(psid, oos.text, oos.quickReplies);
    return;
  }

  const subtotal = priceRes.subtotal;
  let deliveryFee = 0;
  let distanceKm = 0;
  let isEstimate = false;

  if (session.orderType === 'delivery') {
    deliveryFee = session.quote ? session.quote.deliveryFee : 70.00;
    distanceKm = session.quote ? session.quote.distanceKm : FALLBACK_KM;
    isEstimate = session.quote ? session.quote.source === 'fallback' : true;
  }

  const total = Math.round((subtotal + deliveryFee) * 100) / 100;
  session.checkout = { subtotal, deliveryFee, total };
  session.state = 'AWAITING_DETAILS_CONFIRM';

  if (session.orderType === 'delivery') {
    const summaryMsg = botMessages.orderSummary({
      lines: priceRes.lines,
      subtotal: peso(subtotal),
      km: distanceKm,
      fee: peso(deliveryFee),
      total: peso(total),
      name: session.details.name,
      phone: session.details.phone,
      address: session.details.address,
      isEstimate
    });
    await sendQuickReplies(psid, summaryMsg.text, summaryMsg.quickReplies);
  } else {
    const summaryMsg = botMessages.orderSummaryPickup({
      lines: priceRes.lines,
      subtotal: peso(subtotal),
      total: peso(total),
      name: session.details.name,
      phone: session.details.phone
    });
    await sendQuickReplies(psid, summaryMsg.text, summaryMsg.quickReplies);
  }
}

/**
 * Handle confirmation of order summary before payment
 */
async function handleConfirmDetails(psid, session) {
  // Re-price cart from database
  const priceRes = await priceCart(session.cart);

  if (priceRes.unavailable.length > 0) {
    const unavNames = priceRes.unavailable.map(u => u.name).join(', ');
    const oos = botMessages.outOfStock(unavNames);
    await sendQuickReplies(psid, oos.text, oos.quickReplies);
    return;
  }

  const newSubtotal = priceRes.subtotal;
  const deliveryFee = session.checkout ? session.checkout.deliveryFee : 0;
  const newTotal = Math.round((newSubtotal + deliveryFee) * 100) / 100;

  // Price discrepancy check: diff > ₱0.01 (Task 6)
  if (Math.abs(newTotal - (session.checkout?.total || 0)) > 0.01) {
    const pc = botMessages.pricesChanged();
    await sendTextMessage(psid, pc.text);
    await showOrderSummary(psid, session);
    return;
  }

  session.state = 'AWAITING_PAYMENT';
  const payMsg = botMessages.payWith();
  await sendQuickReplies(psid, payMsg.text, payMsg.quickReplies);
}

/**
 * Place the customer order (Task 6)
 */
async function placeCustomerOrder(psid, session, paymentMethod = 'cash') {
  try {
    const orderItems = session.cart.map(c => ({
      menuItemId: c.menuItemId,
      quantity: c.quantity || 1
    }));

    const orderData = {
      customerName: session.details.name,
      customerPhone: session.details.phone,
      deliveryAddress: session.orderType === 'delivery' ? session.details.address : 'Store Pickup',
      orderType: session.orderType || 'delivery',
      paymentMethod,
      items: orderItems,
      deliveryFee: session.checkout?.deliveryFee || 0,
      totalAmount: session.checkout?.total || 0,
      quoteToken: session.quote?.quoteToken || null,
      distanceKm: session.quote?.distanceKm || 1.2
    };

    const order = await createOrder(psid, orderData);

    const orderNum = order.orderNumber || order.order_number;
    session.activeOrderNumber = orderNum;
    session.cart = [];
    session.state = 'IDLE';

    // Order confirmation message (exact catalog)
    const formattedTotal = peso(session.checkout?.total || 0);
    const placedMsg = session.orderType === 'delivery'
      ? botMessages.placedCash(orderNum, formattedTotal)
      : botMessages.placedCashPickup(orderNum, formattedTotal);

    await sendQuickReplies(psid, placedMsg.text, placedMsg.quickReplies);
  } catch (err) {
    console.error('[Order Placement Error]', err);
    await sendTextMessage(psid, "Sorry, we couldn't place your order right now. Please try again.");
    await renderCartSummary(psid, session);
  }
}

/**
 * Initiate GCash Payment
 */
async function initiateGCashPayment(psid, session) {
  session.state = 'AWAITING_GCASH_AMOUNT';
  const totalFormatted = peso(session.checkout?.total || 0);
  const gcashMsg = botMessages.gcashPay(
    totalFormatted,
    config.store.gcashNumber,
    config.store.gcashName
  );
  await sendTextMessage(psid, gcashMsg.text);
}

async function handleGCashAmountInput(psid, session, text) {
  const match = text.match(/[\d,.]+/);
  if (!match) {
    await sendTextMessage(psid, "Please reply with the exact numeric amount you sent via GCash.");
    return { intent: 'BAD_GCASH_AMOUNT', confidence: 1.0 };
  }

  const rawAmount = match[0].replace(/,/g, '');
  const paid = parseFloat(rawAmount);

  if (isNaN(paid) || paid <= 0) {
    await sendTextMessage(psid, "Please reply with a valid amount.");
    return { intent: 'BAD_GCASH_AMOUNT', confidence: 1.0 };
  }

  const expected = session.checkout?.total || 0;
  const isMismatch = Math.abs(paid - expected) > 0.01;

  try {
    const orderItems = session.cart.map(c => ({
      menuItemId: c.menuItemId,
      quantity: c.quantity || 1
    }));

    const order = await createOrder(psid, {
      customerName: session.details.name,
      customerPhone: session.details.phone,
      deliveryAddress: session.orderType === 'delivery' ? session.details.address : 'Store Pickup',
      orderType: session.orderType || 'delivery',
      paymentMethod: 'gcash',
      amountPaid: paid,
      items: orderItems,
      deliveryFee: session.checkout?.deliveryFee || 0,
      totalAmount: expected,
      quoteToken: session.quote?.quoteToken || null
    });

    const orderNum = order.orderNumber || order.order_number;
    session.activeOrderNumber = orderNum;
    session.cart = [];
    session.state = 'IDLE';

    if (isMismatch) {
      const mismatchMsg = botMessages.gcashMismatch(peso(paid), peso(expected));
      await sendQuickReplies(psid, mismatchMsg.text, mismatchMsg.quickReplies);
    } else {
      const okMsg = botMessages.gcashOk(orderNum);
      await sendQuickReplies(psid, okMsg.text, okMsg.quickReplies);
    }

    return { intent: 'GCASH_PAID', confidence: 1.0 };
  } catch (err) {
    console.error('[GCash Placement Error]', err);
    await sendTextMessage(psid, "Sorry, we couldn't record your GCash payment. Please try again.");
    return { intent: 'GCASH_ERROR', confidence: 1.0 };
  }
}

/**
 * Task 9: Post-delivery Feedback & Ratings (R4)
 */
async function handleFeedbackRating(psid, session, rating, orderNumber) {
  if (isNaN(rating) || rating < 1 || rating > 5) {
    await sendTextMessage(psid, "Please choose a rating between 1 and 5 stars.");
    return;
  }

  // Ownership & Delivered check (Fixes F10)
  const [rows] = await db.query(
    `SELECT o.id, o.order_number, o.status, c.psid, o.customer_id
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     WHERE o.order_number = ?`,
    [orderNumber]
  );
  const order = rows && rows[0];

  if (!order || order.psid !== psid || order.status !== 'delivered') {
    await sendTextMessage(psid, "I couldn't find that order.");
    return;
  }

  // Already rated check
  const [fb] = await db.query(`SELECT id FROM feedback WHERE order_id = ?`, [order.id]);
  if (fb && fb.length > 0) {
    const already = botMessages.feedbackAlready();
    await sendTextMessage(psid, already.text);
    return;
  }

  const sentiment = rating >= 4 ? 'positive' : rating === 3 ? 'neutral' : 'negative';

  await db.query(
    `INSERT INTO feedback (order_id, customer_id, rating, comments, sentiment)
     VALUES (?, ?, ?, '', ?)`,
    [order.id, order.customer_id, rating, sentiment]
  );

  notificationService.broadcastSSE('NEW_FEEDBACK', {
    orderId: order.id,
    orderNumber: order.order_number,
    rating,
    sentiment
  });

  if (rating >= 4) {
    const done = botMessages.feedbackDone();
    await sendQuickReplies(psid, done.text, done.quickReplies);
    resetFeedbackSession(session, order.order_number);
  } else {
    // Rating 1 to 3: ask for optional comment only if currently IDLE
    if (session.state === 'IDLE') {
      session.state = 'AWAITING_FEEDBACK_COMMENT';
      session.pendingFeedbackOrderId = order.id;
      session.pendingFeedbackOrderNumber = order.order_number;
      const why = botMessages.feedbackWhy(order.order_number);
      await sendQuickReplies(psid, why.text, why.quickReplies);
    } else {
      const done = botMessages.feedbackDone();
      await sendQuickReplies(psid, done.text, done.quickReplies);
      resetFeedbackSession(session, order.order_number);
    }
  }
}

async function handleFeedbackComment(psid, session, text) {
  const isSkip = !text || text.toLowerCase() === 'skip';
  const orderId = session.pendingFeedbackOrderId;
  const orderNumber = session.pendingFeedbackOrderNumber;

  if (!isSkip && orderId) {
    const sanitized = text.replace(/[<>]/g, '').replace(/[\x00-\x1F\x7F]/g, '').substring(0, 500).trim();
    await db.query(`UPDATE feedback SET comments = ? WHERE order_id = ?`, [sanitized, orderId]);

    // Broadcast SSE again so dashboard card shows the written comment
    const [fbRows] = await db.query(`SELECT rating, sentiment FROM feedback WHERE order_id = ?`, [orderId]);
    if (fbRows && fbRows[0]) {
      notificationService.broadcastSSE('NEW_FEEDBACK', {
        orderId,
        orderNumber,
        rating: fbRows[0].rating,
        sentiment: fbRows[0].sentiment
      });
    }
  }

  const done = botMessages.feedbackDone();
  await sendQuickReplies(psid, done.text, done.quickReplies);
  resetFeedbackSession(session, orderNumber);
  return { intent: 'FEEDBACK_DONE', confidence: 1.0 };
}

async function handleFeedbackSkip(psid, session, orderNumber) {
  const done = botMessages.feedbackDone();
  await sendQuickReplies(psid, done.text, done.quickReplies);
  resetFeedbackSession(session, orderNumber);
}

/**
 * Reset feedback session fields (Decision 12).
 * MUST NOT clear a non-empty cart!
 */
function resetFeedbackSession(session, ratedOrderNumber) {
  session.pendingRating = null;
  session.pendingFeedbackOrderId = null;
  session.pendingFeedbackOrderNumber = null;
  session.pendingItem = null;
  session.pendingAction = null;

  if (session.state === 'IDLE' || session.state === 'AWAITING_FEEDBACK_COMMENT') {
    session.state = 'IDLE';
  }

  if (session.activeOrderNumber === ratedOrderNumber) {
    session.activeOrderNumber = null;
  }
}

/**
 * Track latest order
 */
async function handleTrackOrder(psid, session) {
  const [rows] = await db.query(
    `SELECT o.order_number, o.status, o.total_amount, o.order_type, d.status as delivery_status
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN deliveries d ON d.order_id = o.id
     WHERE c.psid = ?
     ORDER BY o.created_at DESC LIMIT 1`,
    [psid]
  );

  if (!rows || rows.length === 0) {
    await sendQuickReplies(
      psid,
      "You don't have any active orders right now.",
      [{ title: '☕ Menu', payload: 'MENU_HOME' }]
    );
    return;
  }

  const o = rows[0];
  const statusText = o.status.toUpperCase();
  await sendQuickReplies(
    psid,
    `Order #${o.order_number} is currently ${statusText}.`,
    [
      { title: 'Track order', payload: 'TRACK_LATEST_ORDER' },
      { title: '☕ Menu', payload: 'MENU_HOME' }
    ]
  );
}

module.exports = {
  handleMessageEvent,
  macroState,
  expireStaleState,
  sendFullMenu,
  getSession,
  saveSession,
  clearSessionCart,
  getChatbotStatus,
  setChatbotStatus
};
