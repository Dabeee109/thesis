const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, 'test_feedback.sqlite');
if (fs.existsSync(testDbPath)) {
  try { fs.unlinkSync(testDbPath); } catch (e) {}
}

process.env.DB_FORCE_SQLITE = '1';
process.env.SQLITE_PATH = testDbPath;
process.env.NODE_ENV = 'test';

const db = require('../database/db');
const { handleMessageEvent, getSession, saveSession } = require('../src/services/nlpEngine');
const feedbackService = require('../src/services/feedbackService');
const messengerService = require('../src/services/messengerService');
const notificationService = require('../src/services/notificationService');

let sentMessages = [];
messengerService.callSendAPI = async (psid, messagePayload, options) => {
  sentMessages.push({ psid: String(psid), messagePayload, options });
  return { recipient_id: String(psid), message_id: `test.mid.${Date.now()}` };
};

let broadcastEvents = [];
const originalBroadcast = notificationService.broadcastSSE;
notificationService.broadcastSSE = (event, data) => {
  broadcastEvents.push({ event, data });
  if (originalBroadcast) originalBroadcast(event, data);
};

function getSent(psid) {
  return sentMessages.filter(m => m.psid === String(psid));
}

function clearSent() {
  sentMessages = [];
}

test('Feedback Flow - delivered triggers exactly one prompt atomically', async () => {
  await db.initDatabase();
  const psid = 'TEST_FB_USER_' + Date.now();
  clearSent();

  // Create customer
  const [cRes] = await db.query(
    `INSERT INTO customers (psid, first_name, last_name, phone_number)
     VALUES (?, 'Test', 'Customer', '+639171234567')`,
    [psid]
  );
  const custId = cRes.insertId;

  // Create delivered order
  const orderNum = 'DNR-FB-TEST-1';
  const [oRes] = await db.query(
    `INSERT INTO orders (order_number, customer_id, order_type, status, subtotal, delivery_fee, total_amount)
     VALUES (?, ?, 'delivery', 'delivered', 145.00, 70.00, 215.00)`,
    [orderNum, custId]
  );
  const orderId = oRes.insertId;

  // Call 1: should send
  const res1 = await feedbackService.requestFeedback(orderId);
  assert.strictEqual(res1, 'sent');
  assert.strictEqual(getSent(psid).length, 1);

  // Verify proactive send uses messagingType: 'UPDATE'
  const promptSent = getSent(psid)[0];
  assert.strictEqual(promptSent.options.messagingType, 'UPDATE');
  assert.ok(promptSent.messagePayload.text.includes('Your order has been delivered! How was your experience today?'));

  // Call 2: should be skipped (already requested)
  const res2 = await feedbackService.requestFeedback(orderId);
  assert.strictEqual(res2, 'skipped_already_requested');
  assert.strictEqual(getSent(psid).length, 1);
});

test('Feedback Flow - non-Messenger PSIDs are skipped', async () => {
  const webPsid = 'WEB_USER_' + Date.now();
  const [cRes] = await db.query(
    `INSERT INTO customers (psid, first_name, last_name) VALUES (?, 'Web', 'User')`,
    [webPsid]
  );
  const [oRes] = await db.query(
    `INSERT INTO orders (order_number, customer_id, order_type, status, subtotal, delivery_fee, total_amount)
     VALUES ('DNR-WEB-1', ?, 'delivery', 'delivered', 100, 50, 150)`,
    [cRes.insertId]
  );

  const res = await feedbackService.requestFeedback(oRes.insertId);
  assert.strictEqual(res, 'skipped_non_messenger');
});

test('Feedback Flow - already rated orders are skipped', async () => {
  const psid = 'TEST_FB_RATED_' + Date.now();
  const [cRes] = await db.query(
    `INSERT INTO customers (psid, first_name, last_name) VALUES (?, 'Rated', 'User')`,
    [psid]
  );
  const [oRes] = await db.query(
    `INSERT INTO orders (order_number, customer_id, order_type, status, subtotal, delivery_fee, total_amount)
     VALUES ('DNR-ALREADY-1', ?, 'delivery', 'delivered', 100, 50, 150)`,
    [cRes.insertId]
  );
  await db.query(
    `INSERT INTO feedback (order_id, customer_id, rating, comments, sentiment)
     VALUES (?, ?, 5, 'Great', 'positive')`,
    [oRes.insertId, cRes.insertId]
  );

  const res = await feedbackService.requestFeedback(oRes.insertId);
  assert.strictEqual(res, 'skipped_already_rated');
});

test('Feedback Flow - send failure clears the claim', async () => {
  const psid = 'TEST_FB_FAIL_' + Date.now();
  const [cRes] = await db.query(
    `INSERT INTO customers (psid, first_name, last_name) VALUES (?, 'Fail', 'User')`,
    [psid]
  );
  const [oRes] = await db.query(
    `INSERT INTO orders (order_number, customer_id, order_type, status, subtotal, delivery_fee, total_amount)
     VALUES ('DNR-FAIL-1', ?, 'delivery', 'delivered', 100, 50, 150)`,
    [cRes.insertId]
  );

  const origCallSendAPI = messengerService.callSendAPI;
  messengerService.callSendAPI = async () => {
    const err = new Error('Graph API send failed');
    err.code = 'GRAPH_API_ERROR';
    throw err;
  };

  const res = await feedbackService.requestFeedback(oRes.insertId);
  assert.strictEqual(res, 'send_failed');

  // Verify feedback_requested_at is cleared
  const [orders] = await db.query(`SELECT feedback_requested_at FROM orders WHERE id = ?`, [oRes.insertId]);
  assert.strictEqual(orders[0].feedback_requested_at, null);

  messengerService.callSendAPI = origCallSendAPI;
});

