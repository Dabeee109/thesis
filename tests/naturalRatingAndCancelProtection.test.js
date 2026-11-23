const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, 'test_natural_rating.sqlite');
if (fs.existsSync(testDbPath)) {
  try { fs.unlinkSync(testDbPath); } catch (e) {}
}

process.env.DB_FORCE_SQLITE = '1';
process.env.SQLITE_PATH = testDbPath;
process.env.NODE_ENV = 'test';

const notificationService = require('../src/services/notificationService');
let broadcastEvents = [];
const originalBroadcast = notificationService.broadcastSSE;
notificationService.broadcastSSE = (event, data) => {
  broadcastEvents.push({ event, data });
  if (originalBroadcast) originalBroadcast(event, data);
};

const db = require('../database/db');
const { parseCustomerFeedback } = require('../src/services/feedbackParser');
const { handleMessageEvent, getSession, saveSession, handleCancellationRequest } = require('../src/services/nlpEngine');
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
  broadcastEvents = [];
}

test('1. Natural Rating Recognition - parseCustomerFeedback unit tests', () => {
  // Awaiting feedback session
  const sessionAwaiting = {
    state: 'awaiting_feedback',
    pendingFeedbackOrderId: 100,
    pendingFeedbackOrderNumber: 'DNR-20261123-4870'
  };

  // Case 1: "4 lang..."
  const r1 = parseCustomerFeedback('4 lang...', sessionAwaiting);
  assert.strictEqual(r1.isFeedback, true);
  assert.strictEqual(r1.rating, 4);
  assert.strictEqual(r1.comment, '');

  // Case 2: "3"
  const r2 = parseCustomerFeedback('3', sessionAwaiting);
  assert.strictEqual(r2.isFeedback, true);
  assert.strictEqual(r2.rating, 3);
  assert.strictEqual(r2.comment, '');

  // Case 3: "5 lang"
  const r3 = parseCustomerFeedback('5 lang', sessionAwaiting);
  assert.strictEqual(r3.isFeedback, true);
  assert.strictEqual(r3.rating, 5);
  assert.strictEqual(r3.comment, '');

  // Case 4: "4 lang kasi d ako na inform na nasa kitchen na pla"
  const r4 = parseCustomerFeedback('4 lang kasi d ako na inform na nasa kitchen na pla', sessionAwaiting);
  assert.strictEqual(r4.isFeedback, true);
  assert.strictEqual(r4.rating, 4);
  assert.strictEqual(r4.comment, 'd ako na inform na nasa kitchen na pla');

  // Case 5: "5 po"
  const r5 = parseCustomerFeedback('5 po', sessionAwaiting);
  assert.strictEqual(r5.isFeedback, true);
  assert.strictEqual(r5.rating, 5);
  assert.strictEqual(r5.comment, '');

  // Case 6: "apat lang"
  const r6 = parseCustomerFeedback('apat lang', sessionAwaiting);
  assert.strictEqual(r6.isFeedback, true);
  assert.strictEqual(r6.rating, 4);
});

