const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

// Ensure SQLite is forced and a clean test DB is used
const testDbPath = path.join(__dirname, 'test_conversation.sqlite');
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
const originalCallSendAPI = messengerService.callSendAPI;
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

test('Conversation Flow - ok never starts a cookie order (Fix F1)', async () => {
  await db.initDatabase();
  const psid = 'TEST_CONV_OK_' + Date.now();
  clearSent();

  // User sends "ok" with empty cart and IDLE state
  await handleMessageEvent(psid, 'ok');
  const msgs = getSent(psid);
  assert.ok(msgs.length > 0);

  const text = msgs[msgs.length - 1].messagePayload.text;
  assert.ok(!text.toLowerCase().includes('cookie'), 'Plain "ok" must never start a cookie order');
  assert.ok(text.includes('Yes to what?'), 'Plain "ok" should ask "Yes to what?"');

  const session = await getSession(psid);
  assert.strictEqual(session.cart.length, 0, 'Cart must remain empty');
});

test('Conversation Flow - "yes" after checkout question starts checkout flow', async () => {
  const psid = 'TEST_CONV_YES_' + Date.now();
  clearSent();

  // 1. Order item to get checkout prompt
  await handleMessageEvent(psid, '2 spanish latte');
  clearSent();

  // 2. Reply "yep" to the checkout question
  await handleMessageEvent(psid, 'yep');
  const msgs = getSent(psid);
  assert.ok(msgs.length > 0);

  const reply = msgs[msgs.length - 1].messagePayload.text;
  assert.ok(reply.includes('Delivery or pickup?'), 'Affirmation must start checkout with order type question');

  const session = await getSession(psid);
  assert.strictEqual(session.state, 'AWAITING_ORDER_TYPE');
});

test('Conversation Flow - "yes" with no question open asks "Yes to what?"', async () => {
  const psid = 'TEST_CONV_STANDALONE_' + Date.now();
  clearSent();

  const session = await getSession(psid);
  session.state = 'IDLE';
  session.cart = [];
  await saveSession(session);

  await handleMessageEvent(psid, 'yes');
  const msgs = getSent(psid);
  assert.ok(msgs.length > 0);
  assert.ok(msgs[msgs.length - 1].messagePayload.text.includes('Yes to what?'));
});

test('Conversation Flow - non-answer replaces open question', async () => {
  const psid = 'TEST_CONV_REPLACE_' + Date.now();
  clearSent();

  // 1. Add item -> state is AWAITING_CHECKOUT_CONFIRM
  await handleMessageEvent(psid, '1 croissant');
  clearSent();

  // 2. Instead of yes/no, user orders "2 spanish latte"
  await handleMessageEvent(psid, '2 spanish latte');
  const msgs = getSent(psid);
  assert.ok(msgs.length > 0);

  const lastMsg = msgs[msgs.length - 1].messagePayload.text;
  assert.ok(lastMsg.includes('Added 2x Signature Spanish Latte'), 'Must process new order item');

  const session = await getSession(psid);
  assert.strictEqual(session.cart.length, 2, 'Both croissant and latte should be in cart');
});

test('Conversation Flow - 31-minute-old state resets to IDLE before routing', async () => {
  const psid = 'TEST_CONV_TTL_' + Date.now();
  clearSent();

  const session = await getSession(psid);
  session.state = 'AWAITING_CHECKOUT_CONFIRM';
  // 31 minutes ago
  session.lastInteraction = Date.now() - (31 * 60 * 1000);
  await saveSession(session);

  // Send "yes": because state was expired, it treats "yes" as standalone yes
  await handleMessageEvent(psid, 'yes');
  const msgs = getSent(psid);
  assert.ok(msgs.length > 0);
  assert.ok(msgs[msgs.length - 1].messagePayload.text.includes('Yes to what?'));
});

test('Conversation Flow - interruptions inside details flow keep details entered so far', async () => {
  const psid = 'TEST_CONV_INTERRUPT_' + Date.now();
  clearSent();

  // Set up in details flow
  const session = await getSession(psid);
  session.cart = [{ menuItemId: 1, name: 'Signature Spanish Latte', price: 145.00, quantity: 1 }];
  session.orderType = 'delivery';
  session.details = { name: 'Juan Dela Cruz' };
  session.state = 'AWAITING_ADDRESS';
  await saveSession(session);

  // User sends "cancel"
  await handleMessageEvent(psid, 'cancel');
  const msgs = getSent(psid);
  assert.ok(msgs.length > 0);
  assert.ok(msgs[msgs.length - 1].messagePayload.text.includes('Cart kept'));

  const reloaded = await getSession(psid);
  assert.strictEqual(reloaded.details.name, 'Juan Dela Cruz', 'Name entered so far must be retained');
});

test('Conversation Flow - RESET_SESSION clears cart and resets state to IDLE without asking', async () => {
  const psid = 'TEST_CONV_RESET_' + Date.now();
  clearSent();

  const session = await getSession(psid);
  session.cart = [{ menuItemId: 1, name: 'Signature Spanish Latte', price: 145.00, quantity: 2 }];
  session.state = 'AWAITING_PAYMENT';
  session.details = { name: 'Maria' };
  await saveSession(session);

  await handleMessageEvent(psid, '', 'RESET_SESSION');
  const msgs = getSent(psid);
  assert.ok(msgs.length > 0);
  assert.ok(msgs[msgs.length - 1].messagePayload.text.includes('Cart cleared'));

  const reloaded = await getSession(psid);
  assert.strictEqual(reloaded.cart.length, 0);
  assert.strictEqual(reloaded.state, 'IDLE');
});
