const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, 'test_cancellation_modal.sqlite');
if (fs.existsSync(testDbPath)) {
  try { fs.unlinkSync(testDbPath); } catch (e) {}
}

process.env.DB_FORCE_SQLITE = '1';
process.env.SQLITE_PATH = testDbPath;
process.env.NODE_ENV = 'test';

const db = require('../database/db');
const { handleMessageEvent, getSession, saveSession } = require('../src/services/nlpEngine');
const messengerService = require('../src/services/messengerService');
const orderService = require('../src/services/orderService');

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

test('Setup database for cancellation & modal test', async () => {
  await db.initDatabase();
  await new Promise(r => setTimeout(r, 300));
  assert.ok(true, 'Database initialized successfully');
});

test('1. Customer Order Cancellation via Messenger (Pending Approval: Status = PENDING)', async () => {
  const psid = 'TEST_PSID_PENDING_' + Date.now();
  clearSent();

  // 1. Create a customer & pending order
  const [custRes] = await db.query(
    `INSERT INTO customers (psid, first_name, last_name, phone_number) VALUES (?, 'Maria', 'Santos', '09171234567')`,
    [psid]
  );
  const customerId = custRes.insertId;

  // Pick a seeded menu item and check its initial stock
  const [existingItems] = await db.query('SELECT id, stock_quantity FROM menu_items LIMIT 1');
  const menuItemId = existingItems[0].id;
  const initialStock = existingItems[0].stock_quantity;

  const orderNumber = 'DNR-TEST-P1';
  const [ordRes] = await db.query(
    `INSERT INTO orders (order_number, customer_id, order_type, dining_mode, status, subtotal, delivery_fee, total_amount, delivery_address, landmark, arriving_time, note)
     VALUES (?, ?, 'delivery', 'Delivery', 'pending', 280, 40, 320, '456 Sampaloc St', 'Near Church', NULL, 'Less sugar please')`,
    [orderNumber, customerId]
  );
  const orderId = ordRes.insertId;

  await db.query(
    `INSERT INTO order_items (order_id, menu_item_id, item_name, unit_price, quantity, subtotal)
     VALUES (?, ?, 'Test Item', 140, 2, 280)`,
    [orderId, menuItemId]
  );

  // Set session
  const session = await getSession(psid);
  session.customerId = customerId;
  session.activeOrderNumber = orderNumber;
  session.active_order_id = orderId;
  await saveSession(session);

  // 2. Trigger cancellation via button postback payload
  await handleMessageEvent(psid, '', `CANCEL_ORDER_${orderNumber}`);

  const sent = getSent(psid);
  assert.ok(sent.length >= 1, 'Should send response message');
  const lastMsg = sent[sent.length - 1].messagePayload.text;

  const expectedReply = `Naiintindihan po namin. Matagumpay na pong nakansela ang inyong Order #${orderNumber} dahil hindi pa po ito naipapasa sa kusina. Maaari po kayong mag-order muli anumang oras.`;
  assert.strictEqual(lastMsg, expectedReply, 'Rule 1: Confirmation message must match 5-minute instant cancellation policy');

  // Verify status in DB is cancelled
  const [orderRows] = await db.query(`SELECT status FROM orders WHERE id = ?`, [orderId]);
  assert.strictEqual(orderRows[0].status, 'cancelled', 'Order status must be cancelled in DB');

  // Verify stock restoration
  const [itemRows] = await db.query(`SELECT stock_quantity FROM menu_items WHERE id = ?`, [menuItemId]);
  assert.strictEqual(itemRows[0].stock_quantity, initialStock + 2, 'Menu item stock must be restored +2');
});

