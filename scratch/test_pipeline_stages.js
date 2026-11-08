const assert = require('assert');
const { handleTextInput, getSession, saveSession } = require('../src/services/nlpEngine');
const { updateOrderStatus } = require('../src/services/orderService');
const { parseCustomerFeedback, processFeedbackSubmission } = require('../src/services/feedbackParser');
const db = require('../database/db');

async function testPipelineStages() {
  console.log('================================================================');
  console.log('TEST SUITE: CONVERSATIONAL ORDERING PIPELINE & STATUS AUTOMATION');
  console.log('================================================================\n');

  const testPsid = 'test_pipeline_user_' + Date.now();
  let session = await getSession(testPsid);

  // -------------------------------------------------------------------------
  // STAGE 1: Initial Filter (Dining Mode)
  // -------------------------------------------------------------------------
  console.log('[STAGE 1] Testing Initial Greeting & Dining Mode Filter...');
  const res1 = await handleTextInput(testPsid, session, 'Hello po');
  assert.strictEqual(res1.intent, 'GREETING_STAGE1', 'Greeting without dining mode should trigger Stage 1 filter');
  assert(res1.replyLog.includes('Hello po! Welcome to Diner\'s Cafe!'), 'Should use official Stage 1 greeting');
  assert(res1.replyLog.includes('will this be for **Dine In**, **Delivery**, or **Take Out**?'), 'Should inquire dining mode');
  console.log('✓ Stage 1 Greeting prompt verified.');

  // Select Dining Mode (e.g., Delivery)
  session = await getSession(testPsid);
  const res1b = await handleTextInput(testPsid, session, 'Delivery po');
  assert.strictEqual(session.dining_mode, 'Delivery', 'Dining mode should be locked as Delivery in session');
  assert.strictEqual(session.orderType, 'delivery', 'orderType should be set to delivery');
  console.log('✓ Stage 1 Slot Locking verified (dining_mode = "Delivery").\n');

  // -------------------------------------------------------------------------
  // STAGE 5: Summary Receipt & Stage 6 Branch A (CASH)
  // -------------------------------------------------------------------------
  console.log('[STAGE 5 & 6A] Testing Cash Order Placement & Branching...');
  const cashPsid = 'test_cash_user_' + Date.now();
  let cashSession = await getSession(cashPsid);
  cashSession.dining_mode = 'Delivery';
  cashSession.orderType = 'delivery';
  cashSession.state = 'AWAITING_STAGE5_CONFIRM';
  cashSession.pendingStage5 = {
    name: 'Maria Santos',
    phone: '09181234567',
    address: '123 Rizal St, Brgy Holy Spirit, QC',
    paymentMethod: 'cash',
    orderType: 'delivery',
    total: 245.00
  };

  const resCash = await handleTextInput(cashPsid, cashSession, 'YES');
  assert.strictEqual(resCash.intent, 'ORDER_PLACED_CASH');
  assert(resCash.replyLog.includes('Salamat po! Naipasa na po ang inyong order sa system with status: Pending Approval.'), 'Cash order should confirm with exact Pending Approval notice');
  console.log('✓ Stage 6 Branch A (Cash) verified.\n');

  // -------------------------------------------------------------------------
  // STAGE 6 Branch B (GCASH)
  // -------------------------------------------------------------------------
  console.log('[STAGE 6B] Testing GCash Order Placement & Branching...');
  const gcashPsid = 'test_gcash_user_' + Date.now();
  let gcashSession = await getSession(gcashPsid);
  gcashSession.dining_mode = 'Delivery';
  gcashSession.orderType = 'delivery';
  gcashSession.state = 'AWAITING_STAGE5_CONFIRM';
  gcashSession.pendingStage5 = {
    name: 'Juan dela Cruz',
    phone: '09179876543',
    address: 'Unit 4B Sunrise Condo, Pasig',
    paymentMethod: 'gcash',
    orderType: 'delivery',
    total: 350.00
  };

  // Step 1: Confirm YES -> Prompts for GCash payment first
  const resGCashPrompt = await handleTextInput(gcashPsid, gcashSession, 'YES');
  assert.strictEqual(resGCashPrompt.intent, 'ORDER_PLACED_AWAITING_GCASH');
  assert(resGCashPrompt.replyLog.includes('Pakisend po ang bayad na ₱350.00 sa aming GCash:'), 'Should prompt for GCash payment with account details');
  console.log('✓ Stage 6 Branch B payment prompt verified.');

  // Step 2: Proof of payment / "Send na po"
  gcashSession = await getSession(gcashPsid);
  const resGCashPaid = await handleTextInput(gcashPsid, gcashSession, 'Send na po');
  assert.strictEqual(resGCashPaid.intent, 'GCASH_PAID_SIGNAL');
  assert(resGCashPaid.replyLog.includes('Natanggap na po namin ang inyong GCash payment! Ang inyong order'), 'Should acknowledge GCash payment and confirm Pending Approval');
  assert(resGCashPaid.replyLog.includes('submitted na for Pending Approval'), 'Status confirmation verified');
  console.log('✓ Stage 6 Branch B payment confirmation verified.\n');

  // -------------------------------------------------------------------------
  // BACKEND STATUS AUTOMATION & PUSH NOTIFICATIONS
  // -------------------------------------------------------------------------
  console.log('[STATUS AUTOMATION] Testing Order Lifecycle Push Notifications...');
  const orderNum = gcashSession.activeOrderNumber;
  const [orderRows] = await db.query('SELECT id FROM orders WHERE order_number = ?', [orderNum]);
  assert(orderRows.length > 0, 'Created order must exist in DB');
  const orderId = orderRows[0].id;

  // 1. Pending Approval -> In Kitchen Preparation
  const prepRes = await updateOrderStatus(orderId, 'preparing');
  assert.strictEqual(prepRes.newStatus, 'preparing');
  console.log('✓ Transition to In Kitchen Preparation verified.');

  // 2. In Kitchen Preparation -> Dispatched
  const dispRes = await updateOrderStatus(orderId, 'dispatched');
  assert.strictEqual(dispRes.newStatus, 'dispatched');
  console.log('✓ Transition to Dispatched / On Delivery verified.');

  // 3. Dispatched -> Delivered
  const delivRes = await updateOrderStatus(orderId, 'delivered');
  assert.strictEqual(delivRes.newStatus, 'delivered');
  console.log('✓ Transition to Delivered / Completed (Feedback Trigger) verified.\n');

  // -------------------------------------------------------------------------
  // FEEDBACK INGESTION SERVICE
  // -------------------------------------------------------------------------
  console.log('[FEEDBACK SERVICE] Testing Rating & Comment Extraction...');
  const parsedFb = parseCustomerFeedback('5 stars kasi ang bilis dumating at ang sarap ng kape!', gcashSession);
  assert.strictEqual(parsedFb.isFeedback, true, 'Should detect feedback');
  assert.strictEqual(parsedFb.rating, 5, 'Rating must be extracted as integer 5');
  assert(parsedFb.comment.includes('ang bilis dumating at ang sarap ng kape!'), 'Reason comment must be extracted');

  const fbRes = await processFeedbackSubmission({
    psid: gcashPsid,
    session: gcashSession,
    rating: parsedFb.rating,
    comment: parsedFb.comment
  });

  assert.strictEqual(fbRes.eligible, true, 'Delivered order must be eligible for feedback');
  assert.strictEqual(fbRes.rating, 5, 'Rating must be integer 5');
  assert.strictEqual(
    fbRes.botReply,
    'Maraming salamat po sa inyong rating at feedback! Malaking tulong po ito sa amin. Enjoy your meal and see you again soon!'
  );
  console.log('✓ Feedback extraction and exact acknowledgment verified.\n');

  console.log('================================================================');
  console.log('SUCCESS: ALL PIPELINE STAGES & AUTOMATIONS PASSED VERIFICATION!');
  console.log('================================================================');
  process.exit(0);
}

testPipelineStages().catch(err => {
  console.error('❌ PIPELINE TEST FAILED:', err);
  process.exit(1);
});
