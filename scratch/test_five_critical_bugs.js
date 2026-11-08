const assert = require('assert');
const { parseQuantity } = require('../src/services/textMatch');
const { parseRemovalRequests, executeMultiItemRemoval, isRemovalIntent } = require('../src/services/removalService');
const { handleMessageEvent } = require('../src/services/nlpEngine');
const { getSession, saveSession, clearSessionCart } = require('../src/services/sessionManager');
const messengerService = require('../src/services/messengerService');
const db = require('../database/db');

const sentMessages = [];
messengerService.callSendAPI = async (psid, messagePayload, options) => {
  sentMessages.push({ psid, messagePayload, options });
  return { recipient_id: psid, message_id: `mid.${Date.now()}` };
};

async function runTests() {
  console.log('--- STARTING 5 CRITICAL BUG FIX TESTS ---');

  // TEST 1: Multi-Item Removal & Array Mutation (Issue 1)
  console.log('\n[Test 1] Testing Multi-Item Removal & Array Mutation...');
  const testCart = [
    { menuItemId: 13, name: 'qwertys', price: 1, quantity: 2 },
    { menuItemId: 1, name: 'Signature Spanish Latte', price: 145, quantity: 1 },
    { menuItemId: 2, name: 'Caramel Macchiato', price: 150, quantity: 2 },
    { menuItemId: 10, name: 'Grilled Chicken Pesto Panini', price: 175, quantity: 2 }
  ];

  const removeInput = "Pa tanggal po ng 2 qwertys 1 signature spanish latte 2 caramel macchiato and 2 grilled chicken";
  assert.strictEqual(isRemovalIntent(removeInput), true, 'Must identify removal intent');

  const parsed = parseRemovalRequests(removeInput, testCart);
  assert.strictEqual(parsed.length, 4, `Should parse all 4 items, got ${parsed.length}`);

  const removed = executeMultiItemRemoval(testCart, removeInput);
  assert.strictEqual(removed.length, 4, `Should remove all 4 items, got ${removed.length}`);
  assert.strictEqual(testCart.length, 0, 'Cart array should be spliced and completely empty');
  console.log('✓ Test 1 Passed: Atomic batch removal parsed all 4 entity pairs and mutated cart array');

  // TEST 2: Quantity Parser Tagalog Support (Issue 2)
  console.log('\n[Test 2] Testing Quantity Word Support (isang, dalawang, etc.)...');
  assert.strictEqual(parseQuantity('Pa order po ng isang qwertys'), 1, 'isang must parse to 1');
  assert.strictEqual(parseQuantity('dalawang signature spanish latte'), 2, 'dalawang must parse to 2');
  assert.strictEqual(parseQuantity('tatlong cookies'), 3, 'tatlong must parse to 3');
  console.log('✓ Test 2 Passed: Quantity keywords cleanly map to integers without multiplier error');

  // TEST 3: Eliminate "Yes to what" Checkout Confirmation Loop (Issue 3)
  console.log('\n[Test 3] Testing Checkout Intent Bypassing "Yes to what"...');
  const testPsid = `TEST_USER_${Date.now()}`;
  const session = await getSession(testPsid);
  session.cart = [
    { menuItemId: 13, id: 13, name: 'qwertys', price: 1, quantity: 1 }
  ];
  session.state = 'AWAITING_CHECKOUT_CONFIRM';
  await saveSession(session);

  sentMessages.length = 0;
  await handleMessageEvent(testPsid, 'Check out na po');
  assert.strictEqual(session.state, 'COLLECTING_CUSTOMER_INFO', 'State should be COLLECTING_CUSTOMER_INFO');
  
  const lastReply = sentMessages[sentMessages.length - 1]?.messagePayload?.text || '';
  assert.ok(!lastReply.includes('Yes to what?'), 'Must NOT ask "Yes to what?"');
  assert.ok(lastReply.includes('Pakibigay po ang sumusunod para sa inyong order:'), 'Must ask for 4 order details');
  console.log('✓ Test 3 Passed: "Check out na po" transitions directly to details prompt without "Yes to what?" trap');

  // TEST 4 & 5: Mandatory Summary Receipt & Cash/GCash Order Creation (Issue 4 & 5)
  console.log('\n[Test 4 & 5] Testing Summary Receipt and Cash Placement...');
  session.cart = [
    { menuItemId: 13, id: 13, name: 'qwertys', price: 1, quantity: 1 }
  ];
  await saveSession(session);

  const customerDetailsText = `Name: Juan Dela Cruz
Phone number: 09171234567
Address: Table 5 Open Seating
Payment mode: Cash`;

  sentMessages.length = 0;
  await handleMessageEvent(testPsid, customerDetailsText);

  // Requirement 1: Sequential Discount Step prompts before Order Summary
  assert.strictEqual(session.state, 'AWAITING_DISCOUNT_CONFIRMATION', 'Must transition to discount confirmation');
  sentMessages.length = 0;
  await handleMessageEvent(testPsid, 'Wala po');

  // Check that summary receipt was sent
  const receiptMsg = sentMessages.find(m => m.messagePayload?.text?.includes('--- ORDER SUMMARY ---'));
  assert.ok(receiptMsg, 'Summary receipt must be sent before payment processing');
  assert.ok(receiptMsg.messagePayload.text.includes('TOTAL AMOUNT DUE:'), 'Receipt must contain TOTAL AMOUNT DUE');

  const cashConfirmationMsg = sentMessages.find(m => m.messagePayload?.text?.includes('Pending Approval'));
  assert.ok(cashConfirmationMsg, 'Order confirmation must state Pending Approval');
  assert.strictEqual(session.cart.length, 0, 'Cart should be cleared after order submission');
  console.log('✓ Test 4 & 5 Passed: Customer details processed, summary receipt shown, order recorded as Pending Approval');

  // TEST 5B: GCash Verification Workflow (Issue 5)
  console.log('\n[Test 5B] Testing GCash Payment and Reference Number Verification...');
  const gcashPsid = `TEST_GCASH_${Date.now()}`;
  const gcashSession = await getSession(gcashPsid);
  gcashSession.cart = [
    { menuItemId: 13, id: 13, name: 'qwertys', price: 1, quantity: 2 }
  ];
  gcashSession.state = 'COLLECTING_CUSTOMER_INFO';
  await saveSession(gcashSession);

  const gcashDetailsText = `Name: Maria Santos
Phone: 09281762895
Address: 123 BGC Taguig
Payment mode: GCash`;

  sentMessages.length = 0;
  await handleMessageEvent(gcashPsid, gcashDetailsText);
  assert.strictEqual(gcashSession.state, 'AWAITING_DISCOUNT_CONFIRMATION', 'State should be AWAITING_DISCOUNT_CONFIRMATION');

  // Customer says "Wala po" for discount
  sentMessages.length = 0;
  await handleMessageEvent(gcashPsid, 'Wala po');
  assert.strictEqual(gcashSession.state, 'AWAITING_GCASH_VERIFICATION', 'State should be AWAITING_GCASH_VERIFICATION');

  // Send 13-digit reference number
  sentMessages.length = 0;
  await handleMessageEvent(gcashPsid, 'Eto po ang ref number: 1002938475610');
  const gcashVerifiedMsg = sentMessages.find(m => m.messagePayload?.text?.includes('Payment verified!'));
  assert.ok(gcashVerifiedMsg, 'Must reply with "Payment verified!"');
  assert.ok(gcashVerifiedMsg.messagePayload.text.includes('na-submit na for approval'), 'Must state order submitted for approval');
  assert.strictEqual(gcashSession.cart.length, 0, 'Cart should be cleared after verification');
  console.log('✓ Test 5B Passed: GCash reference number verified and order submitted for approval');

  console.log('\n🎉 ALL 5 CRITICAL BUG FIX TESTS PASSED SUCCESSFULLY!');
}

runTests().then(() => process.exit(0)).catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
