const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, 'test_checkout.sqlite');
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

test('Checkout Details - full delivery flow from details to placement', async () => {
  await db.initDatabase();
  const psid = 'TEST_CK_DELIV_' + Date.now();
  clearSent();

  // 1. Add 2 Spanish Lattes (2 x 145 = 290)
  await handleMessageEvent(psid, '2 spanish latte');
  clearSent();

  // 2. Click CONFIRM_CHECKOUT
  await handleMessageEvent(psid, '', 'CONFIRM_CHECKOUT');
  let msgs = getSent(psid);
  assert.ok(msgs[msgs.length - 1].messagePayload.text.includes('Delivery or pickup?'));
  clearSent();

  // 3. Choose Delivery
  await handleMessageEvent(psid, '', 'CHECKOUT_DELIVERY');
  msgs = getSent(psid);
  assert.ok(msgs[msgs.length - 1].messagePayload.text.includes("What's your name?"));
  clearSent();

  // 4. Enter name
  await handleMessageEvent(psid, 'Juan Dela Cruz');
  msgs = getSent(psid);
  assert.ok(msgs[msgs.length - 1].messagePayload.text.includes('Delivery address?'));
  clearSent();

  // 5. Enter address
  await handleMessageEvent(psid, 'Unit 402 Acacia Heights, Maple St, near church');
  msgs = getSent(psid);
  assert.ok(msgs[msgs.length - 1].messagePayload.text.includes('Contact number?'));
  clearSent();

  // 6. Enter phone
  await handleMessageEvent(psid, '0917 123 4567');
  msgs = getSent(psid);
  const summaryText = msgs[msgs.length - 1].messagePayload.text;
  const sessionAfterDetails = await getSession(psid);
  const expectedTotal = sessionAfterDetails.checkout.total;
  const expectedFee = sessionAfterDetails.checkout.deliveryFee;

  assert.ok(summaryText.includes('Order summary'));
  assert.ok(summaryText.includes('Subtotal ₱290.00'));
  assert.ok(summaryText.includes('Delivery fee'));
  assert.ok(summaryText.includes(`Total ₱${expectedTotal.toFixed(2)}`));
  assert.ok(summaryText.includes('Juan Dela Cruz'));
  assert.ok(summaryText.includes('+639171234567'));
  clearSent();

  // 7. Confirm summary
  await handleMessageEvent(psid, '', 'CONFIRM_DETAILS');
  msgs = getSent(psid);
  assert.ok(msgs[msgs.length - 1].messagePayload.text.includes('Pay with?'));
  clearSent();

  // 8. Pay with Cash
  await handleMessageEvent(psid, '', 'PAY_CASH');
  msgs = getSent(psid);
  const confirmMsg = msgs[msgs.length - 1].messagePayload.text;
  assert.ok(confirmMsg.includes(`placed. Pay ₱${expectedTotal.toFixed(2)} in cash on receipt.`));

  // 9. Verify database record
  const [orders] = await db.query(
    `SELECT o.*, c.first_name, c.last_name, c.phone_number
     FROM orders o JOIN customers c ON c.id = o.customer_id
     WHERE c.psid = ? ORDER BY o.id DESC LIMIT 1`,
    [psid]
  );
  assert.strictEqual(orders.length, 1);
  const ord = orders[0];
  assert.strictEqual(parseFloat(ord.subtotal), 290.00);
  assert.strictEqual(parseFloat(ord.delivery_fee), expectedFee);
  assert.strictEqual(parseFloat(ord.total_amount), expectedTotal);
  assert.strictEqual(ord.first_name, 'Juan');
  assert.strictEqual(ord.last_name, 'Dela Cruz');
  assert.strictEqual(ord.phone_number, '+639171234567');
  assert.strictEqual(ord.delivery_address, 'Unit 402 Acacia Heights, Maple St, near church');
});

test('Checkout Details - full pickup flow has no delivery fee and says Store pickup', async () => {
  const psid = 'TEST_CK_PICKUP_' + Date.now();
  clearSent();

  // Add 1 Croissant (95)
  await handleMessageEvent(psid, '1 croissant');
  clearSent();

  // Choose Pickup
  await handleMessageEvent(psid, '', 'CONFIRM_CHECKOUT');
  await handleMessageEvent(psid, '', 'CHECKOUT_PICKUP');
  let msgs = getSent(psid);
  assert.ok(msgs[msgs.length - 1].messagePayload.text.includes("What's your name?"));
  clearSent();

  // Enter name
  await handleMessageEvent(psid, 'Maria Clara');
  msgs = getSent(psid);
  assert.ok(msgs[msgs.length - 1].messagePayload.text.includes('Contact number?'));
  clearSent();

  // Enter phone
  await handleMessageEvent(psid, '0918 234 5678');
  msgs = getSent(psid);
  const summaryText = msgs[msgs.length - 1].messagePayload.text;
  assert.ok(summaryText.includes('Order summary'));
  assert.ok(summaryText.includes('Store pickup'));
  assert.ok(!summaryText.includes('Delivery fee'));
  assert.ok(summaryText.includes('Total ₱95.00'));
  clearSent();

  // Confirm and pay cash
  await handleMessageEvent(psid, '', 'CONFIRM_DETAILS');
  await handleMessageEvent(psid, '', 'PAY_CASH');
  msgs = getSent(psid);
  assert.ok(msgs[msgs.length - 1].messagePayload.text.includes('Pay ₱95.00 at the counter.'));
});

