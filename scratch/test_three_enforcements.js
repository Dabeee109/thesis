const assert = require('assert');
const messengerService = require('../src/services/messengerService');
const { handleMessageEvent } = require('../src/services/nlpEngine');
const { getSession, saveSession } = require('../src/services/sessionManager');
const db = require('../database/db');

const sentMessages = [];
messengerService.callSendAPI = async (psid, messagePayload, options) => {
  sentMessages.push({ psid, messagePayload, options });
  return { recipient_id: psid, message_id: `mid.${Date.now()}` };
};

async function runTests() {
  console.log('--- STARTING 3 ENFORCEMENT VERIFICATION TESTS ---');

  // TEST 1: Mandatory Post-Reset Gateway & Initial Greeting (Requirement 1)
  console.log('\n[Test 1] Testing Mandatory Post-Reset Gateway...');
  const psid1 = `TEST_GATEWAY_${Date.now()}`;
  const session1 = await getSession(psid1);
  session1.state = 'INITIAL';
  session1.dining_mode = null;
  session1.cart = [];
  await saveSession(session1);

  sentMessages.length = 0;
  // User sends a random message (e.g. order attempt before dining mode is selected)
  await handleMessageEvent(psid1, 'Pa order ng kape');
  
  assert.strictEqual(session1.state, 'AWAITING_DINING_MODE', 'State must be locked in AWAITING_DINING_MODE');
  assert.strictEqual(session1.dining_mode, null, 'dining_mode must remain unset');
  
  const greetingMsg = sentMessages[sentMessages.length - 1]?.messagePayload?.text || '';
  const expectedGreeting = "Hello po! Welcome to Diner's Cafe! Ask ko lang po muna bago tayo magsimula, will this be for Dine In, Delivery, or Take Out?";
  assert.strictEqual(greetingMsg, expectedGreeting, 'Must reply ONLY with the exact Welcome Greeting');
  console.log('✓ Test 1A Passed: Unlocked session intercepted with exact Welcome Greeting');

  // User specifies dining mode "Delivery"
  sentMessages.length = 0;
  await handleMessageEvent(psid1, 'Delivery po');
  assert.strictEqual(session1.dining_mode, 'Delivery', 'dining_mode must be locked to Delivery');
  assert.ok(['ORDERING', 'BROWSING'].includes(session1.state), 'State must transition to ORDERING/BROWSING after mode lock');
  console.log('✓ Test 1B Passed: Dining mode successfully locked and unlocked ordering progression');

  // TEST 2: Silent & Atomic Batch Cart Mutation (Add & Remove Multiple Items) (Requirement 2)
  console.log('\n[Test 2] Testing Silent & Atomic Batch Cart Mutation (Add & Remove)...');
  const psid2 = `TEST_BATCH_${Date.now()}`;
  const session2 = await getSession(psid2);
  session2.dining_mode = 'Delivery';
  session2.state = 'ORDERING';
  session2.cart = [];
  await saveSession(session2);

  sentMessages.length = 0;
  const batchAddInput = 'Pa order po ng 2 qwertys 1 signature spanish latte 2 caramel macchiato and 2 grilled chicken';
  await handleMessageEvent(psid2, batchAddInput);

  assert.strictEqual(session2.cart.length, 4, 'Cart must have all 4 items added in one turn');
  assert.strictEqual(session2.cart.find(c => c.name === 'qwertys')?.quantity, 2, '2x qwertys');
  assert.strictEqual(session2.cart.find(c => c.name === 'Signature Spanish Latte')?.quantity, 1, '1x Signature Spanish Latte');
  assert.strictEqual(session2.cart.find(c => c.name === 'Caramel Macchiato')?.quantity, 2, '2x Caramel Macchiato');
  assert.strictEqual(session2.cart.find(c => c.name === 'Grilled Chicken Pesto Panini')?.quantity, 2, '2x Grilled Chicken Pesto Panini');

  const addReply = sentMessages[sentMessages.length - 1]?.messagePayload?.text || '';
  assert.ok(addReply.includes('Updated na po ang inyong cart!'), 'Reply must include Updated na po ang inyong cart!');
  assert.ok(addReply.includes('**Your cart:**'), 'Reply must include **Your cart:**');
  assert.ok(addReply.includes('Total: ₱797.00'), 'Reply must compute correct total (₱797.00)');
  assert.ok(addReply.includes('Gusto niyo pa po bang magdagdag o mag-checkout na?'), 'Reply must include follow-up prompt');
  console.log('✓ Test 2A Passed: Multi-item batch add executed atomically with zero confirmation friction');

  // Now test batch remove
  sentMessages.length = 0;
  const batchRemoveInput = 'Pa tanggal po ng 2 qwertys and 1 signature spanish latte';
  await handleMessageEvent(psid2, batchRemoveInput);

  assert.strictEqual(session2.cart.length, 2, 'Cart must have 2 items remaining after removal');
  assert.strictEqual(session2.cart.find(c => c.name === 'qwertys'), undefined, 'qwertys must be completely spliced');
  assert.strictEqual(session2.cart.find(c => c.name === 'Signature Spanish Latte'), undefined, 'Spanish Latte must be completely spliced');

  const removeReply = sentMessages[sentMessages.length - 1]?.messagePayload?.text || '';
  assert.ok(removeReply.includes('Updated na po ang inyong cart!'), 'Remove reply must include Updated na po ang inyong cart!');
  assert.ok(removeReply.includes('Total: ₱650.00'), 'Total must reflect remaining items (300 + 350 = 650)');
  console.log('✓ Test 2B Passed: Multi-item batch remove executed atomically without confirmation questions');

  // TEST 3: Standard Delivery Checkout Information Layout (Requirement 3)
  console.log('\n[Test 3] Testing Standard Delivery Checkout Information Layout...');
  sentMessages.length = 0;
  await handleMessageEvent(psid2, 'Check out na po');

  assert.strictEqual(session2.state, 'COLLECTING_CUSTOMER_INFO', 'State should be COLLECTING_CUSTOMER_INFO');
  const checkoutPrompt = sentMessages[sentMessages.length - 1]?.messagePayload?.text || '';
  
  const expectedDeliveryPrompt = `Pakibigay po ang inyong impormasyon para sa delivery:
Name:
Phone number:
Address:
Payment mode: (Cash or GCash)`;

  assert.strictEqual(checkoutPrompt, expectedDeliveryPrompt, 'Delivery checkout prompt must match exact requested template');
  console.log('✓ Test 3 Passed: Standard Delivery Checkout prompt rendered with exact 4-line layout');

  console.log('\n🎉 ALL 3 ENFORCEMENT VERIFICATION TESTS PASSED SUCCESSFULLY!');
}

runTests().then(() => process.exit(0)).catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
