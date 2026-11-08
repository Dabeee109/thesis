const assert = require('assert');
const messengerService = require('../src/services/messengerService');
const { handleMessageEvent } = require('../src/services/nlpEngine');
const { getSession, saveSession } = require('../src/services/sessionManager');
const orderService = require('../src/services/orderService');
const deliveryController = require('../src/controllers/deliveryController');
const db = require('../database/db');

const sentMessages = [];
messengerService.callSendAPI = async (psid, messagePayload, options) => {
  sentMessages.push({ psid, messagePayload, options });
  return { recipient_id: psid, message_id: `mid.${Date.now()}` };
};

async function runTests() {
  console.log('--- STARTING DISCOUNT STEP, ORDER SUMMARY & RIDER GATE TESTS ---');

  // TEST 1: Sequential Discount Step & Order Summary (Case A: Senior/PWD with ID)
  console.log('\n[Test 1] Testing Sequential Discount Step - Case A (With ID)...');
  const psid1 = `TEST_DISC_YES_${Date.now()}`;
  const session1 = await getSession(psid1);
  session1.dining_mode = 'Delivery';
  session1.orderType = 'delivery';
  session1.cart = [
    { menuItemId: 1, id: 1, name: 'Signature Spanish Latte', price: 145, quantity: 1 }
  ];
  session1.state = 'COLLECTING_CUSTOMER_INFO';
  await saveSession(session1);

  sentMessages.length = 0;
  const details1 = `Name: Maria Clara\nPhone number: 09171234567\nAddress: 123 Rizal St, Manila\nPayment mode: Cash`;
  await handleMessageEvent(psid1, details1);

  // Assert transitioned to AWAITING_DISCOUNT_CONFIRMATION
  assert.strictEqual(session1.state, 'AWAITING_DISCOUNT_CONFIRMATION', 'State must be AWAITING_DISCOUNT_CONFIRMATION');
  const discountPrompt = sentMessages[sentMessages.length - 1]?.messagePayload?.text || '';
  assert.ok(discountPrompt.includes('Mayroon po ba kayong Senior Citizen o PWD ID'), 'Must ask for Senior/PWD ID');
  console.log('✓ Step 1 Passed: Details collected & transitioned to AWAITING_DISCOUNT_CONFIRMATION');

  // User says "Mayroon po"
  sentMessages.length = 0;
  await handleMessageEvent(psid1, 'Mayroon po, Senior Citizen');
  assert.strictEqual(session1.state, 'AWAITING_DISCOUNT_PROOF', 'State must transition to AWAITING_DISCOUNT_PROOF');
  const proofPrompt = sentMessages[sentMessages.length - 1]?.messagePayload?.text || '';
  assert.ok(proofPrompt.includes('Paki-send po ang picture ng inyong Senior Citizen o PWD ID o i-type ang inyong ID Number'), 'Must ask for ID picture/number');
  console.log('✓ Step 2 Passed: Transitioned to AWAITING_DISCOUNT_PROOF');

  // User provides ID number
  sentMessages.length = 0;
  await handleMessageEvent(psid1, 'SC-ID-123456');

  // Assert 20% discount computed: 145 * 0.20 = 29.00
  assert.strictEqual(session1.discount?.applied, true, 'Discount must be applied');
  assert.strictEqual(session1.discount_amount, 29, 'Discount amount must be 29.00');

  // Assert Order Summary sent in exact format
  const summaryMsg1 = sentMessages.find(m => m.messagePayload?.text?.includes('--- ORDER SUMMARY ---'));
  assert.ok(summaryMsg1, 'Order Summary must be sent');
  const text1 = summaryMsg1.messagePayload.text;
  assert.ok(text1.includes('Name: Maria Clara'), 'Must include customer name');
  assert.ok(text1.includes('Phone number: 09171234567'), 'Must include phone number');
  assert.ok(text1.includes('Dining-mode: Delivery'), 'Must include Dining-mode: Delivery');
  assert.ok(text1.includes('Address: 123 Rizal St, Manila'), 'Must include Address');
  assert.ok(text1.includes('Discount: Senior Citizen / PWD 20%'), 'Must include Discount: Senior Citizen / PWD 20%');
  assert.ok(text1.includes('Payment Mode: Cash'), 'Must include Payment Mode: Cash');
  assert.ok(text1.includes('- 1x Signature Spanish Latte (₱145.00)'), 'Must include line item with (₱145.00)');
  assert.ok(text1.includes('Subtotal: ₱145.00'), 'Must include Subtotal: ₱145.00');
  assert.ok(text1.includes('Discount: ₱29.00'), 'Must include Discount: ₱29.00');
  assert.ok(text1.includes('TOTAL AMOUNT DUE: ₱166.00'), 'Must include TOTAL AMOUNT DUE: ₱166.00 (145 - 29 + 50 = 166.00)');
  console.log('✓ Step 3 Passed: Case A Order Summary formatted and computed with 20% discount');

  // TEST 2: Sequential Discount Step (Case B: No discount)
  console.log('\n[Test 2] Testing Sequential Discount Step - Case B (No Discount)...');
  const psid2 = `TEST_DISC_NO_${Date.now()}`;
  const session2 = await getSession(psid2);
  session2.dining_mode = 'Pick-up';
  session2.orderType = 'pickup';
  session2.cart = [
    { menuItemId: 1, id: 1, name: 'Signature Spanish Latte', price: 145, quantity: 2 }
  ];
  session2.state = 'COLLECTING_CUSTOMER_INFO';
  await saveSession(session2);

  sentMessages.length = 0;
  const details2 = `Name: Andres Bonifacio\nPhone number: 09189876543\nAddress: Store Counter\nPayment mode: Cash`;
  await handleMessageEvent(psid2, details2);
  assert.strictEqual(session2.state, 'AWAITING_DISCOUNT_CONFIRMATION');

  // User says "Wala po"
  sentMessages.length = 0;
  await handleMessageEvent(psid2, 'Wala po');
  assert.strictEqual(session2.discount?.applied, false, 'Discount must not be applied');
  assert.strictEqual(session2.discount_amount, 0, 'Discount amount must be 0');

  const summaryMsg2 = sentMessages.find(m => m.messagePayload?.text?.includes('--- ORDER SUMMARY ---'));
  assert.ok(summaryMsg2, 'Order Summary must be sent');
  const text2 = summaryMsg2.messagePayload.text;
  assert.ok(text2.includes('Discount: None'), 'Discount line must be Discount: None');
  assert.ok(text2.includes('Discount: ₱0.00'), 'Discount amount must be ₱0.00');
  assert.ok(text2.includes('TOTAL AMOUNT DUE: ₱290.00'), 'TOTAL AMOUNT DUE must be ₱290.00 (2x145)');
  console.log('✓ Test 2 Passed: Case B (No discount) proceeds directly to Order Summary');

  // TEST 3: Rider Active Queue Query & Delivery Completion Gatekeeping
  console.log('\n[Test 3] Testing Rider Active Queue & Completion Gatekeeping...');
  
  // Create test order in DB
  const testOrder = await orderService.createOrder('TEST_RIDER_PSID', {
    customerName: 'Test Rider Customer',
    customerPhone: '09123456789',
    deliveryAddress: '456 Test Ave, Manila',
    orderType: 'delivery',
    paymentMethod: 'cash',
    amountPaid: 0,
    items: [{ menuItemId: 1, quantity: 1 }],
    deliveryFee: 50,
    totalAmount: 195
  });

  const orderId = testOrder.orderId || testOrder.id;

  // Set order status to 'preparing' (In Kitchen Preparation)
  await orderService.updateOrderStatus(orderId, 'preparing');

  // Query active queue
  let mockResJson = null;
  const mockRes = {
    json: (data) => { mockResJson = data; return mockRes; },
    status: function(code) { this.statusCode = code; return this; }
  };

  await deliveryController.getActiveRiderOrders({ query: {} }, mockRes);
  assert.ok(mockResJson && mockResJson.success, 'Active queue query should succeed');
  const foundInQueue = mockResJson.orders.find(o => o.order_id === orderId);
  assert.ok(foundInQueue, 'Order in kitchen preparation must be visible in active queue');
  assert.strictEqual(foundInQueue.order_status, 'In Kitchen Preparation', 'Status must be In Kitchen Preparation');
  console.log('✓ Test 3A Passed: Order in kitchen preparation is visible in rider active queue');

  // Attempt to complete delivery while still in kitchen preparation -> Expect 403 Forbidden
  let gateResCode = null;
  let gateResJson = null;
  const gateRes = {
    status: function(code) { gateResCode = code; return this; },
    json: function(data) { gateResJson = data; return this; }
  };

  await deliveryController.completeRiderDelivery({ params: { id: orderId }, body: {}, user: { role: 'rider' } }, gateRes);
  assert.strictEqual(gateResCode, 403, 'Must return HTTP 403 when completing while in kitchen preparation');
  assert.ok(gateResJson.message.includes('Cannot complete delivery while order is still in kitchen preparation'), 'Must return kitchen prep warning message');
  console.log('✓ Test 3B Passed: Delivery completion rejected with HTTP 403 when order is in kitchen preparation');

  // Now dispatch the order (Dispatched / On Delivery)
  await orderService.updateOrderStatus(orderId, 'dispatched');

  // Query active queue again -> Status should be Dispatched / On Delivery
  mockResJson = null;
  await deliveryController.getActiveRiderOrders({ query: {} }, mockRes);
  const foundDispatched = mockResJson.orders.find(o => o.order_id === orderId);
  assert.strictEqual(foundDispatched.order_status, 'Dispatched / On Delivery', 'Status must be Dispatched / On Delivery');
  console.log('✓ Test 3C Passed: Dispatched order visible in active queue');

  // Now complete delivery on dispatched order -> Expect 200 OK
  gateResCode = null;
  gateResJson = null;
  await deliveryController.completeRiderDelivery({ params: { id: orderId }, body: {}, user: { role: 'rider' } }, gateRes);
  assert.strictEqual(gateResJson.success, true, 'Delivery completion must succeed for dispatched order');
  assert.ok(gateResJson.message.includes('Customer feedback gate unlocked'), 'Must unlock customer feedback gate');
  console.log('✓ Test 3D Passed: Delivery completed and customer feedback gate unlocked');

  console.log('\n🎉 ALL DISCOUNT STEP, ORDER SUMMARY & RIDER GATE TESTS PASSED SUCCESSFULLY!');
}

runTests().then(() => process.exit(0)).catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