test('2. Customer Order Cancellation Within 5 Minutes in Kitchen (IN_PREPARATION & elapsed <= 300s)', async () => {
  const psid = 'TEST_PSID_PREP_' + Date.now();
  clearSent();

  const [custRes] = await db.query(
    `INSERT INTO customers (psid, first_name, last_name, phone_number) VALUES (?, 'Juan', 'Dela Cruz', '09181234567')`,
    [psid]
  );
  const customerId = custRes.insertId;

  const orderNumber = 'DNR-TEST-PREP';
  const [ordRes] = await db.query(
    `INSERT INTO orders (order_number, customer_id, order_type, status, subtotal, delivery_fee, total_amount)
     VALUES (?, ?, 'delivery', 'preparing', 200, 40, 240)`,
    [orderNumber, customerId]
  );
  const orderId = ordRes.insertId;

  const session = await getSession(psid);
  session.customerId = customerId;
  session.activeOrderNumber = orderNumber;
  session.active_order_id = orderId;
  await saveSession(session);

  // Customer taps Cancel Order button within 5 minutes of placement
  await handleMessageEvent(psid, '', `CANCEL_ORDER_${orderNumber}`);

  const sent = getSent(psid);
  assert.ok(sent.length >= 1);
  const lastMsg = sent[sent.length - 1].messagePayload.text;

  const expectedGracePeriodMsg = `Naipasa na po ang inyong Order #${orderNumber} sa kusina, ngunit dahil pasok pa po ito sa 5-minute grace period, naipadala na po namin ang inyong cancellation request sa aming duty staff/admin. Maghintay lamang po ng sandali para sa kanilang kumpirmasyon kung maaari pa itong mahinto.`;
  assert.strictEqual(lastMsg, expectedGracePeriodMsg, 'Rule 2: Within 5 min kitchen cancellation must be forwarded to admin');

  // Order status should be cancellation_requested with cancel_requested = 1
  const [orderRows] = await db.query(`SELECT status, cancel_requested FROM orders WHERE id = ?`, [orderId]);
  assert.strictEqual(orderRows[0].status, 'cancellation_requested');
  assert.strictEqual(Number(orderRows[0].cancel_requested), 1);
});

test('2b. Customer Order Cancellation Past 5 Minutes in Kitchen (IN_PREPARATION & elapsed > 300s)', async () => {
  const psid = 'TEST_PSID_PREP_EXPIRED_' + Date.now();
  clearSent();

  const [custRes] = await db.query(
    `INSERT INTO customers (psid, first_name, last_name, phone_number) VALUES (?, 'Lando', 'Santos', '09181112222')`,
    [psid]
  );
  const customerId = custRes.insertId;

  const orderNumber = 'DNR-TEST-EXPIRED';
  const [ordRes] = await db.query(
    `INSERT INTO orders (order_number, customer_id, order_type, status, subtotal, delivery_fee, total_amount, created_at)
     VALUES (?, ?, 'delivery', 'preparing', 200, 40, 240, datetime('now', '-10 minutes'))`,
    [orderNumber, customerId]
  );
  const orderId = ordRes.insertId;

  const session = await getSession(psid);
  session.customerId = customerId;
  session.activeOrderNumber = orderNumber;
  session.active_order_id = orderId;
  await saveSession(session);

  await handleMessageEvent(psid, 'cancel order');

  const sent = getSent(psid);
  assert.ok(sent.length >= 1);
  const lastMsg = sent[sent.length - 1].messagePayload.text;

  const expectedDenial = `Paumanhin po, lampas na po sa 5-minute grace period at kasalukuyan nang niluluto (o naipadala na) ang inyong Order #${orderNumber}, kaya hindi na po ito maaaring kanselahin.`;
  assert.strictEqual(lastMsg, expectedDenial, 'Rule 3: Past 5 minutes in kitchen must be declined');

  // Order status must remain preparing
  const [orderRows] = await db.query(`SELECT status FROM orders WHERE id = ?`, [orderId]);
  assert.strictEqual(orderRows[0].status, 'preparing');
});

test('3. Customer Order Cancellation Denied when Status has progressed (DISPATCHED or DELIVERED)', async () => {
  const psid = 'TEST_PSID_DISP_' + Date.now();
  clearSent();

  const [custRes] = await db.query(
    `INSERT INTO customers (psid, first_name, last_name, phone_number) VALUES (?, 'Pedro', 'Penduko', '09191234567')`,
    [psid]
  );
  const customerId = custRes.insertId;

  const orderNumber = 'DNR-TEST-DISP';
  const [ordRes] = await db.query(
    `INSERT INTO orders (order_number, customer_id, order_type, status, subtotal, delivery_fee, total_amount)
     VALUES (?, ?, 'delivery', 'dispatched', 200, 40, 240)`,
    [orderNumber, customerId]
  );
  const orderId = ordRes.insertId;

  const session = await getSession(psid);
  session.customerId = customerId;
  session.activeOrderNumber = orderNumber;
  session.active_order_id = orderId;
  await saveSession(session);

  // Customer types "cancel order"
  await handleMessageEvent(psid, 'cancel order');

  const sent = getSent(psid);
  assert.ok(sent.length >= 1);
  const lastMsg = sent[sent.length - 1].messagePayload.text;

  const expectedDenial = `Paumanhin po, lampas na po sa 5-minute grace period at kasalukuyan nang niluluto (o naipadala na) ang inyong Order #${orderNumber}, kaya hindi na po ito maaaring kanselahin.`;
  assert.strictEqual(lastMsg, expectedDenial, 'Rule 3: Dispatched order cancellation must be denied');

  // Order status must remain dispatched
  const [orderRows] = await db.query(`SELECT status FROM orders WHERE id = ?`, [orderId]);
  assert.strictEqual(orderRows[0].status, 'dispatched');
});

