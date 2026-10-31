const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, 'test_delivery_payment_flow.sqlite');
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
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  return emojiRegex.test(text);
}

test('0. Setup Database and Seeds', async () => {
  await db.initDatabase();
});

test('1. State: AWAITING_ORDER_TYPE - "delivery", "deliver", and "padeliver" keywords transition to AWAITING_CUSTOMER_INFO', async () => {
  const keywords = ['delivery', 'deliver', 'padeliver'];

  for (const kw of keywords) {
    const psid = `TEST_KW_${kw}_${Date.now()}`;
    clearSent();

    const session = await getSession(psid);
    session.current_step = 'AWAITING_ORDER_TYPE';
    session.state = 'AWAITING_ORDER_TYPE';
    session.cart = [{ menuItemId: 1, name: 'Burger Steak', price: 150, quantity: 1 }];
    await saveSession(session);

    await handleMessageEvent(psid, kw);

    const sent = getSent(psid);
    assert.strictEqual(sent.length, 1, `Must send exactly 1 response for '${kw}'`);
    const text = sent[0].messagePayload.text;

    const expectedText = 
`Please provide the following:
Address:
Name:
Contact number or landmark:`;

    assert.strictEqual(text, expectedText, `Exact format required without emojis for keyword '${kw}'`);
    assert.strictEqual(containsEmoji(text), false, `Zero emojis allowed for keyword '${kw}'`);

    const updatedSession = await getSession(psid);
    assert.strictEqual(updatedSession.current_step, 'AWAITING_CUSTOMER_INFO');
    assert.strictEqual(updatedSession.state, 'AWAITING_CUSTOMER_INFO');
    assert.strictEqual(updatedSession.order_type, 'delivery');
  }
});

test('2. State: AWAITING_CUSTOMER_INFO - Extracts fields, calculates distance from Diner\'s Cafe and delivery fee, dispatches QR and payment details', async () => {
  const psid = 'TEST_CUST_INFO_' + Date.now();
  clearSent();

  const session = await getSession(psid);
  session.current_step = 'AWAITING_CUSTOMER_INFO';
  session.state = 'AWAITING_CUSTOMER_INFO';
  session.order_type = 'delivery';
  session.cart = [
    { menuItemId: 1, name: 'Beef Tapa', price: 150, quantity: 2 },
    { menuItemId: 2, name: 'Iced Coffee', price: 60, quantity: 1 }
  ];
  await saveSession(session);

  const customerInput = 
`Address: 1829, Modesto st, malate manila
Name: Juan Dela Cruz
Contact number or landmark: 0928 176 2895 near Robinsons`;

  await handleMessageEvent(psid, customerInput);

  const sent = getSent(psid);
  assert.strictEqual(sent.length, 2, 'Must send GCash Generic Template Card followed by payment details text');

  // 1. First message: Generic Template Card (GCash Card)
  const firstMsg = sent[0].messagePayload;
  assert.ok(firstMsg.attachment, 'Must be an attachment');
  assert.strictEqual(firstMsg.attachment.type, 'template');
  assert.strictEqual(firstMsg.attachment.payload.template_type, 'generic');
  assert.strictEqual(firstMsg.attachment.payload.image_aspect_ratio, 'square', 'Template must use square image_aspect_ratio');

  const el = firstMsg.attachment.payload.elements[0];
  assert.strictEqual(el.title, 'GCash');
  assert.strictEqual(el.subtitle, '0928 176 2895');
  assert.ok(el.image_url.includes('/images/gcash_full_qr.png') || el.image_url.includes('/images/gcash-banner.png'), 'Must use gcash_full_qr.png or gcash-banner.png');
  assert.strictEqual(el.buttons[0].type, 'web_url');
  assert.ok(el.buttons[0].url.includes('/pay/gcash'), 'Button URL must point to /pay/gcash redirect');
  assert.strictEqual(el.buttons[0].webview_height_ratio, 'compact', 'Button webview_height_ratio must be compact');
  assert.strictEqual(el.buttons[0].title, 'Transfer with GCash');

  // 2. Second message: 3-step text instructions
  const secondMsg = sent[1].messagePayload;
  assert.ok(secondMsg.text, 'Must be a text message');
  const text = secondMsg.text;

  const expectedInstructions = `1. Tap "Transfer with GCash".\n2. GCash will open with the recipient's account details prefilled.\n3. After you complete the transfer, your receipt will be uploaded into this chat.`;
  assert.strictEqual(text, expectedInstructions, 'Must send exact 3-step text instructions');
  assert.strictEqual(containsEmoji(text), false, 'Must contain strictly zero emojis');

  // Verify session state
  const updated = await getSession(psid);
  assert.strictEqual(updated.current_step, 'AWAITING_PAYMENT_VERIFICATION');
  assert.strictEqual(updated.state, 'AWAITING_PAYMENT_VERIFICATION');
  assert.strictEqual(updated.customer_name, 'Juan Dela Cruz');
  assert.strictEqual(updated.delivery_address, '1829, Modesto st, malate manila');
  assert.strictEqual(updated.contact_number, '0928 176 2895 near Robinsons');
  assert.strictEqual(updated.distance_km, 1.4);
  assert.strictEqual(updated.delivery_fee, 50);
  assert.strictEqual(updated.order_subtotal, 360);
  assert.strictEqual(updated.order_total, 410);
});

