/**
 * Conversational AI & NLP Intent Engine (Conversation Flow v2)
 * Implements full conversational state machine, whole menu carousel without category gate,
 * customer details collection before payment, order breakdown with delivery fee,
 * automatic post-delivery feedback, short reply understanding, and cart item removal.
 */

const fs = require('fs');
const path = require('path');
const db = require('../../database/db');
const config = require('../config/config');
const storeSettingsService = require('./storeSettingsService');
const systemSettingsService = require('./systemSettingsService');
const jwt = require('jsonwebtoken');
const { createOrder, verifyOrderPayment } = require('./orderService');
const xenditService = require('./xenditService');
const {
  shouldUseXenditCheckout,
  buildPendingGcashOrder,
  getPendingGcashStatus,
  registerFailedProofAttempt,
  extractReferenceNumber,
  isDuplicateReferenceNumber,
  matchAdminGcashTransaction,
  markAdminGcashMatched
} = require('./personalGcashService');
const {
  sendTextMessage,
  sendImageAttachment,
  sendQuickReplies,
  sendGenericTemplate,
  sendButtonTemplate,
  resolveMessengerImageUrl
} = require('./messengerService');
const {
  isRemovalIntent,
  matchCartItem,
  parseRemovalRequests,
  executeMultiItemRemoval,
  formatRemovalResponse
} = require('./removalService');
const {
  isBatchAddIntent,
  isBatchRemoveIntent,
  executeBatchAdd,
  executeBatchRemove,
  formatUpdatedCartResponse
} = require('./batchCartService');
const notificationService = require('./notificationService');
const { queryWitAi, localNluParse } = require('./witAiService');
const { getSession, saveSession, clearSessionCart, resetUserSession } = require('./sessionManager');
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
const { calculateDeliveryFee, computeDeliveryFee, getStoreOrigin } = require('./deliveryFeeCalculator');
const { geocodeCustomerAddress, sanitizeCustomerAddress } = require('./customerGeocodingService');
const fareEngine = require('./fareEngine');
const { applyStrikethrough, buildTextMenuPayload } = require('./textMenuService');
const {
  isItemPhotoRequest,
  extractPhotoItemQuery,
  findBestFuzzyMenuMatch,
  lookupMenuItemForPhoto,
  resolvePhotoAttachmentUrl
} = require('./itemPhotoService');
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
const aiService = require('./aiService');
const { parseCustomerFeedback, processFeedbackSubmission } = require('./feedbackParser');

const MENU_MAX_ITEMS = parseInt(process.env.MENU_MAX_ITEMS, 10) || 50;
const NLP_STATE_TTL_MIN = parseInt(process.env.NLP_STATE_TTL_MIN, 10) || 30;

let isChatbotActive = true;
let lastToggledBy = 'System';
let lastToggledAt = new Date().toISOString();

function getChatbotStatus() {
  const sys = systemSettingsService.getCachedSystemSettings();
  return {
    isEnabled: Boolean(sys.chatbot_enabled),
    chatbot_enabled: sys.chatbot_enabled,
    lastToggledBy: sys.last_toggled_by || lastToggledBy,
    lastToggledAt: sys.last_toggled_at || lastToggledAt
  };
}

function setChatbotStatus(enabled, user = 'Admin') {
  isChatbotActive = Boolean(enabled);
  lastToggledBy = user;
  lastToggledAt = new Date().toISOString();
  systemSettingsService.updateSystemSettings({ chatbot_enabled: Boolean(enabled), updated_by: user }).catch(() => {});
  return getChatbotStatus();
}

const STORE_ADDRESS = "Diner's Cafe - Store Main Branch, Mandaluyong City";

function getStoreAddress() {
  try {
    const settings = storeSettingsService.getCachedStoreSettings();
    return settings.store_address || STORE_ADDRESS;
  } catch (e) {
    return STORE_ADDRESS;
  }
}

function isDeliveryDiningMode(diningMode) {
  if (!diningMode) return true;
  return /delivery/i.test(String(diningMode).trim());
}

function parsePaymentModeValue(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/\b(?:xendit|online(?:\s*payment)?|gcash|g-?cash|maya|paymaya|grabpay|e-?wallet|bank|card)\b/i.test(s)) {
    return 'Xendit';
  }
  if (/\b(?:cash|cod|kaliwaan)\b/i.test(s)) {
    return 'Cash';
  }
  return null;
}

/**
 * Conditional Checkout Information Prompt (Slot-Filling)
 * CASE A: Delivery -> Name, Phone number, Address, Landmark, Payment mode, note
 * CASE B: Dine In / Pick-up -> Name, Phone number, Arriving time, Payment mode, note
 */
function getCheckoutInfoPrompt(session) {
  const mode = session?.dining_mode || (session?.orderType === 'delivery' ? 'Delivery' : 'Dine In');
  if (isDeliveryDiningMode(mode)) {
    return `Pakibigay po ang sumusunod para sa inyong order:
Name:
Phone number:
Address:
Landmark:
Payment mode: (Cash or Online Payment / Xendit)
note:`;
  } else {
    return `Pakibigay po ang sumusunod para sa inyong order:
Name:
Phone number:
Arriving time:
Payment mode: (Cash or Online Payment / Xendit)
note:`;
  }
}

/**
 * Parse Customer Info (Address, Landmark, Arriving Time, Name, Contact, Payment Mode, Note) from customer input
 * @param {string} rawText 
 * @param {string} [diningMode]
 * @returns {{ address: string, landmark: string, arrivingTime: string, arriving_time: string, name: string, contact: string, paymentMode: string, note: string }}
 */
function parseCustomerInfo(rawText, diningMode) {
  let address = '';
  let landmark = '';
  let arrivingTime = '';
  let name = '';
  let contact = '';
  let paymentMode = 'Cash';
  let note = '';

  const clean = String(rawText || '').trim();
  const isDelivery = diningMode ? isDeliveryDiningMode(diningMode) : true;

  // 1. Labeled pattern matching
  const addressMatch = clean.match(/(?:address|tirahan|location|table|counter)\s*[:=-]\s*([^\n\r]+?)(?=\s*(?:\blandmark\b|\barriving(?:\s*time)?\b|\barrival\b|\bname\b|\bpangalan\b|\bcontact\b|\bphone\b|\bmobile\b|\bpayment\b|\bmode\b|\bnote\b|\bnotes\b|$))/i);
  const landmarkMatch = clean.match(/(?:landmark|tandaan|katabi|tapat)\s*[:=-]\s*([^\n\r]+?)(?=\s*(?:\baddress\b|\btirahan\b|\barriving(?:\s*time)?\b|\barrival\b|\bname\b|\bpangalan\b|\bcontact\b|\bphone\b|\bmobile\b|\bpayment\b|\bmode\b|\bnote\b|\bnotes\b|$))/i);
  const arrivingMatch = clean.match(/(?:arriving(?:\s*time)?|arrival(?:\s*time)?|pickup(?:\s*time)?|pick-up(?:\s*time)?|time|oras|dating|eta)\s*[:=-]\s*([^\n\r]+?)(?=\s*(?:\baddress\b|\btirahan\b|\blandmark\b|\bname\b|\bpangalan\b|\bcontact\b|\bphone\b|\bmobile\b|\bpayment\b|\bmode\b|\bnote\b|\bnotes\b|$))/i);
  const nameMatch = clean.match(/(?:name|pangalan)\s*[:=-]\s*([^\n\r]+?)(?=\s*(?:\baddress\b|\btirahan\b|\blandmark\b|\barriving(?:\s*time)?\b|\barrival\b|\bcontact\b|\bphone\b|\bmobile\b|\bpayment\b|\bmode\b|\bnote\b|\bnotes\b|$))/i);
  const contactMatch = clean.match(/(?:contact(?:\s*number)?|phone(?:\s*number)?|mobile|cellphone)\s*[:=-]\s*([^\n\r]+?)(?=\s*(?:\baddress\b|\btirahan\b|\blandmark\b|\barriving(?:\s*time)?\b|\barrival\b|\bname\b|\bpangalan\b|\bpayment\b|\bmode\b|\bnote\b|\bnotes\b|$))/i);
  const payMatch = clean.match(/(?:payment(?:\s*mode|\s*option)?|mode\s*of\s*payment|bayad)\s*[:=-]\s*([^\n\r]+?)(?=\s*(?:\baddress\b|\blandmark\b|\barriving(?:\s*time)?\b|\barrival\b|\bname\b|\bcontact\b|\bphone\b|\bnote\b|\bnotes\b|$))/i);
  const noteMatch = clean.match(/(?:note|notes|paalala|bilin|instruction|instructions)\s*[:=-]\s*([^\n\r]+?)(?=\s*(?:\baddress\b|\blandmark\b|\barriving(?:\s*time)?\b|\barrival\b|\bname\b|\bcontact\b|\bphone\b|\bpayment\b|\bmode\b|$))/i);

  if (addressMatch) address = addressMatch[1].trim();
  if (landmarkMatch) landmark = landmarkMatch[1].trim();
  if (arrivingMatch) arrivingTime = arrivingMatch[1].trim();
  if (nameMatch) name = nameMatch[1].trim();
  if (contactMatch) contact = contactMatch[1].trim();
  if (noteMatch) note = noteMatch[1].trim();

  if (payMatch) {
    paymentMode = parsePaymentModeValue(payMatch[1]) || 'Cash';
  } else {
    paymentMode = parsePaymentModeValue(clean) || 'Cash';
  }

  // 2. Multiline or delimiter-based fallback
  const needsAddress = isDelivery;
  if ((needsAddress && !address) || !name || !contact) {
    const rawLines = clean.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const lines = [...rawLines];

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (/^(?:address|tirahan|location)[:=-]?\s*/i.test(line) && !address) {
        address = line.replace(/^(?:address|tirahan|location)[:=-]?\s*/i, '').trim();
        lines.splice(i, 1);
      } else if (/^(?:landmark|tandaan|katabi|tapat)[:=-]?\s*/i.test(line) && !landmark) {
        landmark = line.replace(/^(?:landmark|tandaan|katabi|tapat)[:=-]?\s*/i, '').trim();
        lines.splice(i, 1);
      } else if (/^(?:arriving(?:\s*time)?|arrival(?:\s*time)?|pickup(?:\s*time)?|pick-up(?:\s*time)?|time|oras|dating|eta)[:=-]?\s*/i.test(line) && !arrivingTime) {
        arrivingTime = line.replace(/^(?:arriving(?:\s*time)?|arrival(?:\s*time)?|pickup(?:\s*time)?|pick-up(?:\s*time)?|time|oras|dating|eta)[:=-]?\s*/i, '').trim();
        lines.splice(i, 1);
      } else if (/^(?:note|notes|paalala|bilin)[:=-]?\s*/i.test(line) && !note) {
        note = line.replace(/^(?:note|notes|paalala|bilin)[:=-]?\s*/i, '').trim();
        lines.splice(i, 1);
      } else if (/^(?:name|pangalan)[:=-]?\s*/i.test(line) && !name) {
        name = line.replace(/^(?:name|pangalan)[:=-]?\s*/i, '').trim();
        lines.splice(i, 1);
      } else if (/^(?:contact(?:\s*number)?|phone(?:\s*number)?|mobile)[:=-]?\s*/i.test(line) && !contact) {
        contact = line.replace(/^(?:contact(?:\s*number)?|phone(?:\s*number)?|mobile)[:=-]?\s*/i, '').trim();
        lines.splice(i, 1);
      } else if (/^(?:payment(?:\s*mode|\s*option)?|bayad)[:=-]?\s*/i.test(line)) {
        paymentMode = parsePaymentModeValue(line) || 'Cash';
        lines.splice(i, 1);
      }
    }

    if (!contact) {
      const phoneIdx = lines.findIndex(l => /\b09\d{9}\b|\b\+?63\d{10}\b/i.test(l));
      if (phoneIdx !== -1) {
        contact = lines[phoneIdx];
        lines.splice(phoneIdx, 1);
      }
    }

    if (needsAddress && !address) {
      const addrIdx = lines.findIndex(l => /\d+|st\b|street|ave\b|avenue|brgy|barangay|city|manila|road|rd\b|blk|lot|table|counter/i.test(l));
      if (addrIdx !== -1) {
        address = lines[addrIdx];
        lines.splice(addrIdx, 1);
      }
    }

    if (!name && lines.length > 0) {
      name = lines[0];
      lines.splice(0, 1);
    }

    if (needsAddress && !address && lines.length > 0) {
      address = lines[0];
    }
  }

  if (needsAddress && !address && clean.length > 5) {
    address = clean;
  }

  return {
    address: address.trim(),
    landmark: landmark.trim(),
    arrivingTime: arrivingTime.trim(),
    arriving_time: arrivingTime.trim(),
    name: name.trim(),
    contact: contact.trim(),
    paymentMode,
    note: note.trim()
  };
}

/**
 * Plaintext Order Summary Layout
 * Template 1: Dine In / Pick-up
 * Template 2: Delivery
 */
function formatPlaintextOrderSummary(params = {}) {
  const name = params.name;
  const phone = params.phone || params.phone_number;
  const diningMode = params.diningMode || params.dining_mode || 'Delivery';
  const address = params.address || params.delivery_address;
  const landmark = params.landmark || '';
  const note = params.note || params.customer_note || '';
  const discountType = params.discountType || (params.discount && params.discount.type) || 'None';
  const paymentMode = params.paymentMode || params.payment_mode || params.paymentMethod || params.payment_method || 'Cash';
  const cart = params.cart || [];
  const subtotal = params.subtotal !== undefined
    ? params.subtotal
    : (params.order_subtotal !== undefined ? params.order_subtotal : (cart.length > 0 ? calculateCartSubtotal(cart) : 0));
  const discountAmount = params.discountAmount !== undefined
    ? params.discountAmount
    : (params.discount_amount !== undefined ? params.discount_amount : (params.discount?.amount || 0));
  const deliveryFee = params.deliveryFee !== undefined
    ? params.deliveryFee
    : (params.delivery_fee !== undefined ? params.delivery_fee : 0);
  const total = params.total !== undefined
    ? params.total
    : (params.order_total !== undefined ? params.order_total : (params.total_amount !== undefined ? params.total_amount : (subtotal - discountAmount + deliveryFee)));
  let formattedDiningMode = diningMode;
  if (/dine[\s-]*in/i.test(diningMode)) formattedDiningMode = 'Dine In';
  else if (/pick[\s-]*up|pickup|take[\s-]*out|takeout/i.test(diningMode)) formattedDiningMode = 'Pick-up';
  else formattedDiningMode = 'Delivery';

  const isDelivery = formattedDiningMode === 'Delivery';

  let formattedAddress = address;
  const currentStoreAddress = getStoreAddress();
  if (!isDelivery) {
    formattedAddress = currentStoreAddress || "Diner's Cafe, Tondo, Manila";
  } else if (!formattedAddress || /inside cafe|open seating|counter pickup|store counter/i.test(formattedAddress)) {
    formattedAddress = currentStoreAddress || "Diner's Cafe, Tondo, Manila";
  }

  const effectiveNote = (note || '').trim() || 'None';
  const effectiveLandmark = (landmark || '').trim() || 'None';

  const orderLines = (cart || []).map(item => {
    const qty = item.quantity || 1;
    const basePrice = parseFloat(item.price || item.unitPrice || 0);
    const rawAddons = Array.isArray(item.addOns)
      ? item.addOns
      : (Array.isArray(item.addons) ? item.addons : (item.addon ? [item.addon] : []));

    let addonsCost = 0;
    rawAddons.forEach(a => {
      addonsCost += typeof a === 'object' ? (parseFloat(a.price) || 20.0) : 20.0;
    });

    const effectiveUnitPrice = basePrice + addonsCost;
    const lineTotal = (qty * effectiveUnitPrice).toFixed(2);
    const addonNames = rawAddons.map(a => typeof a === 'object' ? a.name : a);
    let addonText = '';
    if (addonNames.length > 0 && !item.name.toLowerCase().includes('w/')) {
      addonText = ` (w/ ${addonNames.join(', ')})`;
    }

    return `- ${qty}x ${item.name}${addonText} (₱${lineTotal})`;
  }).join('\n');

  const formattedSubtotal = Number(subtotal || 0).toFixed(2);
  const formattedDiscount = Number(discountAmount || 0).toFixed(2);
  const formattedDeliveryFee = Number(isDelivery ? (deliveryFee || 0) : 0).toFixed(2);
  const formattedTotal = Number(total || 0).toFixed(2);

  if (isDelivery) {
    return `--- ORDER SUMMARY ---
Name: ${name || 'Customer'}
Phone number: ${phone || ''}
Dining-mode: Delivery
Address: ${formattedAddress || ''}
Landmark: ${effectiveLandmark}
Discount: ${discountType || 'None'}
Payment Mode: ${paymentMode || 'Cash'}

Orders:
${orderLines}

Note: ${effectiveNote}

Subtotal: ₱${formattedSubtotal}
Discount: ₱${formattedDiscount}
Delivery Fee: ₱${formattedDeliveryFee}
TOTAL AMOUNT DUE: ₱${formattedTotal}`;
  } else {
    return `--- ORDER SUMMARY ---
Name: ${name || 'Customer'}
Phone number: ${phone || ''}
Dining-mode: ${formattedDiningMode}
Address: ${formattedAddress}
Discount: ${discountType || 'None'}
Payment Mode: ${paymentMode || 'Cash'}

Orders:
${orderLines}

Note: ${effectiveNote}

Subtotal: ₱${formattedSubtotal}
Discount: ₱${formattedDiscount}
Delivery Fee: ₱0.00
TOTAL AMOUNT DUE: ₱${formattedTotal}`;
  }
}

const formatPlaintextSummaryReceipt = formatPlaintextOrderSummary;

/**
 * Create a direct PH_GCASH Xendit Charge (with GCash-only Invoice fallback) and send checkout button template + cancel/menu quick replies to Messenger.
 */
