/**
 * Verification test suite for Manual GCash Proof-of-Payment Intake Workflow
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../database/db');
const messengerService = require('../src/services/messengerService');
const orderService = require('../src/services/orderService');
const {
  handleMessageEvent,
  getSession,
  saveSession
} = require('../src/services/nlpEngine');

async function runTests() {
  console.log('=== STARTING MANUAL GCASH PROOF-OF-PAYMENT WORKFLOW TESTS ===\n');

  // -------------------------------------------------------------
  // Test 1: Database Schema Verification (Requirement 3)
  // -------------------------------------------------------------
  console.log('[Test 1] Verifying database schema columns on orders table...');
  const [cols] = await db.query('PRAGMA table_info(orders)');
  const colNames = cols.map(c => c.name);

  assert.ok(colNames.includes('payment_proof_image'), 'orders table must have payment_proof_image column');
  assert.ok(colNames.includes('payment_ref_number'), 'orders table must have payment_ref_number column');
  assert.ok(colNames.includes('payment_status'), 'orders table must have payment_status column');
  console.log('✔ Test 1 Passed: Database schema verified with all 3 required payment proof columns.\n');

  // Intercept messenger messages
  const capturedMessages = [];
  const origCallSendAPI = messengerService.callSendAPI;
  messengerService.callSendAPI = async (recipientPsid, messagePayload, options = {}) => {
    capturedMessages.push({ psid: recipientPsid, payload: messagePayload });
    return { recipient_id: recipientPsid, message_id: `mock_mid_${capturedMessages.length}` };
  };

  try {
    // -------------------------------------------------------------
    // Test 2: Conversational Bot Payment Intake Flow (Requirement 1)
    // -------------------------------------------------------------
    console.log('[Test 2] Testing Checkout with GCash selection...');
    const testPsid1 = 'TEST_USER_GCASH_CHECKOUT_' + Date.now();
    const session1 = await getSession(testPsid1);
    session1.dining_mode = 'Delivery';
    session1.cart = [{ id: 13, menuItemId: 13, name: 'Signature Spanish Latte', price: 145, quantity: 1 }];
    session1.state = 'COLLECTING_CUSTOMER_INFO';
    session1.current_step = 'COLLECTING_CUSTOMER_INFO';
    await saveSession(session1);

    capturedMessages.length = 0;
    // Provide 4 customer details with payment mode: GCash
    const checkoutInfo = 'Name: Maria Cruz\nPhone: 09171234567\nAddress: 123 Boni Ave, Mandaluyong\nPayment mode: GCash';
    await handleMessageEvent(testPsid1, checkoutInfo);

    // After providing details, discount question is asked: "Mayroon po ba kayong Senior Citizen o PWD ID para sa 20% discount?"
    // Customer replies "Wala po"
    capturedMessages.length = 0;
    await handleMessageEvent(testPsid1, 'Wala po');

    // Verify session state: session.checkout_step = 'AWAITING_PAYMENT_PROOF'
    const updatedSession1 = await getSession(testPsid1);
    assert.strictEqual(updatedSession1.checkout_step, 'AWAITING_PAYMENT_PROOF', 'session.checkout_step must be AWAITING_PAYMENT_PROOF');
    console.log(' -> Verified session.checkout_step is "AWAITING_PAYMENT_PROOF"');

    // Verify Button template with cafe GCash details
    const buttonMsg = capturedMessages.find(m => m.payload?.attachment?.payload?.template_type === 'button');
    assert.ok(buttonMsg, 'Must dispatch button template with GCash details and deep-link');
    console.log(' Button Template Text:', buttonMsg.payload.attachment.payload.text);
    assert.ok(buttonMsg.payload.attachment.payload.text.includes('GCash Details'), 'Must contain cafe GCash details');
    assert.ok(buttonMsg.payload.attachment.payload.buttons.some(b => b.title === 'Pay with GCash'), 'Must have Pay with GCash button');

    // Verify exact prompt text
    const promptTextMsg = capturedMessages.find(m => m.payload?.text?.includes('Kapag tapos na po magbayad, paki-send dito ang screenshot ng resibo o i-type ang Reference Number.'));
    assert.ok(promptTextMsg, 'Must prompt user with exact prompt string');
    console.log(' Prompt text sent:', promptTextMsg.payload.text);
    console.log('✔ Test 2 Passed: GCash checkout flow and AWAITING_PAYMENT_PROOF setup verified.\n');

    // -------------------------------------------------------------
    // Test 3: Webhook Ingestion - Image Attachment Upload (Requirement 2, Case A)
    // -------------------------------------------------------------
    console.log('[Test 3] Testing incoming payment proof IMAGE attachment ingestion...');
    capturedMessages.length = 0;

    const mockImageAttachment = [{
      type: 'image',
      payload: {
        url: 'data:image/jpeg;base64,' + Buffer.from('mock_receipt_image_binary_data').toString('base64')
      }
    }];

    await handleMessageEvent(testPsid1, '', null, null, mockImageAttachment);

    // Check confirmation message
    const confirmMsg = capturedMessages.find(m => m.payload?.text === 'Natanggap po namin ang proof of payment! I-verify po ito ng staff saglit.');
    assert.ok(confirmMsg, 'Must respond with exact confirmation message');
    console.log(' Bot Response:', confirmMsg.payload.text);

    // Check session reset
    const postImageSession = await getSession(testPsid1);
    assert.strictEqual(postImageSession.checkout_step, null, 'session.checkout_step must be reset');
    assert.strictEqual(postImageSession.state, 'IDLE', 'session.state must be IDLE');
    console.log(' -> Verified session.checkout_step reset to null');

    // Check order in DB
    const [orders1] = await db.query('SELECT * FROM orders WHERE order_number = ?', [updatedSession1.activeOrderNumber]);
    assert.strictEqual(orders1.length, 1, 'Order must exist in database');
    const order1 = orders1[0];
    assert.strictEqual(order1.payment_status, 'Pending Verification', 'payment_status must be "Pending Verification"');
    assert.ok(order1.payment_proof_image, 'payment_proof_image must be populated');
    assert.ok(order1.payment_proof_image.includes('/uploads/payments/'), 'payment_proof_image must point to /uploads/payments/');
    console.log(` -> Verified order DB record: payment_status="${order1.payment_status}", payment_proof_image="${order1.payment_proof_image}"`);

    // Verify file actually exists on disk
    const diskPath = path.join(__dirname, '../public', order1.payment_proof_image.replace(/^\//, ''));
    assert.ok(fs.existsSync(diskPath), `Payment proof file must be saved on disk at: ${diskPath}`);
    console.log(' -> Verified file exists on disk.');
    console.log('✔ Test 3 Passed: Image attachment ingestion and DB updates verified.\n');

    // -------------------------------------------------------------
    // Test 4: Webhook Ingestion - 9 to 13 Digit Reference Number (Requirement 2, Case B)
    // -------------------------------------------------------------
    console.log('[Test 4] Testing incoming text with 9 to 13-digit reference number...');
    const testPsid2 = 'TEST_USER_GCASH_REF_' + Date.now();
    const session2 = await getSession(testPsid2);
    session2.dining_mode = 'Pick-up';
    session2.cart = [{ id: 13, menuItemId: 13, name: 'Signature Spanish Latte', price: 145, quantity: 1 }];
    session2.state = 'COLLECTING_CUSTOMER_INFO';
    session2.current_step = 'COLLECTING_CUSTOMER_INFO';
    await saveSession(session2);

    // Checkout slot filling for Pick-up
    await handleMessageEvent(testPsid2, 'Name: Juan Tamad\nPhone: 09189876543\nPayment mode: GCash');
    // Discount question
    await handleMessageEvent(testPsid2, 'Wala po');

    const updatedSession2 = await getSession(testPsid2);
    assert.strictEqual(updatedSession2.checkout_step, 'AWAITING_PAYMENT_PROOF');

    capturedMessages.length = 0;
    // Customer sends reference number text (12 digits)
    const testRefNumber = '100483958294';
    await handleMessageEvent(testPsid2, `Eto po ang aking GCash Ref: ${testRefNumber}`);

    // Verify confirmation message
    const confirmMsg2 = capturedMessages.find(m => m.payload?.text === 'Natanggap po namin ang proof of payment! I-verify po ito ng staff saglit.');
    assert.ok(confirmMsg2, 'Must respond with exact confirmation message');

    // Verify session reset
    const postRefSession = await getSession(testPsid2);
    assert.strictEqual(postRefSession.checkout_step, null, 'session.checkout_step must be reset');

    // Verify order in DB
    const [orders2] = await db.query('SELECT * FROM orders WHERE order_number = ?', [updatedSession2.activeOrderNumber]);
    assert.strictEqual(orders2.length, 1);
    const order2 = orders2[0];
    assert.strictEqual(order2.payment_status, 'Pending Verification', 'payment_status must be "Pending Verification"');
    assert.strictEqual(order2.payment_ref_number, testRefNumber, `payment_ref_number must be ${testRefNumber}`);
    console.log(` -> Verified order DB record: payment_status="${order2.payment_status}", payment_ref_number="${order2.payment_ref_number}"`);
    console.log('✔ Test 4 Passed: Text reference number ingestion verified.\n');

    // -------------------------------------------------------------
    // Test 5: Staff Verification Action: Mark Payment Verified / Paid (Requirement 4)
    // -------------------------------------------------------------
    console.log('[Test 5] Testing Staff Verification: Mark Payment Verified / Paid...');
    capturedMessages.length = 0;

    const verifyResult = await orderService.verifyOrderPayment(order1.id);
    assert.strictEqual(verifyResult.payment_status, 'Paid', 'Order payment_status must become Paid');

    // Verify DB updated
    const [verifyCheck] = await db.query('SELECT payment_status FROM orders WHERE id = ?', [order1.id]);
    assert.strictEqual(verifyCheck[0].payment_status, 'Paid');

    // Verify customer notification sent
    const verifyNotif = capturedMessages.find(m => m.payload?.text?.includes('Na-verify na po ng aming staff ang inyong GCash payment'));
    assert.ok(verifyNotif, 'Customer must be notified on Messenger when payment is marked Paid');
    console.log(' Customer Notification:', verifyNotif.payload.text);
    console.log('✔ Test 5 Passed: Mark Payment Verified / Paid updates DB and notifies customer.\n');

    // -------------------------------------------------------------
    // Test 6: Staff Action: Invalid Payment Proof (Requirement 4)
    // -------------------------------------------------------------
    console.log('[Test 6] Testing Staff Action: Invalid Payment Proof...');
    capturedMessages.length = 0;

    const invalidResult = await orderService.markOrderPaymentInvalid(order2.id, 'Malabo ang screenshot');
    assert.strictEqual(invalidResult.payment_status, 'Failed', 'Order payment_status must become Failed');

    // Verify customer notification sent prompting re-upload
    const invalidNotif = capturedMessages.find(m => m.payload?.text?.includes('hindi po ma-verify ng aming staff ang inyong ipinadalang proof of payment'));
    assert.ok(invalidNotif, 'Customer must be notified on Messenger with re-upload prompt');
    console.log(' Re-upload Prompt:', invalidNotif.payload.text);

    // Verify customer session was restored to AWAITING_PAYMENT_PROOF so they can re-upload
    const reuploadSession = await getSession(testPsid2);
    assert.strictEqual(reuploadSession.checkout_step, 'AWAITING_PAYMENT_PROOF', 'Customer session must be reset to AWAITING_PAYMENT_PROOF');
    console.log(' -> Customer session checkout_step restored to:', reuploadSession.checkout_step);
    console.log('✔ Test 6 Passed: Invalid Payment Proof prompts customer and resets session for re-upload.\n');

    // -------------------------------------------------------------
    // Test 7: getOrderDetails Parity for Admin Modal (Requirement 4)
    // -------------------------------------------------------------
    console.log('[Test 7] Testing getOrderDetails returns payment proof fields for Admin Modal...');
    const details1 = await orderService.getOrderDetails(order1.id);
    assert.strictEqual(details1.payment_status, 'Paid');
    assert.ok(details1.payment_proof_image);

    const details2 = await orderService.getOrderDetails(order2.id);
    assert.strictEqual(details2.payment_status, 'Failed');
    assert.strictEqual(details2.payment_ref_number, testRefNumber);
    console.log('✔ Test 7 Passed: getOrderDetails provides payment_status, payment_proof_image, and payment_ref_number to modal.\n');

  } finally {
    messengerService.callSendAPI = origCallSendAPI;
  }

  console.log('=== ALL MANUAL GCASH PROOF-OF-PAYMENT TESTS PASSED SUCCESSFULLY! ===');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});