test('3. State: AWAITING_CUSTOMER_INFO - Graceful error handling when address is not found in geocoder', async () => {
  const psid = 'TEST_GEO_NOT_FOUND_' + Date.now();
  clearSent();

  const session = await getSession(psid);
  session.current_step = 'AWAITING_CUSTOMER_INFO';
  session.state = 'AWAITING_CUSTOMER_INFO';
  session.order_type = 'delivery';
  session.cart = [{ menuItemId: 1, name: 'Latte', price: 145, quantity: 1 }];
  await saveSession(session);

  // Address containing "nowhere" triggers GEO_NOT_FOUND in mock provider
  const invalidAddressInput = 
`Address: Nowhere Street, Unreachable City
Name: Pedro Penduko
Contact number or landmark: 09170000000`;

  await handleMessageEvent(psid, invalidAddressInput);

  const sent = getSent(psid);
  assert.strictEqual(sent.length, 1, 'Should send error notification message');
  const text = sent[0].messagePayload.text;

  const expectedErrorMsg = 'Paumanhin, hindi mahanap ang address na inyong ibinigay. Pakisend muli ang inyong kumpletong address kasama ang kilalang landmark upang matukoy ang distansya.';
  assert.strictEqual(text, expectedErrorMsg, 'Must return polite geocoding error message without emojis');
  assert.strictEqual(containsEmoji(text), false, 'Error message must contain zero emojis');

  // Session must remain in AWAITING_CUSTOMER_INFO so user can re-send
  const updated = await getSession(psid);
  assert.strictEqual(updated.current_step, 'AWAITING_CUSTOMER_INFO');
  assert.strictEqual(updated.state, 'AWAITING_CUSTOMER_INFO');
});

test('4. State: AWAITING_PAYMENT_VERIFICATION - Typed 13-digit Reference Number marks order PAID and sends Complete Summary Receipt', async () => {
  const psid = 'TEST_PAY_VERIF_TYPED_' + Date.now();
  clearSent();

  const refNumber = '1092837465019';
  const orderAmount = 200.00; // Subtotal 150 + Fee 50

  // Insert matching admin record
  await db.query(
    `INSERT INTO admin_gcash_transactions (reference_number, amount, status) VALUES (?, ?, 'UNCLAIMED')`,
    [refNumber, orderAmount]
  );

  const session = await getSession(psid);
  session.current_step = 'AWAITING_PAYMENT_VERIFICATION';
  session.state = 'AWAITING_PAYMENT_VERIFICATION';
  session.order_type = 'delivery';
  session.customer_name = 'Maria Clara';
  session.delivery_address = '1829, Modesto st, malate manila';
  session.contact_number = '0928 176 2895 near chapel';
  session.distance_km = 1.4;
  session.delivery_fee = 50.00;
  session.order_subtotal = 150.00;
  session.order_total = 200.00;
  session.ordered_items = [{ menuItemId: 1, name: 'Chicken Inasal', price: 150.00, quantity: 1 }];
  session.cart = [{ menuItemId: 1, name: 'Chicken Inasal', price: 150.00, quantity: 1 }];
  await saveSession(session);

  // Customer types the 13-digit reference number
  await handleMessageEvent(psid, `Eto po ang Ref No: ${refNumber}`);

  const sent = getSent(psid);
  assert.strictEqual(sent.length, 1, 'Must send summary receipt');
  const receipt = sent[0].messagePayload.text;

  // Verify exact Summary Receipt elements
  assert.ok(receipt.includes('Resibo ng Transaksyon:'), 'Receipt title must match');
  assert.ok(receipt.includes('Pangalan: Maria Clara'), 'Must include customer name');
  assert.ok(receipt.includes('Address: 1829, Modesto st, malate manila'), 'Must include delivery address');
  assert.ok(receipt.includes('Contact / Landmark: 0928 176 2895 near chapel'), 'Must include contact or landmark');
  assert.ok(receipt.includes('Mga Inorder:'), 'Must include ordered items section');
  assert.ok(receipt.includes('Chicken Inasal x1 - PHP 150'), 'Must list items and prices');
  assert.ok(receipt.includes('Subtotal: PHP 150'), 'Must include subtotal');
  assert.ok(receipt.includes('Distansya: 1.4 km'), 'Must include distance');
  assert.ok(receipt.includes('Delivery Fee: PHP 50'), 'Must include delivery fee');
  assert.ok(receipt.includes('Kabuuang Halaga: PHP 200'), 'Must include grand total');
  assert.ok(receipt.includes(`GCash Ref No: ${refNumber}`), 'Must include reference number');
  assert.ok(receipt.includes('Salamat! Kumpirmado ang bayad. Inihahanda na ng kusina ang inyong order.'), 'Must include closing message');
  assert.strictEqual(containsEmoji(receipt), false, 'Receipt must contain strictly zero emojis');

  // Verify session state updated to order_placed
  const updated = await getSession(psid);
  assert.strictEqual(updated.current_step, 'order_placed');
  assert.strictEqual(updated.state, 'order_placed');

  // Verify admin transaction marked as MATCHED
  const [adminRow] = await db.query(
    `SELECT status FROM admin_gcash_transactions WHERE reference_number = ?`,
    [refNumber]
  );
  assert.strictEqual(adminRow[0].status, 'MATCHED');

  // Verify order in database marked as PAID
  const [orderRows] = await db.query(
    `SELECT status, gcash_ref FROM orders WHERE order_number = ?`,
    [updated.activeOrderNumber]
  );
  assert.ok(orderRows && orderRows.length > 0, 'Order must be created in DB');
  assert.strictEqual(orderRows[0].status, 'PAID', 'Order status must be PAID');
  assert.strictEqual(orderRows[0].gcash_ref, refNumber);
});

