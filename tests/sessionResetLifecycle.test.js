const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const testDbPath = path.join(__dirname, 'test_session_reset.sqlite');
try { if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath); } catch (_) {}

process.env.DB_FORCE_SQLITE = '1';
process.env.SQLITE_PATH = testDbPath;
process.env.NODE_ENV = 'test';

const { initDatabase, query } = require('../database/db');
const {
  getSession,
  saveSession,
  resetUserSession,
  clearMemorySessions
} = require('../src/services/sessionManager');
const orderService = require('../src/services/orderService');
const messengerService = require('../src/services/messengerService');
const { handleMessageEvent } = require('../src/services/nlpEngine');

const sentMessages = [];
const origCallSendAPI = messengerService.callSendAPI;
messengerService.callSendAPI = async (psid, messagePayload) => {
  sentMessages.push({ psid, messagePayload });
  return { recipient_id: psid, message_id: `mid.test.${Date.now()}` };
};

function getSent(psid) {
  return sentMessages.filter(m => m.psid === psid);
}

function clearSent() {
  sentMessages.length = 0;
}

test('Automated Session Reset Lifecycle Suite', async (t) => {
  await initDatabase();
  await new Promise(r => setTimeout(r, 300));

  await t.test('1. resetUserSession(psid) clears all state, cart, transaction pointers, and persists across reload', async () => {
    const psid = `TEST_RESET_DIRECT_${Date.now()}`;
    const session = await getSession(psid);

    session.state = 'AWAITING_DRINK_ADDON';
    session.cart = [{ menuItemId: 1, name: 'Signature Spanish Latte', price: 145, quantity: 1 }];
    session.activeOrderNumber = 'DNR-20261112-9991';
    session.active_order_id = 9991;
    session.order_id = 9991;
    session.awaiting_field = 'delivery_address';
    session.temp_drink_id = 1;
    session.current_drink_item = { id: 1, name: 'Signature Spanish Latte' };
    session.pendingDrinkOrder = { id: 1 };
    session.pendingStage5 = { total: 145 };
    session.delivery_address = '123 Draft St, Manila';
    session.address = '123 Draft St, Manila';
    session.landmark = 'Near Church';
    session.quote = { fee: 49 };
    session.checkout = { total: 194 };
    await saveSession(session);

    await resetUserSession(psid);

    assert.strictEqual(session.state, 'IDLE');
    assert.strictEqual(session.current_step, 'IDLE');
    assert.deepStrictEqual(session.cart, []);
    assert.strictEqual(session.activeOrderNumber, null);
    assert.strictEqual(session.active_order_id, null);
    assert.strictEqual(session.order_id, null);
    assert.strictEqual(session.awaiting_field, null);
    assert.strictEqual(session.temp_drink_id, null);
    assert.strictEqual(session.current_drink_item, null);
    assert.strictEqual(session.pendingDrinkOrder, null);
    assert.strictEqual(session.pendingStage5, null);
    assert.strictEqual(session.delivery_address, null);
    assert.strictEqual(session.quote, null);
    assert.strictEqual(session.checkout, null);

    // Verify DB persistence across memory cache clear
    clearMemorySessions();
    const reloaded = await getSession(psid);
    assert.strictEqual(reloaded.state, 'IDLE');
    assert.deepStrictEqual(reloaded.cart, []);
    assert.strictEqual(reloaded.activeOrderNumber, null);
    assert.strictEqual(reloaded.awaiting_field, null);
    assert.strictEqual(reloaded.temp_drink_id, null);
    assert.strictEqual(reloaded.current_drink_item, null);
    assert.strictEqual(reloaded.delivery_address, null);
  });

  await t.test('2. Order DELIVERED sends feedback/completion prompt, resets session, and next inbound message starts fresh', async () => {
    const psid = `TEST_RESET_DELIV_${Date.now()}`;
    clearSent();

    const [menuRows] = await query('SELECT id, name, price FROM menu_items WHERE is_available = 1 LIMIT 1');
    const item = menuRows[0];

    const created = await orderService.createOrder(psid, {
      customerName: 'Delivered Guest',
      customerPhone: '09171234567',
      deliveryAddress: '100 Main St, Tondo, Manila',
      orderType: 'delivery',
      dining_mode: 'Delivery',
      paymentMethod: 'cash',
      items: [{ menuItemId: item.id, name: item.name, quantity: 1, unitPrice: item.price }],
      deliveryFee: 49,
      totalAmount: item.price + 49
    });

    // Populate leftover draft state on the customer's session
    const session = await getSession(psid);
    session.state = 'AWAITING_DRINK_ADDON';
    session.cart = [{ menuItemId: item.id, name: item.name, price: item.price, quantity: 2 }];
    session.activeOrderNumber = created.orderNumber;
    session.active_order_id = created.orderId;
    session.awaiting_field = 'note';
    session.temp_drink_id = item.id;
    session.current_drink_item = { id: item.id, name: item.name };
    session.delivery_address = '100 Main St, Tondo, Manila';
    await saveSession(session);

    await orderService.updateOrderStatus(created.orderId, 'delivered');

    // Verify delivery prompt/rating sent
    const msgsAfterDeliver = getSent(psid);
    assert.ok(msgsAfterDeliver.length >= 1, 'Delivery completion or rating prompt must be sent');

    // Verify session was reset immediately
    const resetSess = await getSession(psid);
    assert.strictEqual(resetSess.state, 'IDLE');
    assert.deepStrictEqual(resetSess.cart, []);
    assert.strictEqual(resetSess.activeOrderNumber, null);
    assert.strictEqual(resetSess.active_order_id, null);
    assert.strictEqual(resetSess.awaiting_field, null);
    assert.strictEqual(resetSess.temp_drink_id, null);
    assert.strictEqual(resetSess.current_drink_item, null);
    assert.strictEqual(resetSess.delivery_address, null);

    // Next inbound greeting should start fresh from root intent (greeting / menu), NOT AWAITING_DRINK_ADDON
    clearSent();
    const res = await handleMessageEvent(psid, 'Hello');
    assert.ok(res && res.intent !== 'SELECT_ADDON', 'Next message must start fresh, not stuck in leftover add-on state');
    const greetMsgs = getSent(psid);
    assert.ok(greetMsgs.length >= 1, 'Bot must welcome customer fresh');
  });

  await t.test('3. Order CANCELLED (admin void) notifies customer, resets session, and next inbound starts fresh', async () => {
    const psid = `TEST_RESET_CANCEL_ADMIN_${Date.now()}`;
    clearSent();

    const [menuRows] = await query('SELECT id, name, price FROM menu_items WHERE is_available = 1 LIMIT 1');
    const item = menuRows[0];

    const created = await orderService.createOrder(psid, {
      customerName: 'Voided Guest',
      customerPhone: '09181234567',
      deliveryAddress: 'Store Counter Pickup',
      orderType: 'pickup',
      dining_mode: 'Pick-up',
      paymentMethod: 'cash',
      items: [{ menuItemId: item.id, name: item.name, quantity: 1, unitPrice: item.price }],
      deliveryFee: 0,
      totalAmount: item.price
    });

    const session = await getSession(psid);
    session.state = 'AWAITING_PAYMENT_PROOF';
    session.cart = [{ menuItemId: item.id, name: item.name, price: item.price, quantity: 1 }];
    session.activeOrderNumber = created.orderNumber;
    session.active_order_id = created.orderId;
    session.delivery_address = 'Draft Address';
    session.pendingStage5 = { total: item.price };
    await saveSession(session);

    await orderService.updateOrderStatus(created.orderId, 'cancelled', {
      cancellationReason: 'Item out of stock'
    });

    const msgs = getSent(psid);
    assert.ok(
      msgs.some(m => (m.messagePayload?.text || '').includes('na-cancel')),
      'Cancellation notification must be sent to customer'
    );

    const resetSess = await getSession(psid);
    assert.strictEqual(resetSess.state, 'IDLE');
    assert.deepStrictEqual(resetSess.cart, []);
    assert.strictEqual(resetSess.activeOrderNumber, null);
    assert.strictEqual(resetSess.active_order_id, null);
    assert.strictEqual(resetSess.pendingStage5, null);
    assert.strictEqual(resetSess.delivery_address, null);

    // Next inbound greeting welcomes customer cleanly
    clearSent();
    await handleMessageEvent(psid, 'Hi');
    const nextMsgs = getSent(psid);
    assert.ok(nextMsgs.length >= 1, 'Bot must respond with fresh welcome/menu prompt');
  });

  t.after(() => {
    messengerService.callSendAPI = origCallSendAPI;
    try { if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath); } catch (_) {}
  });
});
