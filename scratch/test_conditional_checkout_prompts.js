const assert = require('assert');
const {
  STORE_ADDRESS,
  getStoreAddress,
  getCheckoutInfoPrompt,
  parseCustomerInfo,
  formatPlaintextOrderSummary,
  handleMessageEvent
} = require('../src/services/nlpEngine');
const { getSession, saveSession } = require('../src/services/sessionManager');
const messengerService = require('../src/services/messengerService');

const sentMessages = [];
messengerService.callSendAPI = async (psid, messagePayload, options) => {
  sentMessages.push({ psid, messagePayload, options });
  return { recipient_id: psid, message_id: `mid.${Date.now()}` };
};

async function runTests() {
  console.log('--- STARTING CONDITIONAL CHECKOUT & ORDER SUMMARY TESTS ---');

  // Test 1: getCheckoutInfoPrompt for Delivery vs Dine In / Pick-up
  console.log('\n[Test 1] Testing getCheckoutInfoPrompt logic...');
  const deliveryPrompt = getCheckoutInfoPrompt({ dining_mode: 'Delivery' });
  const expectedDeliveryPrompt = `Pakibigay po ang sumusunod para sa inyong order:
Name:
Phone number:
Address:
Payment mode: (Cash or GCash)`;
  assert.strictEqual(deliveryPrompt, expectedDeliveryPrompt, 'Delivery prompt must contain all 4 fields including Address');

  const dineInPrompt = getCheckoutInfoPrompt({ dining_mode: 'Dine In' });
  const expectedDineInPrompt = `Pakibigay po ang sumusunod para sa inyong order:
Name:
Phone number:
Payment mode: (Cash or GCash)`;
  assert.strictEqual(dineInPrompt, expectedDineInPrompt, 'Dine In prompt must contain 3 fields omitting Address');

  const pickupPrompt = getCheckoutInfoPrompt({ dining_mode: 'Pick-up' });
  assert.strictEqual(pickupPrompt, expectedDineInPrompt, 'Pick-up prompt must contain 3 fields omitting Address');
  console.log('✓ Test 1 Passed: Conditional prompts correctly return 4 fields for Delivery and 3 for Dine In / Pick-up.');

  // Test 2: Slot-filling parser parseCustomerInfo with 3 fields for Dine In / Pick-up
  console.log('\n[Test 2] Testing parseCustomerInfo slot-filling for Dine In / Pick-up...');
  const dineInInput = `Name: Juan Dela Cruz
Phone number: 09171234567
Payment mode: Cash`;
  const parsedDineIn = parseCustomerInfo(dineInInput, 'Dine In');
  assert.strictEqual(parsedDineIn.name, 'Juan Dela Cruz');
  assert.strictEqual(parsedDineIn.contact, '09171234567');
  assert.strictEqual(parsedDineIn.paymentMode, 'Cash');
  assert.strictEqual(parsedDineIn.address, '', 'Address should not be filled from text if not provided');
  console.log('✓ Test 2 Passed: 3-field customer info parsed accurately without forcing whole text into address.');

  // Test 3: End-to-end Dine In Checkout Flow
  console.log('\n[Test 3] Testing End-to-End Dine In Checkout & Backend Auto-Assignment of STORE_ADDRESS...');
  const testPsidDineIn = 'TEST_DINE_IN_' + Date.now();
  const sessionDineIn = await getSession(testPsidDineIn);
  sessionDineIn.dining_mode = 'Dine In';
  sessionDineIn.cart = [{ menuItemId: 1, name: 'Signature Spanish Latte', price: 145, quantity: 1 }];
  sessionDineIn.state = 'ORDERING';
  await saveSession(sessionDineIn);

  sentMessages.length = 0;
  // Customer initiates checkout
  await handleMessageEvent(testPsidDineIn, 'check out na po');
  const promptMsgDineIn = sentMessages[sentMessages.length - 1]?.messagePayload?.text || '';
  assert.strictEqual(promptMsgDineIn, expectedDineInPrompt, 'Prompt must omit address for Dine In');
  console.log('  -> Received exact 3-field prompt on checkout');

  // Customer provides 3 details (no address)
  sentMessages.length = 0;
  await handleMessageEvent(testPsidDineIn, dineInInput);

  // Verify session auto-assigned STORE_ADDRESS
  const sessionAfterDetails = await getSession(testPsidDineIn);
  const currentStoreAddress = (typeof getStoreAddress === 'function') ? getStoreAddress() : STORE_ADDRESS;
  assert.strictEqual(sessionAfterDetails.address, currentStoreAddress, 'session.address must be dynamic store address');
  assert.strictEqual(sessionAfterDetails.delivery_address, currentStoreAddress, 'session.delivery_address must be dynamic store address');
  assert.strictEqual(sessionAfterDetails.customer_name, 'Juan Dela Cruz');
  assert.strictEqual(sessionAfterDetails.contact_number, '09171234567');
  assert.strictEqual(sessionAfterDetails.payment_mode, 'Cash');
  assert.strictEqual(sessionAfterDetails.state, 'AWAITING_DISCOUNT_CONFIRMATION');
  console.log('  -> Auto-assigned STORE_ADDRESS:', sessionAfterDetails.address);

  // Customer declines discount ("Wala po") -> triggers final order summary receipt
  sentMessages.length = 0;
  await handleMessageEvent(testPsidDineIn, 'wala po');
  
  // Check that Order Summary was sent
  const summaryMsg = sentMessages.find(m => m.messagePayload?.text && m.messagePayload.text.includes('--- ORDER SUMMARY ---'));
  assert.ok(summaryMsg, 'Order summary must be generated and sent');
  console.log('\nGenerated Order Summary (Dine In):\n' + summaryMsg.messagePayload.text);

  assert.ok(summaryMsg.messagePayload.text.includes('Dining-mode: Dine In'), 'Must state Dining-mode: Dine In');
  assert.ok(summaryMsg.messagePayload.text.includes(`Address: ${currentStoreAddress}`), 'Address must display currentStoreAddress');
  assert.ok(summaryMsg.messagePayload.text.includes('Delivery Fee: ₱0.00'), 'Delivery fee must be ₱0.00 for Dine In');
  console.log('✓ Test 3 Passed: Dine In checkout successfully auto-assigned STORE_ADDRESS and formatted summary correctly.');

  // Test 4: End-to-End Pick-up Checkout Flow
  console.log('\n[Test 4] Testing End-to-End Pick-up Checkout Flow...');
  const testPsidPickup = 'TEST_PICKUP_' + Date.now();
  const sessionPickup = await getSession(testPsidPickup);
  sessionPickup.dining_mode = 'Pick-up';
  sessionPickup.cart = [{ menuItemId: 2, name: 'Caramel Macchiato', price: 150, quantity: 2 }];
  sessionPickup.state = 'ORDERING';
  await saveSession(sessionPickup);

  sentMessages.length = 0;
  await handleMessageEvent(testPsidPickup, 'checkout');
  const promptMsgPickup = sentMessages[sentMessages.length - 1]?.messagePayload?.text || '';
  assert.strictEqual(promptMsgPickup, expectedDineInPrompt, 'Prompt must omit address for Pick-up');

  sentMessages.length = 0;
  await handleMessageEvent(testPsidPickup, `Name: Pedro Penduko\nPhone: 09223334444\nPayment mode: Cash`);

  const sessionPickupAfter = await getSession(testPsidPickup);
  assert.strictEqual(sessionPickupAfter.address, currentStoreAddress);
  assert.strictEqual(sessionPickupAfter.delivery_fee, 0);

  sentMessages.length = 0;
  await handleMessageEvent(testPsidPickup, 'wala po');
  const summaryMsgPickup = sentMessages.find(m => m.messagePayload?.text && m.messagePayload.text.includes('--- ORDER SUMMARY ---'));
  assert.ok(summaryMsgPickup);
  assert.ok(summaryMsgPickup.messagePayload.text.includes('Dining-mode: Pick-up'));
  assert.ok(summaryMsgPickup.messagePayload.text.includes(`Address: ${currentStoreAddress}`));
  assert.ok(summaryMsgPickup.messagePayload.text.includes('Delivery Fee: ₱0.00'));
  console.log('✓ Test 4 Passed: Pick-up checkout successfully auto-assigned STORE_ADDRESS and formatted summary.');

  // Test 5: End-to-End Delivery Checkout Flow
  console.log('\n[Test 5] Testing End-to-End Delivery Checkout Flow...');
  const testPsidDelivery = 'TEST_DELIVERY_' + Date.now();
  const sessionDelivery = await getSession(testPsidDelivery);
  sessionDelivery.dining_mode = 'Delivery';
  sessionDelivery.cart = [{ menuItemId: 1, name: 'Signature Spanish Latte', price: 145, quantity: 1 }];
  sessionDelivery.state = 'ORDERING';
  await saveSession(sessionDelivery);

  sentMessages.length = 0;
  await handleMessageEvent(testPsidDelivery, 'check out na po');
  const promptMsgDelivery = sentMessages[sentMessages.length - 1]?.messagePayload?.text || '';
  assert.strictEqual(promptMsgDelivery, expectedDeliveryPrompt, 'Prompt must require Address for Delivery');

  sentMessages.length = 0;
  await handleMessageEvent(testPsidDelivery, `Name: Maria Clara\nPhone: 09187654321\nAddress: Unit 402 Sunshine Tower, Mandaluyong City\nPayment mode: Cash`);

  const sessionDeliveryAfter = await getSession(testPsidDelivery);
  assert.ok(sessionDeliveryAfter.address.includes('Sunshine Tower'), 'Delivery address should be customer address');
  assert.ok(sessionDeliveryAfter.delivery_fee >= 40, 'Delivery fee must be >= 40 for delivery');

  // Confirm drop-off location
  sentMessages.length = 0;
  await handleMessageEvent(testPsidDelivery, 'Oo, tama ito');

  sentMessages.length = 0;
  await handleMessageEvent(testPsidDelivery, 'wala po');
  const summaryMsgDelivery = sentMessages.find(m => m.messagePayload?.text && m.messagePayload.text.includes('--- ORDER SUMMARY ---'));
  assert.ok(summaryMsgDelivery);
  assert.ok(summaryMsgDelivery.messagePayload.text.includes('Dining-mode: Delivery'));
  assert.ok(summaryMsgDelivery.messagePayload.text.includes('Sunshine Tower'));
  assert.ok(summaryMsgDelivery.messagePayload.text.includes(`Delivery Fee: ₱${sessionDeliveryAfter.delivery_fee.toFixed(2)}`));
  console.log('✓ Test 5 Passed: Delivery checkout correctly required address and included delivery fee in summary.');

  console.log('\n🎉 ALL CONDITIONAL CHECKOUT & ORDER SUMMARY TESTS PASSED SUCCESSFULLY!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