test('4. API / orderService: Order details include status, note, landmark, dining_mode, arriving_time', async () => {
  const [custRes] = await db.query(
    `INSERT INTO customers (psid, first_name, last_name, phone_number) VALUES ('PSID_MODAL_TEST', 'Ana', 'Reyes', '09201234567')`
  );
  const customerId = custRes.insertId;

  const orderNumber = 'DNR-MODAL-TEST';
  const [ordRes] = await db.query(
    `INSERT INTO orders (order_number, customer_id, order_type, dining_mode, status, subtotal, delivery_fee, total_amount, delivery_address, landmark, arriving_time, note)
     VALUES (?, ?, 'pickup', 'Pick-up', 'pending', 180, 0, 180, 'Store Counter', NULL, '3:30 PM', 'Extra hot please')`,
    [orderNumber, customerId]
  );
  const orderId = ordRes.insertId;

  const details = await orderService.getOrderDetails(orderId);
  assert.ok(details, 'Details must exist');
  assert.strictEqual(details.status, 'pending');
  assert.strictEqual(details.dining_mode, 'Pick-up');
  assert.strictEqual(details.arriving_time, '3:30 PM');
  assert.strictEqual(details.note, 'Extra hot please');
  assert.strictEqual(details.customer_note, 'Extra hot please');
  assert.ok(details.elapsed_seconds !== undefined, 'Must calculate elapsed_seconds');
});

test('5. Admin / Staff Approves Within-5-Minute Kitchen Cancellation Request', async () => {
  const [custRes] = await db.query(
    `INSERT INTO customers (psid, first_name, last_name, phone_number) VALUES ('PSID_APPR_TEST', 'Gloria', 'Macapagal', '09221234567')`
  );
  const customerId = custRes.insertId;
  const orderNumber = 'DNR-APPR-TEST';
  const [ordRes] = await db.query(
    `INSERT INTO orders (order_number, customer_id, order_type, status, subtotal, delivery_fee, total_amount, cancel_requested)
     VALUES (?, ?, 'delivery', 'cancellation_requested', 250, 40, 290, 1)`,
    [orderNumber, customerId]
  );
  const orderId = ordRes.insertId;

  const updated = await orderService.approveCancellationRequest(orderId, { name: 'Duty Manager', role: 'admin' }, 'Cooking has not started');
  assert.strictEqual(updated.status, 'cancelled');

  const [orderRows] = await db.query(`SELECT status, cancel_requested FROM orders WHERE id = ?`, [orderId]);
  assert.strictEqual(orderRows[0].status, 'cancelled');
  assert.strictEqual(Number(orderRows[0].cancel_requested), 0);
});

test('6. Admin / Staff Declines Within-5-Minute Kitchen Cancellation Request', async () => {
  const [custRes] = await db.query(
    `INSERT INTO customers (psid, first_name, last_name, phone_number) VALUES ('PSID_DECL_TEST', 'Rody', 'Duterte', '09231234567')`
  );
  const customerId = custRes.insertId;
  const orderNumber = 'DNR-DECL-TEST';
  const [ordRes] = await db.query(
    `INSERT INTO orders (order_number, customer_id, order_type, status, subtotal, delivery_fee, total_amount, cancel_requested)
     VALUES (?, ?, 'delivery', 'cancellation_requested', 250, 40, 290, 1)`,
    [orderNumber, customerId]
  );
  const orderId = ordRes.insertId;

  const result = await orderService.declineCancellationRequest(orderId, { name: 'Kitchen Chef', role: 'staff' }, 'Already on the grill');
  assert.strictEqual(result.status, 'preparing');

  const [orderRows] = await db.query(`SELECT status, cancel_requested FROM orders WHERE id = ?`, [orderId]);
  assert.strictEqual(orderRows[0].status, 'preparing');
  assert.strictEqual(Number(orderRows[0].cancel_requested), 0);
});