async function dispatchXenditCheckout(psid, session, { orderId, orderNum, totalAmount, customerName, customerPhone }) {
  const charge = await xenditService.createGcashCharge({
    orderNumber: orderNum,
    amount: totalAmount,
    customerName,
    customerPhone,
    description: `Diner's Cafe Order #${orderNum}`
  });

  const checkoutUrl = charge.checkout_url || charge.invoice_url;

  if (orderId) {
    await db.query(
      `UPDATE orders
       SET payment_ref_number = ?, receipt_url = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [charge.id || null, checkoutUrl || null, orderId]
    ).catch(() => {});

    await db.query(
      `UPDATE payments
       SET reference_no = ?, receipt_url = ?, updated_at = CURRENT_TIMESTAMP
       WHERE order_id = ?`,
      [charge.id || null, checkoutUrl || null, orderId]
    ).catch(() => {});
  }

  session.activeOrderNumber = orderNum;
  session.active_order_id = orderId;
  session.order_id = orderId;
  session.cart = [];
  await clearSessionCart(psid);
  session.checkout_step = null;
  session.state = 'IDLE';
  session.current_step = 'IDLE';
  await saveSession(session);

  const payText = `📱 GCASH DIRECT PAYMENT (via Xendit)\nOrder #${orderNum}\nTotal Amount: ₱${Number(totalAmount).toFixed(2)}\n\nPindutin ang button sa ibaba upang direktang magbayad gamit ang GCash. Awtomatikong makukumpirma ang inyong order pagkabayad!`;

  await sendButtonTemplate(psid, payText, [
    {
      type: 'web_url',
      url: checkoutUrl,
      title: '📱 Pay with GCash',
      webview_height_ratio: 'full'
    }
  ]);

  await sendQuickReplies(psid, 'Kung nais ninyong i-cancel o bumalik sa menu:', [
    { title: '❌ Cancel Order', payload: `CANCEL_ORDER_${orderNum}` },
    { title: '📋 Menu', payload: 'MENU' }
  ]);

  return {
    intent: 'ORDER_PLACED_XENDIT',
    confidence: 1.0,
    replyLog: `${payText}\nCheckout Link: ${checkoutUrl}`,
    orderNumber: orderNum,
    invoiceUrl: checkoutUrl
  };
}

/**
 * Pay-First Personal GCash Checkout Dispatcher (Zero DB/Kitchen Pollution Until Proof Uploaded).
 * Sends store GCash QR image + recipient details + GCash App redirect link, and puts session into AWAITING_PAYMENT_PROOF.
 */
async function dispatchPersonalGcashCheckout(psid, session, draftData = {}) {
  const pendingStatus = getPendingGcashStatus(session);
  const existingPending = pendingStatus.active ? pendingStatus.pending : null;

  const pending = buildPendingGcashOrder(session, draftData);
  if (existingPending && existingPending.cooldownUntil && Date.now() < existingPending.cooldownUntil) {
    const waitMin = pendingStatus.remainingCooldownMinutes || 10;
    const cooldownMsg = `May aktibong security cooldown pa po sa pag-send ng GCash proof. Maghintay ng ${waitMin} minuto bago subukang muli, o pumili ng Cash payment.`;
    await sendQuickReplies(psid, cooldownMsg, [
      { title: '❌ Cancel Checkout', payload: 'CANCEL_PENDING_GCASH' },
      { title: '📋 Menu', payload: 'MENU_HOME' }
    ]);
    return { intent: 'PAYMENT_PROOF_COOLDOWN', confidence: 1.0, replyLog: cooldownMsg };
  }

  session.pendingGCashOrder = pending;
  session.order_total = pending.grandTotal;
  session.state = 'AWAITING_PAYMENT_PROOF';
  session.checkout_step = 'AWAITING_PAYMENT_PROOF';
  session.current_step = 'AWAITING_PAYMENT_PROOF';
  await saveSession(session);

  let storeSettings = storeSettingsService.getCachedStoreSettings();
  try {
    storeSettings = await storeSettingsService.getStoreSettings();
  } catch (_) {}

  const gcashName = storeSettings?.gcash_account_name || config.store?.gcashName || "Diner's Cafe Official";
  const gcashNumber = storeSettings?.gcash_account_number || config.store?.gcashNumber || '0928 176 2895';
  const qrPath = storeSettings?.gcash_qr_image_url || '/images/gcash_official_qr.jpg';

  const baseUrl = (process.env.APP_BASE_URL || config.appUrl || 'http://localhost:3000').trim().replace(/\/+$/, '');
  const resolvedQrUrl = qrPath.startsWith('http://') || qrPath.startsWith('https://')
    ? qrPath
    : `${baseUrl}${qrPath.startsWith('/') ? qrPath : `/${qrPath}`}`;

  if (resolvedQrUrl.startsWith('https://') || resolvedQrUrl.startsWith('http://')) {
    await sendImageAttachment(psid, resolvedQrUrl).catch(() => {});
  }

  const gcashPortalUrl = `${baseUrl}/pay/gcash?psid=${encodeURIComponent(psid)}&amount=${Number(pending.grandTotal).toFixed(2)}&mode=personal`;
  const payText = `📱 GCASH PAYMENT (Pay-First Verification)\nTotal Amount: ₱${Number(pending.grandTotal).toFixed(2)}\nGCash Name: ${gcashName}\nGCash No: ${gcashNumber}\n\n1. Buksan ang GCash App o i-scan ang QR code sa itaas at ipadala ang eksaktong ₱${Number(pending.grandTotal).toFixed(2)}.\n2. I-send dito ang SCREENSHOT ng GCash receipt (o 13-digit Ref No.) sa loob ng 20 minuto.\n\n⚠️ Hindi po muna ipapadala sa kusina ang order hangga't walang valid GCash receipt.`;

  await sendButtonTemplate(psid, payText, [
    {
      type: 'web_url',
      url: gcashPortalUrl,
      title: '📱 Pay via GCash',
      webview_height_ratio: 'full'
    }
  ]);

  await sendQuickReplies(psid, 'Pagkatapos magbayad, i-send dito ang GCash receipt screenshot:', [
    { title: '❌ Cancel Checkout', payload: 'CANCEL_PENDING_GCASH' },
    { title: '📋 Menu', payload: 'MENU_HOME' }
  ]);

  return {
    intent: 'AWAITING_PAYMENT_PROOF',
    confidence: 1.0,
    replyLog: `${payText}\nGCash Portal: ${gcashPortalUrl}`,
    portalUrl: gcashPortalUrl
  };
}

/**
 * Finalize Order Summary, send receipt, and initiate payment (Cash, Personal GCash Pay-First, or Live Xendit)
 */
async function finalizeOrderSummaryAndPayment(psid, session) {
  const subtotal = session.order_subtotal || (session.cart ? calculateCartSubtotal(session.cart) : 0);
  const discountAmount = session.discount_amount || session.discount?.amount || 0;
  const discountType = (session.discount && session.discount.applied) ? (session.discount.type || 'Senior Citizen / PWD 20%') : 'None';

  let diningMode = session.dining_mode || (session.orderType === 'delivery' ? 'Delivery' : 'Dine In');
  if (/pick[\s-]*up|pickup|take[\s-]*out|takeout/i.test(diningMode)) diningMode = 'Pick-up';
  else if (/dine[\s-]*in/i.test(diningMode)) diningMode = 'Dine In';
  else diningMode = 'Delivery';

  session.dining_mode = diningMode;

  const isDelivery = diningMode === 'Delivery';
  const deliveryFee = isDelivery ? (Number.isFinite(session.delivery_fee) ? session.delivery_fee : (Number.isFinite(session.deliveryFee) ? session.deliveryFee : 40.00)) : 0;
  const grandTotal = Math.max(0, Math.round((subtotal - discountAmount + deliveryFee) * 100) / 100);

  session.order_total = grandTotal;
  session.delivery_fee = deliveryFee;
  session.deliveryFee = deliveryFee;

  let addressStr = session.delivery_address || session.address || '';
  const currentStoreAddr = getStoreAddress();
  if (diningMode === 'Dine In' || diningMode === 'Pick-up') {
    addressStr = currentStoreAddr;
    session.address = currentStoreAddr;
    session.delivery_address = currentStoreAddr;
  }

  const paymentMode = session.payment_mode || 'Cash';
  const customerName = session.customer_name || 'Customer';
  const contactNumber = session.contact_number || '';

  // Requirement 3: Standardized Plaintext Order Summary
  const summaryReceipt = formatPlaintextOrderSummary({
    name: customerName,
    phone: contactNumber,
    diningMode: diningMode,
    address: addressStr,
    landmark: session.landmark || session.details?.landmark || '',
    note: session.customer_notes || session.note || session.notes || session.details?.note || '',
    discountType: discountType,
    paymentMode: paymentMode,
    cart: session.cart || [],
    subtotal: subtotal,
    discountAmount: discountAmount,
    deliveryFee: deliveryFee,
    total: grandTotal
  });

  await sendTextMessage(psid, summaryReceipt);

  if (paymentMode === 'Cash') {
    try {
      const order = await createOrder(psid, {
        customerName,
        customerPhone: contactNumber,
        deliveryAddress: addressStr,
        orderType: isDelivery ? 'delivery' : 'pickup',
        dining_mode: diningMode || (isDelivery ? 'Delivery' : 'Pick-up'),
        landmark: session.landmark || null,
        arriving_time: session.arriving_time || session.arrivingTime || session.eta || null,
        note: session.customer_notes || session.note || session.notes || null,
        paymentMethod: 'cash',
        amountPaid: 0,
        items: (session.cart || []).map(c => ({
          menuItemId: c.menuItemId || c.id,
          name: c.name,
          quantity: c.quantity || 1,
          unitPrice: c.price,
          price: c.price,
          price_at_time: c.price,
          addOns: c.addOns || c.addons
        })),
        deliveryFee,
        totalAmount: grandTotal,
        discountAmount,
        is_preorder: Boolean(session.is_preorder)
      });

      const orderNum = order.orderNumber || order.order_number;
      session.activeOrderNumber = orderNum;
      session.cart = [];
      await clearSessionCart(psid);
      session.state = 'IDLE';
      session.current_step = 'IDLE';
      await saveSession(session);

      const cashConfirmation = `Salamat po, ${customerName}! Na-receive na po namin ang inyong order #${orderNum} under Cash Payment. Ang inyong order ay Pending Approval. I-notify po namin kayo kapag approved na ng kitchen!`;
      await sendQuickReplies(psid, cashConfirmation, [
        { title: '❌ Cancel Order', payload: `CANCEL_ORDER_${orderNum}` },
        { title: '📋 Menu', payload: 'MENU' }
      ]);
      return { intent: 'ORDER_PLACED_CASH', confidence: 1.0, replyLog: cashConfirmation, orderNumber: orderNum };
    } catch (err) {
      console.error('[Cash Order Placement Error]', err);
      const errMsg = 'Paumanhin, nagkaroon ng error sa pag-record ng order. Pakisubukan muli o tumawag sa cafe.';
      await sendTextMessage(psid, errMsg);
      return { intent: 'ORDER_ERROR', confidence: 1.0 };
    }
  } else if (shouldUseXenditCheckout()) {
    // Live Xendit Payment Gateway Flow
    try {
      const order = await createOrder(psid, {
        customerName,
        customerPhone: contactNumber,
        deliveryAddress: addressStr,
        orderType: isDelivery ? 'delivery' : 'pickup',
        dining_mode: diningMode || (isDelivery ? 'Delivery' : 'Pick-up'),
        landmark: session.landmark || null,
        arriving_time: session.arriving_time || session.arrivingTime || session.eta || null,
        note: session.customer_notes || session.note || session.notes || null,
        paymentMethod: 'xendit',
        amountPaid: 0,
        items: (session.cart || []).map(c => ({
          menuItemId: c.menuItemId || c.id,
          name: c.name,
          quantity: c.quantity || 1,
          unitPrice: c.price,
          price: c.price,
          price_at_time: c.price,
          addOns: c.addOns || c.addons
        })),
        deliveryFee,
        totalAmount: grandTotal,
        discountAmount,
        is_preorder: Boolean(session.is_preorder),
        paymentStatus: 'Pending'
      });

      const orderNum = order.orderNumber || order.order_number;
      const orderId = order.orderId || order.id;
      return await dispatchXenditCheckout(psid, session, {
        orderId,
        orderNum,
        totalAmount: grandTotal,
        customerName,
        customerPhone: contactNumber
      });
    } catch (err) {
      console.error('[Xendit Order Placement Error]', err);
      const errMsg = 'Paumanhin, nagkaroon ng error sa paggawa ng Xendit payment link. Pakisubukan muli o pumili ng Cash payment.';
      await sendTextMessage(psid, errMsg);
      return { intent: 'ORDER_ERROR', confidence: 1.0, replyLog: errMsg };
    }
  } else {
    // Pay-First Personal GCash Flow (No DB order created until proof of payment is verified)
    return await dispatchPersonalGcashCheckout(psid, session, {
      customerName,
      customerPhone: contactNumber,
      deliveryAddress: addressStr,
      orderType: isDelivery ? 'delivery' : 'pickup',
      dining_mode: diningMode || (isDelivery ? 'Delivery' : 'Pick-up'),
      landmark: session.landmark || null,
      arriving_time: session.arriving_time || session.arrivingTime || session.eta || null,
      note: session.customer_notes || session.note || session.notes || null,
      items: (session.cart || []).map(c => ({
        menuItemId: c.menuItemId || c.id,
        name: c.name,
        quantity: c.quantity || 1,
        unitPrice: c.price,
        price: c.price,
        price_at_time: c.price,
        addOns: c.addOns || c.addons
      })),
      subtotal,
      discountAmount,
      deliveryFee,
      grandTotal,
      is_preorder: Boolean(session.is_preorder)
    });
  }
}

/**
 * Calculate distance from Diner's Cafe and delivery fee based on distance
 * Formula: Base fee ₱40.00 (first 2 km) + ₱12.00 per km beyond 2 km (rounded up to nearest km)
 * @param {string|Object} addressOrCoords
 * @returns {Promise<{ distanceKm: number, deliveryFee: number, formattedAddress: string, isBeyondRadius: boolean, maxRadiusKm: number }>}
 */
async function calculateDeliveryDistanceAndFee(addressOrCoords) {
  const result = await calculateDeliveryFee(addressOrCoords);
  return {
    distanceKm: result.distanceKm,
    deliveryFee: result.deliveryFee,
    formattedAddress: result.formattedAddress || (typeof addressOrCoords === 'string' ? addressOrCoords : ''),
    isBeyondRadius: result.isBeyondRadius,
    isDeliverable: result.isDeliverable,
    radiusLimitKm: result.radiusLimitKm,
    maxRadiusKm: result.maxRadiusKm,
    destination: result.destination
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
 * Completely purge all session and cached order data on reset (Issue 4)
 * @param {Object} session
 */
function purgeSessionData(session) {
  if (!session) return;
  session.name = null;
  session.phone_number = null;
  session.address = null;
  session.dining_mode = null;
  session.orderType = null;
  session.order_type = null;
  session.cart = [];
  session.ordered_items = [];
  session.discount = null;
  session.discount_info = null;
  session.state = 'INITIAL_GREETING';
  session.current_step = 'INITIAL_GREETING';
  session.details = null;
  session.customer_name = null;
  session.contact_number = null;
  session.delivery_address = null;
  session.quote = null;
  session.checkout = null;
  session.order_subtotal = null;
  session.order_total = null;
  session.pendingStage5 = null;
  session.pendingItem = null;
  session.pending_suggestion = null;
  session.pendingAction = null;
  session.failedAttempts = 0;
  session.warning20Sent = false;
  session.warning25Sent = false;
  session.purged30Sent = true;
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

  if (elapsedMin > NLP_STATE_TTL_MIN) {
    purgeSessionData(session);
  }
}

/**
 * Save incoming payment proof image to /public/uploads/payments/
 * @param {string|Buffer|Object} fileSource - Image URL, base64 data URI, or local path
 * @param {string|number} orderId - Associated order ID
 * @returns {Promise<string>} Saved relative public path (e.g. /uploads/payments/payment_proof_123_1794.jpg)
 */
async function savePaymentProofImage(fileSource, orderId) {
  const uploadDir = path.join(__dirname, '../../public/uploads/payments');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const timestamp = Date.now();
  let ext = 'jpg';
  let buffer = null;

  if (Buffer.isBuffer(fileSource)) {
    buffer = fileSource;
  } else if (typeof fileSource === 'string') {
    if (fileSource.startsWith('data:image/')) {
      const matches = fileSource.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
      if (matches) {
        ext = matches[1].includes('png') ? 'png' : (matches[1].includes('webp') ? 'webp' : 'jpg');
        buffer = Buffer.from(matches[2], 'base64');
      }
    } else if (fileSource.startsWith('http://') || fileSource.startsWith('https://')) {
      try {
        const res = await fetch(fileSource);
        if (res.ok) {
          const arrayBuf = await res.arrayBuffer();
          buffer = Buffer.from(arrayBuf);
          const contentType = res.headers.get('content-type') || '';
          if (contentType.includes('png')) ext = 'png';
          else if (contentType.includes('webp')) ext = 'webp';
        }
      } catch (fErr) {
        console.warn('[savePaymentProofImage] Fetch failed, writing fallback placeholder:', fErr.message);
      }
    } else if (fs.existsSync(fileSource)) {
      buffer = fs.readFileSync(fileSource);
      ext = path.extname(fileSource).replace('.', '') || 'jpg';
    }
  }

  const filename = `payment_proof_${orderId || 'ord'}_${timestamp}.${ext}`;
  const targetPath = path.join(uploadDir, filename);

  if (buffer) {
    fs.writeFileSync(targetPath, buffer);
  } else {
    fs.writeFileSync(targetPath, Buffer.from('mock_payment_proof_receipt_image'));
  }

  return `/uploads/payments/${filename}`;
}

/**
 * Shared guard helper before accepting a GCash payment proof submission.
 * Handles 20-minute expiration and 3-strike 10-minute spam cooldown.
 */
async function checkPendingGcashGuard(psid, session) {
  const status = getPendingGcashStatus(session);
  if (status.expired) {
    session.pendingGCashOrder = null;
    session.checkout_step = null;
    session.state = 'IDLE';
    session.current_step = 'IDLE';
    await saveSession(session);
    const expiredMsg = 'Nag-expire na po ang inyong 20-minutong GCash checkout window (walang order na naitala sa kusina). Mag-type lamang ng "Menu" upang mag-order muli.';
    await sendQuickReplies(psid, expiredMsg, [{ title: '📋 Menu', payload: 'MENU_HOME' }]);
    return { blocked: true, intent: 'GCASH_CHECKOUT_EXPIRED', replyLog: expiredMsg };
  }

  if (status.cooldownActive) {
    const cooldownMsg = `Nakapag-send po ng sunod-sunod na hindi valid na resibo. Maghintay ng ${status.remainingCooldownMinutes} minuto bago mag-upload muli.`;
    await sendQuickReplies(psid, cooldownMsg, [
      { title: '❌ Cancel Checkout', payload: 'CANCEL_PENDING_GCASH' },
      { title: '📋 Menu', payload: 'MENU_HOME' }
    ]);
    return { blocked: true, intent: 'PAYMENT_PROOF_COOLDOWN', replyLog: cooldownMsg };
  }

  return { blocked: false, status };
}

/**
 * Resolve existing placed order ID on the session if one already exists (skipping unrelated old orders when pendingGCashOrder is active).
 */
async function resolveTargetOrderIdForProof(psid, session) {
  let orderId = session.active_order_id || session.order_id || null;
  if (!orderId && session.activeOrderNumber) {
    const [rows] = await db.query('SELECT id FROM orders WHERE order_number = ? LIMIT 1', [session.activeOrderNumber]);
    if (rows && rows.length > 0) orderId = rows[0].id;
  }
  if (!orderId && !session.pendingGCashOrder) {
    const [cRows] = await db.query('SELECT id FROM customers WHERE psid = ? LIMIT 1', [psid]);
    if (cRows && cRows.length > 0) {
      const [oRows] = await db.query('SELECT id, order_number FROM orders WHERE customer_id = ? ORDER BY id DESC LIMIT 1', [cRows[0].id]);
      if (oRows && oRows.length > 0) {
        orderId = oRows[0].id;
        session.activeOrderNumber = oRows[0].order_number;
      }
    }
  }
  return orderId;
}

/**
 * Shared Pay-First finalizer for verified image receipts and typed 9-13 digit GCash reference numbers.
 * Enforces duplicate Ref No. blocking, admin ledger auto-matching, and deferred DB order creation.
 */
async function finalizeOrderFromProofSubmission(psid, session, { referenceNumber, savedFilename = null, ocrAmount = null }) {
  const cleanRef = String(referenceNumber || '').trim();
  const pending = session.pendingGCashOrder || null;
  const expectedTotal = Number(pending?.grandTotal || session.order_total || 0);

  // 1. Anti-Scam: Duplicate Reference Number Blocker (no DB order created)
  const dupCheck = await isDuplicateReferenceNumber(cleanRef);
  if (dupCheck.duplicate) {
    const attemptInfo = registerFailedProofAttempt(pending);
    await saveSession(session);
    const dupMsg = attemptInfo.cooldownTriggered
      ? `Ang Reference Number (${cleanRef}) ay nagamit na sa ibang order. Naabot na ang limit kaya maghintay muna ng 10 minuto bago subukang muli.`
      : `Ang Reference Number na ito (${cleanRef}) ay nagamit na sa ibang order. Pakisend ang bagong GCash resibo.`;
    await sendQuickReplies(psid, dupMsg, [
      { title: '❌ Cancel Checkout', payload: 'CANCEL_PENDING_GCASH' },
      { title: '📋 Menu', payload: 'MENU_HOME' }
    ]);
    return { intent: 'DUPLICATE_REFERENCE', confidence: 1.0, replyLog: dupMsg };
  }

  // 2. Check Admin GCash Ledger (admin_gcash_transactions) for automatic verification
  const adminMatch = await matchAdminGcashTransaction(cleanRef, expectedTotal);
  if (adminMatch.duplicate) {
    const attemptInfo = registerFailedProofAttempt(pending);
    await saveSession(session);
    const dupMsg = `Ang Reference Number na ito (${cleanRef}) ay nagamit na sa ibang order. Pakisend ang bagong GCash resibo.`;
    await sendTextMessage(psid, dupMsg);
    return { intent: 'DUPLICATE_REFERENCE', confidence: 1.0, replyLog: dupMsg, attemptInfo };
  }

  if (adminMatch.matched && !adminMatch.exact) {
    const attemptInfo = registerFailedProofAttempt(pending);
    await saveSession(session);
    const mismatchMsg = `Hindi po tugma ang halagang pumasok sa GCash (₱${Number(adminMatch.actualPaid).toFixed(2)}) sa kabuuang halaga ng order (₱${expectedTotal.toFixed(2)}). Pakikumpleto ang bayad o makipag-ugnayan sa staff.`;
    await sendQuickReplies(psid, mismatchMsg, [
      { title: '❌ Cancel Checkout', payload: 'CANCEL_PENDING_GCASH' },
      { title: '📋 Menu', payload: 'MENU_HOME' }
    ]);
    return { intent: 'PAYMENT_AMOUNT_MISMATCH', confidence: 1.0, replyLog: mismatchMsg, attemptInfo };
  }

  let orderId = await resolveTargetOrderIdForProof(psid, session);
  const isAutoMatched = Boolean(adminMatch.matched && adminMatch.exact);

  if (!orderId && pending) {
    const newOrder = await createOrder(psid, {
      customerName: pending.customerName || session.customer_name || 'Customer',
      customerPhone: pending.contactNumber || session.contact_number || session.phone_number,
      deliveryAddress: pending.address || session.delivery_address || 'Store Pickup',
      orderType: pending.orderType || (pending.deliveryFee > 0 ? 'delivery' : 'pickup'),
      dining_mode: pending.dining_mode || (pending.deliveryFee > 0 ? 'Delivery' : 'Pick-up'),
      landmark: pending.landmark || session.landmark || null,
      arriving_time: pending.arriving_time || session.arriving_time || null,
      note: pending.note || session.customer_notes || session.note || null,
      paymentMethod: 'gcash',
      amountPaid: isAutoMatched ? adminMatch.actualPaid : (ocrAmount || 0),
      referenceNo: cleanRef,
      paymentProofImage: savedFilename,
      items: (pending.items || session.cart || []).map(c => ({
        menuItemId: c.menuItemId || c.id,
        name: c.name,
        quantity: c.quantity || 1,
        unitPrice: c.price,
        price: c.price,
        price_at_time: c.price,
        addOns: c.addOns || c.addons
      })),
      deliveryFee: pending.deliveryFee || 0,
      discountAmount: pending.discountAmount || 0,
      totalAmount: expectedTotal,
      quoteToken: pending.quoteToken || null,
      distanceKm: pending.distanceKm || 0,
      is_preorder: Boolean(pending.is_preorder),
      paymentStatus: isAutoMatched ? 'Pending Verification' : 'Pending Verification'
    });
    orderId = newOrder.orderId || newOrder.id;
    session.activeOrderNumber = newOrder.orderNumber || newOrder.order_number;
  }

  if (orderId) {
    await db.query(
      `UPDATE orders
       SET payment_ref_number = ?,
           gcash_ref = COALESCE(gcash_ref, ?),
           payment_proof_image = COALESCE(?, payment_proof_image),
           payment_status = 'Pending Verification',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [cleanRef, cleanRef, savedFilename, orderId]
    );

    await db.query(
      `UPDATE payments
       SET reference_no = ?,
           receipt_url = COALESCE(?, receipt_url),
           status = 'pending',
           updated_at = CURRENT_TIMESTAMP
       WHERE order_id = ?`,
      [cleanRef, savedFilename, orderId]
    );
  }

  if (isAutoMatched && orderId) {
    await markAdminGcashMatched(cleanRef);
    await db.query(
      `UPDATE payments SET amount_paid = ?, updated_at = CURRENT_TIMESTAMP WHERE order_id = ?`,
      [adminMatch.actualPaid, orderId]
    );
    await verifyOrderPayment(orderId, { username: 'GCash Auto-Verify' });

    session.pendingGCashOrder = null;
    session.checkout_step = null;
    session.state = 'IDLE';
    session.current_step = 'IDLE';
    session.cart = [];
    session.gcash_ref = cleanRef;
    await clearSessionCart(psid);
    await saveSession(session);

    return {
      intent: 'PAYMENT_VERIFIED_AUTO',
      confidence: 1.0,
      orderNumber: session.activeOrderNumber,
      referenceNumber: cleanRef,
      filename: savedFilename
    };
  }

  const orderLabel = session.activeOrderNumber ? `#${session.activeOrderNumber} ` : '';
  const confirmMsg = `Natanggap po namin ang inyong GCash proof para sa Order ${orderLabel}(Ref #${cleanRef})! I-ve-verify po ito ng aming cashier bago iproseso sa kusina.`;
  const cancelPayload = (session.activeOrderNumber || orderId) ? `CANCEL_ORDER_${session.activeOrderNumber || orderId}` : 'ACTION_CANCEL_ORDER';
  await sendQuickReplies(psid, confirmMsg, [
    { title: '❌ Cancel Order', payload: cancelPayload },
    { title: '📋 Menu', payload: 'MENU' }
  ]);

  session.pendingGCashOrder = null;
  session.checkout_step = null;
  session.state = 'IDLE';
  session.current_step = 'IDLE';
  session.cart = [];
  session.gcash_ref = cleanRef;
  await clearSessionCart(psid);
  await saveSession(session);

  notificationService.broadcastSSE('ORDER_PAYMENT_PROOF_SUBMITTED', {
    orderId,
    orderNumber: session.activeOrderNumber,
    payment_status: 'Pending Verification',
    payment_ref_number: cleanRef,
    payment_proof_image: savedFilename
  });

  return {
    intent: 'AWAITING_PAYMENT_PROOF',
    confidence: 1.0,
    replyLog: confirmMsg,
    referenceNumber: cleanRef,
    orderNumber: session.activeOrderNumber,
    filename: savedFilename
  };
}

/**
 * Handle incoming image attachment when session.checkout_step === 'AWAITING_PAYMENT_PROOF'
 */
async function handlePaymentProofUpload(psid, session, imgAttachment) {
  const guard = await checkPendingGcashGuard(psid, session);
  if (guard.blocked) {
    return { intent: guard.intent, confidence: 1.0, replyLog: guard.replyLog };
  }

  const pending = session.pendingGCashOrder || null;
  const expectedTotal = Number(pending?.grandTotal || session.order_total || 0);
  const rawUrl = imgAttachment?.payload?.url || (typeof imgAttachment === 'string' ? imgAttachment : (imgAttachment?.url || null));

  let fileBuffer = null;
  let ocrInput = rawUrl;
  if (typeof rawUrl === 'string' && (rawUrl.startsWith('http://') || rawUrl.startsWith('https://'))) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const res = await fetch(rawUrl, {
          headers: { 'User-Agent': 'DinersCafeBot/1.0' },
          signal: controller.signal
        });
        if (res.ok) {
          fileBuffer = Buffer.from(await res.arrayBuffer());
          ocrInput = fileBuffer;
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (dlErr) {
      console.warn('[handlePaymentProofUpload] Image fetch error:', dlErr.message);
    }

    if (!fileBuffer) {
      const attemptInfo = registerFailedProofAttempt(pending);
      await saveSession(session);
      const dlFailMsg = 'Hindi po ma-access ang larawan ng resibo. Pakisend muli ang GCash screenshot o i-type ang 13-digit Reference Number.';
      await sendQuickReplies(psid, dlFailMsg, [
        { title: '❌ Cancel Checkout', payload: 'CANCEL_PENDING_GCASH' },
        { title: '📋 Menu', payload: 'MENU_HOME' }
      ]);
      return { intent: 'UNREADABLE_RECEIPT', confidence: 1.0, replyLog: dlFailMsg, attemptInfo };
    }
  }

  const ocrResult = await recognizeReceipt(ocrInput);
  if (!ocrResult.success || !ocrResult.referenceNumber) {
    const attemptInfo = registerFailedProofAttempt(pending);
    await saveSession(session);
    const unreadableMsg = attemptInfo.cooldownTriggered
      ? 'Hindi po mabasa ang GCash Reference Number sa larawan. Naabot na ang 3 attempts kaya maghintay muna ng 10 minuto bago subukang muli.'
      : `Hindi po mabasa ang 13-digit GCash Reference Number sa screenshot. Pakisend ng malinaw na resibo o i-type ang Reference Number (${attemptInfo.remainingAttempts} attempt(s) natitira).`;
    await sendQuickReplies(psid, unreadableMsg, [
      { title: '❌ Cancel Checkout', payload: 'CANCEL_PENDING_GCASH' },
      { title: '📋 Menu', payload: 'MENU_HOME' }
    ]);
    return { intent: 'UNREADABLE_RECEIPT', confidence: 1.0, replyLog: unreadableMsg };
  }

  if (
    ocrResult.amount !== null &&
    ocrResult.amount !== undefined &&
    expectedTotal > 0 &&
    Number(ocrResult.amount) + 1.00 < expectedTotal
  ) {
    const attemptInfo = registerFailedProofAttempt(pending);
    await saveSession(session);
    const shortMsg = `Mas mababa po ang nakitang halaga sa resibo (₱${Number(ocrResult.amount).toFixed(2)}) kaysa sa kabuuang bayad na ₱${expectedTotal.toFixed(2)}. Pakisend ang kumpletong GCash receipt.`;
    await sendQuickReplies(psid, shortMsg, [
      { title: '❌ Cancel Checkout', payload: 'CANCEL_PENDING_GCASH' },
      { title: '📋 Menu', payload: 'MENU_HOME' }
    ]);
    return { intent: 'PAYMENT_AMOUNT_MISMATCH', confidence: 1.0, replyLog: shortMsg, attemptInfo };
  }

  const savedFilename = await savePaymentProofImage(fileBuffer || rawUrl, pending ? `pending_${psid}` : (session.activeOrderNumber || psid));
  return await finalizeOrderFromProofSubmission(psid, session, {
    referenceNumber: ocrResult.referenceNumber,
    savedFilename,
    ocrAmount: ocrResult.amount
  });
}

/**
 * Handle incoming text when session.checkout_step === 'AWAITING_PAYMENT_PROOF'
 */
async function handlePaymentProofTextInput(psid, session, rawText) {
  const cleanRaw = (rawText || '').trim();

  if (session.pendingGCashOrder && isCancelTriggerWord(cleanRaw.toLowerCase(), cleanRaw)) {
    session.pendingGCashOrder = null;
    session.checkout_step = null;
    session.state = 'IDLE';
    session.current_step = 'IDLE';
    await saveSession(session);
    const cancelMsg = 'Nakansela na po ang pending GCash checkout (walang order na naipadala sa kusina). Mag-type lamang ng "Menu" kung nais mag-order muli.';
    await sendQuickReplies(psid, cancelMsg, [{ title: '📋 Menu', payload: 'MENU_HOME' }]);
    return { intent: 'CANCEL_PENDING_GCASH', confidence: 1.0, replyLog: cancelMsg };
  }

  const guard = await checkPendingGcashGuard(psid, session);
  if (guard.blocked) {
    return { intent: guard.intent, confidence: 1.0, replyLog: guard.replyLog };
  }

  const refNum = extractReferenceNumber(cleanRaw);
  if (refNum) {
    return await finalizeOrderFromProofSubmission(psid, session, {
      referenceNumber: refNum,
      savedFilename: null,
      ocrAmount: null
    });
  }

  const retryMsg = 'Kapag tapos na po magbayad, paki-send dito ang screenshot ng GCash resibo o i-type ang 13-digit Reference Number.';
  await sendQuickReplies(psid, retryMsg, [
    { title: '❌ Cancel Checkout', payload: 'CANCEL_PENDING_GCASH' },
    { title: '📋 Menu', payload: 'MENU_HOME' }
  ]);
  return { intent: 'AWAITING_PAYMENT_PROOF_RETRY', confidence: 1.0, replyLog: retryMsg };
}

/**
 * Helper: Detects cancellation trigger words or postback payloads
 */
function isCancelTriggerWord(norm = '', rawText = '', eventPayload = '') {
  if (eventPayload === 'ACTION_CANCEL_ORDER' || eventPayload === 'CANCEL_ORDER' || (typeof eventPayload === 'string' && eventPayload.startsWith('CANCEL_ORDER_'))) return true;
  const triggerPhrases = [
    'cancel',
    'cancel order',
    'cancel my order',
    'i-cancel ang order',
    'i cancel ang order',
    'icancel ang order',
    'icancel',
    'pa cancel',
    'pa-cancel',
    'pacancel',
    'ayaw ko na',
    'ayaw ko na po',
    'ayaw ko na nito',
    'ayoko na',
    'kanselahin',
    'refund',
    'pa refund',
    'pa-refund',
    'parefund'
  ];
  if (triggerPhrases.some(p => norm === p || norm.includes(p))) return true;
  if (/\b(?:pa[-\s]?cancel|i[-\s]?cancel|kanselahin|ayaw\s+ko\s+na|ayoko\s+na)\b/i.test(rawText)) return true;
  if (/\bcancel\b.*?\b(?:order|food|delivery|kape|drink|ko)\b/i.test(rawText)) return true;
  if (/\b(?:order|food|delivery)\b.*?\bcancel\b/i.test(rawText)) return true;
  return false;
}

/**
 * Dynamic Order Cancellation Guard (Status-Based Rules - Requirement 1)
 * Evaluates active order status:
 * 1. IN_PREPARATION / DISPATCHED / DELIVERED: Block cancellation with kitchen/dispatch alert
 * 2. PENDING / PENDING_APPROVAL: Allow cancellation, update status, restore stock in menu_items & inventory
 */
async function handleCancellationRequest(psid, session, rawText = '') {
  let activeOrder = null;
  let targetOrderIdOrNum = null;

  if (typeof rawText === 'string' && rawText.startsWith('CANCEL_ORDER_')) {
    targetOrderIdOrNum = rawText.replace('CANCEL_ORDER_', '').trim();
  }

  if (targetOrderIdOrNum) {
    const isNum = /^\d+$/.test(targetOrderIdOrNum);
    const [rows] = await db.query(
      `SELECT id, order_number, status, total_amount FROM orders WHERE ${isNum ? '(id = ? OR order_number = ?)' : 'order_number = ?'} LIMIT 1`,
      isNum ? [targetOrderIdOrNum, targetOrderIdOrNum] : [targetOrderIdOrNum]
    );
    if (rows && rows.length > 0) {
      activeOrder = rows[0];
    }
  }

  if (!activeOrder && session.activeOrderNumber) {
    const [rows] = await db.query(
      `SELECT id, order_number, status, total_amount FROM orders WHERE order_number = ? LIMIT 1`,
      [session.activeOrderNumber]
    );
    if (rows && rows.length > 0 && !['cancelled', 'voided'].includes(String(rows[0].status).toLowerCase())) {
      activeOrder = rows[0];
    }
  }

  if (!activeOrder && session.active_order_id) {
    const [rows] = await db.query(
      `SELECT id, order_number, status, total_amount FROM orders WHERE id = ? LIMIT 1`,
      [session.active_order_id]
    );
    if (rows && rows.length > 0 && !['cancelled', 'voided'].includes(String(rows[0].status).toLowerCase())) {
      activeOrder = rows[0];
    }
  }

  if (!activeOrder && psid) {
    const [rows] = await db.query(
      `SELECT o.id, o.order_number, o.status, o.total_amount
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       WHERE c.psid = ? AND LOWER(o.status) NOT IN ('cancelled', 'voided')
       ORDER BY o.id DESC LIMIT 1`,
      [psid]
    );
    if (rows && rows.length > 0) {
      activeOrder = rows[0];
    }
  }

  if (activeOrder) {
    const s = String(activeOrder.status).toLowerCase();
    const { updateOrderStatus } = require('./orderService');

    // Rule 1: If status has progressed to IN_PREPARATION, DISPATCHED, or DELIVERED:
    const isProgressed = (
      s === 'preparing' || s === 'in_preparation' || s === 'in kitchen preparation' ||
      s === 'dispatched' || s === 'on_delivery' || s === 'dispatched / on delivery' ||
      s === 'delivered' || s === 'completed'
    );

    if (isProgressed) {
      const reply = "Paumanhin, hindi na po maaaring kanselahin ang inyong order dahil ito ay kasalukuyan nang inihahanda ng aming kusina o naipadala na. Mangyaring mag-iwan ng mensahe para sa aming staff.";
      await sendTextMessage(psid, reply);
      return { intent: 'ORDER_CANCEL_BLOCKED', confidence: 1.0, replyLog: reply };
    }

    // Rule 2: If status is strictly PENDING / PENDING_APPROVAL / awaiting_confirmation:
    const isPending = (s === 'pending' || s === 'pending_approval' || s === 'awaiting_confirmation');
    if (isPending) {
      await updateOrderStatus(activeOrder.id, 'cancelled', {
        cancellationReason: 'Cancelled by customer via Messenger'
      });
      await resetUserSession(psid);

      const orderIdentifier = activeOrder.order_number || activeOrder.id;
      const reply = `Ang inyong order #${orderIdentifier} ay matagumpay nang nakansela. Kung nais ninyong mag-order muli, mag-type lamang po ng 'Menu'.`;
      await sendTextMessage(psid, reply);
      return { intent: 'ORDER_CANCELLED_PENDING', confidence: 1.0, replyLog: reply };
    }
  }

  // If no placed active order: check for draft items in cart
  if (session.cart && session.cart.length > 0) {
    if (typeof rawText === 'string' && (rawText.startsWith('CANCEL_ORDER') || rawText.startsWith('ACTION_CANCEL_ORDER'))) {
      await resetUserSession(psid);
      const reply = "Na-cancel na po ang inyong kasalukuyang cart selection. Maaari po kayong pumili muli sa ating menu anumang oras!";
      await sendTextMessage(psid, reply);
      return { intent: 'CANCEL_CART', confidence: 1.0, replyLog: reply };
    } else {
      session.previous_step = (session.current_step && session.current_step !== 'idle') ? session.current_step : 'ordering';
      session.current_step = 'AWAITING_CANCEL_CONFIRMATION';
      session.state = 'AWAITING_CANCEL_CONFIRMATION';
      await saveSession(session);

      const reply = 'Sigurado ka ba na nais mong i-cancel ang iyong order? I-type ang yes o no.';
      await sendTextMessage(psid, reply);
      return { intent: 'CANCEL_ORDER_REQUESTED', confidence: 1.0, replyLog: reply };
    }
  }

  const reply = "Wala po kayong kasalukuyang aktibong order na maaaring i-cancel. May maitutulong pa ba ako sa inyo?";
  await sendTextMessage(psid, reply);
  return { intent: 'CANCEL_EMPTY', confidence: 1.0, replyLog: reply };
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
  session.warning20Sent = false;
  session.warning25Sent = false;
  session.purged30Sent = false;

  let detectedIntent = 'UNKNOWN';
  let confidence = 1.0;
  let botReplyLog = '';

  try {
    // 0a. Handle Attachments (Receipt images for OCR or Senior/PWD ID proof)
    if (attachments && attachments.length > 0) {
      const isAwaitingProof = (
        session.checkout_step === 'AWAITING_PAYMENT_PROOF' ||
        session.state === 'AWAITING_PAYMENT_PROOF' ||
        session.current_step === 'AWAITING_PAYMENT_PROOF' ||
        Boolean(session.pendingGCashOrder)
      );
      const imgAttachment =
        attachments.find(a => a.type === 'image') ||
        (isAwaitingProof ? attachments.find(a => a?.payload?.url || a?.url) : null);

      if (imgAttachment) {
        if (session.state === 'AWAITING_DISCOUNT_PROOF' || session.current_step === 'AWAITING_DISCOUNT_PROOF') {
          const subtotal = session.order_subtotal || calculateCartSubtotal(session.cart) || 0;
          const computedDiscount = Math.round((subtotal * 0.20) * 100) / 100;
          session.discount = {
            applied: true,
            type: 'Senior Citizen / PWD 20%',
            amount: computedDiscount,
            idNumber: 'Senior/PWD ID Photo Attached'
          };
          session.discount_amount = computedDiscount;
          return await finalizeOrderSummaryAndPayment(psid, session);
        }

        // Requirement 2: Handle Payment Proof Image when AWAITING_PAYMENT_PROOF
        if (isAwaitingProof) {
          detectedIntent = 'PAYMENT_PROOF_IMAGE';
          try {
            const proofRes = await handlePaymentProofUpload(psid, session, imgAttachment);
            return { intent: proofRes?.intent || 'AWAITING_PAYMENT_PROOF', confidence: 1.0, replyLog: proofRes?.replyLog };
          } catch (proofErr) {
            console.error('[Payment Proof Upload Error]', proofErr);
            const fallbackPayMsg = 'Nagkaroon po ng pansamantalang aberya sa pag-verify ng screenshot. Paki-type na lamang ang 13-digit GCash Reference Number (hal. 7047160660300) upang maituloy agad ang order.';
            await sendQuickReplies(psid, fallbackPayMsg, [
              { title: '❌ Cancel Checkout', payload: 'CANCEL_PENDING_GCASH' },
              { title: '📋 Menu', payload: 'MENU_HOME' }
            ]);
            return { intent: 'PAYMENT_PROOF_ERROR_RECOVERY', confidence: 1.0, replyLog: fallbackPayMsg };
          }
        }

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

    // 0c. Master AI Chatbot Toggle (Mute / Kill Switch - Requirement 2)
    if (!systemSettingsService.isChatbotEnabled()) {
      detectedIntent = 'CHATBOT_MUTED';
      console.log(`[NLP Engine] Chatbot is disabled (chatbot_enabled=0). Skipping automated reply for ${psid}.`);
      return { intent: 'CHATBOT_MUTED', confidence: 1.0, replyLog: 'Chatbot muted' };
    }

    // 0d. Store Operating Hours & Pre-Order Handler (Requirement 3)
    const storeSchedule = systemSettingsService.isStoreOpen();
    if (!storeSchedule.isOpen) {
      const normInput = (text || '').toLowerCase().trim();
      const isCancel = isCancelTriggerWord(normInput, text, eventPayload);

      // Handle explicit Pre-order triggers
      if (eventPayload === 'ACTION_PREORDER' || normInput === 'mag pre-order' || normInput === 'pre-order' || normInput === 'preorder') {
        session.is_preorder = true;
        await saveSession(session);
        const reply = `Salamat po! Naka-activate na po ang inyong Pre-Order mode. Maaari na po kayong pumili sa ating menu sa ibaba. Ang inyong order ay ihahanda at ipapadala pagkabukas ng aming kusina sa susunod na shift (${storeSchedule.openTimeFormatted}).`;
        await sendTextMessage(psid, reply);
        await sendFullMenu(psid, session);
        return { intent: 'PREORDER_ACTIVATED', confidence: 1.0, replyLog: reply };
      }

      // Handle explicit Leave Message triggers
      if (eventPayload === 'ACTION_LEAVE_MESSAGE' || normInput === 'mag-iwan ng mensahe') {
        session.state = 'LEAVING_MESSAGE';
        await saveSession(session);
        const reply = `Salamat po! Maaari po ninyong i-type dito ang inyong mensahe o katanungan. Babasahin at tutugunan po ito ng aming staff sa oras ng pagbubukas ng tindahan (${storeSchedule.openTimeFormatted}). Magandang araw po!`;
        await sendTextMessage(psid, reply);
        return { intent: 'LEAVE_MESSAGE_REQUESTED', confidence: 1.0, replyLog: reply };
      }

      if (session.state === 'LEAVING_MESSAGE') {
        session.state = 'IDLE';
        await saveSession(session);
        const reply = `Maraming salamat po! Naitala na po namin ang inyong mensahe. Tutugunan po kayo ng aming staff sa pagbubukas ng tindahan sa ${storeSchedule.openTimeFormatted}.`;
        await sendTextMessage(psid, reply);
        return { intent: 'MESSAGE_RECORDED', confidence: 1.0, replyLog: reply };
      }

      // If user triggers cancellation, let it through to cancellation guard
      if (isCancel || eventPayload === 'ACTION_CANCEL_ORDER' || eventPayload === 'CANCEL_ORDER') {
        return handleCancellationRequest(psid, session, text);
      }

      // If customer is NOT already in active pre-order shopping flow or completing a GCash proof, show the closed notice
      const isCompletingGcashProof = Boolean(
        session.pendingGCashOrder ||
        session.checkout_step === 'AWAITING_PAYMENT_PROOF' ||
        session.state === 'AWAITING_PAYMENT_PROOF' ||
        session.current_step === 'AWAITING_PAYMENT_PROOF' ||
        eventPayload === 'CANCEL_PENDING_GCASH'
      );
      if (!session.is_preorder && !isCompletingGcashProof) {
        const closedNotice = `Magandang araw po! Sarado na po ang aming kitchen ngayong oras na ito. Ang operating hours po ng Diner's Cafe ay ${storeSchedule.openTimeFormatted} - ${storeSchedule.closeTimeFormatted} (Manila Time). Nais niyo po ba mag pre-order para sa aming susunod na opening, o mag-iwan ng mensahe para sa aming staff?`;
        await sendQuickReplies(psid, closedNotice, [
          { title: 'Mag Pre-Order', payload: 'ACTION_PREORDER' },
          { title: 'Mag-iwan ng Mensahe', payload: 'ACTION_LEAVE_MESSAGE' }
        ]);
        return { intent: 'STORE_CLOSED_NOTICE', confidence: 1.0, replyLog: closedNotice };
      }
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

  // Cancellation Payloads
  if (payload === 'ACTION_CANCEL_ORDER' || payload === 'CANCEL_ORDER') {
    return handleCancellationRequest(psid, session, 'cancel order');
  }

  // Pre-Order Action Payload
  if (payload === 'ACTION_PREORDER') {
    session.is_preorder = true;
    await saveSession(session);
    const storeSchedule = systemSettingsService.isStoreOpen();
    const reply = `Salamat po! Naka-activate na po ang inyong Pre-Order mode. Maaari na po kayong pumili sa ating menu sa ibaba. Ang inyong order ay ihahanda at ipapadala pagkabukas ng aming kusina sa susunod na shift (${storeSchedule.openTimeFormatted}).`;
    await sendTextMessage(psid, reply);
    await sendFullMenu(psid, session);
    return;
  }

  // Leave Message Action Payload
  if (payload === 'ACTION_LEAVE_MESSAGE') {
    session.state = 'LEAVING_MESSAGE';
    await saveSession(session);
    const storeSchedule = systemSettingsService.isStoreOpen();
    const reply = `Salamat po! Maaari po ninyong i-type dito ang inyong mensahe o katanungan. Babasahin at tutugunan po ito ng aming staff sa oras ng pagbubukas ng tindahan (${storeSchedule.openTimeFormatted}). Magandang araw po!`;
    await sendTextMessage(psid, reply);
    return;
  }

  // Welcome / Menu entry
  if (payload === 'GET_STARTED') {
    const welcome = botMessages.welcome();
    await sendQuickReplies(psid, welcome.text, welcome.quickReplies);
    return;
  }

  if (payload === 'MENU_HOME' || payload === 'MENU') {
    await sendFullMenu(psid, session, { view: 'all' });
    return;
  }

  if (payload === 'VIEW_DRINKS') {
    await sendFullMenu(psid, session, { view: 'drinks' });
    return;
  }

  if (payload === 'VIEW_FOOD') {
    await sendFullMenu(psid, session, { view: 'food' });
    return;
  }

  // View Cart
  if (payload === 'VIEW_CART') {
    await renderCartSummary(psid, session);
    return;
  }

  if (payload === 'CONFIRM_CHECKOUT') {
    if (session.dining_mode) {
      session.state = 'COLLECTING_CUSTOMER_INFO';
      session.current_step = 'COLLECTING_CUSTOMER_INFO';
      await saveSession(session);
      const prompt = getCheckoutInfoPrompt(session);
      await sendTextMessage(psid, prompt);
      return;
    }
    session.state = 'AWAITING_ORDER_TYPE';
    const otMsg = botMessages.orderType();
    await sendQuickReplies(psid, otMsg.text, otMsg.quickReplies);
    return;
  }

  if (payload === 'CONFIRM_ADDRESS_YES') {
    return handleTextInput(psid, session, '1');
  }

  if (payload === 'CONFIRM_ADDRESS_NO') {
    return handleTextInput(psid, session, '2');
  }

  if (payload === 'SWITCH_TO_PICKUP') {
    session.state = 'AWAITING_BOUNDARY_PICKUP_SWITCH';
    session.checkout_step = 'AWAITING_BOUNDARY_PICKUP_SWITCH';
    session.current_step = 'AWAITING_BOUNDARY_PICKUP_SWITCH';
    return handleTextInput(psid, session, 'SWITCH_TO_PICKUP');
  }

  if (payload === 'DISCOUNT_YES') {
    session.state = 'AWAITING_DISCOUNT_PROOF';
    session.current_step = 'AWAITING_DISCOUNT_PROOF';
    await saveSession(session);
    const askProofMsg = 'Paki-send po ang picture ng inyong Senior Citizen o PWD ID o i-type ang inyong ID Number para ma-apply ang 20% discount.';
    await sendTextMessage(psid, askProofMsg);
    return;
  }

  if (payload === 'DISCOUNT_NO') {
    session.discount = { applied: false, type: 'None', amount: 0 };
    session.discount_amount = 0;
    await finalizeOrderSummaryAndPayment(psid, session);
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

  if (payload === 'PAY_XENDIT' || payload === 'PAY_GCASH') {
    await placeCustomerOrder(psid, session, 'xendit');
    return;
  }

  if (payload === 'CANCEL_PENDING_GCASH') {
    session.pendingGCashOrder = null;
    session.checkout_step = null;
    session.state = 'IDLE';
    session.current_step = 'IDLE';
    await saveSession(session);
    const cancelMsg = 'Nakansela na po ang pending GCash checkout (walang order na naipadala sa kusina). Mag-type lamang ng "Menu" kung nais mag-order muli.';
    await sendQuickReplies(psid, cancelMsg, [{ title: '📋 Menu', payload: 'MENU_HOME' }]);
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

  // Add-on selection postback
  if (payload.startsWith('ADDON_')) {
    await handleAddonSelection(psid, session, payload);
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

  // Stage 1: Dining Mode Selection Payloads
  if (payload === 'DINING_MODE_DINE_IN' || payload === 'DINE_IN') {
    session.dining_mode = 'Dine In';
    session.orderType = 'dine_in';
    session.state = 'ORDERING';
    await saveSession(session);
    const msg = `Copy po sa Dine In! Free seating po tayo sa open seating area kaya feel free to find any available seat pagdating niyo.\n\nEto po ang aming menu para makapili kayo ng inyong drinks and meals:`;
    await sendTextMessage(psid, msg);
    await sendFullMenu(psid, session);
    return;
  }

  if (payload === 'DINING_MODE_DELIVERY' || payload === 'DELIVERY') {
    session.dining_mode = 'Delivery';
    session.orderType = 'delivery';
    session.state = 'ORDERING';
    await saveSession(session);
    const msg = `Noted po sa Delivery! Ihahatid po namin ito sa inyong address (hihingin po namin ang complete delivery address mamaya sa checkout).\n\nEto po ang aming menu para makapili kayo:`;
    await sendTextMessage(psid, msg);
    await sendFullMenu(psid, session);
    return;
  }

  if (payload === 'DINING_MODE_TAKE_OUT' || payload === 'TAKE_OUT') {
    session.dining_mode = 'Pick-up';
    session.orderType = 'pickup';
    session.state = 'ORDERING';
    await saveSession(session);
    const msg = `Copy po sa Take Out! Ihahanda po natin ito agad para sa counter pickup pagdaan ninyo sa cafe.\n\nEto po ang aming menu para makapili kayo:`;
    await sendTextMessage(psid, msg);
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
 * Shared delivery address + landmark geocoding, OSRM routing, boundary check, and exact fare resolver
 */
async function resolveDeliveryAddressAndFare(psid, session, addressStr, landmarkStr, meta = {}) {
  const customerName = meta.customerName || session.customer_name || 'Customer';
  const contactNumber = meta.contactNumber || session.contact_number || session.phone_number || '';
  const paymentMode = meta.paymentMode || session.payment_mode || 'Cash';
  const customerNote = meta.customerNote !== undefined ? meta.customerNote : (session.customer_notes || '');

  session.customer_name = customerName;
  session.contact_number = contactNumber;
  session.phone_number = contactNumber;
  session.payment_mode = paymentMode;
  session.landmark = landmarkStr || session.landmark || '';
  session.customer_notes = customerNote;
  session.note = customerNote;

  let fareResult;
  try {
    fareResult = await fareEngine.calculateFareForAddress(addressStr, session.landmark);
  } catch (geoErr) {
    const notFoundMsg = 'Paumanhin po, hindi namin mahanap ang eksaktong lokasyon. Pakisama po ang mas malinaw na street address, Barangay, Siyudad, o kilalang Landmark (hal. Tapat ng MRT Boni o Puregold).';
    session.state = 'AWAITING_ADDRESS_RETRY';
    session.checkout_step = 'AWAITING_ADDRESS_RETRY';
    session.current_step = 'AWAITING_ADDRESS_RETRY';
    await saveSession(session);
    await sendTextMessage(psid, notFoundMsg);
    return { intent: 'AWAITING_ADDRESS_RETRY', confidence: 1.0, replyLog: notFoundMsg };
  }

  const distance = fareResult.distanceKm;
  const maxRadiusKm = fareResult.maxRadiusKm || 3;
  const calculatedFee = fareResult.breakdown.finalFare;
  const formatted_address = fareResult.formattedAddress || addressStr;

  if (fareResult.isOutOfBounds) {
    session.delivery_distance_km = distance;
    session.state = 'AWAITING_BOUNDARY_PICKUP_SWITCH';
    session.checkout_step = 'AWAITING_BOUNDARY_PICKUP_SWITCH';
    session.current_step = 'AWAITING_BOUNDARY_PICKUP_SWITCH';
    await saveSession(session);

    const boundaryPrompt = `Paumanhin po, ang inyong address ay nasa ${distance} km at lampas sa aming ${maxRadiusKm} km store delivery limit. Nais niyo po ba itong i-switch sa Store Pick-up?`;
    await sendQuickReplies(psid, boundaryPrompt, [
      { title: '🏪 Store Pick-up', payload: 'SWITCH_TO_PICKUP' },
      { title: '📍 Ibahin Address', payload: 'CONFIRM_ADDRESS_NO' }
    ]);
    try {
      notificationService.broadcastSSE('COURIER_ESCALATION_NEEDED', {
        psid,
        distanceKm: distance,
        maxRadiusKm,
        address: formatted_address
      });
    } catch (notifErr) { }
    return { intent: 'AWAITING_BOUNDARY_PICKUP_SWITCH', confidence: 1.0, replyLog: boundaryPrompt };
  }

  session.delivery_address = formatted_address;
  session.address = formatted_address;
  session.customer_lat = fareResult.coordinates.latitude;
  session.customer_lng = fareResult.coordinates.longitude;
  session.delivery_distance_km = distance;
  session.delivery_fee = calculatedFee;
  session.deliveryFee = calculatedFee;
  if (!session.details) session.details = {};
  session.details.name = customerName;
  session.details.phone = contactNumber;
  session.details.address = formatted_address;
  session.details.landmark = session.landmark;
  session.details.note = customerNote;
  session.details.paymentMode = paymentMode;

  session.state = 'AWAITING_ADDRESS_CONFIRMATION';
  session.checkout_step = 'AWAITING_ADDRESS_CONFIRMATION';
  session.current_step = 'AWAITING_ADDRESS_CONFIRMATION';
  await saveSession(session);

  const confirmPrompt = `📍 Nai-locate po namin ang inyong drop-off:\n"${formatted_address}" (${distance} km)\nDelivery Fee: ₱${calculatedFee.toFixed(2)}\n\nTama po ba ang lokasyong ito?\n[1] Oo, tama ito\n[2] Ibahin ang address`;
  await sendQuickReplies(psid, confirmPrompt, [
    { title: 'Oo, tama ito', payload: 'CONFIRM_ADDRESS_YES' },
    { title: 'Ibahin ang address', payload: 'CONFIRM_ADDRESS_NO' }
  ]);
  return { intent: 'AWAITING_ADDRESS_CONFIRMATION', confidence: 1.0, replyLog: confirmPrompt };
}

/**
 * Handle Free Text Messages in Strict Priority Order (Decision 1)
 */
async function handleTextInput(psid, session, rawText) {
  const norm = normalize(rawText);

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
      if (session.activeOrderNumber) {
        await db.query(`UPDATE orders SET status = 'cancelled' WHERE order_number = ?`, [session.activeOrderNumber]);
      }
      await resetUserSession(psid, { targetState: 'idle' });

      const reply = 'Order has been cancelled.';
      await sendTextMessage(psid, reply);
      return { intent: 'ORDER_CANCELLED', confidence: 1.0, replyLog: reply };
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

  // Dynamic Order Cancellation Guard (Status-Based Rules)
  if (isCancelTriggerWord(norm, rawText)) {
    return handleCancellationRequest(psid, session, rawText);
  }

  // Check for payment confirmation signal like "Send na po", "Bayad na po", "Na-send ko na"
  const isPaidSignal = /(?:^|\b)(?:send na po|na-?send|bayad na|paid|done paying|ok na po|tapos na po|settled)(?:\b|$)/i.test(rawText);
  if (isPaidSignal) {
    if (session.pendingStage5) {
      return handleStage5Confirmation(psid, session, { isAlreadyPaid: true });
    }
    if (session.activeOrderNumber) {
      const [orderRows] = await db.query('SELECT id, status FROM orders WHERE order_number = ? LIMIT 1', [session.activeOrderNumber]);
      if (orderRows && orderRows.length > 0 && orderRows[0].status !== 'cancelled' && orderRows[0].status !== 'delivered') {
        await db.query(
          `UPDATE payments SET status = 'verified', verified_at = CURRENT_TIMESTAMP 
           WHERE order_id = ?`,
          [orderRows[0].id]
        );
        notificationService.broadcastSSE('ORDER_STATUS_CHANGED', {
          orderNumber: session.activeOrderNumber,
          newStatus: 'pending',
          paymentStatus: 'verified'
        });
        const reply = `Natanggap na po namin ang inyong GCash payment! Ang inyong order (#${session.activeOrderNumber}) ay submitted na for Pending Approval.`;
        await sendTextMessage(psid, reply);
        session.state = 'AWAITING_DELIVERY';
        session.current_step = 'AWAITING_DELIVERY';
        await saveSession(session);
        return { intent: 'GCASH_PAID_SIGNAL', confidence: 1.0, replyLog: reply };
      }
    }
  }

  // Check for affirmative confirmation to Stage 5 summary like "Yes tama lang lahat", "Confirm", "Oo"
  const isAffirmativeConfirm = /(?:^|\b)(?:yes|oo|opo|confirm|proceed|tama|sige|push|g|ok na)(?:\b|$)/i.test(rawText);
  if (isAffirmativeConfirm && (session.state === 'AWAITING_STAGE5_CONFIRM' || session.pendingStage5)) {
    return handleStage5Confirmation(psid, session, { isAlreadyPaid: false });
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
        // Stock & Availability Guard (Requirement 4)
        const targetItemId = pending.id || pending.menuItemId || 1;
        const [stockRows] = await db.query(
          `SELECT is_available, COALESCE(stock_quantity, 0) AS stock_quantity FROM menu_items WHERE id = ?`,
          [targetItemId]
        );
        if (stockRows.length > 0) {
          const s = stockRows[0].stock_quantity;
          const a = stockRows[0].is_available;
          if (s <= 0 || !a) {
            session.pending_suggestion = null;
            session.pendingItem = null;
            await saveSession(session);
            const soldOutMsg = `Paumanhin po, sold out na po ang item na ito. (${addedName} is currently unavailable)`;
            await sendTextMessage(psid, soldOutMsg);
            return { intent: 'ORDER_ITEM_OUT_OF_STOCK', handled: true };
          }
        }

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
    /\bcancel\b.*?\b(?:order|food|delivery|kape|drink|ko)\b/i.test(rawText) ||
    /\b(?:order|food|delivery)\b.*?\bcancel\b/i.test(rawText) ||
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
        await resetUserSession(psid);

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
    session.name = null;
    session.customer_name = null;
    session.phone_number = null;
    session.contact_number = null;
    session.address = null;
    session.delivery_address = null;
    session.dining_mode = null;
    session.discount = null;
    session.order_type = null;
    session.orderType = null;
    session.gcash_ref = null;
    session.partial_paid = null;
    session.details = null;
    session.pendingItem = null;
    session.pending_suggestion = null;
    session.pendingAction = null;
    session.pendingGCashOrder = null;
    session.quote = null;
    session.checkout = null;
    session.order_subtotal = 0;
    session.order_total = 0;
    await clearSessionCart(psid);
    await saveSession(session);
    const resetMsg = 'Na-reset na ang iyong session. Paano kita matutulungan ngayon?';
    await sendTextMessage(psid, resetMsg);
    return { intent: 'RESET_SESSION', confidence: 1.0, replyLog: resetMsg };
  }

  // Requirement 1: Mandatory Post-Reset Gateway & Initial Greeting
  // Whenever session is in RESET, EXPIRED, INITIAL, INITIAL_GREETING, AWAITING_DINING_MODE, or when dining_mode is not yet selected
  const isPostResetState = ['RESET', 'EXPIRED', 'INITIAL', 'INITIAL_GREETING', 'AWAITING_DINING_MODE'].includes(session.state) ||
    ['RESET', 'EXPIRED', 'INITIAL', 'INITIAL_GREETING', 'AWAITING_DINING_MODE'].includes(session.current_step) ||
    (session.state === 'idle' && !session.dining_mode);

  if (isPostResetState && !session.dining_mode) {
    if (/\b(?:dine\s*in|sa\s*loob|table)\b/i.test(norm)) {
      session.dining_mode = 'Dine In';
      session.orderType = 'dine_in';
      session.state = 'ORDERING';
      session.current_step = 'ORDERING';
      await saveSession(session);
      const msg = `Copy po sa Dine In! Free seating po tayo sa open seating area kaya feel free to find any available seat pagdating niyo.\n\nEto po ang aming menu para makapili kayo ng inyong drinks and meals:`;
      await sendTextMessage(psid, msg);
      await sendFullMenu(psid, session);
      return { intent: 'DINING_MODE_DINE_IN', confidence: 1.0, replyLog: msg };
    }
    if (/\b(?:take[\s-]*out|takeout|pick[\s-]*up|pickup|daanan)\b/i.test(norm)) {
      session.dining_mode = 'Pick-up';
      session.orderType = 'pickup';
      session.state = 'ORDERING';
      session.current_step = 'ORDERING';
      await saveSession(session);
      const msg = `Copy po sa Take Out! Ihahanda po natin ito agad para sa counter pickup pagdaan ninyo sa cafe.\n\nEto po ang aming menu para makapili kayo:`;
      await sendTextMessage(psid, msg);
      await sendFullMenu(psid, session);
      return { intent: 'DINING_MODE_TAKE_OUT', confidence: 1.0, replyLog: msg };
    }
    if (/\b(?:delivery|deliver|padeliver|pa-deliver)\b/i.test(norm)) {
      session.dining_mode = 'Delivery';
      session.orderType = 'delivery';
      session.state = 'ORDERING';
      session.current_step = 'ORDERING';
      await saveSession(session);
      const msg = `Noted po sa Delivery! Ihahatid po namin ito sa inyong address (hihingin po namin ang complete delivery address mamaya sa checkout).\n\nEto po ang aming menu para makapili kayo:`;
      await sendTextMessage(psid, msg);
      await sendFullMenu(psid, session);
      return { intent: 'DINING_MODE_DELIVERY', confidence: 1.0, replyLog: msg };
    }

    // Customer has NOT chosen dining mode yet: lock progression and reply ONLY with the exact Welcome Greeting
    session.state = 'AWAITING_DINING_MODE';
    session.current_step = 'AWAITING_DINING_MODE';
    await saveSession(session);

    const greetingMsg = "Hello po! Welcome to Diner's Cafe! Ask ko lang po muna bago tayo magsimula, will this be for Dine In, Delivery, or Take Out?";
    await sendQuickReplies(psid, greetingMsg, [
      { title: 'Dine In', payload: 'DINING_MODE_DINE_IN' },
      { title: 'Delivery', payload: 'DINING_MODE_DELIVERY' },
      { title: 'Take Out', payload: 'DINING_MODE_TAKE_OUT' }
    ]);
    return { intent: 'AWAITING_DINING_MODE_GATEWAY', confidence: 1.0, replyLog: greetingMsg };
  }

  // Requirement 2: Silent & Atomic Batch Cart Mutation (Add & Remove Multiple Items)
  if (isBatchRemoveIntent(rawText)) {
    const removedItems = executeBatchRemove(session.cart, rawText);
    if (removedItems && removedItems.length > 0) {
      const cartTotal = session.cart.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0);
      session.order_subtotal = cartTotal;
      session.order_total = cartTotal;
      session.state = session.cart.length > 0 ? 'AWAITING_CHECKOUT_CONFIRM' : 'IDLE';
      session.current_step = session.cart.length > 0 ? 'AWAITING_CHECKOUT_CONFIRM' : 'IDLE';
      await saveSession(session);

      const resp = formatUpdatedCartResponse(session.cart);
      await sendQuickReplies(psid, resp.text, resp.quickReplies);
      return { intent: 'BATCH_CART_REMOVE', confidence: 1.0, removedItems, cartTotal };
    }
  }

  if (isBatchAddIntent(rawText)) {
    const [candidates] = await db.query(`
      SELECT m.id, m.name, m.price, m.synonyms, m.is_available, COALESCE(m.stock_quantity, i.stock_quantity, 0) AS stock_quantity
      FROM menu_items m
      LEFT JOIN inventory i ON i.menu_item_id = m.id
      WHERE COALESCE(m.is_deleted, 0) = 0
    `);

    if (!session.cart) session.cart = [];
    const addedItems = executeBatchAdd(session.cart, rawText, candidates);

    // Notify user of any out-of-stock items (Requirement 4)
    if (addedItems && addedItems.outOfStockItems && addedItems.outOfStockItems.length > 0) {
      for (const oosName of addedItems.outOfStockItems) {
        const soldOutMsg = `Paumanhin po, sold out na po ang item na ito. (${oosName} is currently unavailable)`;
        await sendTextMessage(psid, soldOutMsg);
      }
    }

    if (addedItems && addedItems.length > 0) {
      const cartTotal = session.cart.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0);
      session.order_subtotal = cartTotal;
      session.order_total = cartTotal;
      session.state = 'AWAITING_CHECKOUT_CONFIRM';
      session.current_step = 'AWAITING_CHECKOUT_CONFIRM';
      await saveSession(session);

      const resp = formatUpdatedCartResponse(session.cart);
      await sendQuickReplies(psid, resp.text, resp.quickReplies);
      return { intent: 'BATCH_CART_ADD', confidence: 1.0, addedItems, cartTotal };
    } else if (addedItems && addedItems.outOfStockItems && addedItems.outOfStockItems.length > 0) {
      return { intent: 'BATCH_CART_ADD_OUT_OF_STOCK', confidence: 1.0, outOfStock: true };
    }
  }

  // 1. Delivery trigger keywords: 'delivery', 'deliver', 'padeliver'
  const isDeliveryChoice = ['delivery', 'deliver', 'padeliver'].includes(norm) ||
    (/\b(delivery|deliver|padeliver)\b/i.test(norm) && (session.state === 'AWAITING_ORDER_TYPE' || session.current_step === 'AWAITING_ORDER_TYPE'));

  if (isDeliveryChoice && (session.state === 'AWAITING_ORDER_TYPE' || session.current_step === 'AWAITING_ORDER_TYPE' || (session.cart && session.cart.length > 0 && !isDetailsStateCheck))) {
    session.orderType = 'delivery';
    session.order_type = 'delivery';
    session.dining_mode = 'Delivery';
    if (session.cart && session.cart.length > 0) {
      session.ordered_items = [...session.cart];
    }
    session.current_step = 'COLLECTING_CUSTOMER_INFO';
    session.state = 'COLLECTING_CUSTOMER_INFO';
    await saveSession(session);

    const reply = getCheckoutInfoPrompt(session);

    await sendTextMessage(psid, reply);
    return { intent: 'ORDER_TYPE_DELIVERY', confidence: 1.0, replyLog: reply };
  }

  // 2. State: 'COLLECTING_CUSTOMER_INFO' & 'AWAITING_CUSTOMER_INFO' (Issue 3 & Issue 4)
  if (
    session.state === 'COLLECTING_CUSTOMER_INFO' ||
    session.current_step === 'COLLECTING_CUSTOMER_INFO' ||
    session.state === 'AWAITING_CUSTOMER_INFO' ||
    session.current_step === 'AWAITING_CUSTOMER_INFO'
  ) {
    let currentDiningMode = session.dining_mode;
    if (!currentDiningMode) {
      if (session.orderType === 'delivery') currentDiningMode = 'Delivery';
      else if (session.orderType === 'dine_in') currentDiningMode = 'Dine In';
      else if (session.orderType === 'pickup') currentDiningMode = 'Pick-up';
    }

    const parsed = parseCustomerInfo(rawText, currentDiningMode);

    const customerName = parsed.name || session.customer_name || session.details?.name || '';
    const contactNumber = parsed.contact || session.contact_number || session.details?.phone || '';

    // If customer name or contact number is missing, prompt politely
    if (!customerName || !contactNumber || contactNumber.length < 7) {
      const askInfoMsg = 'Pakibigay po ang inyong buong Pangalan at Active Contact Number para sa inyong order:';
      await sendTextMessage(psid, askInfoMsg);
      return { intent: 'AWAITING_CUSTOMER_INFO_RETRY', confidence: 1.0, replyLog: askInfoMsg };
    }

    const subtotal = (session.cart && session.cart.length > 0)
      ? calculateCartSubtotal(session.cart)
      : (session.order_subtotal || 0);

    const discount = parseFloat(session.discount_amount || 0) || 0;

    const isDineIn = /dine[\s-]*in|sa\s*loob/i.test(currentDiningMode || '') || /table|dine[\s-]*in|sa\s*loob/i.test(parsed.address || '');
    const isPickup = /pick[\s-]*up|pickup|take[\s-]*out|takeout|daanan/i.test(currentDiningMode || '') || /pick[\s-]*up|pickup|take[\s-]*out|takeout|counter/i.test(parsed.address || '');
    const isDelivery = !isDineIn && !isPickup && (/delivery/i.test(currentDiningMode || '') || (!currentDiningMode && parsed.address));

    if (isDineIn) session.dining_mode = 'Dine In';
    else if (isPickup) session.dining_mode = 'Pick-up';
    else if (isDelivery) session.dining_mode = 'Delivery';

    let addressStr = '';
    let deliveryFee = 0;

    const currentStoreAddr = getStoreAddress();
    if (session.dining_mode === 'Dine In' || session.dining_mode === 'Pick-up') {
      session.address = currentStoreAddr;
      session.delivery_address = currentStoreAddr;
      addressStr = currentStoreAddr;
      deliveryFee = 0;
      session.customer_name = customerName;
      session.contact_number = contactNumber;
      session.phone_number = contactNumber;
      session.payment_mode = parsed.paymentMode || parsePaymentModeValue(rawText) || 'Cash';
      session.customer_notes = parsed.note || session.customer_notes || '';
      session.note = session.customer_notes;
      session.arriving_time = parsed.arrivingTime || parsed.arriving_time || session.arriving_time || '';
      session.arrivingTime = session.arriving_time;
      if (!session.details) session.details = {};
      session.details.name = customerName;
      session.details.phone = contactNumber;
      session.details.address = currentStoreAddr;
      session.details.arrivingTime = session.arriving_time;
      session.details.note = session.customer_notes;
      session.details.paymentMode = session.payment_mode;
    } else {
      addressStr = parsed.address || session.delivery_address || session.address || session.details?.address || '';
      if (!addressStr || addressStr === currentStoreAddr || addressStr === STORE_ADDRESS) {
        const askAddrMsg = 'Pakibigay po ang inyong kumpletong Delivery Address:';
        await sendTextMessage(psid, askAddrMsg);
        return { intent: 'AWAITING_CUSTOMER_INFO_RETRY', confidence: 1.0, replyLog: askAddrMsg };
      }

      const landmarkStr = parsed.landmark || session.landmark || '';
      const paymentModeResolved = parsed.paymentMode || parsePaymentModeValue(rawText) || 'Cash';
      const noteStr = parsed.note || session.customer_notes || '';

      return await resolveDeliveryAddressAndFare(psid, session, addressStr, landmarkStr, {
        customerName,
        contactNumber,
        paymentMode: paymentModeResolved,
        customerNote: noteStr
      });
    }

    // For Dine In / Pick-up: Skip address confirmation, auto-assign store address, set fee 0, and proceed directly to discount
    const paymentMode = parsed.paymentMode || parsePaymentModeValue(rawText) || 'Cash';
    session.customer_name = customerName;
    session.contact_number = contactNumber;
    session.phone_number = contactNumber;
    session.delivery_address = addressStr;
    session.address = addressStr;
    session.delivery_fee = 0;
    session.deliveryFee = 0;
    session.order_subtotal = subtotal;
    session.payment_mode = paymentMode;
    if (!session.details) session.details = {};
    session.details.name = customerName;
    session.details.phone = contactNumber;
    session.details.address = addressStr;
    session.details.paymentMode = paymentMode;

    session.state = 'AWAITING_DISCOUNT_CONFIRMATION';
    session.current_step = 'AWAITING_DISCOUNT_CONFIRMATION';
    session.checkout_step = 'AWAITING_DISCOUNT_CONFIRMATION';
    await saveSession(session);

    const askDiscountMsg = 'Mayroon po ba kayong Senior Citizen o PWD ID para sa 20% discount?';
    await sendQuickReplies(psid, askDiscountMsg, [
      { title: 'Mayroon', payload: 'DISCOUNT_YES' },
      { title: 'Wala po', payload: 'DISCOUNT_NO' }
    ]);
    return { intent: 'AWAITING_DISCOUNT_CONFIRMATION', confidence: 1.0, replyLog: askDiscountMsg };
  }

  // 2a-1. State: 'AWAITING_ADDRESS_CONFIRMATION' (Text-Based Geocoding Drop-off Confirmation)
  if (
    session.state === 'AWAITING_ADDRESS_CONFIRMATION' ||
    session.checkout_step === 'AWAITING_ADDRESS_CONFIRMATION' ||
    session.current_step === 'AWAITING_ADDRESS_CONFIRMATION'
  ) {
    const isConfirm = rawText === 'CONFIRM_ADDRESS_YES' ||
      /\b(?:1|oo|opo|yes|tama|tama\s*ito|oo\s*tama|ok|okay|confirm|proceed|sige|g)\b/i.test(norm);
    const isChange = rawText === 'CONFIRM_ADDRESS_NO' ||
      /\b(?:2|ibahin|ibahin\s*ang\s*address|hindi|no|mali|change|iba|palitan)\b/i.test(norm);

    if (isConfirm) {
      session.state = 'AWAITING_DISCOUNT_CONFIRMATION';
      session.current_step = 'AWAITING_DISCOUNT_CONFIRMATION';
      session.checkout_step = 'AWAITING_DISCOUNT_CONFIRMATION';
      await saveSession(session);

      const askDiscountMsg = 'Mayroon po ba kayong Senior Citizen o PWD ID para sa 20% discount?';
      await sendQuickReplies(psid, askDiscountMsg, [
        { title: 'Mayroon', payload: 'DISCOUNT_YES' },
        { title: 'Wala po', payload: 'DISCOUNT_NO' }
      ]);
      return { intent: 'AWAITING_DISCOUNT_CONFIRMATION', confidence: 1.0, replyLog: askDiscountMsg };
    }

    if (isChange) {
      session.state = 'AWAITING_ADDRESS_RETRY';
      session.current_step = 'AWAITING_ADDRESS_RETRY';
      session.checkout_step = 'AWAITING_ADDRESS_RETRY';
      await saveSession(session);

      const askRetryMsg = 'Pakisama po ang inyong specific street number at kalapit na landmark (hal. #123 Boni Ave tapat ng Puregold, Mandaluyong):';
      await sendTextMessage(psid, askRetryMsg);
      return { intent: 'AWAITING_ADDRESS_RETRY', confidence: 1.0, replyLog: askRetryMsg };
    }

    // Default re-prompt if response is ambiguous
    const reconfirmMsg = `Pakipili po kung tama ang drop-off:\n[1] Oo, tama ito\n[2] Ibahin ang address`;
    await sendQuickReplies(psid, reconfirmMsg, [
      { title: 'Oo, tama ito', payload: 'CONFIRM_ADDRESS_YES' },
      { title: 'Ibahin ang address', payload: 'CONFIRM_ADDRESS_NO' }
    ]);
    return { intent: 'AWAITING_ADDRESS_CONFIRMATION', confidence: 1.0, replyLog: reconfirmMsg };
  }

  // 2a-1b. State: 'AWAITING_BOUNDARY_PICKUP_SWITCH' (Out-of-bounds > 3km switch to Store Pick-up)
  if (
    session.state === 'AWAITING_BOUNDARY_PICKUP_SWITCH' ||
    session.checkout_step === 'AWAITING_BOUNDARY_PICKUP_SWITCH' ||
    session.current_step === 'AWAITING_BOUNDARY_PICKUP_SWITCH'
  ) {
    const switchYes = rawText === 'SWITCH_TO_PICKUP' ||
      /\b(?:oo|opo|yes|sige|ok|okay|switch|pick[\s-]*up|pickup|oo\s*switch)\b/i.test(norm);
    const changeAddr = rawText === 'CONFIRM_ADDRESS_NO' ||
      /\b(?:hindi|no|ibahin|change|palitan|address)\b/i.test(norm);

    if (switchYes && !changeAddr) {
      const storeAddr = getStoreAddress();
      session.dining_mode = 'Pick-up';
      session.orderType = 'pickup';
      session.order_type = 'pickup';
      session.delivery_fee = 0;
      session.deliveryFee = 0;
      session.delivery_address = storeAddr;
      session.address = storeAddr;
      if (session.details) session.details.address = storeAddr;

      session.state = 'AWAITING_DISCOUNT_CONFIRMATION';
      session.current_step = 'AWAITING_DISCOUNT_CONFIRMATION';
      session.checkout_step = 'AWAITING_DISCOUNT_CONFIRMATION';
      await saveSession(session);

      const switchedMsg = 'Na-switch na po ang inyong order sa Store Pick-up (Delivery Fee: ₱0.00). Mayroon po ba kayong Senior Citizen o PWD ID para sa 20% discount?';
      await sendQuickReplies(psid, switchedMsg, [
        { title: 'Mayroon', payload: 'DISCOUNT_YES' },
        { title: 'Wala po', payload: 'DISCOUNT_NO' }
      ]);
      return { intent: 'AWAITING_DISCOUNT_CONFIRMATION', confidence: 1.0, replyLog: switchedMsg };
    }

    session.state = 'AWAITING_ADDRESS_RETRY';
    session.current_step = 'AWAITING_ADDRESS_RETRY';
    session.checkout_step = 'AWAITING_ADDRESS_RETRY';
    await saveSession(session);

    const askRetryMsg = 'Pakibigay po ng bagong Delivery Address at kalapit na Landmark sa loob ng 3 km radius:';
    await sendTextMessage(psid, askRetryMsg);
    return { intent: 'AWAITING_ADDRESS_RETRY', confidence: 1.0, replyLog: askRetryMsg };
  }

  // 2a-2. State: 'AWAITING_ADDRESS_RETRY' (Revised address input)
  if (
    session.state === 'AWAITING_ADDRESS_RETRY' ||
    session.checkout_step === 'AWAITING_ADDRESS_RETRY' ||
    session.current_step === 'AWAITING_ADDRESS_RETRY'
  ) {
    const rawAddressInput = rawText.trim();
    const parsedRetry = parseCustomerInfo(rawAddressInput, 'Delivery');
    const retryAddr = parsedRetry.address || rawAddressInput;
    const retryLandmark = parsedRetry.landmark || session.landmark || '';

    return await resolveDeliveryAddressAndFare(psid, session, retryAddr, retryLandmark);
  }

  // 2b. State: 'AWAITING_DISCOUNT_CONFIRMATION' (Requirement 1)
  if (
    session.state === 'AWAITING_DISCOUNT_CONFIRMATION' ||
    session.current_step === 'AWAITING_DISCOUNT_CONFIRMATION'
  ) {
    const isYes = /\b(?:meron|mayroon|opo|yes|oo|senior|pwd|meron\s*po|mayroon\s*po|i\s*have)\b/i.test(norm);
    const isNo = /\b(?:wala|wala\s*po|no|hindi|none|wag\s*na|huwag|ayaw|wala\s*akong)\b/i.test(norm);

    if (isYes) {
      session.state = 'AWAITING_DISCOUNT_PROOF';
      session.current_step = 'AWAITING_DISCOUNT_PROOF';
      await saveSession(session);

      const askProofMsg = 'Paki-send po ang picture ng inyong Senior Citizen o PWD ID o i-type ang inyong ID Number para ma-apply ang 20% discount.';
      await sendTextMessage(psid, askProofMsg);
      return { intent: 'AWAITING_DISCOUNT_PROOF', confidence: 1.0, replyLog: askProofMsg };
    }

    if (isNo) {
      session.discount = { applied: false, type: 'None', amount: 0 };
      session.discount_amount = 0;
      return await finalizeOrderSummaryAndPayment(psid, session);
    }

    const reAskMsg = 'Mayroon po ba kayong Senior Citizen o PWD ID para sa 20% discount?';
    await sendQuickReplies(psid, reAskMsg, [
      { title: 'Mayroon', payload: 'DISCOUNT_YES' },
      { title: 'Wala po', payload: 'DISCOUNT_NO' }
    ]);
    return { intent: 'AWAITING_DISCOUNT_CONFIRMATION_RETRY', confidence: 1.0, replyLog: reAskMsg };
  }

  // 2c. State: 'AWAITING_DISCOUNT_PROOF' (Requirement 1)
  if (
    session.state === 'AWAITING_DISCOUNT_PROOF' ||
    session.current_step === 'AWAITING_DISCOUNT_PROOF'
  ) {
    const subtotal = session.order_subtotal || (session.cart ? calculateCartSubtotal(session.cart) : 0);
    const computedDiscount = Math.round((subtotal * 0.20) * 100) / 100;
    const idText = rawText.trim() || 'Senior / PWD ID Provided';

    session.discount = {
      applied: true,
      type: 'Senior Citizen / PWD 20%',
      amount: computedDiscount,
      idNumber: idText
    };
    session.discount_amount = computedDiscount;

    return await finalizeOrderSummaryAndPayment(psid, session);
  }

  // 3. State: 'AWAITING_PAYMENT_PROOF', 'AWAITING_GCASH_VERIFICATION', 'AWAITING_PAYMENT_VERIFICATION'
  if (
    session.checkout_step === 'AWAITING_PAYMENT_PROOF' ||
    session.state === 'AWAITING_PAYMENT_PROOF' ||
    session.current_step === 'AWAITING_PAYMENT_PROOF' ||
    session.state === 'AWAITING_GCASH_VERIFICATION' ||
    session.current_step === 'AWAITING_GCASH_VERIFICATION' ||
    session.state === 'AWAITING_PAYMENT_VERIFICATION' ||
    session.current_step === 'AWAITING_PAYMENT_VERIFICATION' ||
    session.state === 'AWAITING_DELIVERY_DETAILS' ||
    session.current_step === 'AWAITING_DELIVERY_DETAILS' ||
    Boolean(session.pendingGCashOrder)
  ) {
    return await handlePaymentProofTextInput(psid, session, rawText);
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

  if (session.state === 'AWAITING_DRINK_ADDON' || session.current_step === 'AWAITING_DRINK_ADDON') {
    await handleAddonSelection(psid, session, rawText);
    return { intent: 'SELECT_ADDON', confidence: 1.0 };
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
        if (parsePaymentModeValue(rawText) === 'Xendit') {
          await placeCustomerOrder(psid, session, 'xendit');
          return { intent: 'PAY_XENDIT', confidence: 1.0 };
        }
      }
    }
  }

  // Issue 3: Explicit Checkout intent / triggers (Eliminates "Yes to what" and confirmation trap)
  if (
    /(?:check\s*out|checkout|yes.*checkout|bayad|babayaran|paki\s*checkout)/i.test(norm) ||
    ['checkout', 'check out', 'pay now', 'im done', 'thats all'].includes(norm)
  ) {
    return startCheckoutFlow(psid, session);
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

  // 4. Shortcut words & Full Menu inquiries (Requirement 1)
  if (
    ['menu', 'order', 'browse', 'show menu', 'show me the menu', 'what do you have', 'what s available', 'menu please', 'full menu', 'menu list', 'menu po'].includes(norm) ||
    /\b(?:patingin\s*(?:ng)?\s*menu|tingin\s*(?:ng)?\s*menu|menu\s*please|ano\s*pong\s*tinda\s*niyo|anong\s*tinda\s*niyo|drinks\s*list|list\s*of\s*drinks|food\s*list|pahingi\s*ng\s*menu|pakita\s*ng\s*menu)\b/i.test(rawText) ||
    (/\b(?:menu|catalog|tinda|listahan)\b/i.test(norm) && !/\b(?:cancel|remove|delete|alisin|tanggalin)\b/i.test(norm))
  ) {
    await sendFullMenu(psid, session);
    return { intent: 'BROWSE_MENU', confidence: 1.0 };
  }

  // 4b. On-Demand Item Photo Request (e.g., "Patingin ng picture ng Biscoff Cheesecake")
  if (isItemPhotoRequest(rawText)) {
    return await handleItemPhotoRequest(psid, session, rawText);
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
    ['track', 'track order', 'where is my order', 'status', 'order status'].includes(norm) ||
    /\b(?:track|nasaan|asan|balita|status|kamusta|kumusta|update)\b.*\b(?:order|delivery|pagkain|kape)\b/i.test(rawText) ||
    /\b(?:order|delivery)\b.*\b(?:status|balita|nasaan|asan|update)\b/i.test(rawText) ||
    /\b(?:gaano|kailan|kelan|oras|katagal)\b.*\b(?:bago|dumating|makuha|ma kuha|deliver|order)\b/i.test(rawText)
  ) {
    await handleTrackOrder(psid, session);
    return { intent: 'TRACK_ORDER', confidence: 1.0 };
  }

  // Stage 1: Dining Mode text responses if not yet locked
  if (!session.dining_mode && !session.orderType) {
    if (/\b(?:dine\s*in|sa\s*loob|table)\b/i.test(norm)) {
      session.dining_mode = 'Dine In';
      session.orderType = 'dine_in';
      session.state = 'ORDERING';
      await saveSession(session);
      const msg = `Copy po sa Dine In! Free seating po tayo sa open seating area kaya feel free to find any available seat pagdating niyo.\n\nEto po ang aming menu para makapili kayo ng inyong drinks and meals:`;
      await sendTextMessage(psid, msg);
      await sendFullMenu(psid, session);
      return { intent: 'DINING_MODE_DINE_IN', confidence: 1.0, replyLog: msg };
    }
    if (/\b(?:take[\s-]*out|takeout|pick[\s-]*up|pickup|daanan)\b/i.test(norm)) {
      session.dining_mode = 'Pick-up';
      session.orderType = 'pickup';
      session.state = 'ORDERING';
      await saveSession(session);
      const msg = `Copy po sa Take Out! Ihahanda po natin ito agad para sa counter pickup pagdaan ninyo sa cafe.\n\nEto po ang aming menu para makapili kayo:`;
      await sendTextMessage(psid, msg);
      await sendFullMenu(psid, session);
      return { intent: 'DINING_MODE_TAKE_OUT', confidence: 1.0, replyLog: msg };
    }
    if (/\b(?:delivery|deliver|padeliver|pa-deliver)\b/i.test(norm)) {
      session.dining_mode = 'Delivery';
      session.orderType = 'delivery';
      session.state = 'ORDERING';
      await saveSession(session);
      const msg = `Noted po sa Delivery! Ihahatid po namin ito sa inyong address (hihingin po namin ang complete delivery address mamaya sa checkout).\n\nEto po ang aming menu para makapili kayo:`;
      await sendTextMessage(psid, msg);
      await sendFullMenu(psid, session);
      return { intent: 'DINING_MODE_DELIVERY', confidence: 1.0, replyLog: msg };
    }
  }

  if (['hi', 'hello', 'hey', 'good morning', 'kumusta'].includes(norm) || /^(?:hi|hello|magandang (?:araw|umaga|hapon|gabi))\b/i.test(norm)) {
    if (!session.dining_mode && !session.orderType) {
      session.state = 'AWAITING_DINING_MODE';
      await saveSession(session);
      const greetingMsg = `Hello po! Welcome to Diner's Cafe! Ask ko lang po muna bago tayo magsimula, will this be for **Dine In**, **Delivery**, or **Take Out**?`;
      await sendQuickReplies(psid, greetingMsg, [
        { title: 'Dine In', payload: 'DINING_MODE_DINE_IN' },
        { title: 'Delivery', payload: 'DINING_MODE_DELIVERY' },
        { title: 'Take Out', payload: 'DINING_MODE_TAKE_OUT' }
      ]);
      return { intent: 'GREETING_STAGE1', confidence: 1.0, replyLog: greetingMsg };
    }
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

  // 5a. Bilingual / Taglish Conversational Assistant (Google Gemini AI + Structured JSON Action Routing)
  if ((process.env.NODE_ENV !== 'test' || global.__ENABLE_AI_SERVICE_IN_TEST__) && aiService.isAiConfigured() && isConversationalInquiry(rawText, session)) {
    const aiTurn = await executeAiAssistantTurn(psid, session, rawText);
    if (aiTurn) {
      return aiTurn;
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
    if ((process.env.NODE_ENV !== 'test' || global.__ENABLE_AI_SERVICE_IN_TEST__) && aiService.isAiConfigured()) {
      const aiFallbackTurn = await executeAiAssistantTurn(psid, session, rawText);
      if (aiFallbackTurn) {
        return aiFallbackTurn;
      }
    }
    const fb = botMessages.fallback();
    await sendQuickReplies(psid, fb.text, fb.quickReplies);
    return { intent: 'FALLBACK', confidence: conf };
  }

  if (intent === 'OUT_OF_SCOPE') {
    if ((process.env.NODE_ENV !== 'test' || global.__ENABLE_AI_SERVICE_IN_TEST__) && aiService.isAiConfigured()) {
      const aiTurn = await executeAiAssistantTurn(psid, session, rawText);
      if (aiTurn) return aiTurn;
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

  if (/^(?:view\s*drinks?|drinks?\s*menu|show\s*drinks?|drinks?\s*lang)$/i.test(norm)) {
    await sendFullMenu(psid, session, { view: 'drinks' });
    return { intent: 'VIEW_DRINKS', confidence: 1.0 };
  }

  if (/^(?:view\s*food|food\s*menu|show\s*food|meals?\s*menu)$/i.test(norm)) {
    await sendFullMenu(psid, session, { view: 'food' });
    return { intent: 'VIEW_FOOD', confidence: 1.0 };
  }

  if (intent === 'BROWSE_MENU') {
    await sendFullMenu(psid, session, { view: 'all' });
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
    if (session.dining_mode) {
      session.state = 'COLLECTING_CUSTOMER_INFO';
      session.current_step = 'COLLECTING_CUSTOMER_INFO';
      await saveSession(session);
      const prompt = getCheckoutInfoPrompt(session);
      await sendTextMessage(psid, prompt);
      return { intent: 'CONFIRM_CHECKOUT_YES', confidence: 1.0 };
    }
    session.state = 'AWAITING_ORDER_TYPE';
    const otMsg = botMessages.orderType();
    await sendQuickReplies(psid, otMsg.text, otMsg.quickReplies);
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
/**
 * Template string handler formatting the structured Announcement text (Deliverable 2)
 * @param {Object} promo - Promotion record
 * @returns {string} Formatted announcement text
 */
function formatPromotionAnnouncement(promo) {
  const eventTitle = promo.title || 'Special Promotion';
  let dateRange = 'Ongoing Promo';

  if (promo.start_date && promo.end_date) {
    dateRange = promo.start_date === promo.end_date 
      ? promo.start_date 
      : `${promo.start_date} to ${promo.end_date}`;
  } else if (promo.start_date) {
    dateRange = `Simula ${promo.start_date}`;
  } else if (promo.end_date) {
    dateRange = `Hanggang ${promo.end_date}`;
  }

  const eventDescription = promo.description || promo.perk_description || '';

  return `📢 SPECIAL EVENT ANNOUNCEMENT!\n\n${eventTitle}\n📅 Petsa: ${dateRange}\n\n${eventDescription}\n\nBago po kayo mag-order, nais niyo po ba itong i-avail? Eto po ang ating buong menu:`;
}

/**
 * Check for currently active promotion / event for pre-menu teaser
 * Query: SELECT * FROM promotions WHERE is_active = TRUE AND NOW() BETWEEN start_date AND end_date LIMIT 1
 */
async function getActivePromotionForPreMenu() {
  try {
    const [rows] = await db.query(`
      SELECT * FROM promotions 
      WHERE is_active = TRUE 
        AND NOW() BETWEEN start_date AND end_date 
      LIMIT 1
    `);
    if (rows && rows.length > 0) {
      return rows[0];
    }

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const [fallbackRows] = await db.query(`
      SELECT * FROM promotions 
      WHERE is_active = 1 
        AND (start_date IS NULL OR start_date <= ?)
        AND (end_date IS NULL OR end_date >= ?)
      ORDER BY created_at DESC 
      LIMIT 1
    `, [todayStr, todayStr]);
    return (fallbackRows && fallbackRows.length > 0) ? fallbackRows[0] : null;
  } catch (err) {
    console.warn('[Pre-Menu Promo Query Warning]', err.message);
    return null;
  }
}

async function getActivePromotionsForToday() {
  const promo = await getActivePromotionForPreMenu();
  return promo ? [promo] : [];
}

/**
 * Handle on-demand customer photo inquiry for a specific menu item.
 * Dispatches image attachment (if uploaded) + price/description + [+ Order] / [View Menu] Quick Replies.
 */
async function handleItemPhotoRequest(psid, session, rawText) {
  const queryName = extractPhotoItemQuery(rawText);
  const item = await lookupMenuItemForPhoto(queryName);

  // Scenario C: Item not found
  if (!item) {
    const notFoundMsg = "Paumanhin po, hindi ko po nahanap ang item na iyon. Maaari niyo pong i-type ang 'Menu' para makita ang listahan ng available nating pagkain at inumin.";
    await sendQuickReplies(psid, notFoundMsg, [
      { title: '📋 View Menu', payload: 'MENU_HOME' }
    ]);
    return { intent: 'ITEM_PHOTO_NOT_FOUND', confidence: 1.0, replyLog: notFoundMsg };
  }

  const priceStr = Number(item.price || 0).toFixed(2);
  const isAvailable = Number(item.is_available) === 1 && Number(item.stock) > 0;
  const descText = item.description ? ` ${String(item.description).trim()}` : '';
  const photoUrl = resolvePhotoAttachmentUrl(item.image_url);
  const orderTitle = `+ Order ${item.name}`.substring(0, 20);

  // Scenario A: Item and image_url exist
  if (photoUrl) {
    await sendImageAttachment(psid, photoUrl);

    if (isAvailable) {
      const followUp = `Ito po ang ating ${item.name} (₱${priceStr}).${descText}`;
      await sendQuickReplies(psid, followUp, [
        { title: orderTitle, payload: `ADD_ITEM_${item.id}` },
        { title: '📋 View Menu', payload: 'MENU_HOME' }
      ]);
      return { intent: 'ITEM_PHOTO_SENT', confidence: 1.0, replyLog: followUp, itemId: item.id };
    } else {
      const oosFollowUp = `Ito po ang ating ${item.name} (₱${priceStr}).${descText}\n\n⚠️ Paumanhin po, kasalukuyan itong Out of Stock sa ngayon.`;
      await sendQuickReplies(psid, oosFollowUp, [
        { title: '📋 View Menu', payload: 'MENU_HOME' }
      ]);
      return { intent: 'ITEM_PHOTO_SENT_OOS', confidence: 1.0, replyLog: oosFollowUp, itemId: item.id };
    }
  }

  // Scenario B: Item exists but image_url is null/empty
  if (isAvailable) {
    const noPhotoMsg = `Paumanhin po, wala pa pong uploaded na picture para sa ${item.name}, pero available po ito sa halagang ₱${priceStr}. Nais niyo po ba itong subukan?`;
    await sendQuickReplies(psid, noPhotoMsg, [
      { title: orderTitle, payload: `ADD_ITEM_${item.id}` },
      { title: '📋 View Menu', payload: 'MENU_HOME' }
    ]);
    return { intent: 'ITEM_PHOTO_MISSING', confidence: 1.0, replyLog: noPhotoMsg, itemId: item.id };
  }

  const noPhotoOosMsg = `Paumanhin po, wala pa pong uploaded na picture para sa ${item.name} (₱${priceStr}), at kasalukuyan po itong Out of Stock sa ngayon.`;
  await sendQuickReplies(psid, noPhotoOosMsg, [
    { title: '📋 View Menu', payload: 'MENU_HOME' }
  ]);
  return { intent: 'ITEM_PHOTO_MISSING_OOS', confidence: 1.0, replyLog: noPhotoOosMsg, itemId: item.id };
}

/**
 * Send Categorized Plain-Text Menu (replaces image carousel cards).
 * Groups active items by category, renders out-of-stock items with Unicode
 * combining strikethrough (\u0336), splits cleanly under 2,000 chars per bubble,
 * and attaches Quick Replies for fast filtering ([View Drinks], [View Food], [My Cart]).
 */
async function sendFullMenu(psid, session, options = {}) {
  session.state = 'BROWSING';
  await saveSession(session).catch(() => {});

  const [items] = await db.query(`
    SELECT m.id, m.name, m.price, m.is_available,
           COALESCE(i.stock_quantity, m.stock_quantity, 0) AS stock,
           COALESCE(c.name, 'Uncategorized') AS category_name,
           c.slug AS category_slug,
           COALESCE(c.display_order, 999) AS display_order
    FROM menu_items m
    LEFT JOIN categories c ON m.category_id = c.id
    LEFT JOIN inventory i ON i.menu_item_id = m.id
    WHERE COALESCE(m.is_deleted, 0) = 0
      AND (c.id IS NULL OR c.is_active = 1)
    ORDER BY COALESCE(c.display_order, 999) ASC, m.name ASC
  `);

  if (!items || items.length === 0) {
    await sendTextMessage(psid, "Our menu items are temporarily being restocked. Please check back shortly!");
    return;
  }

  const hasCart = Boolean(session.cart && session.cart.length > 0);
  const { messages, quickReplies } = buildTextMenuPayload(items, {
    view: options.view || 'all',
    hasCart
  });

  for (let idx = 0; idx < messages.length; idx++) {
    if (idx === messages.length - 1) {
      await sendQuickReplies(psid, messages[idx], quickReplies);
    } else {
      await sendTextMessage(psid, messages[idx]);
    }
  }
}

/**
 * Category-filtered plain-text menu (backward compatibility for CATEGORY_* payloads)
 */
async function sendCategoryMenu(psid, slug) {
  const [items] = await db.query(`
    SELECT m.id, m.name, m.price, m.is_available,
           COALESCE(i.stock_quantity, m.stock_quantity, 0) AS stock,
           COALESCE(c.name, 'Category') AS category_name,
           c.slug AS category_slug
    FROM menu_items m
    LEFT JOIN categories c ON c.id = m.category_id
    LEFT JOIN inventory i ON i.menu_item_id = m.id
    WHERE c.slug = ? AND COALESCE(m.is_deleted, 0) = 0
    ORDER BY m.name ASC
  `, [slug]);

  if (!items || items.length === 0) {
    await sendTextMessage(psid, "No items available in this category.");
    return;
  }

  const { messages, quickReplies } = buildTextMenuPayload(items, { view: 'all', hasCart: false });
  for (let idx = 0; idx < messages.length; idx++) {
    if (idx === messages.length - 1) {
      await sendQuickReplies(psid, messages[idx], quickReplies);
    } else {
      await sendTextMessage(psid, messages[idx]);
    }
  }
}

/**
 * Check if item belongs to Drinks & Milktea / beverage category
 */
function isDrinkOrMilktea(item) {
  if (!item) return false;
  const name = String(item.name || '').toLowerCase();
  const cat = String(item.category || item.category_name || '').toLowerCase();
  if (cat.includes('drink') || cat.includes('milktea') || cat.includes('coffee') || cat.includes('tea') || cat.includes('beverage')) {
    return true;
  }
  return /milktea|milk\s*tea|tea|latte|coffee|macchiato|frappe|yakult|fruit\s*tea|americano|matcha|espresso|cappuccino|mocha|cooler|juice|shake|cheesecake|beverage|drink|chocolate/i.test(name);
}

/**
 * Detect explicit add-on in customer input (e.g. "with pearls", "with coffee jelly")
 */
function detectAddonInText(text) {
  if (!text) return null;
  if (/\b(?:with|plus|may|lagyan\s*ng|add)?\s*(?:pearls?|tapioca|sago)\b/i.test(text)) return 'Pearls';
  if (/\b(?:with|plus|may|lagyan\s*ng|add)?\s*(?:nata\s*de\s*coco|nata|rainbow|crystals?)\b/i.test(text)) return 'Nata de Coco';
  if (/\b(?:with|plus|may|lagyan\s*ng|add)?\s*(?:cream\s*cheese|creamcheese|wall)\b/i.test(text)) return 'Cream Cheese';
  if (/\b(?:with|plus|may|lagyan\s*ng|add)?\s*(?:coffee\s*jelly|espresso\s*jelly)\b/i.test(text)) return 'Coffee Jelly';
  if (/\b(?:with|plus|may|lagyan\s*ng|add)?\s*(?:egg\s*pudding|pudding)\b/i.test(text)) return 'Egg Pudding';
  if (/\b(?:with|plus|may|lagyan\s*ng|add)?\s*(?:crushed\s*oreo|oreo)\b/i.test(text)) return 'Crushed Oreo';
  return null;
}

/**
 * Prompt customer if they want to add add-ons for drinks & milk tea
 */
async function promptDrinkAddons(psid, session, item, quantity) {
  session.current_drink_item = { item, quantity };
  session.pendingDrinkOrder = { item, quantity };
  session.pendingItem = null;
  session.state = 'AWAITING_DRINK_ADDON';
  session.current_step = 'AWAITING_DRINK_ADDON';
  await saveSession(session);

  const askAddonMsg = "Nais niyo po ba itong lagyan ng Add-ons tulad ng Pearls, Nata de Coco, o Cream Cheese (+₱20 bawat isa)?";
  await sendQuickReplies(psid, askAddonMsg, [
    { title: 'Pearls (+₱20)', payload: 'ADDON_PEARLS' },
    { title: 'Nata de Coco (+₱20)', payload: 'ADDON_NATA' },
    { title: 'Cream Cheese (+₱20)', payload: 'ADDON_CREAM_CHEESE' },
    { title: 'Wala / Skip', payload: 'ADDON_NONE' }
  ]);
}

/**
 * Handle chosen add-on for drinks
 */
async function handleAddonSelection(psid, session, rawInput) {
  const pendingDrink = session.current_drink_item || session.pendingDrinkOrder;
  if (!pendingDrink || !pendingDrink.item) {
    session.state = 'ORDERING';
    await sendTextMessage(psid, "Ano po ang nais ninyong i-order?");
    return;
  }

  const { item, quantity } = pendingDrink;
  const qty = Math.max(1, parseInt(quantity, 10) || 1);
  const input = String(rawInput || '').trim();

  // Scenario C: User Inquires About Options ("Ano ang mga add-ons?", "Anong meron?", "Options?", etc.)
  const isInquiry = (
    /ADDON_INQUIRY/i.test(input) ||
    /\b(?:ano|anong|anu-ano|anu-anong|what|whats|what's|list|patingin|options?|choices?|available|pwede)\b.*\b(?:add[\s-]*ons?|addons?|meron|toppings?|idagdag)\b/i.test(input) ||
    /^(?:ano|anong|anu-ano|anu-anong|what|whats|what's|ano\s*ba|patingin)\s+(?:ang|mga|ang\s*mga)?\s*(?:add[\s-]*ons?|addons?|toppings?|meron)\??$/i.test(input) ||
    /^(?:anong\s*meron|ano\s*meron|options\??|choices\??|add[\s-]*ons?\??|addons\??|anong\s*add[\s-]*ons\??)$/i.test(input) ||
    /\b(?:ano\s*ang\s*mga\s*add[\s-]*ons|anong\s*meron|options)\b/i.test(input)
  );

  if (isInquiry) {
    session.state = 'AWAITING_DRINK_ADDON';
    session.current_step = 'AWAITING_DRINK_ADDON';
    await saveSession(session);

    const catalogMsg = `Narito po ang mga available naming Add-ons (+₱20 bawat isa):
• Pearls
• Nata de Coco
• Cream Cheese
• Coffee Jelly
• Egg Pudding

Alin po rito ang nais ninyong idagdag? (O sabihin lamang ang 'Wala' kung ayaw mag-add).`;

    await sendQuickReplies(psid, catalogMsg, [
      { title: 'Pearls', payload: 'ADDON_PEARLS' },
      { title: 'Nata de Coco', payload: 'ADDON_NATA' },
      { title: 'Cream Cheese', payload: 'ADDON_CREAM_CHEESE' },
      { title: 'Wala / Skip', payload: 'ADDON_NONE' }
    ]);
    return;
  }

  // Scenario B: User Declines ("Wala", "No", "Skip", "Wag na", etc.)
  const isDecline = (
    /ADDON_NONE/i.test(input) ||
    /^(?:wala|wala\s*po|no|none|skip|ayaw|wag|huwag|wag\s*na|huwag\s*na|hindi|plain|only|no\s*thanks|pass|ayoko|ayaw\s*ko|wala\s*na|wala\s*na\s*po)$/i.test(input) ||
    /\b(?:wala\s*na|wag\s*na|huwag\s*na|no\s*add[\s-]*ons?|ayaw\s*ng\s*add[\s-]*ons?)\b/i.test(input)
  );

  if (isDecline) {
    if (!session.cart) session.cart = [];
    const drinkToCart = { ...item };
    addToCart(session.cart, drinkToCart, qty);

    session.current_drink_item = null;
    session.pendingDrinkOrder = null;
    session.state = 'COLLECTING_CUSTOMER_INFO';
    session.current_step = 'COLLECTING_CUSTOMER_INFO';
    await saveSession(session);

    await sendTextMessage(psid, "Sige po, walang add-ons.");
    const prompt = getCheckoutInfoPrompt(session);
    await sendTextMessage(psid, prompt);
    return;
  }

  // Scenario A: User Selects an Add-on (Click or Text input matching an add-on)
  let selectedAddon = null;
  if (/ADDON_PEARLS|\b(?:pearls?|tapioca|sago)\b/i.test(input)) {
    selectedAddon = 'Pearls';
  } else if (/ADDON_NATA|ADDON_CRYSTALS|\b(?:nata\s*de\s*coco|nata|rainbow|crystals?)\b/i.test(input)) {
    selectedAddon = 'Nata de Coco';
  } else if (/ADDON_CREAM_CHEESE|\b(?:cream\s*cheese|creamcheese|wall)\b/i.test(input)) {
    selectedAddon = 'Cream Cheese';
  } else if (/ADDON_COFFEE_JELLY|\b(?:coffee\s*jelly|espresso\s*jelly)\b/i.test(input)) {
    selectedAddon = 'Coffee Jelly';
  } else if (/ADDON_PUDDING|\b(?:egg\s*pudding|pudding)\b/i.test(input)) {
    selectedAddon = 'Egg Pudding';
  } else if (/ADDON_OREO|\b(?:crushed\s*oreo|oreo)\b/i.test(input)) {
    selectedAddon = 'Crushed Oreo';
  }

  if (selectedAddon) {
    if (!session.cart) session.cart = [];
    const modifiedName = `${item.name} (w/ ${selectedAddon})`;
    const drinkToCart = {
      ...item,
      name: modifiedName,
      addons: [selectedAddon],
      addOns: [{ name: selectedAddon, price: 20.0 }]
    };
    addToCart(session.cart, drinkToCart, qty);

    session.current_drink_item = null;
    session.pendingDrinkOrder = null;
    session.state = 'COLLECTING_CUSTOMER_INFO';
    session.current_step = 'COLLECTING_CUSTOMER_INFO';
    await saveSession(session);

    await sendTextMessage(psid, `Sige po, nailagay na ang ${selectedAddon} (+₱20)!`);
    const prompt = getCheckoutInfoPrompt(session);
    await sendTextMessage(psid, prompt);
    return;
  }

  // Unrecognized input in add-ons state: politely re-prompt
  const clarifyMsg = "Paki-pili po kung nais ninyo ng Add-ons o i-tap ang 'Wala / Skip':";
  await sendQuickReplies(psid, clarifyMsg, [
    { title: 'Pearls (+₱20)', payload: 'ADDON_PEARLS' },
    { title: 'Nata de Coco (+₱20)', payload: 'ADDON_NATA' },
    { title: 'Cream Cheese (+₱20)', payload: 'ADDON_CREAM_CHEESE' },
    { title: 'Wala / Skip', payload: 'ADDON_NONE' }
  ]);
}

/**
 * Handle adding an item via button payload
 */
async function handleAddItemPayload(psid, session, menuItemId) {
  const [rows] = await db.query(
    `SELECT m.id, m.name, m.price, m.category, m.is_available, i.stock_quantity 
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
  session.pendingItem = { id: item.id, name: item.name, price: item.price, category: item.category };

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

  const { checkMenuAvailability } = require('./inventoryService');
  const bomCheck = await checkMenuAvailability(item.id || item.menuItemId, quantity);
  if (!bomCheck.available) {
    session.pendingItem = null;
    session.state = 'BROWSING';
    await saveSession(session);
    const missingNames = (bomCheck.missingIngredients || []).map(m => m.name).join(', ');
    const oosMsg = missingNames
      ? `Paumanhin po, out of stock na po ang ${item.name} dahil kulang na ang raw ingredients (${missingNames}). Pili na lang po tayo ng iba!`
      : `Paumanhin po, sold out / out of stock na po ang ${item.name} sa ngayon.`;
    await sendQuickReplies(psid, oosMsg, [{ title: '☕ Menu', payload: 'MENU_HOME' }]);
    return;
  }

  // If item is a drink or milk tea, ask if they want add-ons
  if (isDrinkOrMilktea(item)) {
    await promptDrinkAddons(psid, session, item, quantity);
    return;
  }

  // Non-drink items: Add directly to cart
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
    SELECT m.id, m.name, m.price, m.synonyms, m.is_available, COALESCE(m.stock_quantity, i.stock_quantity, 0) AS stock_quantity
    FROM menu_items m
    LEFT JOIN inventory i ON i.menu_item_id = m.id
    WHERE COALESCE(m.is_deleted, 0) = 0
  `);

  let cleanQuery = (nlu?.menuItem || rawText || '')
    .replace(/\b(?:i\s*want|can\s*i\s*get|order|add|one\s*more|another|isa\s*pang|dalawa\s*pang|gusto\s*ko\s*ng|pa[- ]?order(?:\s*po)?(?:\s*ng)?|pabili(?:\s*po)?(?:\s*ng)?)\b/gi, '')
    .replace(/\b(?:the|a|an|po|please|pls|ang|yung|ng|sa)\b/gi, '')
    .replace(/\b\d+\s*(?:pcs|pieces|orders?|cups?|servings?|x)?\b/gi, '')
    .replace(/\b(?:one|two|three|four|five|six|seven|eight|nine|ten|isa|isang|dalawa|dalawang|tatlo|tatlong|apat|apat na|lima|limang|anim|anim na|pito|pitong|walo|walong|siyam|siyam na|sampu|sampung)\b/gi, '')
    .trim();
  if (!cleanQuery) cleanQuery = rawText;

  const matchResult = matchItems(cleanQuery, candidates);

  if (matchResult.status === 'accept') {
    const matchedItem = matchResult.matches[0];

    // Stock & Availability Guard (Requirement 4)
    const stock = matchedItem.stock_quantity !== undefined ? matchedItem.stock_quantity : 999;
    const isAvail = matchedItem.is_available === undefined || matchedItem.is_available === 1 || matchedItem.is_available === true;
    if (stock <= 0 || !isAvail) {
      const soldOutMsg = `Paumanhin po, sold out na po ang item na ito. (${matchedItem.name} is currently unavailable)`;
      await sendTextMessage(psid, soldOutMsg);
      return { intent: 'ORDER_ITEM_OUT_OF_STOCK', confidence: 1.0, handled: true };
    }

    const qty = nlu.quantity || parseQuantity(rawText) || 1;

    const { checkMenuAvailability } = require('./inventoryService');
    const bomCheck = await checkMenuAvailability(matchedItem.id, qty);
    if (!bomCheck.available) {
      const missingNames = (bomCheck.missingIngredients || []).map(m => m.name).join(', ');
      const soldOutMsg = missingNames
        ? `Paumanhin po, out of stock na po ang ${matchedItem.name} sa ngayon (kulang sa ingredients: ${missingNames}).`
        : `Paumanhin po, sold out na po ang item na ito. (${matchedItem.name} is currently unavailable)`;
      await sendQuickReplies(psid, soldOutMsg, [{ title: '☕ Menu', payload: 'MENU_HOME' }]);
      return { intent: 'ORDER_ITEM_OUT_OF_STOCK', confidence: 1.0, handled: true };
    }

    if (qty !== null && qty > 0) {
      if (isDrinkOrMilktea(matchedItem)) {
        const detectedAddon = detectAddonInText(rawText);
        if (detectedAddon) {
          if (!session.cart) session.cart = [];
          const modifiedName = `${matchedItem.name} (w/ ${detectedAddon})`;
          const drinkWithAddon = {
            ...matchedItem,
            name: modifiedName,
            addons: [detectedAddon],
            addOns: [{ name: detectedAddon, price: 20.0 }]
          };
          addToCart(session.cart, drinkWithAddon, qty);
          session.state = 'COLLECTING_CUSTOMER_INFO';
          session.current_step = 'COLLECTING_CUSTOMER_INFO';
          await saveSession(session);
          await sendTextMessage(psid, `Sige po, nailagay na ang ${detectedAddon} (+₱20)!`);
          const prompt = getCheckoutInfoPrompt(session);
          await sendTextMessage(psid, prompt);
          return { intent: 'ORDER_ITEM', confidence: 1.0 };
        }

        await promptDrinkAddons(psid, session, matchedItem, qty);
        return { intent: 'AWAITING_DRINK_ADDON', confidence: 1.0 };
      }

      if (!session.cart) session.cart = [];
      addToCart(session.cart, matchedItem, qty);
      await saveSession(session);
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

    // Stock & Availability Guard (Requirement 4)
    const candStock = topCand.stock_quantity !== undefined ? topCand.stock_quantity : 999;
    const candAvail = topCand.is_available === undefined || topCand.is_available === 1 || topCand.is_available === true;
    if (candStock <= 0 || !candAvail) {
      const soldOutMsg = `Paumanhin po, sold out na po ang item na ito. (${topCand.name} is currently unavailable)`;
      await sendTextMessage(psid, soldOutMsg);
      return { intent: 'ORDER_ITEM_OUT_OF_STOCK', confidence: 1.0, handled: true };
    }
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

  // Generative AI Conversational Assistant fallback (Google Gemini via @google/genai + Structured JSON Routing)
  if ((process.env.NODE_ENV !== 'test' || global.__ENABLE_AI_SERVICE_IN_TEST__) && aiService.isAiConfigured()) {
    const aiTurn = await executeAiAssistantTurn(psid, session, rawText);
    if (aiTurn) {
      return aiTurn;
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

  await saveSession(session);

  if (session.cart.length === 0) {
    session.state = 'IDLE';
    const remEmptyMsg = `Removed na po ang ${result.removed}x ${result.name} sa inyong cart! Eto po ang updated items niyo: Cart is now empty.`;
    await sendQuickReplies(psid, remEmptyMsg, [
      { title: '☕ Menu', payload: 'MENU_HOME' }
    ]);
  } else {
    session.state = 'AWAITING_CHECKOUT_CONFIRM';
    const subtotal = calculateCartSubtotal(session.cart);
    const summaryList = session.cart.map(c => `- ${c.quantity}x ${c.name} (${peso((c.price || 0) * c.quantity)})`).join('\n') + `\nTotal: ${peso(subtotal)}`;
    const remMsg = `Removed na po ang ${result.removed}x ${result.name} sa inyong cart! Eto po ang updated items niyo:\n${summaryList}`;
    await sendQuickReplies(psid, remMsg, [
      { title: 'Proceed to Checkout', payload: 'CONFIRM_CHECKOUT' },
      { title: 'Add more items', payload: 'KEEP_SHOPPING' },
      { title: 'View cart', payload: 'VIEW_CART' }
    ]);
  }
}

async function handleRemoveItemText(psid, session, rawText, nlu = {}) {
  if (!session.cart || session.cart.length === 0) {
    const empty = botMessages.cartEmpty();
    await sendQuickReplies(psid, empty.text, empty.quickReplies);
    return { intent: 'REMOVE_ITEM_EMPTY', confidence: 1.0 };
  }

  // Multi-item & Typo-tolerant atomic removal (Issue 1)
  const removedItems = executeMultiItemRemoval(session.cart, rawText);
  if (removedItems && removedItems.length > 0) {
    // Recompute cart_total immediately after mutation
    const cart_total = session.cart.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0);
    session.order_subtotal = cart_total;
    session.order_total = cart_total;

    // Mutate and persist to DB directly
    await saveSession(session);

    session.state = session.cart.length > 0 ? 'AWAITING_CHECKOUT_CONFIRM' : 'IDLE';
    session.current_step = session.cart.length > 0 ? 'AWAITING_CHECKOUT_CONFIRM' : 'IDLE';

    const resp = formatRemovalResponse(removedItems, session.cart);
    await sendQuickReplies(psid, resp.text, resp.quickReplies);
    return { intent: 'REMOVE_ITEM', confidence: 1.0, removedItems, cart_total };
  }

  // If no specific item in text, ask which item
  const itemQuery = (nlu && nlu.menuItem) || rawText
    .replace(/\b(?:remove|delete|take\s*out|cancel\s*(?:the|my)?|alisin|tanggalin|patanggal|pa\s*tanggal)\b/gi, '')
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
  const qty = (nlu && nlu.quantity) || parseQuantity(rawText);

  // Single-Turn Atomic Execution: Remove item directly without secondary confirmation
  if (matchRes.status === 'accept' || matchRes.status === 'confirm') {
    const matched = matchRes.matches[0];
    await handleRemoveItemById(psid, session, matched.id, qty);
    return { intent: 'REMOVE_ITEM', confidence: 1.0 };
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
    return { intent: 'CHECKOUT_EMPTY', confidence: 1.0 };
  }

  // Issue 3: Immediately transition to COLLECTING_CUSTOMER_INFO and prompt cleanly without "Yes to what?"
  session.state = 'COLLECTING_CUSTOMER_INFO';
  session.current_step = 'COLLECTING_CUSTOMER_INFO';
  await saveSession(session);

  const prompt = getCheckoutInfoPrompt(session);
  await sendTextMessage(psid, prompt);
  return { intent: 'COLLECTING_CUSTOMER_INFO_PROMPT', confidence: 1.0, replyLog: prompt };
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
    const feeRes = await calculateDeliveryFee(location.lat, location.lng);
    session.delivery_fee = feeRes.deliveryFee;
    session.deliveryFee = feeRes.deliveryFee;
    session.delivery_coordinates = { lat: location.lat, lng: location.lng };

    const quoteRes = await quoteForAddress({ lat: location.lat, lng: location.lng, address: session.details?.address });
    session.quote = quoteRes;
    session.details.address = feeRes.formattedAddress || quoteRes.formattedAddress || `Pin (${location.lat.toFixed(4)}, ${location.lng.toFixed(4)})`;

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
    const isOnlineMethod = paymentMethod === 'xendit' || paymentMethod === 'gcash';
    if (isOnlineMethod && !shouldUseXenditCheckout()) {
      const diningMode = session.orderType === 'delivery' ? 'Delivery' : 'Pick-up';
      return await dispatchPersonalGcashCheckout(psid, session, {
        customerName: session.details?.name || session.customer_name || 'Customer',
        contactNumber: session.details?.phone || session.contact_number || session.phone_number || '',
        deliveryAddress: session.orderType === 'delivery' ? (session.details?.address || session.delivery_address) : 'Store Pickup',
        orderType: session.orderType || 'delivery',
        dining_mode: diningMode,
        items: (session.cart || []).map(c => ({
          menuItemId: c.menuItemId || c.id,
          name: c.name,
          quantity: c.quantity || 1,
          unitPrice: c.price,
          price: c.price,
          addOns: c.addOns || c.addons
        })),
        subtotal: session.checkout?.subtotal || session.order_subtotal || 0,
        deliveryFee: session.checkout?.deliveryFee || 0,
        grandTotal: session.checkout?.total || session.order_total || 0,
        quoteToken: session.quote?.quoteToken || null,
        distanceKm: session.quote?.distanceKm || 1.2
      });
    }

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
    const orderId = order.orderId || order.id;

    if (paymentMethod === 'xendit' || paymentMethod === 'gcash') {
      return await dispatchXenditCheckout(psid, session, {
        orderId,
        orderNum,
        totalAmount: orderData.totalAmount || 0,
        customerName: orderData.customerName || 'Customer',
        customerPhone: orderData.customerPhone || ''
      });
    }

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
 * Initiate Online Payment (Xendit)
 */
async function initiateGCashPayment(psid, session) {
  return placeCustomerOrder(psid, session, 'xendit');
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
async function handleStage5Confirmation(psid, session, options = {}) {
  const { isAlreadyPaid = false } = options;
  const p = session.pendingStage5 || {};
  const customerName = p.name || session.customer_name || session.details?.name || 'Customer';
  const deliveryAddress = p.address || session.delivery_address || session.details?.address || 'Inside Cafe (Open Seating / Counter Pickup)';
  const orderType = (p.orderType === 'pickup' || p.orderType === 'dine_in') ? 'pickup' : 'delivery';
  const rawMethod = (p.paymentMethod || 'xendit').toLowerCase();
  const paymentMethod = (rawMethod === 'gcash' || rawMethod === 'xendit') ? 'xendit' : 'cash';
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
    const storeSettings = storeSettingsService.getCachedStoreSettings();
    quoteToken = jwt.sign(
      {
        lat: Number(storeSettings.store_latitude) || Number(config.store?.lat) || 14.6042,
        lng: Number(storeSettings.store_longitude) || Number(config.store?.lng) || 120.9822,
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

  if (paymentMethod === 'xendit' && !isAlreadyPaid && !shouldUseXenditCheckout()) {
    session.pendingStage5 = null;
    return await dispatchPersonalGcashCheckout(psid, session, {
      customerName,
      customerPhone: session.phone_number || session.contact_number || session.details?.phone || '',
      deliveryAddress,
      orderType,
      dining_mode: session.dining_mode || (orderType === 'delivery' ? 'Delivery' : 'Pick-up'),
      items,
      deliveryFee: session.delivery_fee || 0,
      grandTotal: totalAmount,
      quoteToken
    });
  }

  const newOrder = await createOrder(psid, {
    customerName,
    customerPhone: session.phone_number || session.contact_number || session.details?.phone || '',
    deliveryAddress,
    orderType,
    paymentMethod,
    amountPaid: (isAlreadyPaid && paymentMethod === 'xendit') ? totalAmount : 0,
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

  // Broadcast to Admin Dashboard so Kanban displays card in Pending Approval
  notificationService.broadcastSSE('NEW_ORDER', {
    orderNumber: orderNum,
    status: 'pending',
    totalAmount,
    customerName,
    paymentMethod
  });

  if (isAlreadyPaid) {
    await db.query(
      `UPDATE payments SET status = 'verified', verified_at = CURRENT_TIMESTAMP 
       WHERE order_id = (SELECT id FROM orders WHERE order_number = ? LIMIT 1)`,
      [orderNum]
    );
    notificationService.broadcastSSE('ORDER_STATUS_CHANGED', {
      orderNumber: orderNum,
      newStatus: 'pending',
      paymentStatus: 'verified'
    });
    session.state = 'AWAITING_DELIVERY';
    session.current_step = 'AWAITING_DELIVERY';
    await saveSession(session);

    const reply = `Natanggap na po namin ang inyong GCash payment! Ang inyong order (#${orderNum}) ay submitted na for Pending Approval.`;
    await sendTextMessage(psid, reply);
    return { intent: 'ORDER_CONFIRMED_PAID', confidence: 1.0, replyLog: reply };
  }

  if (paymentMethod === 'xendit') {
    try {
      return await dispatchXenditCheckout(psid, session, {
        orderId: newOrder.orderId || newOrder.id,
        orderNum,
        totalAmount,
        customerName,
        customerPhone: session.phone_number || session.contact_number || session.details?.phone || ''
      });
    } catch (xErr) {
      console.error('[Xendit Stage 5 Checkout Error]', xErr);
      const errMsg = 'Paumanhin, nagkaroon ng error sa paggawa ng Xendit payment link. Pakisubukan muli o pumili ng Cash payment.';
      await sendTextMessage(psid, errMsg);
      return { intent: 'ORDER_ERROR', confidence: 1.0, replyLog: errMsg };
    }
  } else {
    session.state = 'ORDER_PLACED';
    session.current_step = 'ORDER_PLACED';
    await saveSession(session);

    const textMsg = `Salamat po! Naipasa na po ang inyong order sa system with status: Pending Approval. I-notify po namin kayo oras na ma-verify ng store.`;
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
      "Wala po kayong aktibong order sa ngayon. Nais niyo po bang mag-order?",
      [{ title: '☕ Menu', payload: 'MENU_HOME' }]
    );
    return;
  }

  const o = rows[0];
  let statusText = 'Pending Approval (inihahanda sa kusina)';
  if (o.status === 'preparing') statusText = 'kasalukuyang inihahanda at niluluto sa kusina';
  else if (o.status === 'dispatched') statusText = 'on the way na po kasama si kuya rider';
  else if (o.status === 'delivered') statusText = 'matagumpay nang nai-deliver';
  else if (o.status === 'cancelled') statusText = 'na-cancel po';

  let etaText = '';
  if (o.status === 'pending' || o.status === 'preparing') {
    etaText = '\nKaraniwan po, 30 to 45 minutes ang preparation at delivery. I-a-update po namin kayo agad!';
  } else if (o.status === 'dispatched') {
    etaText = '\nAsahan po itong darating sa loob ng susunod na 15-20 minuto!';
  }

  if (o.status === 'delivered' || o.status === 'cancelled') {
    session.activeOrderNumber = null;
  } else {
    session.activeOrderNumber = o.order_number;
  }

  const replyMsg = `Status ng inyong Order #${o.order_number}:\nIto po ay ${statusText}!${etaText}\nTotal: ₱${parseFloat(o.total_amount).toFixed(2)} (${o.order_type.toUpperCase()}).`;
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
 * Execute a grounded Gemini Conversational AI turn using aiService.generateAssistantResponse()
 * and route the strict JSON output (NONE | ADD_ITEM | VIEW_MENU | SEND_PICTURE | CANCEL_ORDER | CHECK_STATUS | PROCEED_CHECKOUT).
 */
async function executeAiAssistantTurn(psid, session, rawText, options = {}) {
  try {
    const aiRes = options.aiResponse || await aiService.generateAssistantResponse(psid, rawText, session, options);
    if (!aiRes || !aiRes.reply_message) {
      return null;
    }

    const { reply_message, detected_action, action_payload = {} } = aiRes;

    // Persist dining_mode if Gemini extracted Delivery or Pick-up
    if (action_payload.dining_mode === 'Delivery' || action_payload.dining_mode === 'Pick-up') {
      session.dining_mode = action_payload.dining_mode;
      session.orderType = action_payload.dining_mode === 'Delivery' ? 'delivery' : 'pickup';
    }

    switch (detected_action) {
      case 'VIEW_MENU': {
        await sendTextMessage(psid, reply_message);
        await sendFullMenu(psid, session);
        return {
          intent: 'AI_VIEW_MENU',
          confidence: 0.98,
          replyLog: reply_message,
          aiAction: 'VIEW_MENU'
        };
      }

      case 'SEND_PICTURE': {
        const targetQuery = action_payload.item_name || rawText;
        const photoRes = await handleItemPhotoRequest(psid, session, targetQuery);
        return {
          ...photoRes,
          aiAction: 'SEND_PICTURE'
        };
      }

      case 'CANCEL_ORDER': {
        const cancelRes = await handleCancellationRequest(psid, session, rawText);
        return {
          ...cancelRes,
          aiAction: 'CANCEL_ORDER'
        };
      }

      case 'CHECK_STATUS': {
        await handleTrackOrder(psid, session);
        return {
          intent: 'AI_CHECK_STATUS',
          confidence: 0.98,
          replyLog: reply_message,
          aiAction: 'CHECK_STATUS'
        };
      }

      case 'PROCEED_CHECKOUT': {
        if (!session.cart || session.cart.length === 0) {
          await sendQuickReplies(psid, reply_message, [
            { title: '☕ Menu', payload: 'MENU_HOME' }
          ]);
          return {
            intent: 'AI_PROCEED_CHECKOUT_EMPTY',
            confidence: 0.95,
            replyLog: reply_message,
            aiAction: 'PROCEED_CHECKOUT'
          };
        }
        await sendTextMessage(psid, reply_message);
        const checkoutRes = await startCheckoutFlow(psid, session);
        return {
          ...(checkoutRes || { intent: 'AI_PROCEED_CHECKOUT', confidence: 0.98 }),
          replyLog: reply_message,
          aiAction: 'PROCEED_CHECKOUT'
        };
      }

      case 'ADD_ITEM': {
        const requestedName = String(action_payload.item_name || '').trim();
        const qty = Math.max(1, parseInt(action_payload.quantity, 10) || 1);

        if (requestedName) {
          const [allMenuRows] = await db.query(`
            SELECT m.id, m.name, m.price, m.is_available, m.synonyms,
                   COALESCE(i.stock_quantity, m.stock_quantity, 0) AS stock_quantity,
                   COALESCE(c.name, 'Cafe') AS category_name
            FROM menu_items m
            LEFT JOIN categories c ON c.id = m.category_id
            LEFT JOIN inventory i ON i.menu_item_id = m.id
            WHERE COALESCE(m.is_deleted, 0) = 0
          `);

          const rows = Array.isArray(allMenuRows) ? allMenuRows : [];
          const lowerReq = requestedName.toLowerCase();
          let dbItem =
            rows.find(r => String(r.name || '').toLowerCase() === lowerReq) ||
            rows.find(r => String(r.name || '').toLowerCase().includes(lowerReq) || lowerReq.includes(String(r.name || '').toLowerCase())) ||
            findBestFuzzyMenuMatch(requestedName, rows);

          if (dbItem) {
            const stock = Number(dbItem.stock_quantity ?? 0);
            const isAvail = dbItem.is_available === 1 || dbItem.is_available === true;
            const { checkMenuAvailability } = require('./inventoryService');
            const bomCheck = await checkMenuAvailability(dbItem.id, qty);
            if (!isAvail || stock <= 0 || !bomCheck.available) {
              const missingList = (bomCheck.missingIngredients || []).map(m => m.name).join(', ');
              const oosMsg = missingList
                ? `Paumanhin po, out of stock na po ang ${dbItem.name} sa ngayon (kulang sa ingredients: ${missingList}). Pili na lang po tayo ng ibang available sa menu!`
                : `Paumanhin po, sold out / out of stock na po ang ${dbItem.name} sa ngayon. Pili na lang po tayo ng ibang available sa menu!`;
              await sendQuickReplies(psid, oosMsg, [
                { title: '☕ Menu', payload: 'MENU_HOME' },
                { title: '🛒 Cart', payload: 'VIEW_CART' }
              ]);
              return {
                intent: 'AI_ADD_ITEM_OUT_OF_STOCK',
                confidence: 0.98,
                replyLog: oosMsg,
                aiAction: 'ADD_ITEM'
              };
            }

            if (!session.cart) session.cart = [];
            const rawAddon = action_payload.addon ? String(action_payload.addon).trim() : null;
            const resolvedAddon = rawAddon ? (detectAddonInText(rawAddon) || rawAddon) : null;

            // If Drinks & Milktea and no add-on specified, trigger AWAITING_DRINK_ADDON upsell
            if (isDrinkOrMilktea(dbItem) && !resolvedAddon) {
              await sendTextMessage(psid, reply_message);
              await promptDrinkAddons(psid, session, dbItem, qty);
              return {
                intent: 'AI_ADD_ITEM_UPSELL',
                confidence: 0.98,
                replyLog: reply_message,
                aiAction: 'ADD_ITEM'
              };
            }

            const itemToCart = resolvedAddon
              ? {
                  ...dbItem,
                  name: `${dbItem.name} (w/ ${resolvedAddon})`,
                  addons: [resolvedAddon],
                  addOns: [{ name: resolvedAddon, price: 20.0 }]
                }
              : dbItem;

            addToCart(session.cart, itemToCart, qty);
            session.state = 'AWAITING_CHECKOUT_CONFIRM';
            await saveSession(session);

            const subtotal = calculateCartSubtotal(session.cart);
            const cartText = `${reply_message}\n\nCart subtotal: ${peso(subtotal)}. Check out?`;
            await sendQuickReplies(psid, cartText, [
              { title: 'Yes, checkout', payload: 'CONFIRM_CHECKOUT' },
              { title: 'Add more', payload: 'KEEP_SHOPPING' },
              { title: 'View cart', payload: 'VIEW_CART' }
            ]);
            return {
              intent: 'AI_ADD_ITEM',
              confidence: 0.98,
              replyLog: cartText,
              aiAction: 'ADD_ITEM'
            };
          }
        }

        // Grounded item not found in catalog
        await sendQuickReplies(psid, reply_message, [
          { title: '☕ Menu', payload: 'MENU_HOME' }
        ]);
        return {
          intent: 'AI_ADD_ITEM_UNMATCHED',
          confidence: 0.85,
          replyLog: reply_message,
          aiAction: 'ADD_ITEM'
        };
      }

      case 'NONE':
      default: {
        await sendQuickReplies(psid, reply_message, [
          { title: '☕ Menu', payload: 'MENU_HOME' },
          { title: '🛒 Cart', payload: 'VIEW_CART' }
        ]);
        await saveSession(session);
        return {
          intent: 'AI_CONVERSATION',
          confidence: 0.98,
          replyLog: reply_message,
          aiAction: 'NONE'
        };
      }
    }
  } catch (err) {
    console.warn('[executeAiAssistantTurn Warning]', err.message);
    return null;
  }
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

    const { formatOrderSummaryReceipt } = require('./geminiService');
    geminiRes.replyText = formatOrderSummaryReceipt(geminiRes.replyText);

    // Capture Stage 5 summary in session for explicit confirmation
    const isStage5Summary = /summary\s+ng\s+(?:inyong\s+)?order/i.test(geminiRes.replyText) ||
      (/\bName\s*:/i.test(geminiRes.replyText) && /\bLocation\s*:/i.test(geminiRes.replyText) && /\bTotal\s*:/i.test(geminiRes.replyText)) ||
      (/\bName\s*:/i.test(geminiRes.replyText) && /\bOrder\s*:/i.test(geminiRes.replyText) && /\bTotal\s*:/i.test(geminiRes.replyText));

    if (isStage5Summary) {
      const nameMatch = geminiRes.replyText.match(/Name\s*:\s*([^\n\r]+)/i);
      const locMatch = geminiRes.replyText.match(/Location\s*:\s*([^\n\r]+)/i);
      const payMatch = geminiRes.replyText.match(/Payment option\s*:\s*([^\n\r]+)/i);
      const diningMatch = geminiRes.replyText.match(/Dining mode\s*:\s*([^\n\r]+)/i);
      const totalMatch = geminiRes.replyText.match(/Total\s*:\s*(?:₱|PHP\s*)?([\d,.]+)/i);

      session.state = 'AWAITING_STAGE5_CONFIRM';
      session.current_step = 'AWAITING_STAGE5_CONFIRM';
      // Clear any prior active order number so we don't accidentally track an old completed/cancelled order
      session.activeOrderNumber = null;
      session.pendingStage5 = {
        name: nameMatch?.[1]?.trim() || session.customer_name || 'Customer',
        address: locMatch?.[1]?.trim() || session.delivery_address || 'Inside Cafe',
        paymentMethod: parsePaymentModeValue(payMatch?.[1] || '') === 'Xendit' ? 'xendit' : 'cash',
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
          // Stock & Availability Guard (Requirement 4)
          const itemStock = dbItem.stock_quantity !== undefined ? dbItem.stock_quantity : 999;
          const isAvail = dbItem.is_available === undefined || dbItem.is_available === 1 || dbItem.is_available === true;
          if (itemStock <= 0 || !isAvail) {
            const soldOutMsg = `Paumanhin po, sold out na po ang item na ito. (${dbItem.name} is currently unavailable)`;
            await sendTextMessage(psid, soldOutMsg);
            continue;
          }

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
  generateSummaryReceipt,
  finalizeOrderSummaryAndPayment,
  STORE_ADDRESS,
  getStoreAddress,
  getCheckoutInfoPrompt,
  parseCustomerInfo,
  formatPlaintextOrderSummary,
  formatPromotionAnnouncement,
  getActivePromotionForPreMenu,
  savePaymentProofImage,
  handlePaymentProofUpload,
  handlePaymentProofTextInput,
  calculateDeliveryFee,
  calculateDeliveryDistanceAndFee,
  computeDeliveryFee,
  geocodeCustomerAddress,
  sanitizeCustomerAddress,
  resolveDeliveryAddressAndFare,
  handleCancellationRequest,
  isCancelTriggerWord,
  promptDrinkAddons,
  handleAddonSelection,
  isDrinkOrMilktea,
  detectAddonInText,
  applyStrikethrough,
  isItemPhotoRequest,
  handleItemPhotoRequest,
  dispatchPersonalGcashCheckout,
  finalizeOrderFromProofSubmission,
  executeAiAssistantTurn
};
