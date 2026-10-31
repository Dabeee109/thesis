const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, 'test_cancel_flow.sqlite');
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

test('1. Triggering cancellation with "cancel order", "cancel my order", "i-cancel ang order", "kanselahin"', async () => {
  await db.initDatabase();

  const triggers = [
    'cancel order',
    'cancel my order',
    'i-cancel ang order',
    'kanselahin'
  ];

  for (const trigger of triggers) {
    const psid = 'TEST_TRIGGER_' + Math.random().toString(36).substring(7);
    clearSent();

    const session = await getSession(psid);
    session.current_step = 'ordering';
    session.state = 'ordering';
    session.cart = [{ menuItemId: 1, name: 'Signature Spanish Latte', price: 145, quantity: 2 }];
    session.order_type = 'delivery';
    session.delivery_address = '123 Sampaguita St';
    session.gcash_ref = '1234567890123';
    await saveSession(session);

    await handleMessageEvent(psid, trigger);

    const sent = getSent(psid);
    assert.ok(sent.length >= 1, `Must reply to trigger: ${trigger}`);
    const lastMsg = sent[sent.length - 1].messagePayload.text;

    assert.strictEqual(
      lastMsg,
      'Sigurado ka ba na nais mong i-cancel ang iyong order? I-type ang yes o no.',
      `Bot reply must be exact confirmation question for trigger: ${trigger}`
    );
    assert.strictEqual(containsEmoji(lastMsg), false, 'Reply must not contain emojis');

    const updatedSession = await getSession(psid);
    assert.strictEqual(
      updatedSession.current_step,
      'AWAITING_CANCEL_CONFIRMATION',
      'current_step must transition to AWAITING_CANCEL_CONFIRMATION'
    );
    assert.strictEqual(
      updatedSession.state,
      'AWAITING_CANCEL_CONFIRMATION',
      'state must transition to AWAITING_CANCEL_CONFIRMATION'
    );
    assert.strictEqual(updatedSession.cart.length, 1, 'Cart must NOT be wiped before confirmation');
    assert.strictEqual(updatedSession.cart[0].quantity, 2);
  }
});

test('2. AWAITING_CANCEL_CONFIRMATION: Affirmative answers wipe session and cancel order', async () => {
  const affirmatives = ['yes', 'oo', 'sige', 'yep', 'opo'];

  for (const aff of affirmatives) {
    const psid = 'TEST_AFF_' + Math.random().toString(36).substring(7);
    clearSent();

    // Create a mock placed order in DB to verify status cancellation
    const orderNumber = 'DNR-TEST-' + Math.floor(1000 + Math.random() * 9000);
    const session = await getSession(psid);
    session.current_step = 'AWAITING_CANCEL_CONFIRMATION';
    session.state = 'AWAITING_CANCEL_CONFIRMATION';
    session.cart = [{ menuItemId: 1, name: 'Caramel Macchiato', price: 155, quantity: 1 }];
    session.order_type = 'delivery';
    session.delivery_address = 'Barangay 5, Manila';
    session.gcash_ref = '9876543210123';
    session.activeOrderNumber = orderNumber;
    await saveSession(session);

    await db.query(
      `INSERT INTO orders (order_number, customer_id, order_type, status, subtotal, total_amount)
       VALUES (?, ?, 'delivery', 'pending', 155.00, 155.00)`,
      [orderNumber, session.customerId || 1]
    );

    await handleMessageEvent(psid, aff);

    const sent = getSent(psid);
    assert.ok(sent.length >= 1, `Must reply to affirmative: ${aff}`);
    const lastMsg = sent[sent.length - 1].messagePayload.text;

    assert.strictEqual(lastMsg, 'Order has been cancelled.', `Bot reply must be exact for: ${aff}`);
    assert.strictEqual(containsEmoji(lastMsg), false, 'Reply must not contain emojis');

    const reloaded = await getSession(psid);
    assert.strictEqual(reloaded.cart.length, 0, 'session.cart must be cleared to []');
    assert.strictEqual(reloaded.order_type, null, 'session.order_type must be null');
    assert.strictEqual(reloaded.delivery_address, null, 'session.delivery_address must be null');
    assert.strictEqual(reloaded.gcash_ref, null, 'session.gcash_ref must be null');
    assert.strictEqual(reloaded.current_step, 'idle', 'session.current_step must be idle');
    assert.strictEqual(reloaded.state, 'idle', 'session.state must be idle');

    // Verify DB order cancelled
    const [rows] = await db.query(`SELECT status FROM orders WHERE order_number = ?`, [orderNumber]);
    assert.ok(rows && rows.length > 0);
    assert.strictEqual(rows[0].status, 'cancelled');
  }
});

