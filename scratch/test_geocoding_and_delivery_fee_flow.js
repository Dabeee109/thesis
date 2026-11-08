const assert = require('assert');
process.env.DB_FORCE_SQLITE = 'true';
process.env.DATABASE_CLIENT = 'sqlite';

const db = require('../database/db');
const {
  geocodeCustomerAddress,
  sanitizeCustomerAddress,
  hasLocalAnchor,
  METRO_MANILA_BOUNDS,
  getOriginCoordinates
} = require('../src/services/customerGeocodingService');

const {
  calculateDeliveryFee,
  computeDeliveryFee
} = require('../src/services/deliveryFeeCalculator');

const {
  handleMessageEvent,
  formatPlaintextOrderSummary
} = require('../src/services/nlpEngine');

const { getSession, saveSession } = require('../src/services/sessionManager');
const messengerService = require('../src/services/messengerService');

async function runTests() {
  console.log('================================================================');
  console.log('RUNNING TEXT-BASED GEOCODING & DELIVERY FEE INTERACTIVE TESTS');
  console.log('================================================================');

  await db.initDatabase();

  // ---------------------------------------------------------------------------
  // [Test 1] Store Origin Configuration
  // ---------------------------------------------------------------------------
  console.log('\n[Test 1] Testing Store Origin Configuration...');
  const origin = getOriginCoordinates();
  console.log('  Resolved Origin:', origin);
  assert.ok(Number.isFinite(origin.lat) && origin.lat > 14.0 && origin.lat < 15.0, 'Origin latitude must be within Metro Manila');
  assert.ok(Number.isFinite(origin.lng) && origin.lng > 120.0 && origin.lng < 122.0, 'Origin longitude must be within Metro Manila');
  console.log('  ✓ Test 1 Passed: Store origin coordinates dynamically verified.');

  // ---------------------------------------------------------------------------
  // [Test 2] Address Sanitization & Local Anchors
  // ---------------------------------------------------------------------------
  console.log('\n[Test 2] Testing Address Sanitization & Local Anchoring...');
  assert.strictEqual(hasLocalAnchor('123 Boni Ave, Mandaluyong'), true);
  assert.strictEqual(hasLocalAnchor('Corner Shaw Blvd, Pasig'), true);
  assert.strictEqual(hasLocalAnchor('Greenhills, San Juan'), true);
  assert.strictEqual(hasLocalAnchor('Poblacion, Makati'), true);
  assert.strictEqual(hasLocalAnchor('BGC, Taguig City'), true);
  assert.strictEqual(hasLocalAnchor('Malate, Metro Manila'), true);
  assert.strictEqual(hasLocalAnchor('74 Acacia St'), false);

  const sanitizedWithoutAnchor = sanitizeCustomerAddress('Unit 101, Sunflower Condo');
  assert.ok(sanitizedWithoutAnchor.includes('Metro Manila, Philippines'), 'Must append local anchor when omitted');

  const sanitizedWithAnchor = sanitizeCustomerAddress('78 Pioneer St, Mandaluyong City');
  assert.ok(!sanitizedWithAnchor.includes('Mandaluyong, Metro Manila, Philippines, Mandaluyong'), 'Must not duplicate local anchor');
  assert.ok(sanitizedWithAnchor.includes('Philippines'), 'Must ensure Philippines component');
  console.log('  ✓ Test 2 Passed: Address sanitization and local anchoring verified.');

  // ---------------------------------------------------------------------------
  // [Test 3] Geocoding Customer Address
  // ---------------------------------------------------------------------------
  console.log('\n[Test 3] Testing Geocoding Engine with Metro Manila bounds...');
  
  // 3a. Real local address
  const localRes = await geocodeCustomerAddress('Boni Ave, Mandaluyong');
  console.log('  Geocoded "Boni Ave, Mandaluyong":', localRes);
  assert.strictEqual(localRes.success, true);
  assert.ok(Number.isFinite(localRes.resolved_lat));
  assert.ok(Number.isFinite(localRes.resolved_lng));
  assert.ok(localRes.formatted_address.length > 0);

  // 3b. Address without local city (auto-anchored)
  const autoAnchoredRes = await geocodeCustomerAddress('Malamig St');
  assert.strictEqual(autoAnchoredRes.success, true);
  assert.ok(Number.isFinite(autoAnchoredRes.resolved_lat));

  // 3c. Zero results / gibberish fallback
  const invalidRes = await geocodeCustomerAddress('nowhere');
  console.log('  Unlocatable input "nowhere" result:', invalidRes);
  assert.strictEqual(invalidRes.success, false);
  assert.strictEqual(invalidRes.error, 'ZERO_RESULTS');

  console.log('  ✓ Test 3 Passed: Geocoding resolution and zero results fallback verified.');

  // ---------------------------------------------------------------------------
  // [Test 4] Interactive Chatbot Flow - Address Confirmation & Order Summary
  // ---------------------------------------------------------------------------
  console.log('\n[Test 4] Testing Interactive Chatbot Checkout Flow with Drop-off Confirmation...');
  
  const testPsid = `test_geo_chat_${Date.now()}`;
  const sentMessages = [];
  const origCallSendAPI = messengerService.callSendAPI;
  messengerService.callSendAPI = async (psid, messagePayload, options) => {
    sentMessages.push({ psid, messagePayload, options });
    return { recipient_id: psid, message_id: `mid.${Date.now()}` };
  };

  try {
    const session = await getSession(testPsid);
    session.dining_mode = 'Delivery';
    session.cart = [
      { id: 1, name: 'Signature Spanish Latte', price: 195.00, quantity: 1 }
    ];
    session.state = 'ORDERING';
    await saveSession(session);

    // 1. Initiate checkout
    sentMessages.length = 0;
    await handleMessageEvent(testPsid, 'check out na po');

    // 2. Submit customer details with delivery address
    sentMessages.length = 0;
    const checkoutInput = `Name: Juan Dela Cruz\nPhone: 09171234567\nAddress: Unit 402 Sunshine Tower, Pioneer St, Mandaluyong City\nPayment: Cash`;
    await handleMessageEvent(testPsid, checkoutInput);

    // 3. Verify that the bot sent the Drop-off Verification prompt
    const confirmMsg = sentMessages.find(m => m.messagePayload?.text?.includes('Nai-locate po namin ang inyong drop-off'));
    assert.ok(confirmMsg, 'Must dispatch drop-off location verification prompt');
    console.log('\n--- Received Drop-off Verification Prompt ---\n' + confirmMsg.messagePayload.text + '\n-------------------------------------------\n');
    assert.ok(confirmMsg.messagePayload.text.includes('Delivery Fee: ₱'));
    assert.ok(confirmMsg.messagePayload.text.includes('[1] Oo, tama ito'));
    assert.ok(confirmMsg.messagePayload.text.includes('[2] Ibahin ang address'));

    // Check session state
    const sessionAwaitingConfirm = await getSession(testPsid);
    assert.strictEqual(sessionAwaitingConfirm.state, 'AWAITING_ADDRESS_CONFIRMATION');
    assert.ok(sessionAwaitingConfirm.delivery_fee >= 40.00);
    assert.ok(sessionAwaitingConfirm.customer_lat);
    assert.ok(sessionAwaitingConfirm.customer_lng);
    console.log('  -> Session entered AWAITING_ADDRESS_CONFIRMATION with fee ₱' + sessionAwaitingConfirm.delivery_fee);

    // 4. Customer confirms drop-off: "Oo, tama ito"
    sentMessages.length = 0;
    await handleMessageEvent(testPsid, 'Oo, tama ito');

    // Bot must now ask for Senior Citizen / PWD discount
    const discountPrompt = sentMessages.find(m => m.messagePayload?.text?.includes('Senior Citizen o PWD ID'));
    assert.ok(discountPrompt, 'Must transition to discount check after address confirmation');
    console.log('  -> Transitioned to Senior/PWD discount check');

    // 5. Customer declines discount: "Wala po" -> triggers finalized Order Summary
    sentMessages.length = 0;
    await handleMessageEvent(testPsid, 'wala po');

    const summaryMsg = sentMessages.find(m => m.messagePayload?.text?.includes('--- ORDER SUMMARY ---'));
    assert.ok(summaryMsg, 'Must send final Order Summary receipt');
    const summaryText = summaryMsg.messagePayload.text;
    console.log('\n--- Final Order Summary Receipt ---\n' + summaryText + '\n-----------------------------------\n');

    const expectedFee = sessionAwaitingConfirm.delivery_fee;
    assert.ok(summaryText.includes(`Delivery Fee: ₱${expectedFee.toFixed(2)}`), 'Receipt must contain confirmed Delivery Fee');
    assert.ok(summaryText.includes(`TOTAL AMOUNT DUE: ₱${(195.00 + expectedFee).toFixed(2)}`), 'Receipt must include delivery fee in total');

    console.log('  ✓ Test 4 Passed: Confirmation flow successfully locked in address & delivery fee.');

    // ---------------------------------------------------------------------------
    // [Test 5] Address Change / Retry Flow ([2] Ibahin ang address)
    // ---------------------------------------------------------------------------
    console.log('\n[Test 5] Testing Address Change / Retry Flow ([2] Ibahin ang address)...');
    const testPsidChange = `test_change_${Date.now()}`;
    const sessionChange = await getSession(testPsidChange);
    sessionChange.dining_mode = 'Delivery';
    sessionChange.cart = [{ id: 1, name: 'Americano', price: 120.00, quantity: 1 }];
    sessionChange.state = 'ORDERING';
    await saveSession(sessionChange);

    await handleMessageEvent(testPsidChange, 'checkout');
    await handleMessageEvent(testPsidChange, `Name: Pedro Penduko\nPhone: 09223334444\nAddress: Pioneer St\nPayment: Cash`);

    const sessionBeforeChange = await getSession(testPsidChange);
    assert.strictEqual(sessionBeforeChange.state, 'AWAITING_ADDRESS_CONFIRMATION');

    // Customer selects [2] Ibahin ang address
    sentMessages.length = 0;
    await handleMessageEvent(testPsidChange, 'Ibahin ang address');

    const retryPrompt = sentMessages.find(m => m.messagePayload?.text?.includes('specific street number at kalapit na landmark'));
    assert.ok(retryPrompt, 'Must ask for specific street and landmark');
    console.log('  -> Received retry landmark prompt:', retryPrompt.messagePayload.text);

    const sessionAwaitingRetry = await getSession(testPsidChange);
    assert.strictEqual(sessionAwaitingRetry.state, 'AWAITING_ADDRESS_RETRY');

    // Customer provides revised specific address
    sentMessages.length = 0;
    await handleMessageEvent(testPsidChange, '#50 Pioneer St tapat ng Robinsons Forum, Mandaluyong');

    const newConfirmMsg = sentMessages.find(m => m.messagePayload?.text?.includes('Nai-locate po namin ang inyong drop-off'));
    assert.ok(newConfirmMsg, 'Must re-geocode and send new confirmation prompt');
    console.log('  -> Successfully re-geocoded revised address and re-prompted for confirmation.');

    // Customer confirms new address
    sentMessages.length = 0;
    await handleMessageEvent(testPsidChange, 'Oo, tama ito');
    const discountAfterRetry = sentMessages.find(m => m.messagePayload?.text?.includes('Senior Citizen o PWD ID'));
    assert.ok(discountAfterRetry, 'Successfully transitioned to discount check after revised address confirmation.');

    console.log('  ✓ Test 5 Passed: Address retry and re-confirmation cycle verified.');

    // ---------------------------------------------------------------------------
    // [Test 6] Non-deliverable (> 10 km) and Unlocatable Fallback Prompts
    // ---------------------------------------------------------------------------
    console.log('\n[Test 6] Testing Unlocatable Address Fallback Prompt...');
    const testPsidUnloc = `test_unloc_${Date.now()}`;
    const sessionUnloc = await getSession(testPsidUnloc);
    sessionUnloc.dining_mode = 'Delivery';
    sessionUnloc.cart = [{ id: 1, name: 'Cold Brew', price: 130.00, quantity: 1 }];
    sessionUnloc.state = 'ORDERING';
    await saveSession(sessionUnloc);

    await handleMessageEvent(testPsidUnloc, 'checkout');
    sentMessages.length = 0;
    await handleMessageEvent(testPsidUnloc, `Name: Juan\nPhone: 09171112222\nAddress: nowhere\nPayment: Cash`);

    const unlocMsg = sentMessages.find(m => m.messagePayload?.text?.includes('hindi namin mahanap ang eksaktong lokasyon'));
    assert.ok(unlocMsg, 'Must prompt fallback message for unlocatable address');
    console.log('  -> Fallback prompt dispatched:', unlocMsg.messagePayload.text);

    const sessionUnlocFinal = await getSession(testPsidUnloc);
    assert.strictEqual(sessionUnlocFinal.state, 'AWAITING_ADDRESS_RETRY');
    console.log('  ✓ Test 6 Passed: Unlocatable address gracefully prompted and maintained in AWAITING_ADDRESS_RETRY.');

    console.log('\n================================================================');
    console.log('ALL GEOCODING & DELIVERY FEE INTERACTIVE TESTS PASSED! 🎉');
    console.log('================================================================');

  } finally {
    messengerService.callSendAPI = origCallSendAPI;
  }
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