test('2. Natural Rating Recognition - End-to-end via handleMessageEvent with DB & SSE', async () => {
  await db.initDatabase();
  const psid = 'PSID_NATURAL_RATING_' + Date.now();
  clearSent();

  // Create customer
  const [cRes] = await db.query(
    `INSERT INTO customers (psid, first_name, last_name, phone_number)
     VALUES (?, 'Francis Dave', 'Fernandez', '09171234567')`,
    [psid]
  );
  const custId = cRes.insertId;

  // Create an old pending order (like #DNR-20261123-8058)
  const [oldOrder] = await db.query(
    `INSERT INTO orders (order_number, customer_id, total_amount, status, payment_status, created_at)
     VALUES ('DNR-20261123-8058', ?, 538.00, 'pending', 'unpaid', DATETIME('now', '-2 hours'))`,
    [custId]
  );

  // Create a recent delivered order (like #DNR-20261123-4870)
  const [newOrder] = await db.query(
    `INSERT INTO orders (order_number, customer_id, total_amount, status, payment_status, created_at)
     VALUES ('DNR-20261123-4870', ?, 358.00, 'delivered', 'paid', DATETIME('now', '-10 minutes'))`,
    [custId]
  );

  // Set session to awaiting_feedback for DNR-20261123-4870
  const session = await getSession(psid);
  session.state = 'awaiting_feedback';
  session.pendingFeedbackOrderId = newOrder.insertId;
  session.pendingFeedbackOrderNumber = 'DNR-20261123-4870';
  await saveSession(session);

  // Customer replies: "4 lang kasi d ako na inform na nasa kitchen na pla"
  const res = await handleMessageEvent(psid, '4 lang kasi d ako na inform na nasa kitchen na pla');

  assert.strictEqual(res.intent, 'FEEDBACK_SUBMITTED');

  // Verify feedback was persisted in database
  const [fbRows] = await db.query(
    `SELECT * FROM feedback WHERE order_id = ?`,
    [newOrder.insertId]
  );
  assert.strictEqual(fbRows.length, 1);
  assert.strictEqual(fbRows[0].rating, 4);
  assert.strictEqual(fbRows[0].comments, 'd ako na inform na nasa kitchen na pla');

  // Verify SSE event was broadcast
  const sseFb = broadcastEvents.find(e => e.event === 'NEW_FEEDBACK');
  assert.ok(sseFb, 'NEW_FEEDBACK SSE event must be emitted');
  assert.strictEqual(sseFb.data.rating, 4);
  assert.strictEqual(sseFb.data.orderNumber, 'DNR-20261123-4870');

  // CRITICAL CHECK: Verify old pending order #DNR-20261123-8058 was NOT cancelled!
  const [checkOld] = await db.query(
    `SELECT status FROM orders WHERE id = ?`,
    [oldOrder.insertId]
  );
  assert.strictEqual(checkOld[0].status, 'pending', 'Old order must remain pending and NOT be cancelled by feedback!');
});

test('3. AI Order Protection - Customer with delivered order cannot cancel old pending orders', async () => {
  const psid = 'PSID_CANCEL_PROTECT_' + Date.now();
  clearSent();

  // Create customer
  const [cRes] = await db.query(
    `INSERT INTO customers (psid, first_name, last_name, phone_number)
     VALUES (?, 'Francis Dave', 'Fernandez', '09171234567')`,
    [psid]
  );
  const custId = cRes.insertId;

  // Old pending order
  const [oldOrder] = await db.query(
    `INSERT INTO orders (order_number, customer_id, total_amount, status, payment_status, created_at)
     VALUES ('DNR-20261123-8059', ?, 538.00, 'pending', 'unpaid', DATETIME('now', '-3 hours'))`,
    [custId]
  );

  // Latest order is delivered
  const [deliveredOrder] = await db.query(
    `INSERT INTO orders (order_number, customer_id, total_amount, status, payment_status, created_at)
     VALUES ('DNR-20261123-4871', ?, 358.00, 'delivered', 'paid', DATETIME('now', '-5 minutes'))`,
    [custId]
  );

  const session = await getSession(psid);
  session.state = 'IDLE';
  session.activeOrderNumber = null;
  await saveSession(session);

  // If a generic cancel request comes in without an explicit order number:
  const cancelRes = await handleCancellationRequest(psid, session, 'cancel order');
  assert.strictEqual(cancelRes.intent, 'ORDER_CANCEL_BLOCKED');
  assert.ok(cancelRes.replyLog.includes('naihatid na') || cancelRes.replyLog.includes('tapos na'));

  // Verify old order is still untouched in DB
  const [checkOld] = await db.query(`SELECT status FROM orders WHERE id = ?`, [oldOrder.insertId]);
  assert.strictEqual(checkOld[0].status, 'pending');
});