test('3. AWAITING_CANCEL_CONFIRMATION: Negative answers retain cart and revert state to ordering', async () => {
  const negatives = ['no', 'hindi', 'wag', 'wait', 'hindi pa'];

  for (const neg of negatives) {
    const psid = 'TEST_NEG_' + Math.random().toString(36).substring(7);
    clearSent();

    const session = await getSession(psid);
    session.current_step = 'AWAITING_CANCEL_CONFIRMATION';
    session.state = 'AWAITING_CANCEL_CONFIRMATION';
    session.previous_step = 'ordering';
    session.cart = [{ menuItemId: 2, name: 'Signature Spanish Latte', price: 145, quantity: 3 }];
    session.order_type = 'delivery';
    session.delivery_address = 'Sampaloc, Manila';
    await saveSession(session);

    await handleMessageEvent(psid, neg);

    const sent = getSent(psid);
    assert.ok(sent.length >= 1, `Must reply to negative: ${neg}`);
    const lastMsg = sent[sent.length - 1].messagePayload.text;

    assert.strictEqual(lastMsg, 'Anything else?', `Bot reply must be exact for: ${neg}`);
    assert.strictEqual(containsEmoji(lastMsg), false, 'Reply must not contain emojis');

    const reloaded = await getSession(psid);
    assert.strictEqual(reloaded.cart.length, 1, 'Cart must be retained');
    assert.strictEqual(reloaded.cart[0].quantity, 3);
    assert.strictEqual(reloaded.current_step, 'ordering', 'current_step must return to ordering');
    assert.strictEqual(reloaded.state, 'ordering', 'state must return to ordering');
  }
});

test('4. AWAITING_CANCEL_CONFIRMATION: Invalid / ambiguous answer prompts retry without leaving state', async () => {
  const psid = 'TEST_RETRY_' + Date.now();
  clearSent();

  const session = await getSession(psid);
  session.current_step = 'AWAITING_CANCEL_CONFIRMATION';
  session.state = 'AWAITING_CANCEL_CONFIRMATION';
  session.cart = [{ menuItemId: 1, name: 'Latte', price: 145, quantity: 1 }];
  await saveSession(session);

  // Send an ambiguous reply
  await handleMessageEvent(psid, 'ano po ba ang menu niyo?');

  let sent = getSent(psid);
  assert.ok(sent.length >= 1);
  let lastMsg = sent[sent.length - 1].messagePayload.text;

  assert.strictEqual(
    lastMsg,
    'Pakisagot lamang ng yes o no kung nais mong i-cancel ang iyong order.'
  );
  assert.strictEqual(containsEmoji(lastMsg), false);

  let reloaded = await getSession(psid);
  assert.strictEqual(reloaded.current_step, 'AWAITING_CANCEL_CONFIRMATION');
  assert.strictEqual(reloaded.state, 'AWAITING_CANCEL_CONFIRMATION');
  assert.strictEqual(reloaded.cart.length, 1);

  // User subsequently replies "yes"
  clearSent();
  await handleMessageEvent(psid, 'yes');

  sent = getSent(psid);
  assert.ok(sent.length >= 1);
  lastMsg = sent[sent.length - 1].messagePayload.text;
  assert.strictEqual(lastMsg, 'Order has been cancelled.');

  reloaded = await getSession(psid);
  assert.strictEqual(reloaded.cart.length, 0);
  assert.strictEqual(reloaded.current_step, 'idle');
});

test('5. Non-regression: Global "reset" command still resets immediately', async () => {
  const psid = 'TEST_RESET_REGRESSION_' + Date.now();
  clearSent();

  const session = await getSession(psid);
  session.current_step = 'ordering';
  session.cart = [{ menuItemId: 1, name: 'Latte', price: 145, quantity: 1 }];
  await saveSession(session);

  await handleMessageEvent(psid, 'reset');

  const sent = getSent(psid);
  assert.ok(sent.length >= 1);
  const lastMsg = sent[sent.length - 1].messagePayload.text;
  assert.strictEqual(lastMsg, 'Na-reset na ang iyong session. Paano kita matutulungan ngayon?');

  const reloaded = await getSession(psid);
  assert.strictEqual(reloaded.cart.length, 0);
  assert.strictEqual(reloaded.current_step, 'idle');
});
