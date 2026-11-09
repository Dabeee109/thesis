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

  const expectedReply = `Ang inyong order #${orderNumber} ay matagumpay nang nakansela. Kung nais ninyong mag-order muli, mag-type lamang po ng 'Menu'.`;
  assert.strictEqual(lastMsg, expectedReply, 'Confirmation message must match exact requirement');

  // Verify status in DB is cancelled
  const [orderRows] = await db.query(`SELECT status FROM orders WHERE id = ?`, [orderId]);
  assert.strictEqual(orderRows[0].status, 'cancelled', 'Order status must be cancelled in DB');

  // Verify stock restoration
  const [itemRows] = await db.query(`SELECT stock_quantity FROM menu_items WHERE id = ?`, [menuItemId]);
  assert.strictEqual(itemRows[0].stock_quantity, initialStock + 2, 'Menu item stock must be restored +2');
});

test('2. Customer Order Cancellation Denied when Status has progressed (IN_PREPARATION)', async () => {
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

  // Customer taps Cancel Order button
  await handleMessageEvent(psid, '', `CANCEL_ORDER_${orderNumber}`);

  const sent = getSent(psid);
  assert.ok(sent.length >= 1);
  const lastMsg = sent[sent.length - 1].messagePayload.text;

  const expectedDenial = 'Paumanhin, hindi na po maaaring kanselahin ang inyong order dahil ito ay kasalukuyan nang inihahanda ng aming kusina o naipadala na. Mangyaring mag-iwan ng mensahe para sa aming staff.';
  assert.strictEqual(lastMsg, expectedDenial, 'Denial message must match exact requirement');

  // Order status should remain preparing
  const [orderRows] = await db.query(`SELECT status FROM orders WHERE id = ?`, [orderId]);
  assert.strictEqual(orderRows[0].status, 'preparing', 'Order status must not change');
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

  const expectedDenial = 'Paumanhin, hindi na po maaaring kanselahin ang inyong order dahil ito ay kasalukuyan nang inihahanda ng aming kusina o naipadala na. Mangyaring mag-iwan ng mensahe para sa aming staff.';
  assert.strictEqual(lastMsg, expectedDenial, 'Denial message must match exact requirement for dispatched');

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
});
