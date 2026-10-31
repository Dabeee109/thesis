const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, 'test_gcash_dispatch.sqlite');
if (fs.existsSync(testDbPath)) {
  try { fs.unlinkSync(testDbPath); } catch (e) {}
}

process.env.DB_FORCE_SQLITE = '1';
process.env.SQLITE_PATH = testDbPath;
process.env.NODE_ENV = 'test';

const db = require('../database/db');
const { handleMessageEvent, getSession, saveSession } = require('../src/services/nlpEngine');
const messengerService = require('../src/services/messengerService');

let sentMessages = [];
messengerService.callSendAPI = async (psid, messagePayload, options) => {
  sentMessages.push({ psid: String(psid), messagePayload, options });
  return { recipient_id: String(psid), message_id: `test.mid.${Date.now()}` };
};

function getSent(psid) {
  return sentMessages.filter(m => m.psid === String(psid));
}

function clearSent() {
  sentMessages = [];
}

function containsEmoji(text) {
  if (!text) return false;
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/u;
  return emojiRegex.test(text);
}

test('1. Static Asset Verification: QR code image files exist in public directories', () => {
  const publicImagesJpg = path.join(__dirname, '../public/images/gcash_official_qr.jpg');
  const publicAssetsJpg = path.join(__dirname, '../public/assets/gcash_qr.jpg');
  
  assert.ok(fs.existsSync(publicImagesJpg), 'public/images/gcash_official_qr.jpg must exist');
  assert.ok(fs.existsSync(publicAssetsJpg), 'public/assets/gcash_qr.jpg must exist');
  assert.ok(fs.statSync(publicImagesJpg).size > 1000, 'Image file must be valid non-empty asset');
});

test('2. Delivery Selection in AWAITING_ORDER_TYPE prompts for customer info (Address, Name, Contact)', async () => {
  await db.initDatabase();

  const psid = 'TEST_GCASH_DISPATCH_' + Date.now();
  clearSent();

  const session = await getSession(psid);
  session.current_step = 'AWAITING_ORDER_TYPE';
  session.state = 'AWAITING_ORDER_TYPE';
  session.cart = [{ menuItemId: 1, name: 'Signature Spanish Latte', price: 145, quantity: 2 }];
  await saveSession(session);

  // Customer replies "delivery"
  await handleMessageEvent(psid, 'delivery');

  const sent = getSent(psid);
  assert.strictEqual(sent.length, 1, 'Must send customer details request message');
  const text = sent[0].messagePayload.text;

  const expectedText = 
`Please provide the following:
Address:
Name:
Contact number or landmark:`;

  assert.strictEqual(text, expectedText, 'Text message must match the exact prompt without emojis');
  assert.strictEqual(containsEmoji(text), false, 'Prompt must contain zero emojis');

  const updatedSession = await getSession(psid);
  assert.strictEqual(
    updatedSession.current_step,
    'AWAITING_CUSTOMER_INFO',
    'Session current_step must be AWAITING_CUSTOMER_INFO'
  );
  assert.strictEqual(
    updatedSession.state,
    'AWAITING_CUSTOMER_INFO',
    'Session state must be AWAITING_CUSTOMER_INFO'
  );
  assert.strictEqual(updatedSession.order_type, 'delivery');
});

test('3. Providing customer info calculates distance and fee, dispatches QR code and payment details', async () => {
  const psid = 'TEST_CUSTOMER_INFO_' + Date.now();
  clearSent();

  const session = await getSession(psid);
  session.current_step = 'AWAITING_CUSTOMER_INFO';
  session.state = 'AWAITING_CUSTOMER_INFO';
  session.order_type = 'delivery';
  session.cart = [{ menuItemId: 1, name: 'Latte', price: 145, quantity: 2 }];
  await saveSession(session);

  const infoText = 
`Address: 1829, Modesto st, malate manila
Name: Juan Dela Cruz
Contact number or landmark: 0928 176 2895`;

  await handleMessageEvent(psid, infoText);

  const sent = getSent(psid);
  assert.strictEqual(sent.length, 2, 'Must send Generic Template Card followed by payment details text');

  // 1. Generic Template Card
  const firstMsg = sent[0].messagePayload;
  assert.ok(firstMsg.attachment, 'First message must be an attachment');
  assert.strictEqual(firstMsg.attachment.type, 'template');
  assert.strictEqual(firstMsg.attachment.payload.template_type, 'generic');
  assert.strictEqual(firstMsg.attachment.payload.image_aspect_ratio, 'square', 'Template must use square image_aspect_ratio');
  const el = firstMsg.attachment.payload.elements[0];
  assert.strictEqual(el.title, 'GCash');
  assert.strictEqual(el.subtitle, '0928 176 2895');
  assert.ok(el.image_url.includes('/images/gcash_full_qr.png') || el.image_url.includes('/images/gcash-banner.png'));
  assert.strictEqual(el.buttons[0].title, 'Transfer with GCash');
  assert.strictEqual(el.buttons[0].type, 'web_url');
  assert.ok(el.buttons[0].url.includes('/pay/gcash'), 'Button URL must point to /pay/gcash redirect');
  assert.strictEqual(el.buttons[0].webview_height_ratio, 'compact', 'Button webview_height_ratio must be compact');

  // 2. 3-step text instructions message
  const secondMsg = sent[1].messagePayload;
  assert.ok(secondMsg.text, 'Second message must be text');
  const text = secondMsg.text;

  const expectedInstructions = `1. Tap "Transfer with GCash".\n2. GCash will open with the recipient's account details prefilled.\n3. After you complete the transfer, your receipt will be uploaded into this chat.`;
  assert.strictEqual(text, expectedInstructions, 'Must send exact 3-step text instructions');
  assert.strictEqual(containsEmoji(text), false, 'Instructions text must contain strictly zero emojis');

  const updatedSession = await getSession(psid);
  assert.strictEqual(updatedSession.current_step, 'AWAITING_PAYMENT_VERIFICATION');
  assert.strictEqual(updatedSession.customer_name, 'Juan Dela Cruz');
  assert.strictEqual(updatedSession.delivery_address, '1829, Modesto st, malate manila');
  assert.strictEqual(updatedSession.contact_number, '0928 176 2895');
});

