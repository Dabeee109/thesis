/**
 * Verification test for:
 * 1. Phone number data synchronization (Chat Receipt ⇄ DB ⇄ Admin Modal)
 * 2. Pre-menu active promotion/event hook
 * 3. Conditional silent cancellation (test/duplicate orders) vs standard customer notification
 */
const assert = require('assert');
const db = require('../database/db');
const orderService = require('../src/services/orderService');
const nlpEngine = require('../src/services/nlpEngine');
const messengerService = require('../src/services/messengerService');

async function runTests() {
  console.log('=== STARTING VERIFICATION TESTS ===\n');

  // -------------------------------------------------------------
  // Test 1: Phone Number Data Synchronization
  // -------------------------------------------------------------
  console.log('[Test 1] Testing Phone Number Data Synchronization...');
  const testPsid = 'TEST_USER_PHONE_SYNC_' + Date.now();
  const testPhone = '09987654321';
  const testName = 'Juan Synchronized';

  const orderResult = await orderService.createOrder(testPsid, {
    customerName: testName,
    customerPhone: testPhone,
    deliveryAddress: "123 Diner's Blvd, Mandaluyong City",
    orderType: 'delivery',
    paymentMethod: 'cash',
    amountPaid: 0,
    items: [{ menuItemId: 13, quantity: 2, unitPrice: 26 }],
    deliveryFee: 50,
    totalAmount: 102
  });

  const orderId = orderResult.orderId;
  const orderNumber = orderResult.orderNumber;
  console.log(` Created test order ID=${orderId}, OrderNumber=${orderNumber}`);

  // Check DB directly
  const [dbRows] = await db.query('SELECT id, customer_phone, customer_id FROM orders WHERE id = ?', [orderId]);
  assert.strictEqual(dbRows.length, 1, 'Order must exist in database');
  assert.strictEqual(dbRows[0].customer_phone, testPhone, 'orders.customer_phone must match supplied phone number');
  console.log(` -> Verified orders.customer_phone in DB: "${dbRows[0].customer_phone}" == "${testPhone}"`);

  // Check customer table phone number
  const [custRows] = await db.query('SELECT phone_number FROM customers WHERE id = ?', [dbRows[0].customer_id]);
  assert.strictEqual(custRows[0].phone_number, testPhone, 'customers.phone_number must also be synchronized');
  console.log(` -> Verified customers.phone_number in DB: "${custRows[0].phone_number}" == "${testPhone}"`);

  // Check getOrderDetails (what Admin Modal fetches)
  const orderDetails = await orderService.getOrderDetails(orderId);
  assert.strictEqual(orderDetails.customer_phone, testPhone, 'getOrderDetails must return customer_phone correctly');
  assert.notStrictEqual(orderDetails.customer_phone, '09170000000', 'Must not be dummy fallback 09170000000');
  console.log(` -> Verified getOrderDetails for Admin Modal: "${orderDetails.customer_phone}" == "${testPhone}"`);
  console.log('✔ Test 1 Passed: Phone Number Parity 100% Verified.\n');

  // -------------------------------------------------------------
  // Test 2: Pre-Menu Active Promotion / Event Hook
  // -------------------------------------------------------------
  console.log('[Test 2] Testing Pre-Menu Active Promotion / Event Hook...');

  const capturedCalls = [];
  const origCallSendAPI = messengerService.callSendAPI;
  messengerService.callSendAPI = async (recipientPsid, messagePayload, options = {}) => {
    capturedCalls.push({ psid: recipientPsid, payload: messagePayload });
    return { recipient_id: recipientPsid, message_id: 'mid.mock' };
  };

  try {
    // 2a: When an active promotion exists
    const today = new Date().toISOString().split('T')[0];
    const [promoInsert] = await db.query(`
      INSERT INTO promotions (title, description, perk_description, promo_type, start_date, end_date, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `, ['Test Promo 50% OFF', 'Special 50% off', '50% OFF cold brews', 'discount', today, today]);
    const promoId = promoInsert.insertId || promoInsert.lastID;

    const sessionMock = {
      dining_mode: 'Dine In',
      cart: [],
      state: 'IDLE'
    };

    capturedCalls.length = 0;
    await nlpEngine.sendFullMenu('MOCK_PSID_PROMO_TEST', sessionMock);

    const teaserFound = capturedCalls.some(m => 
      m.payload?.text &&
      m.payload.text.includes('📢 SPECIAL EVENT ANNOUNCEMENT!')
    );
    assert.strictEqual(teaserFound, true, 'Announcement message must be sent before menu when active promo exists');
    console.log(' -> Verified announcement message dispatched when active promo exists.');

    // Clean up test promo
    await db.query('DELETE FROM promotions WHERE id = ?', [promoId]);

    // 2b: When no active promotions exist
    capturedCalls.length = 0;
    // temporarily deactivate all promos
    await db.query('UPDATE promotions SET is_active = 0');

    await nlpEngine.sendFullMenu('MOCK_PSID_NO_PROMO_TEST', sessionMock);
    const teaserWhenNone = capturedCalls.some(m => m.payload?.text && m.payload.text.includes('📢 SPECIAL EVENT ANNOUNCEMENT!'));
    assert.strictEqual(teaserWhenNone, false, 'No announcement should be sent if there are no active promos');
    console.log(' -> Verified NO announcement is sent when no promos are active.');

    // Reactivate previously active promos
    await db.query('UPDATE promotions SET is_active = 1 WHERE end_date >= ? OR end_date IS NULL', [today]);
    console.log('✔ Test 2 Passed: Pre-Menu Promo Hook Verified.\n');
  } finally {
    messengerService.callSendAPI = origCallSendAPI;
  }

  // -------------------------------------------------------------
  // Test 3: Silent Cancellation vs Standard Customer Notification
  // -------------------------------------------------------------
  console.log('[Test 3] Testing Conditional Silent Order Cancellation...');

  const interceptedCancelCalls = [];
  messengerService.callSendAPI = async (recipientPsid, messagePayload, options = {}) => {
    interceptedCancelCalls.push({ psid: recipientPsid, payload: messagePayload });
    return { recipient_id: recipientPsid, message_id: 'mid.mock' };
  };

  try {
    // 3a. Test Silent Cancellation for "Test Order"
    interceptedCancelCalls.length = 0;
    const res1 = await orderService.updateOrderStatus(orderId, 'cancelled', { cancellationReason: 'Test Order' });
    assert.strictEqual(res1.newStatus, 'cancelled');
    assert.strictEqual(interceptedCancelCalls.length, 0, 'Meta Send API must NOT be called for "Test Order" (Silent)');
    console.log(' -> Verified "Test Order" was cancelled silently without customer message.');

    // Reset status to pending for next test
    await db.query("UPDATE orders SET status = 'pending', cancellation_reason = NULL WHERE id = ?", [orderId]);

    // 3b. Test Silent Cancellation for "Duplicate Order"
    interceptedCancelCalls.length = 0;
    const res2 = await orderService.updateOrderStatus(orderId, 'cancelled', { cancellationReason: 'Duplicate order by customer' });
    assert.strictEqual(res2.newStatus, 'cancelled');
    assert.strictEqual(interceptedCancelCalls.length, 0, 'Meta Send API must NOT be called for "Duplicate order" (Silent)');
    console.log(' -> Verified "Duplicate Order" was cancelled silently without customer message.');

    // Reset status to pending for next test
    await db.query("UPDATE orders SET status = 'pending', cancellation_reason = NULL WHERE id = ?", [orderId]);

    // 3c. Test Standard Cancellation for "Out of Stock"
    interceptedCancelCalls.length = 0;
    const reasonStandard = 'Out of Stock';
    const res3 = await orderService.updateOrderStatus(orderId, 'cancelled', { cancellationReason: reasonStandard });
    assert.strictEqual(res3.newStatus, 'cancelled');
    assert.strictEqual(interceptedCancelCalls.length, 1, 'Customer MUST be notified on Messenger for valid cancellation');
    const expectedMsg = `Paumanhin po, ang inyong Order #${orderNumber} ay na-cancel dahil sa sumusunod na dahilan: ${reasonStandard}.`;
    assert.strictEqual(interceptedCancelCalls[0].payload.text, expectedMsg, 'Cancellation message text must match format');
    console.log(` -> Verified customer notified for "${reasonStandard}": "${interceptedCancelCalls[0].payload.text}"`);

    console.log('✔ Test 3 Passed: Conditional Silent Cancellation Verified.\n');
  } finally {
    messengerService.callSendAPI = origCallSendAPI;
    // Clean up test order
    await db.query('DELETE FROM order_items WHERE order_id = ?', [orderId]);
    await db.query('DELETE FROM orders WHERE id = ?', [orderId]);
  }

  console.log('=== ALL TESTS PASSED SUCCESSFULLY! ===');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
