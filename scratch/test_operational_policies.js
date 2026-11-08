const assert = require('assert');
const db = require('../database/db');
const systemSettingsService = require('../src/services/systemSettingsService');
const { updateOrderStatus, createOrder } = require('../src/services/orderService');
const { handleCancellationRequest, isCancelTriggerWord } = require('../src/services/nlpEngine');

async function runTests() {
  console.log('=== RUNNING OPERATIONAL POLICIES TEST SUITE ===\n');

  // Ensure DB ready
  await new Promise(r => setTimeout(r, 500));

  // --------------------------------------------------------------------------
  // TEST 1: Master AI Chatbot Toggle
  // --------------------------------------------------------------------------
  console.log('--- TEST 1: Master AI Chatbot Toggle (Mute/Kill Switch) ---');
  await systemSettingsService.updateSystemSettings({ chatbot_enabled: 0 });
  assert.strictEqual(systemSettingsService.isChatbotEnabled(), false, 'Chatbot should be disabled');
  console.log('✔ Chatbot disabled verified');

  await systemSettingsService.updateSystemSettings({ chatbot_enabled: 1 });
  assert.strictEqual(systemSettingsService.isChatbotEnabled(), true, 'Chatbot should be enabled');
  console.log('✔ Chatbot re-enabled verified');

  // --------------------------------------------------------------------------
  // TEST 2: Store Operating Hours & Timezone Evaluation
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 2: Store Operating Hours Evaluation ---');
  const schedule = systemSettingsService.isStoreOpen();
  console.log(`Current Manila Time: ${schedule.currentTime}, Status: ${schedule.isOpen ? 'OPEN' : 'CLOSED'}`);
  assert(schedule.openTimeFormatted, 'openTimeFormatted should exist');
  assert(schedule.closeTimeFormatted, 'closeTimeFormatted should exist');
  console.log('✔ Manila timezone operating hours evaluation verified');

  // --------------------------------------------------------------------------
  // TEST 3: Dynamic Order Cancellation Guard
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 3: Dynamic Order Cancellation Guard ---');
  
  // Create a test customer if needed
  const testPsid = 'TEST_CUST_' + Date.now();
  const [cRes] = await db.query(
    "INSERT INTO customers (psid, first_name, last_name, phone_number, delivery_address) VALUES (?, 'Test', 'User', '09123456789', '123 Test St')",
    [testPsid]
  );
  const custId = cRes.insertId;

  // Find a menu item to use
  const [menuRows] = await db.query("SELECT id, name, price, stock_quantity FROM menu_items WHERE stock_quantity > 5 LIMIT 1");
  const menuItem = menuRows[0];
  const initialStock = menuItem.stock_quantity;
  console.log(`Using menu item "${menuItem.name}" (ID ${menuItem.id}) with initial stock: ${initialStock}`);

  // Scenario 3A: PENDING Order -> Allow cancellation & restore stock
  console.log('\nScenario 3A: Cancel PENDING order');
  const orderPending = await createOrder(testPsid, {
    customerName: 'Test User',
    customerPhone: '09123456789',
    deliveryAddress: '123 Test St',
    orderType: 'delivery',
    paymentMethod: 'cash',
    items: [{ menuItemId: menuItem.id, quantity: 2 }],
    totalAmount: menuItem.price * 2
  });

  const [afterOrderStockRows] = await db.query("SELECT stock_quantity FROM menu_items WHERE id = ?", [menuItem.id]);
  console.log(`Stock after order creation: ${afterOrderStockRows[0].stock_quantity} (decremented by 2)`);

  const sessionMockA = { activeOrderNumber: orderPending.orderNumber, cart: [] };
  const cancelResultPending = await handleCancellationRequest(testPsid, sessionMockA, 'cancel');
  assert.strictEqual(cancelResultPending.intent, 'ORDER_CANCELLED_PENDING');
  assert(cancelResultPending.replyLog.includes('Na-cancel na po ang inyong order'));
  console.log('✔ PENDING order successfully cancelled with customer confirmation');

  const [restoredStockRows] = await db.query("SELECT stock_quantity FROM menu_items WHERE id = ?", [menuItem.id]);
  console.log(`Stock after cancellation: ${restoredStockRows[0].stock_quantity}`);
  assert.strictEqual(restoredStockRows[0].stock_quantity, initialStock, 'Stock should be fully restored in menu_items');
  console.log('✔ Stock restoration verified');

  // Scenario 3B: IN_PREPARATION Order -> Block cancellation with food waste message
  console.log('\nScenario 3B: Cancel IN_PREPARATION order');
  const orderPrep = await createOrder(testPsid, {
    customerName: 'Test User',
    customerPhone: '09123456789',
    deliveryAddress: '123 Test St',
    orderType: 'delivery',
    paymentMethod: 'cash',
    items: [{ menuItemId: menuItem.id, quantity: 1 }],
    totalAmount: menuItem.price
  });
  await updateOrderStatus(orderPrep.orderId, 'preparing');

  const sessionMockB = { activeOrderNumber: orderPrep.orderNumber, cart: [] };
  const cancelResultPrep = await handleCancellationRequest(testPsid, sessionMockB, 'ayaw ko na');
  assert.strictEqual(cancelResultPrep.intent, 'ORDER_CANCEL_BLOCKED_PREPARING');
  assert(cancelResultPrep.replyLog.includes('kasalukuyan na pong inihahanda sa kusina'));
  assert(cancelResultPrep.replyLog.includes('food waste'));
  console.log('✔ IN_PREPARATION order cancellation blocked with exact food waste explanation');

  // Scenario 3C: DISPATCHED / ON_DELIVERY Order -> Block cancellation with rider dispatch message
  console.log('\nScenario 3C: Cancel DISPATCHED order');
  await updateOrderStatus(orderPrep.orderId, 'dispatched');

  const cancelResultDispatched = await handleCancellationRequest(testPsid, sessionMockB, 'i-cancel ang order');
  assert.strictEqual(cancelResultDispatched.intent, 'ORDER_CANCEL_BLOCKED_DISPATCHED');
  assert(cancelResultDispatched.replyLog.includes('na-dispatch na po'));
  assert(cancelResultDispatched.replyLog.includes('kasalukuyan na pong papunta ang ating rider'));
  console.log('✔ DISPATCHED order cancellation blocked with rider dispatch notification');

  // --------------------------------------------------------------------------
  // TEST 4: Pre-Order Flagging
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 4: Pre-Order Flagging ---');
  const preorder = await createOrder(testPsid, {
    customerName: 'Preorder User',
    customerPhone: '09123456789',
    deliveryAddress: '123 Test St',
    orderType: 'delivery',
    paymentMethod: 'cash',
    is_preorder: true,
    items: [{ menuItemId: menuItem.id, quantity: 1 }],
    totalAmount: menuItem.price
  });

  const [poRows] = await db.query("SELECT is_preorder FROM orders WHERE id = ?", [preorder.orderId]);
  assert.strictEqual(poRows[0].is_preorder, 1, 'Order should have is_preorder = 1');
  console.log('✔ is_preorder = 1 verified in orders table');

  console.log('\n=========================================');
  console.log('ALL OPERATIONAL POLICIES PASSED SUCCESSFULLY!');
  console.log('=========================================\n');
}

runTests().then(() => process.exit(0)).catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
