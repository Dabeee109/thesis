const test = require('node:test');
const assert = require('node:assert/strict');
const nlpEngine = require('../src/services/nlpEngine');
const sessionManager = require('../src/services/sessionManager');

test('Francis Dave Messenger Flow - Bug Fixes & Precision Verification', async (t) => {
  await t.test('1. Delivery location inquiry does NOT blindly lock session into Delivery mode', async () => {
    const psid = 'test_fd_inq_' + Date.now();
    const session = await sessionManager.getSession(psid);
    session.state = 'AWAITING_DINING_MODE';
    session.current_step = 'AWAITING_DINING_MODE';

    const res = await nlpEngine.handleTextInput(psid, session, 'Makakapag deliver ba kayo sa mandaluyong?');
    assert.equal(res.intent, 'DELIVERY_COVERAGE_INQUIRY');
    assert.match(res.replyLog, /Tondo, Manila/i);
    assert.match(res.replyLog, /3 km/i);
    assert.match(res.replyLog, /Pick-up/i);
    assert.equal(session.dining_mode, null);
  });

  await t.test('2. Unlabelled customer details correctly parses Francis Dave without "Dave" triggering Avenue address', async () => {
    const raw = `Francis Dave\n09281762895\n203 blk 14 addition Hills Mandaluyong City\nBencel store\nGcash`;
    const parsed = nlpEngine.parseCustomerInfo(raw, 'Delivery');

    assert.equal(parsed.name, 'Francis Dave');
    assert.equal(parsed.contact, '09281762895');
    assert.match(parsed.address, /203 blk 14 addition Hills Mandaluyong City/i);
    assert.equal(parsed.paymentMode, 'GCash');
  });

  await t.test('3. Mandaluyong address accurately triggers out-of-bounds (>3km) store radius warning', async () => {
    const psid = 'test_fd_oob_' + Date.now();
    const session = await sessionManager.getSession(psid);
    session.cart = [{ id: 1, name: 'Biscoff Cheesecake', price: 169.00, quantity: 1 }];
    session.dining_mode = 'Delivery';
    session.state = 'COLLECTING_CUSTOMER_INFO';
    session.current_step = 'COLLECTING_CUSTOMER_INFO';

    const raw = `Francis Dave\n09281762895\n203 blk 14 addition Hills Mandaluyong City\nBencel store\nGcash`;
    const res = await nlpEngine.handleTextInput(psid, session, raw);

    assert.equal(res.intent, 'AWAITING_BOUNDARY_PICKUP_SWITCH');
    assert.match(res.replyLog, /lampas sa aming 3 km store delivery limit/i);
    assert.equal(session.customer_name, 'Francis Dave');
    assert.equal(session.contact_number, '+639281762895');
    assert.equal(session.state, 'AWAITING_BOUNDARY_PICKUP_SWITCH');
  });

  await t.test('4. formatPlaintextOrderSummary formats phone number when contact_number is populated', async () => {
    const summary = nlpEngine.formatPlaintextOrderSummary({
      name: 'Francis Dave',
      contact_number: '+639281762895',
      diningMode: 'Delivery',
      address: '203 blk 14 addition Hills Mandaluyong City',
      cart: [{ name: 'Biscoff Cheesecake', price: 169.00, quantity: 1 }],
      total: 169.00
    });

    assert.match(summary, /Phone number: \+639281762895/);
    assert.match(summary, /Name: Francis Dave/);
    assert.match(summary, /1x Biscoff Cheesecake/);
  });

  await t.test('5. Customer question "Bakit wala akong delivery fee?" in payment proof is answered politely', async () => {
    const psid = 'test_fd_fee_q_' + Date.now();
    const session = await sessionManager.getSession(psid);
    session.state = 'AWAITING_PAYMENT_PROOF';
    session.current_step = 'AWAITING_PAYMENT_PROOF';
    session.checkout_step = 'AWAITING_PAYMENT_PROOF';
    session.delivery_fee = 0;

    const res = await nlpEngine.handleTextInput(psid, session, 'Bakit wala akong delivery fee?');
    assert.equal(res.intent, 'PAYMENT_PROOF_FEE_INQUIRY');
    assert.match(res.replyLog, /delivery fee/i);
  });
});
