const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, 'test_personal_gcash_payfirst.sqlite');
if (fs.existsSync(testDbPath)) {
  try { fs.unlinkSync(testDbPath); } catch (e) {}
}

process.env.DB_FORCE_SQLITE = '1';
process.env.SQLITE_PATH = testDbPath;
process.env.NODE_ENV = 'test';
process.env.APP_BASE_URL = 'https://diners-cafe-test.onrender.com';
delete process.env.GCASH_CHECKOUT_MODE;
process.env.XENDIT_SECRET_KEY = 'xnd_development_test_key_only';

const db = require('../database/db');
const personalGcashService = require('../src/services/personalGcashService');
const nlpEngine = require('../src/services/nlpEngine');
const messengerService = require('../src/services/messengerService');
const webhookController = require('../src/controllers/webhookController');
const orderService = require('../src/services/orderService');

const sentMessages = [];
messengerService.callSendAPI = async (psid, messagePayload, options) => {
  sentMessages.push({ psid: String(psid), messagePayload, options });
  return { recipient_id: String(psid), message_id: `mid.test.${Date.now()}` };
};

function clearSent(psid) {
  for (let i = sentMessages.length - 1; i >= 0; i--) {
    if (!psid || sentMessages[i].psid === String(psid)) {
      sentMessages.splice(i, 1);
    }
  }
}

function getSent(psid) {
  return sentMessages.filter(m => m.psid === String(psid));
}

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    send(payload) { this.body = payload; return this; }
  };
}