test('Checkout Details - returning customer offered saved details with one tap', async () => {
  const psid = 'TEST_CK_RETURNING_' + Date.now();
  clearSent();

  // Seed existing customer in DB
  await db.query(
    `INSERT INTO customers (psid, first_name, last_name, phone_number, delivery_address, conversation_state)
     VALUES (?, 'Sofia', 'Reyes', '+639182345678', 'Bldg B, Sunshine Residences', 'IDLE')`,
    [psid]
  );

  // Add item and start checkout
  await handleMessageEvent(psid, '1 americano');
  clearSent();

  await handleMessageEvent(psid, '', 'CONFIRM_CHECKOUT');
  await handleMessageEvent(psid, '', 'CHECKOUT_DELIVERY');
  const msgs = getSent(psid);
  const savedMsg = msgs[msgs.length - 1].messagePayload.text;
  assert.ok(savedMsg.includes('Use your saved details?'));
  assert.ok(savedMsg.includes('Sofia Reyes'));
  assert.ok(savedMsg.includes('+639182345678'));

  // Tap USE_SAVED_DETAILS
  clearSent();
  await handleMessageEvent(psid, '', 'USE_SAVED_DETAILS');
  const summaryMsgs = getSent(psid);
  assert.ok(summaryMsgs[summaryMsgs.length - 1].messagePayload.text.includes('Order summary'));
});

test('Checkout Details - invalid phone triggers badPhone and three failures offer Back to cart', async () => {
  const psid = 'TEST_CK_BADPHONE_' + Date.now();
  clearSent();

  const session = await getSession(psid);
  session.cart = [{ menuItemId: 1, name: 'Signature Spanish Latte', price: 145.00, quantity: 1 }];
  session.orderType = 'delivery';
  session.details = { name: 'Juan Dela Cruz', address: '123 Academic Hub Ave' };
  session.state = 'AWAITING_PHONE';
  await saveSession(session);

  // 1st failure
  await handleMessageEvent(psid, '123');
  let msgs = getSent(psid);
  assert.ok(msgs[msgs.length - 1].messagePayload.text.includes('valid mobile number'));

  // 2nd failure
  await handleMessageEvent(psid, 'abc');

  // 3rd failure
  clearSent();
  await handleMessageEvent(psid, '028123456');
  msgs = getSent(psid);
  const lastQr = msgs[msgs.length - 1].messagePayload.quick_replies;
  assert.ok(lastQr.some(qr => qr.title === 'Back to cart'));
});

test('Checkout Details - editing one field re-renders summary with updated value', async () => {
  const psid = 'TEST_CK_EDIT_' + Date.now();
  clearSent();

  const session = await getSession(psid);
  session.cart = [{ menuItemId: 1, name: 'Signature Spanish Latte', price: 145.00, quantity: 1 }];
  session.orderType = 'delivery';
  session.details = { name: 'Old Name', address: 'Unit 402 Acacia Heights', phone: '+639171234567' };
  session.quote = { distanceKm: 1.5, deliveryFee: 70.00 };
  session.state = 'AWAITING_DETAILS_CONFIRM';
  await saveSession(session);

  // Click EDIT_DETAILS
  await handleMessageEvent(psid, '', 'EDIT_DETAILS');
  let msgs = getSent(psid);
  assert.ok(msgs[msgs.length - 1].messagePayload.text.includes('What do you want to change?'));

  // Choose EDIT_NAME
  clearSent();
  await handleMessageEvent(psid, '', 'EDIT_NAME');
  msgs = getSent(psid);
  assert.ok(msgs[msgs.length - 1].messagePayload.text.includes("What's your name?"));

  // Send new name
  clearSent();
  await handleMessageEvent(psid, 'Dr. Jose Rizal');
  msgs = getSent(psid);
  const summaryText = msgs[msgs.length - 1].messagePayload.text;
  assert.ok(summaryText.includes('Order summary'));
  assert.ok(summaryText.includes('Dr. Jose Rizal'));
});

test('Checkout Details - price change between summary and confirm warns customer and refreshes summary', async () => {
  const psid = 'TEST_CK_PRICEDIFF_' + Date.now();
  clearSent();

  const session = await getSession(psid);
  session.cart = [{ menuItemId: 1, name: 'Signature Spanish Latte', price: 145.00, quantity: 1 }];
  session.orderType = 'delivery';
  session.details = { name: 'Juan', phone: '+639171234567', address: 'Unit 402 Acacia Heights' };
  session.checkout = { subtotal: 145.00, deliveryFee: 70.00, total: 215.00 };
  session.state = 'AWAITING_DETAILS_CONFIRM';
  await saveSession(session);

  // Change DB price of item 1 from 145 to 160
  await db.query('UPDATE menu_items SET price = 160.00 WHERE id = 1');

  // Customer tries to confirm old summary
  await handleMessageEvent(psid, '', 'CONFIRM_DETAILS');
  const msgs = getSent(psid);

  // Must warn "Prices changed. Please review." and remain on summary
  assert.ok(msgs.some(m => m.messagePayload.text.includes('Prices changed. Please review.')));

  const reloaded = await getSession(psid);
  assert.strictEqual(reloaded.state, 'AWAITING_DETAILS_CONFIRM');
  assert.strictEqual(reloaded.checkout.subtotal, 160.00);

  // Restore price back to 145.00
  await db.query('UPDATE menu_items SET price = 145.00 WHERE id = 1');
});
