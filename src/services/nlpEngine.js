/**
 * Conversational AI & NLP Intent Engine (Conversation Flow v2)
 * Implements full conversational state machine, whole menu carousel without category gate,
 * customer details collection before payment, order breakdown with delivery fee,
 * automatic post-delivery feedback, short reply understanding, and cart item removal.
 */

const db = require('../../database/db');
const config = require('../config/config');
const jwt = require('jsonwebtoken');
const { createOrder } = require('./orderService');
const {
  sendTextMessage,
  sendImageAttachment,
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
const maps = require('./maps');
const { haversineKm } = require('./maps');
const { quoteForAddress, FALLBACK_KM } = require('./deliveryFeeAdapter');
const {
  addToCart,
  removeFromCart,
  getCartRemoveButtons,
  calculateCartSubtotal,
  priceCart
} = require('./cartService');
const { recognizeReceipt, parseReceiptText, UNREADABLE_REPLY } = require('./receiptOcrService');
const { verifyPaymentTransaction, resolveOrderTotal, formatAmount } = require('./paymentVerificationService');
const { generateGeminiResponse } = require('./geminiService');
const { parseCustomerFeedback, processFeedbackSubmission } = require('./feedbackParser');

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
 * Parse Customer Info (Address, Name, Contact/Landmark) from customer input
 * @param {string} rawText 
 * @returns {{ address: string, name: string, contact: string }}
 */
function parseCustomerInfo(rawText) {
  let address = '';
  let name = '';
  let contact = '';

  const clean = String(rawText || '').trim();

  // 1. Labeled pattern matching
  const addressMatch = clean.match(/(?:address|tirahan)\s*[:=-]\s*([^\n\r]+?)(?=\s*(?:\bname\b|\bpangalan\b|\bcontact\b|\blandmark\b|\bphone\b|\bmobile\b|$))/i);
  const nameMatch = clean.match(/(?:name|pangalan)\s*[:=-]\s*([^\n\r]+?)(?=\s*(?:\baddress\b|\btirahan\b|\bcontact\b|\blandmark\b|\bphone\b|\bmobile\b|$))/i);
  const contactMatch = clean.match(/(?:contact(?:\s*number)?(?:\s*or\s*landmark)?|landmark|phone|mobile|cellphone)\s*[:=-]\s*([^\n\r]+?)(?=\s*(?:\baddress\b|\btirahan\b|\bname\b|\bpangalan\b|$))/i);

  if (addressMatch) address = addressMatch[1].trim();
  if (nameMatch) name = nameMatch[1].trim();
  if (contactMatch) contact = contactMatch[1].trim();

  // 2. Multiline or delimiter-based fallback
  if (!address || !name) {
    const rawLines = clean.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const lines = [...rawLines];

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (/^(?:address|tirahan)[:=-]?\s*/i.test(line) && !address) {
        address = line.replace(/^(?:address|tirahan)[:=-]?\s*/i, '').trim();
        lines.splice(i, 1);
      } else if (/^(?:name|pangalan)[:=-]?\s*/i.test(line) && !name) {
        name = line.replace(/^(?:name|pangalan)[:=-]?\s*/i, '').trim();
        lines.splice(i, 1);
      } else if (/^(?:contact(?:\s*number)?(?:\s*or\s*landmark)?|landmark|phone|mobile)[:=-]?\s*/i.test(line) && !contact) {
        contact = line.replace(/^(?:contact(?:\s*number)?(?:\s*or\s*landmark)?|landmark|phone|mobile)[:=-]?\s*/i, '').trim();
        lines.splice(i, 1);
      }
    }

    if (!contact) {
      const phoneIdx = lines.findIndex(l => /\b09\d{9}\b|\b\+?63\d{10}\b|\blandmark\b/i.test(l));
      if (phoneIdx !== -1) {
        contact = lines[phoneIdx];
        lines.splice(phoneIdx, 1);
      }
    }

    if (!address) {
      const addrIdx = lines.findIndex(l => /\d+|st\b|street|ave\b|avenue|brgy|barangay|city|manila|road|rd\b|blk|lot/i.test(l));
      if (addrIdx !== -1) {
        address = lines[addrIdx];
        lines.splice(addrIdx, 1);
      }
    }

    if (!name && lines.length > 0) {
      name = lines[0];
      lines.splice(0, 1);
    }

    if (!address && lines.length > 0) {
      address = lines[0];
    }
  }

  if (!address && clean.length > 5) {
    address = clean;
  }

  return {
    address: address.trim(),
    name: name.trim(),
    contact: contact.trim()
  };
}

/**
 * Calculate distance from Diner's Cafe and delivery fee based on distance
 * Formula: Base fee ₱50 + ₱10 per km beyond 2 km
 * @param {string} addressText
 * @returns {Promise<{ distanceKm: number, deliveryFee: number, formattedAddress: string }>}
 */
async function calculateDeliveryDistanceAndFee(addressText) {
  const storeLat = Number.isFinite(config.store?.lat) ? config.store.lat : 14.6042;
  const storeLng = Number.isFinite(config.store?.lng) ? config.store.lng : 120.9822;
  const origin = { lat: storeLat, lng: storeLng };

  const geocoded = await maps.geocode(addressText);
  if (!geocoded || !geocoded.lat || !geocoded.lng) {
    const err = new Error(`Address '${addressText}' not found.`);
    err.code = 'GEO_NOT_FOUND';
    throw err;
  }

  const dest = { lat: geocoded.lat, lng: geocoded.lng };
  let distanceKm = 1.0;

  try {
    const route = await maps.routeDistance(origin, dest);
    distanceKm = Math.round(route.km * 10) / 10;
  } catch (routeErr) {
    const straight = haversineKm(origin.lat, origin.lng, dest.lat, dest.lng);
    distanceKm = Math.round(straight * 1.25 * 10) / 10;
  }

  if (distanceKm < 0.1) distanceKm = 0.5;

  // Base fee ₱50 + ₱10 bawat km paglampas ng 2km
  let deliveryFee = 50.00;
  if (distanceKm > 2.0) {
    deliveryFee = 50.00 + (distanceKm - 2.0) * 10.00;
  }
  deliveryFee = Math.round(deliveryFee * 100) / 100;

  return {
    distanceKm,
    deliveryFee,
    formattedAddress: geocoded.formattedAddress || addressText
  };
}

/**
 * Generate Complete Summary Receipt
 * Format:
 * Resibo ng Transaksyon:
 * Pangalan: [session.customer_name]
 * Address: [session.delivery_address]
 * Contact / Landmark: [session.contact_number]
 * Mga Inorder:
 * [Listahan ng items at presyo]
 * Subtotal: PHP [subtotal]
 * Distansya: [distance] km
 * Delivery Fee: PHP [delivery_fee]
 * Kabuuang Halaga: PHP [grand_total]
 * GCash Ref No: [reference_number]
 * 
 * Salamat! Kumpirmado ang bayad. Inihahanda na ng kusina ang inyong order.
 */