test('5. State: AWAITING_PAYMENT_VERIFICATION - Receipt Screenshot OCR marks order PAID and sends Complete Summary Receipt', async () => {
  const psid = 'TEST_PAY_VERIF_OCR_' + Date.now();
  clearSent();

  const refNumber = '5566778899001';
  const orderAmount = 200.00;

  // Insert matching admin record
  await db.query(
    `INSERT INTO admin_gcash_transactions (reference_number, amount, status) VALUES (?, ?, 'UNCLAIMED')`,
    [refNumber, orderAmount]
  );

  const session = await getSession(psid);
  session.current_step = 'AWAITING_PAYMENT_VERIFICATION';
  session.state = 'AWAITING_PAYMENT_VERIFICATION';
  session.order_type = 'delivery';
  session.customer_name = 'Crisostomo Ibarra';
  session.delivery_address = '1829, Modesto st, malate manila';
  session.contact_number = '0928 176 2895';
  session.distance_km = 1.4;
  session.delivery_fee = 50.00;
  session.order_subtotal = 150.00;
  session.order_total = 200.00;
  session.ordered_items = [{ menuItemId: 1, name: 'Special Pork Sisig', price: 150.00, quantity: 1 }];
  session.cart = [{ menuItemId: 1, name: 'Special Pork Sisig', price: 150.00, quantity: 1 }];
  await saveSession(session);

  // Customer uploads a screenshot of the receipt
  const attachments = [
    {
      type: 'image',
      payload: {
        url: { text: `GCash Express Send\nAmount: PHP 200.00\nRef No. 5566 778 899001\nSuccessful` }
      }
    }
  ];

  await handleMessageEvent(psid, '', null, null, attachments);

  const sent = getSent(psid);
  assert.strictEqual(sent.length, 1, 'Must send summary receipt');
  const receipt = sent[0].messagePayload.text;

  assert.ok(receipt.includes('Resibo ng Transaksyon:'), 'Receipt title must match');
  assert.ok(receipt.includes('Pangalan: Crisostomo Ibarra'), 'Must include customer name');
  assert.ok(receipt.includes('Address: 1829, Modesto st, malate manila'), 'Must include delivery address');
  assert.ok(receipt.includes('Contact / Landmark: 0928 176 2895'), 'Must include contact');
  assert.ok(receipt.includes('Special Pork Sisig x1 - PHP 150'), 'Must list items and prices');
  assert.ok(receipt.includes('Subtotal: PHP 150'), 'Must include subtotal');
  assert.ok(receipt.includes('Distansya: 1.4 km'), 'Must include distance');
  assert.ok(receipt.includes('Delivery Fee: PHP 50'), 'Must include delivery fee');
  assert.ok(receipt.includes('Kabuuang Halaga: PHP 200'), 'Must include grand total');
  assert.ok(receipt.includes(`GCash Ref No: ${refNumber}`), 'Must include reference number');
  assert.ok(receipt.includes('Salamat! Kumpirmado ang bayad. Inihahanda na ng kusina ang inyong order.'));
  assert.strictEqual(containsEmoji(receipt), false, 'Receipt must contain strictly zero emojis');

  const updated = await getSession(psid);
  assert.strictEqual(updated.current_step, 'order_placed');
  assert.strictEqual(updated.state, 'order_placed');
});
