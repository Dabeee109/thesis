/**
 * QA Conversational Bug Fixes & No-Time-Limit Pending Cancellation Regression Suite
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.DB_FORCE_SQLITE = 'true';
process.env.SQLITE_PATH = path.join(__dirname, 'test_qa_conversation_fixes.sqlite');

const db = require('../database/db');
const nlpEngine = require('../src/services/nlpEngine');
const messenger = require('../src/services/messengerService');
const orderService = require('../src/services/orderService');

// Outbound message interceptor
const outboundMessages = new Map();
function clearSent(psid) {
  outboundMessages.set(String(psid), []);
}
function getSent(psid) {
  return outboundMessages.get(String(psid)) || [];
}

test.before(async () => {
  messenger.sendTextMessage = async (psid, text) => {
    const list = outboundMessages.get(String(psid)) || [];
    list.push({ type: 'text', text });
    outboundMessages.set(String(psid), list);
    return { recipient_id: psid, message_id: `mid_${Date.now()}` };
  };

  messenger.sendQuickReplies = async (psid, text, quickReplies) => {
    const list = outboundMessages.get(String(psid)) || [];
    list.push({ type: 'quick_replies', text, quickReplies });
    outboundMessages.set(String(psid), list);
    return { recipient_id: psid, message_id: `mid_${Date.now()}` };
  };

  // Ensure DB tables exist
  await db.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      psid VARCHAR(64) UNIQUE,
      first_name VARCHAR(100),
      last_name VARCHAR(100),
      phone_number VARCHAR(20),
      delivery_address TEXT,
      conversation_state VARCHAR(50) DEFAULT 'IDLE',
      cart_json TEXT DEFAULT '[]',
      session_json TEXT DEFAULT '{}',
      last_interaction_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      order_number VARCHAR(50) UNIQUE,
      status VARCHAR(50) DEFAULT 'pending',
      total_amount DECIMAL(10, 2) DEFAULT 0.00,
      payment_status VARCHAR(50) DEFAULT 'UNPAID',
      payment_method VARCHAR(50) DEFAULT 'cash',
      payment_ref_number VARCHAR(100),
      order_type VARCHAR(50) DEFAULT 'dinein',
      dining_mode VARCHAR(50) DEFAULT 'Dine In',
      delivery_address TEXT,
      cancel_requested INTEGER DEFAULT 0,
      cancel_requested_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      method VARCHAR(50) DEFAULT 'cash',
      reference_no VARCHAR(100),
      status VARCHAR(50) DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
});

test('QA Conversation & Cancellation Policy Enhancements', async (t) => {
  await t.test('1. Pending Approval order can be cancelled with NO TIME LIMIT (even after 30 minutes)', async () => {
    const psid = `PSID_NO_LIMIT_${Date.now()}`;
    clearSent(psid);
    const orderNum = `DNR-TEST-P30-${Date.now()}`;

    // Create customer and order placed 30 minutes ago (1800 seconds)
    const [custRes] = await db.query(
      `INSERT INTO customers (psid, first_name, conversation_state) VALUES (?, 'TestCust', 'IDLE')`,
      [psid]
    );
    const customerId = custRes.insertId;

    const [ordRes] = await db.query(
      `INSERT INTO orders (customer_id, order_number, status, payment_status, total_amount, created_at)
       VALUES (?, ?, 'pending_approval', 'UNPAID', 1601.00, datetime('now', '-30 minutes'))`,
      [customerId, orderNum]
    );

    const session = await nlpEngine.getSession(psid);
    session.activeOrderNumber = orderNum;
    session.active_order_id = ordRes.insertId;

    const res = await nlpEngine.handleCancellationRequest(psid, session, 'pa cancel ng order ko');
    assert.strictEqual(res.intent, 'ORDER_CANCELLED_PENDING');
    assert.ok(res.replyLog && res.replyLog.includes('Matagumpay na pong nakansela'), 'Reports success cancellation');

    const [check] = await db.query(`SELECT status FROM orders WHERE id = ?`, [ordRes.insertId]);
    assert.strictEqual(check[0].status, 'cancelled', 'DB order status is cancelled');
  });

  await t.test('2. Cancellation targets latest active order (highest id) instead of stale yesterday order', async () => {
    const psid = `PSID_LATEST_ORDER_${Date.now()}`;
    clearSent(psid);
    const yesterdayOrd = `DNR-YEST-${Date.now()}`;
    const todayOrd = `DNR-TODAY-${Date.now()}`;

    const [custRes] = await db.query(
      `INSERT INTO customers (psid, first_name, conversation_state) VALUES (?, 'Francis', 'IDLE')`,
      [psid]
    );
    const customerId = custRes.insertId;

    // Yesterday order (old, past 5 mins, preparing)
    await db.query(
      `INSERT INTO orders (customer_id, order_number, status, payment_status, total_amount, created_at)
       VALUES (?, ?, 'in_preparation', 'PAID', 936.00, datetime('now', '-1 day'))`,
      [customerId, yesterdayOrd]
    );

    // Today's fresh order (just placed, pending_approval)
    const [freshOrd] = await db.query(
      `INSERT INTO orders (customer_id, order_number, status, payment_status, total_amount, created_at)
       VALUES (?, ?, 'pending_approval', 'UNPAID', 1601.00, datetime('now', '-1 minute'))`,
      [customerId, todayOrd]
    );

    const session = await nlpEngine.getSession(psid);
    // Even if session had yesterday's order cached
    session.activeOrderNumber = yesterdayOrd;

    const res = await nlpEngine.handleCancellationRequest(psid, session, 'Pa cancel ng order ko');
    assert.strictEqual(res.intent, 'ORDER_CANCELLED_PENDING');
    assert.strictEqual(res.orderNumber, todayOrd, 'Cancelled today fresh order, not yesterday order');

    const [checkToday] = await db.query(`SELECT status FROM orders WHERE id = ?`, [freshOrd.insertId]);
    assert.strictEqual(checkToday[0].status, 'cancelled');
  });

  await t.test('3. Conversational frustration phrase "hayss wag na pa cancel na lang ng order ko" is recognized as cancellation', async () => {
    const psid = `PSID_CONV_CANCEL_${Date.now()}`;
    clearSent(psid);

    const isCancel = nlpEngine.isCancelTriggerWord(
      'hayss wag na pa cancel na lang ng order ko',
      'hayss wag na pa cancel na lang ng order ko'
    );
    assert.strictEqual(isCancel, true, 'isCancelTriggerWord returns true for natural phrase');
  });

  await t.test('4. Typo in cart ("patingin ako ng kart ko") triggers VIEW_CART intent', async () => {
    const psid = `PSID_KART_${Date.now()}`;
    clearSent(psid);

    const [menuRows] = await db.query('SELECT id, name, price FROM menu_items LIMIT 1');
    const menuItem = menuRows[0];

    const session = await nlpEngine.getSession(psid);
    session.cart = [{ menuItemId: menuItem.id, name: menuItem.name, price: menuItem.price, quantity: 1 }];
    await nlpEngine.saveSession(session);

    const res = await nlpEngine.processMessage(psid, 'patingin ako ng kart ko');
    assert.strictEqual(res.intent, 'VIEW_CART', 'kart typo triggers VIEW_CART');
    assert.ok(res.replyLog && res.replyLog.includes(menuItem.name), 'Cart summary returned');
  });

  await t.test('5. Natural sentence checkout details parsed without requiring labeled form', async () => {
    const text = 'name ko ay Francis ang number ko naman ay 09281762895 makaka dating ako dyan ng mga 7 pm bayadan ko na gamit ang gcash';
    const parsed = nlpEngine.parseCustomerInfo(text, null);

    assert.strictEqual(parsed.name, 'Francis');
    assert.strictEqual(parsed.contact, '09281762895');
    assert.strictEqual(parsed.arrivingTime, '7 pm');
    assert.strictEqual(parsed.paymentMode, 'GCash');
    assert.strictEqual(parsed.diningMode, 'Dine In');
  });

  await t.test('6. Submitting reference number links to active order and sets payment to GCash', async () => {
    const psid = `PSID_REF_SUBMIT_${Date.now()}`;
    clearSent(psid);
    const gcashOrd = `DNR-GCASH-${Date.now()}`;

    const [custRes] = await db.query(
      `INSERT INTO customers (psid, first_name, conversation_state) VALUES (?, 'Francjs', 'IDLE')`,
      [psid]
    );
    const customerId = custRes.insertId;

    const [ordRes] = await db.query(
      `INSERT INTO orders (customer_id, order_number, status, payment_status, total_amount)
       VALUES (?, ?, 'pending_approval', 'UNPAID', 1601.00)`,
      [customerId, gcashOrd]
    );

    const session = await nlpEngine.getSession(psid);
    session.activeOrderNumber = gcashOrd;
    session.active_order_id = ordRes.insertId;

    const res = await nlpEngine.processMessage(psid, 'ref: 1238901234561');
    assert.strictEqual(res.intent, 'GCASH_REFERENCE_SUBMITTED');
    assert.strictEqual(res.referenceNumber, '1238901234561');

    const [ordCheck] = await db.query(`SELECT payment_ref_number, gcash_ref, payment_status FROM orders WHERE id = ?`, [ordRes.insertId]);
    assert.strictEqual(ordCheck[0].payment_ref_number, '1238901234561');
    assert.strictEqual(ordCheck[0].gcash_ref, '1238901234561');
    assert.strictEqual(ordCheck[0].payment_status, 'Pending Verification');

    const [payCheck] = await db.query(`SELECT payment_method, reference_no FROM payments WHERE order_id = ?`, [ordRes.insertId]);
    assert.strictEqual(payCheck[0].payment_method, 'gcash');
    assert.strictEqual(payCheck[0].reference_no, '1238901234561');
  });

  await t.test('7. Manual Store OPEN/CLOSE override overrides operating hours in systemSettings and AI operational context', async () => {
    const systemSettingsService = require('../src/services/systemSettingsService');
    const aiService = require('../src/services/aiService');

    // 1. Manually force Store OPEN with schedule outside normal hours
    await systemSettingsService.updateSystemSettings({
      store_status: 'OPEN',
      is_manual_override: 1,
      store_open_time: '06:00:00',
      store_close_time: '05:59:00',
      override_at: new Date().toISOString(),
      override_by: 'Admin'
    });

    const statusCheck = systemSettingsService.isStoreOpen();
    assert.strictEqual(statusCheck.isOpen, true, 'Store is open due to manual override');
    assert.strictEqual(statusCheck.status, 'OPEN');
    assert.strictEqual(statusCheck.is_manual_override, 1);

    const context = await aiService.loadOperationalContext('TEST_PSID');
    assert.strictEqual(context.store.isOpen, true, 'AI context reflects store is OPEN');
    assert.strictEqual(context.store.status, 'OPEN');
    assert.strictEqual(context.store.isManualOverride, true, 'AI context flags manual override as active');
    assert.ok(context.store.operatingHours.includes('6:00 AM'), 'AI context uses live operating hours');

    const prompt = aiService.buildAssistantSystemInstruction(context);
    assert.ok(prompt.includes('Manual Override: ACTIVE'), 'Prompt explicitly informs AI that manual override is ACTIVE');
    assert.ok(!prompt.includes('STRICT STORE HOURS: Operating hours are strictly 9:00 AM - 9:00 PM'), 'Hardcoded 9:00 AM - 9:00 PM is removed');
  });
});