test('Feedback Flow - ownership check rejects rating if order belongs to another sender', async () => {
  const ownerPsid = 'TEST_FB_OWNER_' + Date.now();
  const imposterPsid = 'TEST_FB_IMPOSTER_' + Date.now();
  clearSent();

  const [cRes] = await db.query(
    `INSERT INTO customers (psid, first_name, last_name) VALUES (?, 'Real', 'Owner')`,
    [ownerPsid]
  );
  const orderNum = 'DNR-OWNER-1';
  await db.query(
    `INSERT INTO orders (order_number, customer_id, order_type, status, subtotal, delivery_fee, total_amount)
     VALUES (?, ?, 'delivery', 'delivered', 100, 50, 150)`,
    [orderNum, cRes.insertId]
  );

  // Imposter tries to rate orderNum
  await handleMessageEvent(imposterPsid, '', `FEEDBACK_RATE_5_${orderNum}`);
  const msgs = getSent(imposterPsid);
  assert.ok(msgs.some(m => m.messagePayload.text.includes("I couldn't find that order.")));
});

test('Feedback Flow - rating 5 saves feedback row, emits NEW_FEEDBACK, exact closing text, keeps cart', async () => {
  const psid = 'TEST_FB_R5_' + Date.now();
  clearSent();
  broadcastEvents = [];

  const [cRes] = await db.query(
    `INSERT INTO customers (psid, first_name, last_name) VALUES (?, 'Star', 'User')`,
    [psid]
  );
  const orderNum = 'DNR-R5-1';
  const [oRes] = await db.query(
    `INSERT INTO orders (order_number, customer_id, order_type, status, subtotal, delivery_fee, total_amount)
     VALUES (?, ?, 'delivery', 'delivered', 100, 50, 150)`,
    [orderNum, cRes.insertId]
  );

  // User has built a newer order in cart
  const session = await getSession(psid);
  session.cart = [{ menuItemId: 2, name: 'Caramel Macchiato', price: 155.00, quantity: 1 }];
  session.state = 'IDLE';
  await saveSession(session);

  // Customer rates 5
  await handleMessageEvent(psid, '', `FEEDBACK_RATE_5_${orderNum}`);
  const msgs = getSent(psid);

  // Closing message text exact (Section 8)
  const lastMsg = msgs[msgs.length - 1].messagePayload.text;
  assert.strictEqual(lastMsg, "Thanks for your feedback! Type 'Menu' or 'Order' whenever you're ready for your next order.");

  // Feedback row in DB
  const [fb] = await db.query(`SELECT * FROM feedback WHERE order_id = ?`, [oRes.insertId]);
  assert.strictEqual(fb.length, 1);
  assert.strictEqual(fb[0].rating, 5);
  assert.strictEqual(fb[0].sentiment, 'positive');

  // NEW_FEEDBACK broadcast event emitted
  assert.ok(broadcastEvents.some(b => b.event === 'NEW_FEEDBACK' && b.data.rating === 5));

  // Non-empty cart preserved
  const reloaded = await getSession(psid);
  assert.strictEqual(reloaded.cart.length, 1);
  assert.strictEqual(reloaded.cart[0].name, 'Caramel Macchiato');

  // Second tap on rating: must not overwrite
  clearSent();
  await handleMessageEvent(psid, '', `FEEDBACK_RATE_5_${orderNum}`);
  const msgs2 = getSent(psid);
  assert.ok(msgs2.some(m => m.messagePayload.text.includes("You've already rated this order. Thanks!")));
});

test('Feedback Flow - low rating 2 asks for comment only when IDLE, comment updates DB and emits again', async () => {
  const psid = 'TEST_FB_LOW_' + Date.now();
  clearSent();
  broadcastEvents = [];

  const [cRes] = await db.query(
    `INSERT INTO customers (psid, first_name, last_name) VALUES (?, 'Low', 'User')`,
    [psid]
  );
  const orderNum = 'DNR-LOW-1';
  const [oRes] = await db.query(
    `INSERT INTO orders (order_number, customer_id, order_type, status, subtotal, delivery_fee, total_amount)
     VALUES (?, ?, 'delivery', 'delivered', 100, 50, 150)`,
    [orderNum, cRes.insertId]
  );

  const session = await getSession(psid);
  session.state = 'IDLE';
  await saveSession(session);

  // Rate 2 stars
  await handleMessageEvent(psid, '', `FEEDBACK_RATE_2_${orderNum}`);
  let msgs = getSent(psid);
  const whyMsg = msgs[msgs.length - 1].messagePayload.text;
  assert.strictEqual(whyMsg, 'Sorry about that. What went wrong? (optional)');

  const sAfterRating = await getSession(psid);
  assert.strictEqual(sAfterRating.state, 'AWAITING_FEEDBACK_COMMENT');

  // Customer replies with comment
  clearSent();
  broadcastEvents = [];
  await handleMessageEvent(psid, 'Coffee arrived cold <script>alert(1)</script>');
  msgs = getSent(psid);

  const doneMsg = msgs[msgs.length - 1].messagePayload.text;
  assert.strictEqual(doneMsg, "Thanks for your feedback! Type 'Menu' or 'Order' whenever you're ready for your next order.");

  // DB comment sanitized (< and > stripped)
  const [fb] = await db.query(`SELECT comments, rating, sentiment FROM feedback WHERE order_id = ?`, [oRes.insertId]);
  assert.strictEqual(fb[0].comments, 'Coffee arrived cold scriptalert(1)/script');

  // Broadcast emitted second time with comment update
  assert.ok(broadcastEvents.some(b => b.event === 'NEW_FEEDBACK'));
});