test('4. In AWAITING_PAYMENT_VERIFICATION state, bot stays silent when receiving non-ref text', async () => {
  const psid = 'TEST_SILENT_' + Date.now();
  clearSent();

  const session = await getSession(psid);
  session.current_step = 'AWAITING_PAYMENT_VERIFICATION';
  session.state = 'AWAITING_PAYMENT_VERIFICATION';
  await saveSession(session);

  await handleMessageEvent(psid, 'hello po');

  const sent = getSent(psid);
  assert.strictEqual(sent.length, 0, 'Bot must stay silent in AWAITING_PAYMENT_VERIFICATION state');
});

test('5. GCash Redirect Endpoint (GET /pay/gcash) returns HTML with deep link & intent fallback', async () => {
  const webhookController = require('../src/controllers/webhookController');
  let responseHtml = '';
  const headers = {};
  const mockReq = { query: {} };
  const mockRes = {
    setHeader: (name, val) => {
      headers[name.toLowerCase()] = val;
    },
    send: (body) => {
      responseHtml = body;
    }
  };

  await webhookController.gcashRedirect(mockReq, mockRes);

  assert.strictEqual(headers['ngrok-skip-browser-warning'], 'true', 'Must set ngrok-skip-browser-warning header');
  assert.ok(headers['content-type'].includes('text/html'), 'Content-Type must be text/html');
  assert.ok(responseHtml.includes('Redirecting to GCash...'), 'HTML title must be Redirecting to GCash...');
  assert.ok(responseHtml.includes('gcash://'), 'HTML must attempt deep link gcash://');
  assert.ok(
    responseHtml.includes('intent://#Intent;scheme=gcash;package=com.globe.gcash.android;end'),
    'HTML must contain Android intent fallback'
  );
  assert.ok(
    responseHtml.includes('Buksan ang GCash'),
    'HTML must include fallback button text'
  );
  assert.ok(
    responseHtml.includes('background:#007dfe') || responseHtml.includes('background-color:#007dfe'),
    'Fallback button must be styled with #007dfe'
  );
});

test('6. GCash payment confirmation (POST /pay/gcash/confirm) records transaction, marks order PAID, and sends confirmation receipt to Messenger', async () => {
  const webhookController = require('../src/controllers/webhookController');
  const psid = 'TEST_GCASH_PAY_PORTAL_' + Date.now();
  clearSent();

  const session = await getSession(psid);
  session.current_step = 'AWAITING_PAYMENT_VERIFICATION';
  session.state = 'AWAITING_PAYMENT_VERIFICATION';
  session.order_type = 'delivery';
  session.customer_name = 'Maria Santos';
  session.delivery_address = '123 Taft Avenue, Manila';
  session.contact_number = '0917 123 4567';
  session.cart = [{ menuItemId: 1, name: 'Signature Spanish Latte', price: 145, quantity: 2 }];
  session.order_subtotal = 290;
  session.delivery_fee = 50;
  session.order_total = 340;
  await saveSession(session);

  let jsonResult = null;
  let statusCode = 200;
  const mockReq = {
    body: {
      psid,
      amount: 340
    }
  };
  const mockRes = {
    status: (code) => {
      statusCode = code;
      return mockRes;
    },
    json: (data) => {
      jsonResult = data;
    }
  };

  await webhookController.confirmGcashPayment(mockReq, mockRes);

  assert.strictEqual(statusCode, 200);
  assert.strictEqual(jsonResult.success, true);
  assert.ok(jsonResult.referenceNumber);
  assert.strictEqual(jsonResult.referenceNumber.length, 13);
  assert.strictEqual(jsonResult.amount, 340);

  // Verify Messenger Send API was called with the summary receipt
  const sent = getSent(psid);
  assert.strictEqual(sent.length, 1, 'Must send summary receipt message to Messenger chat');
  const receiptText = sent[0].messagePayload.text;
  assert.ok(receiptText.includes('Resibo ng Transaksyon'), 'Receipt must have header Resibo ng Transaksyon');
  assert.ok(receiptText.includes('Maria Santos'), 'Receipt must include customer name');
  assert.ok(receiptText.includes(jsonResult.referenceNumber), 'Receipt must include the 13-digit GCash ref');
  assert.ok(receiptText.includes('340'), 'Receipt must include total');

  // Verify session state
  const updatedSession = await getSession(psid);
  assert.strictEqual(updatedSession.current_step, 'order_placed');
  assert.strictEqual(updatedSession.state, 'order_placed');
  assert.strictEqual(updatedSession.gcash_ref, jsonResult.referenceNumber);

  // Verify admin_gcash_transactions was updated to MATCHED
  const [adminRows] = await db.query(
    'SELECT * FROM admin_gcash_transactions WHERE reference_number = ?',
    [jsonResult.referenceNumber]
  );
  assert.strictEqual(adminRows.length, 1);
  assert.strictEqual(adminRows[0].status, 'MATCHED');
});



