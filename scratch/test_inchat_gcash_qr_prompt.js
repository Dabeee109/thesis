const assert = require('assert');
const path = require('path');
const fs = require('fs');
const http = require('http');

// Set SQLite force mode for clean test environment
process.env.DB_FORCE_SQLITE = 'true';
process.env.DATABASE_CLIENT = 'sqlite';

const db = require('../database/db');
const { getSession, saveSession } = require('../src/services/sessionManager');
const nlpEngine = require('../src/services/nlpEngine');
const messengerService = require('../src/services/messengerService');
const storeSettingsService = require('../src/services/storeSettingsService');

async function runTests() {
  console.log('====================================================');
  console.log('RUNNING IN-CHAT GCASH QR & PROMPT VERIFICATION TESTS');
  console.log('====================================================');

  await db.initDatabase();

  // Test 1: Express Server ngrok-skip-browser-warning Header Middleware
  console.log('\n[Test 1] Testing ngrok-skip-browser-warning middleware on Express app...');
  const app = require('../src/server'); // server exports or runs app
  // Create test request or check webhookController.gcashRedirect
  const webhookController = require('../src/controllers/webhookController');
  const headers = {};
  const mockRes = {
    setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
    send: () => {}
  };
  await webhookController.gcashRedirect({ query: {} }, mockRes);
  assert.strictEqual(headers['ngrok-skip-browser-warning'], 'true', 'Must set ngrok-skip-browser-warning: true');
  console.log('  ✓ Webhook controller sets ngrok-skip-browser-warning: true');

  // Test 2: In-Chat GCash Details & QR Dispatch in finalizeOrderSummaryAndPayment
  console.log('\n[Test 2] Testing finalizeOrderSummaryAndPayment for GCash checkout...');
  
  const testPsid = `test_gcash_${Date.now()}`;
  const sentPayloads = [];
  
  // Intercept callSendAPI
  const originalCallSendAPI = messengerService.callSendAPI;
  messengerService.callSendAPI = async (psid, messagePayload, options) => {
    sentPayloads.push({ psid, messagePayload, options });
    return { recipient_id: psid, message_id: `mid.${Date.now()}` };
  };

  try {
    const session = await getSession(testPsid);
    session.dining_mode = 'Delivery';
    session.customer_name = 'Juan Dela Cruz';
    session.contact_number = '09171234567';
    session.phone_number = '09171234567';
    session.delivery_address = '123 Rizal St, Manila';
    session.payment_mode = 'GCash';
    session.cart = [
      { id: 1, name: 'Signature Spanish Latte', price: 195.00, quantity: 1 }
    ];
    session.deliveryFee = 50.00;
    session.discount = 0;
    await saveSession(session);

    // Call checkout initiation then details submission
    await nlpEngine.handleMessageEvent(testPsid, 'check out na po');
    sentPayloads.length = 0;

    const infoText = `Name: Juan Dela Cruz\nPhone: 09171234567\nAddress: 123 Rizal St, Manila\nPayment: GCash`;
    await nlpEngine.handleMessageEvent(testPsid, infoText);

    // Confirm drop-off location
    sentPayloads.length = 0;
    await nlpEngine.handleMessageEvent(testPsid, 'Oo, tama ito');

    // Decline discount to trigger final order summary and GCash payment flow
    sentPayloads.length = 0;
    const result = await nlpEngine.handleMessageEvent(testPsid, 'wala po');

    console.log('  Result intent:', result?.intent);
    console.log('  Total messages sent:', sentPayloads.length);

    // Check that NO external URL buttons with pay/gcash or ngrok were sent
    for (const p of sentPayloads) {
      const payloadStr = JSON.stringify(p);
      assert.ok(!payloadStr.includes('/pay/gcash'), 'Must NOT send /pay/gcash link buttons!');
      assert.ok(!payloadStr.includes('Transfer with GCash'), 'Must NOT send "Transfer with GCash" button!');
      assert.ok(!payloadStr.includes('Pay with GCash'), 'Must NOT send "Pay with GCash" button!');
      
      const buttons = p.messagePayload?.attachment?.payload?.buttons;
      if (buttons && Array.isArray(buttons)) {
        for (const b of buttons) {
          assert.notStrictEqual(b.type, 'web_url', 'Must NOT have web_url button redirecting externally');
        }
      }
    }
    console.log('  ✓ Verified NO external webview buttons or pay/gcash redirects were sent.');

    // Verify Message 1: Image attachment with QR code
    const imageMsg = sentPayloads.find(p => p.messagePayload?.attachment?.type === 'image');
    assert.ok(imageMsg, 'Must dispatch an image attachment as Message 1');
    const qrPayload = imageMsg.messagePayload.attachment.payload;
    assert.ok(qrPayload.url || qrPayload.attachment_id, 'QR attachment must have url or attachment_id');
    console.log('  ✓ Message 1 is image attachment with QR Code URL:', qrPayload.url || qrPayload.attachment_id);

    // Verify Message 2: Exact formatted text
    const textMsgs = sentPayloads.filter(p => typeof p.messagePayload?.text === 'string');
    const gcashDetailsMsg = textMsgs.find(p => p.messagePayload.text.includes('💳 GCASH PAYMENT DETAILS:'));
    assert.ok(gcashDetailsMsg, 'Must dispatch formatted text message containing 💳 GCASH PAYMENT DETAILS:');

    const msgText = gcashDetailsMsg.messagePayload.text;
    console.log('\n--- Message 2 Text Preview ---\n' + msgText + '\n------------------------------\n');

    assert.ok(msgText.includes('Account Name:'), 'Must include Account Name:');
    assert.ok(msgText.includes('Account Number:'), 'Must include Account Number:');
    assert.ok(msgText.includes('Total Amount to Pay:'), 'Must include Total Amount to Pay:');
    assert.ok(msgText.includes('📌 Paalala:'), 'Must include 📌 Paalala:');
    assert.ok(msgText.includes('I-save o i-scan ang QR code sa itaas gamit ang inyong GCash app.'), 'Must include QR scan instructions');
    assert.ok(msgText.includes('Pagkatapos magbayad, paki-send po rito ang SCREENSHOT ng resibo o i-type ang 13-digit Reference Number'), 'Must include proof instructions');
    console.log('  ✓ Message 2 matches required format and Tagalog instructions.');

    // Check session state
    const updatedSession = await getSession(testPsid);
    assert.strictEqual(updatedSession.checkout_step, 'AWAITING_PAYMENT_PROOF', 'Session checkout_step must be AWAITING_PAYMENT_PROOF');
    console.log('  ✓ Session checkout_step is set to AWAITING_PAYMENT_PROOF.');

    // Test 3: Webhook Ingestion with 13-digit reference number
    console.log('\n[Test 3] Testing webhook ingestion for reference number string...');
    sentPayloads.length = 0;
    const refNumText = '1002345678901';
    const refResult = await nlpEngine.handleMessageEvent(testPsid, refNumText);
    assert.strictEqual(refResult?.intent, 'AWAITING_PAYMENT_PROOF', 'Must handle payment proof');
    
    // Check payment & order in DB
    const [orders] = await db.query('SELECT * FROM orders WHERE customer_phone = ? ORDER BY id DESC LIMIT 1', ['09171234567']);
    assert.ok(orders.length > 0, 'Order must exist in database');
    const order = orders[0];
    const orderId = order.id;
    assert.strictEqual(order.payment_ref_number, refNumText, 'Order payment_ref_number must match');
    assert.strictEqual(order.payment_status, 'Pending Verification', 'Order payment_status must be Pending Verification');

    const [payments] = await db.query('SELECT * FROM payments WHERE order_id = ?', [order.id]);
    assert.ok(payments.length > 0, 'Payment record must exist');
    assert.strictEqual(payments[0].reference_no, refNumText, 'Payment reference_no must match');
    console.log('  ✓ Successfully stored reference number and set order payment_status to "Pending Verification".');

    // Test 4: Webhook Ingestion with Image Attachment
    console.log('\n[Test 4] Testing webhook ingestion for payment proof image attachment...');
    sentPayloads.length = 0;
    const sessionForImg = await getSession(testPsid);
    sessionForImg.checkout_step = 'AWAITING_PAYMENT_PROOF';
    sessionForImg.active_order_id = orderId;
    await saveSession(sessionForImg);

    const mockImgAttachment = {
      type: 'image',
      payload: {
        url: 'https://example.com/receipt.jpg'
      }
    };
    
    const imgResult = await nlpEngine.handleMessageEvent(testPsid, '', null, null, [mockImgAttachment]);
    console.log('  Image handler result intent:', imgResult?.intent);
    
    const [updatedOrders] = await db.query('SELECT * FROM orders WHERE id = ?', [orderId]);
    assert.strictEqual(updatedOrders[0].payment_status, 'Pending Verification', 'Order payment_status must be Pending Verification');
    assert.ok(updatedOrders[0].payment_proof_image, 'Order must store payment_proof_image');
    console.log('  ✓ Image attachment processed, saved proof image, and order payment_status is "Pending Verification".');

    console.log('\n====================================================');
    console.log('ALL TESTS PASSED SUCCESSFULLY! 🎉');
    console.log('====================================================');

  } finally {
    messengerService.callSendAPI = originalCallSendAPI;
  }
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