test('Personal GCash Pay-First & Anti-Flood Suite', async (t) => {
  await db.initDatabase();

  const [menuRows] = await db.query('SELECT id, name, price FROM menu_items WHERE is_available = 1 LIMIT 1');
  assert.ok(menuRows && menuRows.length > 0, 'Seeded menu item required');
  const sampleItem = menuRows[0];

  await t.test('1. shouldUseXenditCheckout defaults to Personal GCash unless live xnd_production_ key or explicit xendit override', () => {
    const origKey = process.env.XENDIT_SECRET_KEY;
    const origMode = process.env.GCASH_CHECKOUT_MODE;

    try {
      delete process.env.GCASH_CHECKOUT_MODE;
      process.env.XENDIT_SECRET_KEY = 'xnd_development_abc';
      assert.strictEqual(personalGcashService.shouldUseXenditCheckout(), false);

      process.env.XENDIT_SECRET_KEY = '';
      assert.strictEqual(personalGcashService.shouldUseXenditCheckout(), false);

      process.env.XENDIT_SECRET_KEY = 'xnd_production_real_live_key';
      assert.strictEqual(personalGcashService.shouldUseXenditCheckout(), true);

      process.env.GCASH_CHECKOUT_MODE = 'personal';
      assert.strictEqual(personalGcashService.shouldUseXenditCheckout(), false);

      process.env.XENDIT_SECRET_KEY = 'xnd_development_abc';
      process.env.GCASH_CHECKOUT_MODE = 'xendit';
      assert.strictEqual(personalGcashService.shouldUseXenditCheckout(), true);
    } finally {
      process.env.XENDIT_SECRET_KEY = origKey;
      if (origMode === undefined) delete process.env.GCASH_CHECKOUT_MODE;
      else process.env.GCASH_CHECKOUT_MODE = origMode;
    }
  });

  await t.test('2. Pay-First checkout stores session.pendingGCashOrder WITHOUT inserting into orders DB', async () => {
    const psid = `PSID_PAY_FIRST_${Date.now()}`;
    clearSent(psid);

    const session = await nlpEngine.getSession(psid);
    session.customer_name = 'Juan Dela Cruz';
    session.contact_number = '09171234567';
    session.dining_mode = 'Pick-up';
    session.payment_mode = 'Xendit';
    session.order_subtotal = Number(sampleItem.price);
    session.cart = [{ menuItemId: sampleItem.id, name: sampleItem.name, price: Number(sampleItem.price), quantity: 1 }];
    await nlpEngine.saveSession(session);

    const [beforeOrders] = await db.query(
      `SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.psid = ?`,
      [psid]
    );
    assert.strictEqual(beforeOrders.length, 0);

    const result = await nlpEngine.finalizeOrderSummaryAndPayment(psid, session);
    assert.strictEqual(result.intent, 'AWAITING_PAYMENT_PROOF');

    // Critical anti-flood verification: zero DB orders inserted yet!
    const [afterOrders] = await db.query(
      `SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.psid = ?`,
      [psid]
    );
    assert.strictEqual(afterOrders.length, 0, 'Must NOT insert order into DB until valid proof is uploaded');

    const updated = await nlpEngine.getSession(psid);
    assert.strictEqual(updated.state, 'AWAITING_PAYMENT_PROOF');
    assert.ok(updated.pendingGCashOrder, 'pendingGCashOrder draft must be saved in session');
    assert.strictEqual(Number(updated.pendingGCashOrder.grandTotal), Number(sampleItem.price));

    const sent = getSent(psid);
    const btnMsg = sent.find(m => m.messagePayload?.attachment?.payload?.template_type === 'button');
    assert.ok(btnMsg, 'Must send Button Template with GCash payment portal URL');
    const url = btnMsg.messagePayload.attachment.payload.buttons[0].url;
    assert.ok(url.includes('/pay/gcash?'), 'Button URL must point to /pay/gcash');
    assert.ok(url.includes('mode=personal'), 'Button URL must include mode=personal');
  });

  await t.test('3. /pay/gcash?mode=personal hides mock payBtn and confirmGcashPayment blocks personal self-confirm', async () => {
    const psid = `PSID_PORTAL_PERSONAL_${Date.now()}`;
    const resHtml = createMockRes();
    await webhookController.gcashRedirect({ query: { mode: 'personal', amount: '249.00', psid } }, resHtml);

    assert.strictEqual(resHtml.statusCode, 200);
    assert.ok(resHtml.body.includes('I-scan ang Official GCash QR ng Tindahan'), 'Must render store GCash QR section');
    assert.strictEqual(resHtml.body.includes('submitGcashPayment'), false, 'Must NOT expose mock self-confirm button in personal mode');
    assert.ok(resHtml.body.includes('Buksan ang GCash'), 'Must include real GCash app launch button');

    const resConfirm = createMockRes();
    await webhookController.confirmGcashPayment({ body: { psid, amount: 249, mode: 'personal' } }, resConfirm);
    assert.strictEqual(resConfirm.statusCode, 403);
    assert.strictEqual(resConfirm.body.success, false);
  });

  await t.test('4. Unreadable receipt rejects without DB insert and activates 10-minute cooldown after 3 attempts', async () => {
    const psid = `PSID_SPAM_COOLDOWN_${Date.now()}`;
    clearSent(psid);

    const session = await nlpEngine.getSession(psid);
    session.state = 'AWAITING_PAYMENT_PROOF';
    session.checkout_step = 'AWAITING_PAYMENT_PROOF';
    session.current_step = 'AWAITING_PAYMENT_PROOF';
    session.pendingGCashOrder = personalGcashService.buildPendingGcashOrder(session, {
      customerName: 'Troll Tester',
      contactNumber: '09170000001',
      deliveryAddress: 'Store Pickup',
      dining_mode: 'Pick-up',
      items: [{ menuItemId: sampleItem.id, name: sampleItem.name, price: Number(sampleItem.price), quantity: 1 }],
      grandTotal: Number(sampleItem.price)
    });
    await nlpEngine.saveSession(session);

    const fakeSelfie = [{ type: 'image', payload: { url: { text: 'Hello world no numbers here selfie photo' } } }];

    await nlpEngine.handleMessageEvent(psid, '', null, null, fakeSelfie);
    await nlpEngine.handleMessageEvent(psid, '', null, null, fakeSelfie);
    await nlpEngine.handleMessageEvent(psid, '', null, null, fakeSelfie);

    const updated = await nlpEngine.getSession(psid);
    assert.strictEqual(updated.pendingGCashOrder.failedAttempts, 3);
    assert.ok(updated.pendingGCashOrder.cooldownUntil > Date.now(), 'Cooldown must engage after 3 failures');

    // 4th attempt should be blocked immediately by cooldown even with text/image
    const blockedRes = await nlpEngine.handleMessageEvent(psid, 'Ref No 1009123456789');
    assert.strictEqual(blockedRes.intent, 'PAYMENT_PROOF_COOLDOWN');

    const [orders] = await db.query(
      `SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.psid = ?`,
      [psid]
    );
    assert.strictEqual(orders.length, 0, 'Zero orders created from spam/unreadable attempts');
  });

  await t.test('5. Underpaid and Duplicate GCash reference numbers are blocked cleanly with zero DB orders', async () => {
    const psidExisting = `PSID_EXISTING_REF_${Date.now()}`;
    const usedRef = `1009${String(Date.now()).slice(-9)}`;

    // Seed an existing order using `usedRef`
    await orderService.createOrder(psidExisting, {
      customerName: 'Prior Customer',
      customerPhone: '09171112222',
      deliveryAddress: 'Store Pickup',
      orderType: 'pickup',
      paymentMethod: 'gcash',
      referenceNo: usedRef,
      items: [{ menuItemId: sampleItem.id, quantity: 1 }],
      deliveryFee: 0,
      totalAmount: Number(sampleItem.price)
    });

    const psidAttacker = `PSID_DUP_ATTEMPT_${Date.now()}`;
    clearSent(psidAttacker);
    const session = await nlpEngine.getSession(psidAttacker);
    session.state = 'AWAITING_PAYMENT_PROOF';
    session.checkout_step = 'AWAITING_PAYMENT_PROOF';
    session.pendingGCashOrder = personalGcashService.buildPendingGcashOrder(session, {
      customerName: 'Scammer One',
      contactNumber: '09172223333',
      deliveryAddress: 'Store Pickup',
      dining_mode: 'Pick-up',
      items: [{ menuItemId: sampleItem.id, name: sampleItem.name, price: Number(sampleItem.price), quantity: 1 }],
      grandTotal: Number(sampleItem.price)
    });
    await nlpEngine.saveSession(session);

    // 5a. Underpaid receipt rejected
    const underpaidImg = [{
      type: 'image',
      payload: { url: { text: `GCash Express Send\nAmount Sent: PHP 10.00\nRef No. 1099 888 777666` } }
    }];
    const underRes = await nlpEngine.handleMessageEvent(psidAttacker, '', null, null, underpaidImg);
    assert.strictEqual(underRes.intent, 'PAYMENT_AMOUNT_MISMATCH');
    const sentMsgs = getSent(psidAttacker);
    assert.ok(sentMsgs.some(m => (m.messagePayload?.text || '').includes('Mas mababa')), 'Must warn customer about underpaid screenshot');

    // 5b. Duplicate reference rejected via text
    const dupRes = await nlpEngine.handleMessageEvent(psidAttacker, usedRef);
    assert.strictEqual(dupRes.intent, 'DUPLICATE_REFERENCE');

    const [attackerOrders] = await db.query(
      `SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.psid = ?`,
      [psidAttacker]
    );
    assert.strictEqual(attackerOrders.length, 0, 'Duplicate and underpaid attempts must NOT create any DB order');
  });

  await t.test('6. Unique receipt matched against admin_gcash_transactions creates PAID order and moves straight to preparing', async () => {
    const psid = `PSID_AUTO_MATCH_${Date.now()}`;
    clearSent(psid);

    const exactAmount = Number(sampleItem.price);
    const uniqueRef = `1008${String(Date.now()).slice(-9)}`;

    await db.query(
      `INSERT INTO admin_gcash_transactions (reference_number, amount, status) VALUES (?, ?, 'UNCLAIMED')`,
      [uniqueRef, exactAmount]
    );

    const session = await nlpEngine.getSession(psid);
    session.state = 'AWAITING_PAYMENT_PROOF';
    session.checkout_step = 'AWAITING_PAYMENT_PROOF';
    session.pendingGCashOrder = personalGcashService.buildPendingGcashOrder(session, {
      customerName: 'Real Payer',
      contactNumber: '09178889999',
      deliveryAddress: 'Store Pickup',
      dining_mode: 'Pick-up',
      items: [{ menuItemId: sampleItem.id, name: sampleItem.name, price: exactAmount, quantity: 1 }],
      grandTotal: exactAmount
    });
    await nlpEngine.saveSession(session);

    const validReceiptImg = [{
      type: 'image',
      payload: { url: { text: `GCash\nSuccessfully Sent\nAmount: PHP ${exactAmount.toFixed(2)}\nRef No. ${uniqueRef}` } }
    }];

    await nlpEngine.handleMessageEvent(psid, '', null, null, validReceiptImg);

    const [orders] = await db.query(
      `SELECT o.id, o.order_number, o.status, o.payment_status, o.gcash_ref
       FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.psid = ?`,
      [psid]
    );
    assert.strictEqual(orders.length, 1, 'Exactly 1 order must be created once valid proof matches');
    assert.strictEqual(orders[0].status, 'preparing', 'Matched GCash order must advance immediately to preparing');
    assert.strictEqual(orders[0].payment_status, 'Paid');
    assert.strictEqual(orders[0].gcash_ref, uniqueRef);

    const [ledger] = await db.query(
      `SELECT status FROM admin_gcash_transactions WHERE reference_number = ?`,
      [uniqueRef]
    );
    assert.strictEqual(ledger[0].status, 'MATCHED');
  });

  await t.test('7. gcashSmsWebhook parses GCash SMS text and auto-verifies matching Pending Verification order', async () => {
    const origToken = process.env.GCASH_SMS_WEBHOOK_TOKEN;
    process.env.GCASH_SMS_WEBHOOK_TOKEN = 'sms_secret_token_999';

    try {
      const psid = `PSID_SMS_VERIFY_${Date.now()}`;
      const smsRef = `1007${String(Date.now()).slice(-9)}`;
      const exactAmount = Number(sampleItem.price);

      const created = await orderService.createOrder(psid, {
        customerName: 'SMS Customer',
        customerPhone: '09173334444',
        deliveryAddress: 'Store Pickup',
        orderType: 'pickup',
        paymentMethod: 'gcash',
        paymentStatus: 'Pending Verification',
        referenceNo: smsRef,
        items: [{ menuItemId: sampleItem.id, quantity: 1 }],
        deliveryFee: 0,
        totalAmount: exactAmount
      });

      // Unauthorized call rejected with 401
      const badRes = createMockRes();
      await webhookController.gcashSmsWebhook({
        headers: { 'x-gcash-webhook-token': 'wrong' },
        body: { text: `You have received PHP ${exactAmount.toFixed(2)} Ref. No. ${smsRef}` }
      }, badRes);
      assert.strictEqual(badRes.statusCode, 401);

      // Authorized GCash SMS forwarder triggers auto-verify -> preparing
      const okRes = createMockRes();
      await webhookController.gcashSmsWebhook({
        headers: { 'x-gcash-webhook-token': 'sms_secret_token_999' },
        body: { text: `You have received PHP ${exactAmount.toFixed(2)} of GCash from JUAN D. Ref. No. ${smsRef}.` }
      }, okRes);
      assert.strictEqual(okRes.statusCode, 200);
      assert.strictEqual(okRes.body.success, true);
      assert.strictEqual(okRes.body.autoVerifiedOrder, created.orderNumber);

      const [orders] = await db.query('SELECT status, payment_status FROM orders WHERE id = ?', [created.orderId]);
      assert.strictEqual(orders[0].status, 'preparing');
      assert.strictEqual(orders[0].payment_status, 'Paid');
    } finally {
      if (origToken === undefined) delete process.env.GCASH_SMS_WEBHOOK_TOKEN;
      else process.env.GCASH_SMS_WEBHOOK_TOKEN = origToken;
    }
  });
});

