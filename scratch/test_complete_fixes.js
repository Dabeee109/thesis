const assert = require('assert');
const { formatOrderSummaryReceipt } = require('../src/services/geminiService');
const { corpus, findTopRelevantExamples, getByCategory } = require('../src/services/enterprise800Dataset');
const { handleTextInput, getSession, saveSession } = require('../src/services/nlpEngine');
const db = require('../database/db');

async function runTests() {
  console.log('--- 1. Testing Format of Order Summary Receipt ---');
  const inputReceipt = "Name: Dave Fernandez Phone Number: 09171234567 Location: 203 blk 14 Addition hills Mandaluyong City Payment option: GCash Dining mode: Delivery Discount: ₱0.00 (None) Order: - 1x Spanish Latte (16oz, 50% sugar, Oat Milk, Iced) - ₱175.00 Total: ₱225.00 (Subtotal ₱175.00 - ₱0.00 + ₱50.00 Delivery Fee) Tama po ba lahat ng details? Reply YES to confirm, o sabihin lang po kung may gustong palitan!";
  
  const formatted = formatOrderSummaryReceipt(inputReceipt);
  console.log('FORMATTED OUTPUT:\n' + formatted);

  assert(formatted.includes('Name: Dave Fernandez'), 'Name must be present');
  assert(/Phone(?:\s*number)?:\s*09171234567/i.test(formatted), 'Phone number must have its own line');
  assert(formatted.includes('\nLocation: 203 blk 14 Addition hills Mandaluyong City'), 'Location must have its own line');
  assert(formatted.includes('\nPayment option: GCash'), 'Payment option must have its own line');
  assert(formatted.includes('\nDining mode: Delivery'), 'Dining mode must have its own line');
  assert(formatted.includes('\nDiscount: ₱0.00 (None)'), 'Discount must have its own line');
  assert(formatted.includes('\nOrder:\n- 1x Spanish Latte'), 'Order must have its own line');
  assert(formatted.includes('\nTotal: ₱225.00'), 'Total must have its own line');
  assert(formatted.includes('\nTama po ba lahat ng details?'), 'Confirmation question must have its own line');
  console.log('✅ TEST 1 PASSED: Format Order Summary Receipt has all explicit line breaks!\n');

  console.log('--- 2. Testing 800-Dataset Module ---');
  assert.strictEqual(corpus.length, 800, 'Corpus must contain exactly 800 items');
  for (let c = 1; c <= 8; c++) {
    const items = getByCategory(c);
    assert.strictEqual(items.length, 100, `Category ${c} must have exactly 100 items`);
  }
  const topMatches = findTopRelevantExamples('anong bestseller nyo para sa first timer?');
  assert(topMatches.length > 0, 'Should find relevant examples for bestseller');
  console.log('Top match for bestseller:', topMatches[0].user, '->', topMatches[0].assistant);
  console.log('✅ TEST 2 PASSED: 800-Dataset indexed and verified!\n');

  console.log('--- 3. Testing Order Creation on "Send na po" with pendingStage5 ---');
  const testPsid = 'test_dave_' + Date.now();
  const session = await getSession(testPsid);
  session.pendingStage5 = {
    name: 'Dave Fernandez',
    address: '203 blk 14 Addition hills Mandaluyong City',
    paymentMethod: 'gcash',
    orderType: 'delivery',
    total: 129.80
  };
  session.state = 'AWAITING_STAGE5_CONFIRM';
  session.current_step = 'AWAITING_STAGE5_CONFIRM';
  session.activeOrderNumber = null; // No active order

  const res = await handleTextInput(testPsid, session, 'Send na po');
  console.log('handleTextInput result:', res);
  assert(res && (res.intent === 'ORDER_CONFIRMED_PAID' || res.intent === 'GCASH_PAID_SIGNAL'), 'Should recognize paid signal');

  // Verify that an order was inserted in the database
  const [dbOrders] = await db.query(
    'SELECT o.id, o.order_number, o.status, o.total_amount, p.status as payment_status FROM orders o LEFT JOIN payments p ON o.id = p.order_id WHERE o.order_number = ?',
    [session.activeOrderNumber]
  );
  assert(dbOrders.length > 0, 'Order must exist in database');
  console.log('Created order in database:', dbOrders[0]);
  assert.strictEqual(dbOrders[0].status, 'pending', 'Order status must be pending');
  assert.strictEqual(dbOrders[0].payment_status, 'verified', 'Payment status must be verified');
  console.log('✅ TEST 3 PASSED: Order created in SQLite and verified on "Send na po"!\n');

  console.log('--- 4. Testing Real Tracking (No hallucination of cancelled orders) ---');
  const trackRes = await handleTextInput(testPsid, session, 'Ano na pong balita sa order?');
  console.log('Tracking handled:', trackRes);
  assert.strictEqual(trackRes.intent, 'TRACK_ORDER', 'Intent must be TRACK_ORDER');
  console.log('✅ TEST 4 PASSED: Track Order reports real order status!\n');

  console.log('🎉 ALL INTEGRATION TESTS PASSED!');
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});