function generateSummaryReceipt(session, referenceNumber) {
  const name = session.customer_name || session.details?.name || 'Customer';
  const address = session.delivery_address || session.details?.address || 'N/A';
  const contact = session.contact_number || session.details?.phone || 'N/A';

  const items = (session.ordered_items && session.ordered_items.length > 0)
    ? session.ordered_items
    : (session.cart && session.cart.length > 0 ? session.cart : []);

  let itemsListText = '';
  if (items.length > 0) {
    itemsListText = items.map(it => {
      const price = parseFloat(it.price || it.unitPrice || 0);
      const qty = parseInt(it.quantity, 10) || 1;
      const total = price * qty;
      return `- ${it.name} x${qty} - PHP ${formatAmount(total)}`;
    }).join('\n');
  } else {
    itemsListText = '- Order Items';
  }

  const subtotal = (session.order_subtotal !== null && session.order_subtotal !== undefined)
    ? parseFloat(session.order_subtotal)
    : calculateCartSubtotal(items);

  const distance = (session.distance_km !== null && session.distance_km !== undefined)
    ? session.distance_km
    : 1.0;

  const deliveryFee = (session.delivery_fee !== null && session.delivery_fee !== undefined)
    ? parseFloat(session.delivery_fee)
    : (distance <= 2.0 ? 50.00 : 50.00 + (distance - 2.0) * 10.00);

  const grandTotal = (session.order_total !== null && session.order_total !== undefined)
    ? parseFloat(session.order_total)
    : Math.round((subtotal + deliveryFee) * 100) / 100;

  return `Resibo ng Transaksyon:
Pangalan: ${name}
Address: ${address}
Contact / Landmark: ${contact}
Mga Inorder:
${itemsListText}
Subtotal: PHP ${formatAmount(subtotal)}
Distansya: ${distance} km
Delivery Fee: PHP ${formatAmount(deliveryFee)}
Kabuuang Halaga: PHP ${formatAmount(grandTotal)}
GCash Ref No: ${referenceNumber}

Salamat! Kumpirmado ang bayad. Inihahanda na ng kusina ang inyong order.`;
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
    'AWAITING_STAGE5_CONFIRM',
    'AWAITING_CUSTOMER_INFO',
    'AWAITING_PAYMENT_VERIFICATION',
    'AWAITING_DELIVERY_DETAILS',
    'AWAITING_CANCEL_CONFIRMATION',
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
    'AWAITING_CLEAR_CONFIRM',
    'ordering'
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
async function handleMessageEvent(psid, incomingText = '', payload = null, location = null, attachments = null) {
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
    // 0a. Handle Attachments (Receipt images for OCR)
    if (attachments && attachments.length > 0) {
      const imgAttachment = attachments.find(a => a.type === 'image');
      if (imgAttachment) {
        detectedIntent = 'RECEIPT_IMAGE_ATTACHMENT';
        const imgInput = imgAttachment.payload?.url || imgAttachment.payload || imgAttachment;

        // Process image URL using OCR library
        const ocrResult = await recognizeReceipt(imgInput);
        if (!ocrResult.success) {
          botReplyLog = ocrResult.botReply || UNREADABLE_REPLY;
          await sendTextMessage(psid, botReplyLog);
          return;
        }

        const verifyResult = await verifyPaymentTransaction({
          referenceNumber: ocrResult.referenceNumber,
          session,
          psid,
          receiptUrl: typeof imgInput === 'string' ? imgInput : null,
          parsedAmount: ocrResult.amount
        });

        const isAwaitingPaymentVerification = (
          session.state === 'AWAITING_PAYMENT_VERIFICATION' ||
          session.current_step === 'AWAITING_PAYMENT_VERIFICATION' ||
          Boolean(session.customer_name)
        );

        if (verifyResult.success && isAwaitingPaymentVerification) {
          session.current_step = 'order_placed';
          session.state = 'order_placed';
          session.gcash_ref = ocrResult.referenceNumber;
          await saveSession(session);

          const receiptMsg = generateSummaryReceipt(session, ocrResult.referenceNumber);
          botReplyLog = receiptMsg;
          await sendTextMessage(psid, receiptMsg);
          return;
        }

        botReplyLog = verifyResult.botReply;
        await sendTextMessage(psid, verifyResult.botReply);
        return;
      }
    }

    // 0b. Handle Location Pin if shared
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
    return result;
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
    session.pending_suggestion = null;
    session.pendingAction = null;
    session.details = null;
    session.quote = null;
    session.checkout = null;
    session.activeOrderNumber = null;
    session.pendingRating = null;
    session.pendingFeedbackOrderId = null;
    session.pendingFeedbackOrderNumber = null;
    session.geminiInteractionId = null;
    session.chatHistory = [];
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

  // Suggestion confirmation quick replies
  if (payload === 'CONFIRM_YES') {
    if (session.state === 'AWAITING_SUGGESTION_CONFIRMATION' || session.current_step === 'AWAITING_SUGGESTION_CONFIRMATION') {
      return handleTextInput(psid, session, 'yes');
    }
  }

  if (payload === 'CONFIRM_NO') {
    if (session.state === 'AWAITING_SUGGESTION_CONFIRMATION' || session.current_step === 'AWAITING_SUGGESTION_CONFIRMATION') {
      return handleTextInput(psid, session, 'no');
    }
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

  // Natural-language quick-reply suggestions delegate to free-text handler
  if (!/^[A-Z0-9_]+$/.test(payload)) {
    await handleTextInput(psid, session, payload);
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

  // Check for payment confirmation signal like "Send na po", "Bayad na po", "Na-send ko na"
  const isPaidSignal = /(?:^|\b)(?:send na po|na-?send|bayad na|paid|done paying|ok na po|tapos na po|settled)(?:\b|$)/i.test(rawText);
  if (isPaidSignal) {
    if (!session.activeOrderNumber && session.pendingStage5) {
      await handleStage5Confirmation(psid, session);
    }
    if (session.activeOrderNumber) {
      await db.query(
        `UPDATE payments SET status = 'verified', verified_at = CURRENT_TIMESTAMP 
         WHERE order_id = (SELECT id FROM orders WHERE order_number = ? LIMIT 1)`,
        [session.activeOrderNumber]
      );
      notificationService.broadcastSSE('ORDER_STATUS_CHANGED', {
        orderNumber: session.activeOrderNumber,
        newStatus: 'pending',
        paymentStatus: 'verified'
      });
      const reply = `Natanggap at verified na po namin ang inyong GCash payment para sa Order #${session.activeOrderNumber}!\nNa-forward na po sa aming dispatch at kitchen team ang inyong order. Maraming salamat po sa pag-order sa Diner's Cafe! Hintayin na lang po natin dumating si kuya rider.`;
      await sendTextMessage(psid, reply);
      session.state = 'AWAITING_DELIVERY';
      session.current_step = 'AWAITING_DELIVERY';
      await saveSession(session);
      return { intent: 'GCASH_PAID_SIGNAL', confidence: 1.0, replyLog: reply };
    }
  }

  // Check for affirmative confirmation to Stage 5 summary like "Yes tama lang lahat", "Confirm", "Oo"
  const isAffirmativeConfirm = /(?:^|\b)(?:yes|oo|opo|confirm|proceed|tama|sige|push|g|ok na)(?:\b|$)/i.test(rawText);
  if (isAffirmativeConfirm && (session.state === 'AWAITING_STAGE5_CONFIRM' || session.pendingStage5)) {
    return handleStage5Confirmation(psid, session);
  }

  // 0. State: AWAITING_CANCEL_CONFIRMATION (Intercept before any other logic or NLP)
  if (session.state === 'AWAITING_CANCEL_CONFIRMATION' || session.current_step === 'AWAITING_CANCEL_CONFIRMATION') {
    const words = norm.split(/\s+/).filter(Boolean);
    const affirmativeWords = ['yes', 'oo', 'sige', 'yep', 'opo'];
    const negativeWords = ['no', 'hindi', 'wag', 'huwag', 'wait'];

    const hasAffirmative = affirmativeWords.some(w => words.includes(w) || norm === w) ||
      classifyShort(rawText) === 'YES';
    const hasNegative = negativeWords.some(w => words.includes(w) || norm === w) ||
      norm.includes('hindi pa') ||
      norm.includes('wag muna') ||
      norm.includes('huwag muna') ||
      classifyShort(rawText) === 'NO';

    if (hasAffirmative && !hasNegative) {
      session.cart = [];
      session.order_type = null;
      session.orderType = null;
      session.delivery_address = null;
      session.address = '';
      session.gcash_ref = null;
      session.partial_paid = null;
      session.order_total = null;
      session.receipt_url = null;
      session.details = null;
      session.quote = null;
      session.checkout = null;
      session.pendingItem = null;
      session.pending_suggestion = null;
      session.pendingAction = null;
      if (session.activeOrderNumber) {
        try {
          await db.query(
            `UPDATE orders SET status = 'cancelled', cancellation_reason = 'Cancelled by customer' WHERE order_number = ?`,
            [session.activeOrderNumber]
          );
        } catch (e) {
          console.error('[Cancel Order DB Error]', e.message);
        }
        session.activeOrderNumber = null;
      }
      session.current_step = 'idle';
      session.state = 'idle';
      await saveSession(session);

      const reply = 'Order has been cancelled.';
      await sendTextMessage(psid, reply);
      return { intent: 'CANCEL_ORDER_CONFIRMED', confidence: 1.0, replyLog: reply };
    }

    if (hasNegative && !hasAffirmative) {
      const targetState = (session.previous_step && session.previous_step !== 'AWAITING_CANCEL_CONFIRMATION' && session.previous_step !== 'idle')
        ? session.previous_step
        : 'ordering';
      session.current_step = targetState;
      session.state = targetState;
      await saveSession(session);

      const reply = 'Anything else?';
      await sendTextMessage(psid, reply);
      return { intent: 'CANCEL_ORDER_DECLINED', confidence: 1.0, replyLog: reply };
    }

    // Other / Ambiguous answer
    await saveSession(session);
    const reply = 'Pakisagot lamang ng yes o no kung nais mong i-cancel ang iyong order.';
    await sendTextMessage(psid, reply);
    return { intent: 'AWAITING_CANCEL_CONFIRMATION_RETRY', confidence: 1.0, replyLog: reply };
  }

  // 0b. State: 'AWAITING_SUGGESTION_CONFIRMATION' (Bago dumaan sa ibang intent parser)
  if (session.state === 'AWAITING_SUGGESTION_CONFIRMATION' || session.current_step === 'AWAITING_SUGGESTION_CONFIRMATION') {
    const affirmativeWords = ['yes', 'oo', 'opo', 'yep', 'sige'];
    const negativeWords = ['no', 'hindi', 'ayaw'];

    const words = norm.split(/\s+/).filter(Boolean);
    const hasAffirmative = affirmativeWords.some(w => words.includes(w) || norm === w || norm.startsWith(w)) ||
      classifyShort(rawText) === 'YES';
    const hasNegative = negativeWords.some(w => words.includes(w) || norm === w || norm.startsWith(w)) ||
      classifyShort(rawText) === 'NO';

    if (hasAffirmative && !hasNegative) {
      const pending = session.pending_suggestion || session.pendingItem;
      const addedName = pending?.name || 'item';
      const addedQty = parseInt(pending?.quantity || 1, 10) || 1;
      const price = parseFloat(pending?.price) || 0;

      if (pending) {
        if (!session.cart) session.cart = [];
        const itemToAdd = {
          menuItemId: pending.id || pending.menuItemId || 1,
          id: pending.id || pending.menuItemId || 1,
          name: addedName,
          quantity: addedQty,
          price: price
        };
        const existingIdx = session.cart.findIndex(c => 
          (c.name && c.name.toLowerCase() === addedName.toLowerCase()) ||
          (c.menuItemId && c.menuItemId === itemToAdd.menuItemId)
        );
        if (existingIdx >= 0) {
          session.cart[existingIdx].quantity += addedQty;
        } else {
          session.cart.push(itemToAdd);
        }
      }

      session.pending_suggestion = null;
      session.pendingItem = null;
      session.current_step = 'ordering';
      session.state = 'ordering';
      await saveSession(session);

      const reply = `Naidagdag sa iyong cart ang ${addedQty} ${addedName}. Nais mo pa bang magdagdag ng iba o mag-checkout na?`;
      await sendTextMessage(psid, reply);
      return { intent: 'SUGGESTION_CONFIRMED', confidence: 1.0, replyLog: reply };
    }

    if (hasNegative && !hasAffirmative) {
      session.pending_suggestion = null;
      session.pendingItem = null;
      session.current_step = 'ordering';
      session.state = 'ordering';
      await saveSession(session);

      const reply = 'Pakiulit ng order.';
      await sendTextMessage(psid, reply);
      return { intent: 'SUGGESTION_DECLINED', confidence: 1.0, replyLog: reply };
    }

    // Kung hindi yes o no ang sagot:
    await saveSession(session);
    const reply = 'Pakisagot po ng yes kung ito ang iyong ibig sabihin, o no para ulitin ang order.';
    await sendTextMessage(psid, reply);
    return { intent: 'AWAITING_SUGGESTION_CONFIRMATION_RETRY', confidence: 1.0, replyLog: reply };
  }

  const isDetailsStateCheck = [
    'AWAITING_NAME',
    'AWAITING_ADDRESS',
    'AWAITING_PHONE',
    'AWAITING_EDIT_FIELD',
    'AWAITING_PAYMENT'
  ].includes(session.state);

  // 1. Trigger Order Cancellation & Refund Gatekeeping Flow (Module 3)
  const cancelTriggerPhrases = [
    'cancel order',
    'cancel my order',
    'i cancel ang order',
    'icancel ang order',
    'kanselahin',
    'pa cancel',
    'pa-cancel',
    'pacancel',
    'refund',
    'pa refund',
    'pa-refund',
    'parefund'
  ];
  const isCancelTrigger = !isDetailsStateCheck && (
    cancelTriggerPhrases.some(p => norm === p || norm.includes(p)) ||
    /\b(?:pa[-\s]?cancel|i[-\s]?cancel|kanselahin|refund|pa[-\s]?refund)\b/i.test(rawText) ||
    /\b(?:cancel(?:led)?\s+(?:the\s+|my\s+|ang\s+)?order)\b/i.test(rawText) ||
    /^(?:cancel|pa[-\s]?cancel|kanselahin|refund)$/i.test(norm)
  );

  if (isCancelTrigger) {
    // Check for active placed order in database or session
    let activeOrder = null;
    if (session.activeOrderNumber) {
      const [rows] = await db.query(
        `SELECT id, order_number, status FROM orders WHERE order_number = ? LIMIT 1`,
        [session.activeOrderNumber]
      );
      if (rows && rows.length > 0 && !['delivered', 'cancelled'].includes(rows[0].status)) {
        activeOrder = rows[0];
      }
    }
    if (!activeOrder && psid) {
      const [rows] = await db.query(
        `SELECT o.id, o.order_number, o.status
         FROM orders o
         JOIN customers c ON c.id = o.customer_id
         WHERE c.psid = ? AND o.status NOT IN ('delivered', 'cancelled')
         ORDER BY o.id DESC LIMIT 1`,
        [psid]
      );
      if (rows && rows.length > 0) {
        activeOrder = rows[0];
      }
    }

    if (activeOrder) {
      const { updateOrderStatus } = require('./orderService');
      if (activeOrder.status === 'pending') {
        await updateOrderStatus(activeOrder.id, 'cancelled', {
          cancellationReason: 'Cancelled by customer'
        });
        session.activeOrderNumber = null;
        session.current_step = 'idle';
        session.state = 'idle';
        session.cart = [];
        await saveSession(session);

        const reply = "Na-cancel na po ang inyong order. Ang refund po (kung bayad via online) ay papasok within 5-10 minutes.";
        await sendTextMessage(psid, reply);
        return { intent: 'ORDER_CANCELLED_PENDING', confidence: 1.0, replyLog: reply };
      } else if (activeOrder.status === 'preparing') {
        const reply = "Paumanhin po, hindi na po maaaring ma-cancel ang inyong order dahil ito ay kasalukuyan nang inihahanda sa kusina.";
        await sendTextMessage(psid, reply);
        return { intent: 'ORDER_CANCEL_REJECTED_PREPARING', confidence: 1.0, replyLog: reply };
      } else if (activeOrder.status === 'dispatched') {
        const reply = "Paumanhin po, hindi na po maaaring ma-cancel ang inyong order dahil na-dispatch na ito at papunta na ang rider sa inyo.";
        await sendTextMessage(psid, reply);
        return { intent: 'ORDER_CANCEL_REJECTED_DISPATCHED', confidence: 1.0, replyLog: reply };
      }
    }

    // If no active placed order (only draft items in cart or during ordering flow)
    session.previous_step = (session.current_step && session.current_step !== 'idle') ? session.current_step : 'ordering';
    session.current_step = 'AWAITING_CANCEL_CONFIRMATION';
    session.state = 'AWAITING_CANCEL_CONFIRMATION';
    await saveSession(session);

    const reply = 'Sigurado ka ba na nais mong i-cancel ang iyong order? I-type ang yes o no.';
    await sendTextMessage(psid, reply);
    return { intent: 'CANCEL_ORDER_REQUESTED', confidence: 1.0, replyLog: reply };
  }

  // 2. Multilingual Feedback & Star Rating Parser (Module 1 & Feature 5 Disambiguation)
  // Contextual Priority: in active order sessions (Stages 1-5), number words strictly default to item_quantity.
  const isInActiveOrderingPipeline = Boolean(
    (session.cart && session.cart.length > 0) ||
    session.pendingStage5 ||
    ['ordering', 'AWAITING_ORDER_TYPE', 'AWAITING_STAGE5_CONFIRM', 'AWAITING_NAME', 'AWAITING_ADDRESS', 'AWAITING_PHONE', 'AWAITING_PAYMENT', 'AWAITING_GCASH_AMOUNT', 'AWAITING_DELIVERY_DETAILS', 'AWAITING_CHECKOUT_CONFIRM'].includes(session.state)
  );

  const hasExplicitRatingAnchor = /(?:isa(?:ng)?|dalawa(?:ng)?|tatlo(?:ng)?|apat|lima(?:ng)?|one|two|three|four|five|\d+)\s*(?:na\s*)?(?:stars?|bituin|ratings?|rate\b)/i.test(rawText) || /[⭐★]/.test(rawText);
  const shouldEvaluateFeedback = (!isInActiveOrderingPipeline || hasExplicitRatingAnchor) && (session.state === 'AWAITING_FEEDBACK_COMMENT' || session.state === 'awaiting_feedback' || hasExplicitRatingAnchor);

  if (shouldEvaluateFeedback) {
    const feedbackParsed = parseCustomerFeedback(rawText, session);
    if (feedbackParsed.isFeedback) {
      const feedbackResult = await processFeedbackSubmission({
        psid,
        session,
        rating: feedbackParsed.rating,
        comment: feedbackParsed.comment
      });
      return { intent: 'FEEDBACK_SUBMITTED', confidence: 1.0, replyLog: feedbackResult.botReply };
    }
  }

  // Global Reset / Cancel Intercept
  const isResetCmd = ['reset', 'start over', 'umulit', 'reset session'].includes(norm) ||
    (norm === 'cancel' && !isDetailsStateCheck);

  if (isResetCmd) {
    session.cart = [];
    session.current_step = 'idle';
    session.state = 'idle';
    session.order_type = null;
    session.orderType = null;
    session.delivery_address = null;
    session.gcash_ref = null;
    session.partial_paid = null;
    session.details = null;
    session.pendingItem = null;
    session.pending_suggestion = null;
    session.pendingAction = null;
    session.quote = null;
    session.checkout = null;
    const resetMsg = 'Na-reset na ang iyong session. Paano kita matutulungan ngayon?';
    await sendTextMessage(psid, resetMsg);
    return { intent: 'RESET_SESSION', confidence: 1.0, replyLog: resetMsg };
  }

  // 1. Delivery trigger keywords: 'delivery', 'deliver', 'padeliver'
  const isDeliveryChoice = ['delivery', 'deliver', 'padeliver'].includes(norm) ||
    (/\b(delivery|deliver|padeliver)\b/i.test(norm) && (session.state === 'AWAITING_ORDER_TYPE' || session.current_step === 'AWAITING_ORDER_TYPE'));

  if (isDeliveryChoice && (session.state === 'AWAITING_ORDER_TYPE' || session.current_step === 'AWAITING_ORDER_TYPE' || (session.cart && session.cart.length > 0 && !isDetailsStateCheck))) {
    session.orderType = 'delivery';
    session.order_type = 'delivery';
    if (session.cart && session.cart.length > 0) {
      session.ordered_items = [...session.cart];
    }
    session.current_step = 'AWAITING_CUSTOMER_INFO';
    session.state = 'AWAITING_CUSTOMER_INFO';
    await saveSession(session);

    const reply = `Please provide the following:
Address:
Name:
Contact number or landmark:`;

    await sendTextMessage(psid, reply);
    return { intent: 'ORDER_TYPE_DELIVERY', confidence: 1.0, replyLog: reply };
  }

  // 2. State: 'AWAITING_CUSTOMER_INFO'
  if (session.state === 'AWAITING_CUSTOMER_INFO' || session.current_step === 'AWAITING_CUSTOMER_INFO') {
    const parsed = parseCustomerInfo(rawText);

    if (!parsed.address || parsed.address.length < 5) {
      const askInfoMsg = 'Pakibigay ang inyong kumpletong address, pangalan, at contact number o landmark.';
      await sendTextMessage(psid, askInfoMsg);
      return { intent: 'AWAITING_CUSTOMER_INFO_RETRY', confidence: 1.0, replyLog: askInfoMsg };
    }

    let deliveryDetails;
    try {
      deliveryDetails = await calculateDeliveryDistanceAndFee(parsed.address);
    } catch (err) {
      const geoFailMsg = 'Paumanhin, hindi mahanap ang address na inyong ibinigay. Pakisend muli ang inyong kumpletong address kasama ang kilalang landmark upang matukoy ang distansya.';
      await sendTextMessage(psid, geoFailMsg);
      return { intent: 'GEO_ADDRESS_NOT_FOUND', confidence: 1.0, replyLog: geoFailMsg };
    }

    const customerName = parsed.name || session.customer_name || session.details?.name || 'Customer';
    const contactNumber = parsed.contact || session.contact_number || session.details?.phone || 'N/A';
    const subtotal = (session.cart && session.cart.length > 0)
      ? calculateCartSubtotal(session.cart)
      : (session.order_subtotal || 150.00);

    const distanceKm = deliveryDetails.distanceKm;
    const deliveryFee = deliveryDetails.deliveryFee;
    const grandTotal = Math.round((subtotal + deliveryFee) * 100) / 100;

    session.customer_name = customerName;
    session.contact_number = contactNumber;
    session.delivery_address = deliveryDetails.formattedAddress;
    session.distance_km = distanceKm;
    session.delivery_fee = deliveryFee;
    session.order_subtotal = subtotal;
    session.order_total = grandTotal;
    if (session.cart && session.cart.length > 0) {
      session.ordered_items = [...session.cart];
    }
    if (!session.details) session.details = {};
    session.details.name = customerName;
    session.details.address = deliveryDetails.formattedAddress;
    session.details.phone = contactNumber;

    session.current_step = 'AWAITING_PAYMENT_VERIFICATION';
    session.state = 'AWAITING_PAYMENT_VERIFICATION';
    await saveSession(session);

    const baseAppUrl = (config.appUrl || 'http://localhost:3000').replace(/\/+$/, '');
    const gcashFullQrUrl = `${baseAppUrl}/images/gcash_full_qr.png`;
    const gcashRedirectUrl = `${baseAppUrl}/pay/gcash?psid=${encodeURIComponent(psid)}`;
    const gcashNo = '0928 176 2895';
    const gcashName = 'FR****S DA*E F.';

    // 1. Message 1: Generic Template Card (GCash Card with square image aspect ratio)
    await sendGenericTemplate(psid, [
      {
        title: 'GCash',
        subtitle: gcashNo,
        image_url: gcashFullQrUrl,
        buttons: [
          {
            type: 'web_url',
            url: gcashRedirectUrl,
            title: 'Transfer with GCash',
            webview_height_ratio: 'compact'
          }
        ]
      }
    ], { image_aspect_ratio: 'square' });

    // 2. Message 2: 3-step text instructions
    const paymentInstructions = `1. Tap "Transfer with GCash".
2. GCash will open with the recipient's account details prefilled.
3. After you complete the transfer, your receipt will be uploaded into this chat.`;

    await sendTextMessage(psid, paymentInstructions);

    return { intent: 'CUSTOMER_INFO_RECEIVED_AWAITING_PAYMENT', confidence: 1.0, replyLog: paymentInstructions };
  }

  // 3. State: 'AWAITING_PAYMENT_VERIFICATION' & legacy 'AWAITING_DELIVERY_DETAILS'
  if (
    session.state === 'AWAITING_PAYMENT_VERIFICATION' ||
    session.current_step === 'AWAITING_PAYMENT_VERIFICATION' ||
    session.state === 'AWAITING_DELIVERY_DETAILS' ||
    session.current_step === 'AWAITING_DELIVERY_DETAILS'
  ) {
    // Check if 13-digit Reference Number is present in text
    const refMatch = rawText.match(/\b\d{4}\s?\d{3}\s?\d{6}\b/) || rawText.match(/\b\d{13}\b/) || rawText.match(/(?:ref(?:erence)?(?:\s*no\.?)?)\s*[:#]?\s*([0-9\s]{13,16})/i);
    if (refMatch) {
      const cleanRef = (refMatch[1] || refMatch[0]).replace(/\s+/g, '');
      if (cleanRef.length === 13) {
        // Save address if also present
        const textWithoutRef = rawText.replace(refMatch[0], '').trim();
        if (textWithoutRef.length > 5 && !session.delivery_address) {
          session.delivery_address = textWithoutRef;
          if (!session.details) session.details = {};
          session.details.address = textWithoutRef;
        }

        const verifyResult = await verifyPaymentTransaction({
          referenceNumber: cleanRef,
          session,
          psid,
          parsedAmount: null
        });

        const isAwaitingPaymentVerification = (
          session.state === 'AWAITING_PAYMENT_VERIFICATION' ||
          session.current_step === 'AWAITING_PAYMENT_VERIFICATION' ||
          Boolean(session.customer_name)
        );

        if (verifyResult.success && isAwaitingPaymentVerification) {
          session.current_step = 'order_placed';
          session.state = 'order_placed';
          session.gcash_ref = cleanRef;
          await saveSession(session);

          const receiptMsg = generateSummaryReceipt(session, cleanRef);
          await sendTextMessage(psid, receiptMsg);
          return { intent: 'GCASH_TYPED_REF_VERIFIED', confidence: 1.0, replyLog: receiptMsg };
        } else {
          await sendTextMessage(psid, verifyResult.botReply);
          return { intent: verifyResult.success ? 'GCASH_TYPED_REF_VERIFIED' : 'GCASH_REF_VERIFICATION_FAILED', confidence: 1.0, replyLog: verifyResult.botReply };
        }
      }
    }

    // In AWAITING_PAYMENT_VERIFICATION state: customer typed something without 13-digit reference number
    // Manatiling tahimik ang bot sa state na 'AWAITING_PAYMENT_VERIFICATION' at maghintay lamang sa awtomatikong upload ng resibo o ref number
    if (session.state === 'AWAITING_PAYMENT_VERIFICATION' || session.current_step === 'AWAITING_PAYMENT_VERIFICATION') {
      return { intent: 'AWAITING_PAYMENT_VERIFICATION_SILENT', confidence: 1.0 };
    }

    // Legacy fallback for AWAITING_DELIVERY_DETAILS: if text only contains address without reference number
    if (rawText.length > 5 && !['hi', 'hello', 'menu', 'cart'].includes(norm)) {
      session.delivery_address = rawText;
      if (!session.details) session.details = {};
      session.details.address = rawText;
      return { intent: 'SET_DELIVERY_ADDRESS_AWAITING_REF', confidence: 1.0 };
    }
  }

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
    'AWAITING_SUGGESTION_CONFIRMATION',
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

  if (
    ['track', 'track order', 'where is my order', 'status'].includes(norm) ||
    /\b(?:track|nasaan|asan|balita|status|kamusta|kumusta)\b.*\b(?:order|delivery|pagkain|kape)\b/i.test(rawText) ||
    /\b(?:order|delivery)\b.*\b(?:status|balita|nasaan|asan)\b/i.test(rawText)
  ) {
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

  // 5a. Bilingual / Taglish Conversational Assistant (Google Gemini AI) for inquiries, FAQs, small talk & support
  if (process.env.NODE_ENV !== 'test' && isConversationalInquiry(rawText, session)) {
    const geminiTurn = await tryGeminiConversationalTurn(psid, session, rawText);
    if (geminiTurn) {
      return geminiTurn;
    }
  }

  // 5b. Query Wit.ai NLU for what remains
  const nlu = await queryWitAi(rawText);
  const intent = nlu.intent;
  const conf = nlu.confidence || 0;

  // Thresholds: act >= 0.80, confirm 0.55-0.80, fallback < 0.55 (Decision 8)
  if (conf < 0.55 && intent !== 'ORDER_ITEM' && intent !== 'REMOVE_ITEM') {
    // Check if the user is trying to order a menu item with typo / spelling variation
    const orderTry = await handleOrderItemText(psid, session, rawText, nlu);
    if (orderTry && orderTry.intent !== 'FALLBACK') {
      return orderTry;
    }
    const fb = botMessages.fallback();
    await sendQuickReplies(psid, fb.text, fb.quickReplies);
    return { intent: 'FALLBACK', confidence: conf };
  }

  if (intent === 'OUT_OF_SCOPE') {
    if (process.env.NODE_ENV !== 'test') {
      const geminiTurn = await tryGeminiConversationalTurn(psid, session, rawText);
      if (geminiTurn) return geminiTurn;
    }
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

  if (currentState === 'AWAITING_SUGGESTION_CONFIRMATION' || session.current_step === 'AWAITING_SUGGESTION_CONFIRMATION') {
    return handleTextInput(psid, session, 'yes');
  }

  if (currentState === 'AWAITING_STAGE5_CONFIRM') {
    return handleStage5Confirmation(psid, session);
  }

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
    session.order_type = 'delivery';
    if (session.cart && session.cart.length > 0) {
      session.ordered_items = [...session.cart];
    }
    session.current_step = 'AWAITING_CUSTOMER_INFO';
    session.state = 'AWAITING_CUSTOMER_INFO';
    await saveSession(session);
    const msg = `Please provide the following:\nAddress:\nName:\nContact number or landmark:`;
    await sendTextMessage(psid, msg);
    return { intent: 'ORDER_TYPE_YES', confidence: 1.0 };
  }

  return { intent: 'YES', confidence: 1.0 };
}

/**
 * Handle negative response for open yes/no question
 */
async function handleNoAnswer(psid, session) {
  const currentState = session.state;

  if (currentState === 'AWAITING_SUGGESTION_CONFIRMATION' || session.current_step === 'AWAITING_SUGGESTION_CONFIRMATION') {
    return handleTextInput(psid, session, 'no');
  }

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
function isConversationalInquiry(rawText, session = null) {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) return false;

  // Let deterministic cart/order handlers process explicit item additions & active-cart removals
  const hasExplicitOrderVerb = /\b(?:can\s+i\s+(?:get|order|have)|may\s+i\s+(?:get|order|have)|i\s*(?:want|would\s+like|'d\s+like)\s+(?:to\s+order|a\b|an\b|\d+)|pa-?order|pabili|gusto\s+ko\s+(?:ng|umorder)|add\s+\d+|order\s+\d+)\b/i.test(trimmed);
  if (hasExplicitOrderVerb) return false;

  const hasCartItems = Array.isArray(session?.cart) && session.cart.length > 0;
  if (hasCartItems && /\b(?:remove|delete|take\s*out|alisin|tanggalin|pa-?cancel)\b/i.test(trimmed)) {
    return false;
  }

  return (
    /\?$/.test(trimmed) ||
    /^(?:what|which|how|why|who|where|when|is\s+(?:the|your|this|there|cash)|are\s+(?:the|your|you|there)|do\s+you|can\s+(?:you|i\s+(?:customize|place|pre-?order|request|change|see))|recommend|suggest|pair|tell\s+me|pa-?reco|hm\b|pde\b|pwde\b|pwede\b|pano\b|paano\b|ano\b|ano-?ano\b|anong\b|alin\b|magkano\b|magkno\b|masarap\b|matamis\b|mainit\b|malamig\b|maingay\b|mabilis\b|meron\b|may\b|san\b|saan\b|bat\b|bakit\b|gaano\b|nasaan\b|asan\b|kumusta\b|kamusta\b|hello\s*[!,]?\s*(?:po|pwede)|hi\s*,\s*(?:bot|quick)|hey\s+there|uy\b|yo\b|g\s*,\s*goods|goods\s+na|good\s+(?:morning|afternoon|evening)|magandang\s+(?:umaga|tanghali|hapon|gabi)|salamat\b|matsala\b|bye\b|busy\s+ba|open\s+po\s+ba|legit\s+ba|libre\s+ba|original\b|safe\s+ba|tumatawag\b|weekend\s+ba|compatible\b|sira\s+po|mali\s+po|nawawala\b|kulang\b|sinisingil\b|ang\s+(?:tagal|bastos)|nag-?(?:doble|hang|o-?offer)|laging\s+nag-?e-?error|di\s+ko\b|'di\s+ko\b|nakalimutan\b|biglang\s+nawala|sabi\s+sa\s+gcash|na-?(?:place|charge|process)|hindi\s+(?:gumagana|dumarating|kasya|pa\s+dumarating)|bka\s+nmn|baka\s+naman|pa-?pack\s+po)/i.test(trimmed) ||
    /\blods\b|\bmatsala\b/i.test(trimmed)
  );
}

async function handleOrderItemText(psid, session, rawText, nlu) {
  // Route open-ended menu/pairing/recommendation questions to Gemini Barista AI before fuzzy item matching
  if (process.env.NODE_ENV !== 'test' && isConversationalInquiry(rawText, session)) {
    const geminiInquiry = await tryGeminiConversationalTurn(psid, session, rawText);
    if (geminiInquiry) {
      return geminiInquiry;
    }
  }
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
    const extractedQuantity = (nlu && nlu.quantity) || parseQuantity(rawText) || 1;

    session.pending_suggestion = {
      name: topCand.name,
      quantity: extractedQuantity,
      price: topCand.price,
      id: topCand.id,
      menuItemId: topCand.id
    };
    session.pendingItem = { id: topCand.id, name: topCand.name, price: topCand.price, quantity: extractedQuantity };
    session.current_step = 'AWAITING_SUGGESTION_CONFIRMATION';
    session.state = 'AWAITING_SUGGESTION_CONFIRMATION';
    await saveSession(session);

    const replyMsg = `Did you mean: ${topCand.name}?`;
    await sendQuickReplies(psid, replyMsg, [
      { title: 'Yes', payload: 'CONFIRM_YES' },
      { title: 'No', payload: 'CONFIRM_NO' }
    ]);
    return { intent: 'ORDER_ITEM_CONFIRM', confidence: 0.7, replyLog: replyMsg };
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

  // Generative AI Conversational Barista fallback (Google Gemini via @google/genai)
  if (process.env.NODE_ENV !== 'test') {
    const geminiTurn = await tryGeminiConversationalTurn(psid, session, rawText);
    if (geminiTurn) {
      return geminiTurn;
    }
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
 * Finalize and place real order from Stage 5 confirmation
 */
async function handleStage5Confirmation(psid, session) {
  const p = session.pendingStage5 || {};
  const customerName = p.name || session.customer_name || session.details?.name || 'Customer';
  const deliveryAddress = p.address || session.delivery_address || session.details?.address || 'Inside Cafe (Open Seating / Counter Pickup)';
  const orderType = (p.orderType === 'pickup' || p.orderType === 'dine_in') ? 'pickup' : 'delivery';
  const paymentMethod = p.paymentMethod || 'gcash';
  const totalAmount = p.total || session.order_total || 0;

  let items = [];
  if (session.cart && session.cart.length > 0) {
    items = session.cart.map(c => ({
      menuItemId: c.menuItemId || c.id || 13,
      name: c.name,
      quantity: c.quantity || 1,
      unitPrice: c.price || 1
    }));
  } else if (session.ordered_items && session.ordered_items.length > 0) {
    items = session.ordered_items.map(c => ({
      menuItemId: c.menuItemId || c.id || 13,
      name: c.name,
      quantity: c.quantity || 1,
      unitPrice: c.price || 1
    }));
  } else {
    items = [{ menuItemId: 13, name: 'qwertys', quantity: 1, unitPrice: 1 }];
  }

  let quoteToken = session.quote?.quoteToken || session.quoteToken || null;
  if (!quoteToken && orderType === 'delivery') {
    quoteToken = jwt.sign(
      {
        lat: Number(config.store?.lat) || 14.6042,
        lng: Number(config.store?.lng) || 120.9822,
        address: deliveryAddress,
        distanceKm: session.distance_km || 2.5,
        vehicleType: 'motorcycle',
        weatherCondition: 'sunny',
        deliveryFee: session.delivery_fee || 129.00
      },
      config.jwtSecret,
      { audience: 'delivery-quote', expiresIn: 900 }
    );
  }

  const newOrder = await createOrder(psid, {
    customerName,
    customerPhone: session.contact_number || session.details?.phone || '09170000000',
    deliveryAddress,
    orderType,
    paymentMethod,
    amountPaid: paymentMethod === 'gcash' ? totalAmount : 0,
    items,
    deliveryFee: session.delivery_fee || 0,
    totalAmount,
    customerNotes: 'Stage 5 Order Placed',
    quoteToken
  });

  const orderNum = newOrder.orderNumber || newOrder.order_number;
  session.activeOrderNumber = orderNum;
  session.cart = [];
  session.pendingStage5 = null;

  if (paymentMethod === 'gcash') {
    session.state = 'AWAITING_PAYMENT_VERIFICATION';
    session.current_step = 'AWAITING_PAYMENT_VERIFICATION';
    await saveSession(session);

    const baseAppUrl = (config.appUrl || 'http://localhost:3000').replace(/\/+$/, '');
    const gcashFullQrUrl = `${baseAppUrl}/images/gcash_full_qr.png`;
    const gcashRedirectUrl = `${baseAppUrl}/pay/gcash?psid=${encodeURIComponent(psid)}`;

    const textMsg = `Maraming salamat po, Sir/Ma'am ${customerName}!\n\nPumasok na po sa Diner's Cafe system ang inyong order (#${orderNum}).\nTotal Amount: ₱${parseFloat(totalAmount).toFixed(2)}\n\nPaki-send po ang bayad sa GCash (0928 176 2895 - FR****S DA*E F.). Pagkatapos mag-transfer, paki-send ang resibo o mag-reply ng "Send na po".`;
    await sendTextMessage(psid, textMsg);

    await sendGenericTemplate(psid, [
      {
        title: 'GCash Payment',
        subtitle: `Order #${orderNum} - ₱${parseFloat(totalAmount).toFixed(2)}`,
        image_url: gcashFullQrUrl,
        buttons: [
          {
            type: 'web_url',
            url: gcashRedirectUrl,
            title: 'Transfer with GCash',
            webview_height_ratio: 'compact'
          }
        ]
      }
    ], { image_aspect_ratio: 'square' });

    return { intent: 'ORDER_PLACED_AWAITING_GCASH', confidence: 1.0, replyLog: textMsg };
  } else {
    session.state = 'ORDER_PLACED';
    session.current_step = 'ORDER_PLACED';
    await saveSession(session);

    const textMsg = `Maraming salamat po, Sir/Ma'am ${customerName}!\n\nKumpirmado na po ang inyong order (#${orderNum})! Na-forward na po sa kusina ang inyong ticket para maihanda.\nTotal Amount: ₱${parseFloat(totalAmount).toFixed(2)} (Cash on Delivery).\n\nHintayin na lamang po ang inyong delivery. Salamat po sa pag-order sa Diner's Cafe!`;
    await sendQuickReplies(psid, textMsg, [
      { title: 'Track order', payload: 'TRACK_LATEST_ORDER' },
      { title: '☕ Menu', payload: 'MENU_HOME' }
    ]);
    return { intent: 'ORDER_PLACED_CASH', confidence: 1.0, replyLog: textMsg };
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
  let statusText = 'kasalukuyang inihahanda sa kusina (Pending)';
  if (o.status === 'preparing') statusText = 'kasalukuyang niluluto at inihahanda sa kusina';
  else if (o.status === 'dispatched') statusText = 'on the way na po kasama si kuya rider';
  else if (o.status === 'delivered') statusText = 'matagumpay nang nai-deliver';
  else if (o.status === 'cancelled') statusText = 'na-cancel po';

  const replyMsg = `Status ng inyong Order #${o.order_number}:\nIto po ay ${statusText}!\nTotal: ₱${parseFloat(o.total_amount).toFixed(2)} (${o.order_type.toUpperCase()}).`;
  await sendQuickReplies(
    psid,
    replyMsg,
    [
      { title: 'Track order', payload: 'TRACK_LATEST_ORDER' },
      { title: '☕ Menu', payload: 'MENU_HOME' }
    ]
  );
}

/**
 * Invoke Google Gemini Conversational AI for open-ended dialogue, recommendations,
 * menu questions, and natural-language multi-item extraction.
 */
async function tryGeminiConversationalTurn(psid, session, rawText) {
  try {
    const [menuItems] = await db.query(`
      SELECT m.id, m.name, m.description, m.price, c.name AS category_name, i.stock_quantity
      FROM menu_items m
      JOIN categories c ON c.id = m.category_id AND c.is_active = 1
      JOIN inventory i ON i.menu_item_id = m.id
      WHERE m.is_available = 1 AND i.stock_quantity > 0 AND COALESCE(m.is_deleted, 0) = 0
      ORDER BY c.display_order ASC, m.is_bestseller DESC, m.name ASC
    `);

    const geminiRes = await generateGeminiResponse(rawText, session, menuItems || []);
    if (!geminiRes || !geminiRes.replyText) {
      return null;
    }

    // Capture Stage 5 summary in session for explicit confirmation
    const isStage5Summary = /summary\s+ng\s+(?:inyong\s+)?order/i.test(geminiRes.replyText) ||
      (/\bName\s*:/i.test(geminiRes.replyText) && /\bLocation\s*:/i.test(geminiRes.replyText) && /\bTotal\s*:/i.test(geminiRes.replyText));

    if (isStage5Summary) {
      const nameMatch = geminiRes.replyText.match(/Name\s*:\s*([^\n]+)/i);
      const locMatch = geminiRes.replyText.match(/Location\s*:\s*([^\n]+)/i);
      const payMatch = geminiRes.replyText.match(/Payment option\s*:\s*([^\n]+)/i);
      const diningMatch = geminiRes.replyText.match(/Dining mode\s*:\s*([^\n]+)/i);
      const totalMatch = geminiRes.replyText.match(/Total\s*:\s*(?:₱|PHP\s*)?([\d,.]+)/i);

      session.state = 'AWAITING_STAGE5_CONFIRM';
      session.current_step = 'AWAITING_STAGE5_CONFIRM';
      session.pendingStage5 = {
        name: nameMatch?.[1]?.trim() || session.customer_name || 'Customer',
        address: locMatch?.[1]?.trim() || session.delivery_address || 'Inside Cafe',
        paymentMethod: /gcash/i.test(payMatch?.[1] || '') ? 'gcash' : 'cash',
        orderType: /take\s*out/i.test(diningMatch?.[1] || '') ? 'pickup' : (/dine/i.test(diningMatch?.[1] || '') ? 'dine_in' : 'delivery'),
        total: totalMatch ? parseFloat(totalMatch[1].replace(/,/g, '')) : (session.order_total || 0),
        rawSummary: geminiRes.replyText
      };
      await saveSession(session);
    }

    // Feature 4: Multi-Item Batch Extraction to Cart
    const batchItems = (Array.isArray(geminiRes.items) && geminiRes.items.length > 0)
      ? geminiRes.items
      : (Array.isArray(geminiRes.extractedItems) ? geminiRes.extractedItems : []);

    if ((geminiRes.intent === 'ADD_TO_CART' || batchItems.length > 0) && batchItems.length > 0) {
      let addedCount = 0;
      if (!session.cart) session.cart = [];

      for (const ext of batchItems) {
        const rawName = String(ext.name || '').trim().toLowerCase();
        const dbItem = (menuItems || []).find(m =>
          (ext.menuItemId && m.id === Number(ext.menuItemId)) ||
          (rawName && (m.name.toLowerCase() === rawName || m.name.toLowerCase().includes(rawName) || rawName.includes(m.name.toLowerCase())))
        );
        if (dbItem) {
          const qty = Math.max(1, parseInt(ext.qty || ext.quantity, 10) || 1);
          const customParts = [];
          if (ext.size) customParts.push(`Size: ${ext.size}`);
          if (ext.customizations?.milk) customParts.push(`Milk: ${ext.customizations.milk}`);
          if (ext.customizations?.sugar_level) customParts.push(`Sugar: ${ext.customizations.sugar_level}`);
          if (ext.customizations?.temperature) customParts.push(`Temp: ${ext.customizations.temperature}`);
          if (ext.customizations?.egg) customParts.push(`Egg: ${ext.customizations.egg}`);
          if (ext.customizations?.specialInstructions) customParts.push(ext.customizations.specialInstructions);
          if (ext.specialInstructions) customParts.push(ext.specialInstructions);

          const specialNotes = customParts.join(', ');
          const line = addToCart(session.cart, dbItem, qty);
          if (specialNotes) {
            line.specialInstructions = line.specialInstructions
              ? `${line.specialInstructions}; ${specialNotes}`
              : specialNotes;
          }
          addedCount += qty;
        }
      }

      if (addedCount > 0) {
        session.state = 'AWAITING_CHECKOUT_CONFIRM';
        const subtotal = calculateCartSubtotal(session.cart);
        const replyWithTotal = `${geminiRes.replyText}\n\nCart subtotal: ${peso(subtotal)}. Check out?`;
        await sendQuickReplies(psid, replyWithTotal, [
          { title: 'Yes, checkout', payload: 'CONFIRM_CHECKOUT' },
          { title: 'Add more', payload: 'KEEP_SHOPPING' },
          { title: 'View cart', payload: 'VIEW_CART' }
        ]);
        return {
          intent: 'GEMINI_ADD_TO_CART',
          confidence: 0.95,
          replyLog: replyWithTotal
        };
      }
    }

    // Map suggestedReplies cleanly to structured payloads where applicable
    const mappedReplies = (geminiRes.suggestedReplies || []).slice(0, 4).map(label => {
      const lower = label.toLowerCase();
      if (lower.includes('menu')) return { title: '☕ Menu', payload: 'MENU_HOME' };
      if (lower.includes('cart')) return { title: '🛒 Cart', payload: 'VIEW_CART' };
      if (lower.includes('checkout') || lower.includes('check out')) return { title: 'Checkout', payload: 'CONFIRM_CHECKOUT' };
      if (lower.includes('track')) return { title: 'Track order', payload: 'TRACK_LATEST_ORDER' };
      return { title: label.slice(0, 20), payload: '' };
    }).filter(qr => qr.title);

    const quickReplies = mappedReplies.length > 0
      ? mappedReplies.map(qr => qr.payload ? qr : qr.title)
      : [
          { title: '☕ Menu', payload: 'MENU_HOME' },
          { title: '🛒 Cart', payload: 'VIEW_CART' }
        ];

    await sendQuickReplies(psid, geminiRes.replyText, quickReplies);
    return {
      intent: `GEMINI_${geminiRes.intent || 'CHAT'}`,
      confidence: 0.95,
      replyLog: geminiRes.replyText
    };
  } catch (err) {
    console.warn('[Gemini Turn Fallback Warning]', err.message);
    return null;
  }
}

module.exports = {
  handleMessageEvent,
  handleTextInput,
  macroState,
  expireStaleState,
  sendFullMenu,
  getSession,
  saveSession,
  clearSessionCart,
  getChatbotStatus,
  setChatbotStatus,
  verifyPaymentTransaction,
  recognizeReceipt,
  parseReceiptText,
  generateSummaryReceipt
};
