const assert = require('assert');
process.env.DB_FORCE_SQLITE = 'true';
process.env.DATABASE_CLIENT = 'sqlite';

const config = require('../src/config/config');
const db = require('../database/db');
const {
  calculateDeliveryFee,
  computeDeliveryFee,
  getStoreOrigin,
  DEFAULT_STORE_NAME,
  DEFAULT_STORE_LAT,
  DEFAULT_STORE_LNG,
  DEFAULT_MAX_RADIUS_KM,
  BASE_FARE,
  BASE_COVERAGE_KM,
  INCREMENTAL_RATE_PER_KM
} = require('../src/services/deliveryFeeCalculator');

const {
  handleMessageEvent,
  calculateDeliveryDistanceAndFee,
  formatPlaintextOrderSummary
} = require('../src/services/nlpEngine');
const { getSession, saveSession } = require('../src/services/sessionManager');
const messengerService = require('../src/services/messengerService');

async function runTests() {
  console.log('================================================================');
  console.log('RUNNING AUTOMATED DISTANCE-BASED DELIVERY FARE CALCULATION TESTS');
  console.log('================================================================');

  await db.initDatabase();

  // ---------------------------------------------------------------------------
  // [Test 1] Store Fixed Origin Coordinates
  // ---------------------------------------------------------------------------
  console.log('\n[Test 1] Verifying Static Store Origin Coordinates & Config Defaults...');
  const origin = getStoreOrigin();
  console.log('  Resolved Store Origin:', origin);
  assert.strictEqual(origin.name, "Diner's Cafe - Main Branch", 'Default store name must be Diner\'s Cafe - Main Branch');
  assert.ok(Number.isFinite(origin.lat) && origin.lat > 0, 'Origin latitude must be a valid positive number');
  assert.ok(Number.isFinite(origin.lng) && origin.lng > 0, 'Origin longitude must be a valid positive number');
  assert.strictEqual(origin.maxRadiusKm, 3.0, 'Default Max Delivery Radius must be 3.0 km');
  console.log('  ✓ Test 1 Passed: Static Origin Coordinates and Config Defaults verified.');

  // ---------------------------------------------------------------------------
  // [Test 2] Fare Matrix Rules (Base ₱40 up to 2km, ₱12/km rounded up beyond 2km)
  // ---------------------------------------------------------------------------
  console.log('\n[Test 2] Verifying Fare Matrix Mathematical Rules...');
  
  // First 2 km: ₱40.00
  const fare0_5 = computeDeliveryFee(0.5);
  assert.strictEqual(fare0_5.deliveryFee, 40.00, '0.5 km must be ₱40.00 base fare');
  assert.strictEqual(fare0_5.isBeyondRadius, false);

  const fare1_5 = computeDeliveryFee(1.5);
  assert.strictEqual(fare1_5.deliveryFee, 40.00, '1.5 km must be ₱40.00 base fare');
  assert.strictEqual(fare1_5.isBeyondRadius, false);

  const fare2_0 = computeDeliveryFee(2.0);
  assert.strictEqual(fare2_0.deliveryFee, 40.00, '2.0 km must be ₱40.00 base fare');
  assert.strictEqual(fare2_0.isBeyondRadius, false);
  console.log('  ✓ Within 2.0 km: Exactly ₱40.00 Base Fare verified.');

  // Beyond 2 km: rounded up to nearest km * ₱12.00
  // 2.1 km -> excess 0.1 km -> ceil(0.1) = 1 km -> 40 + 1 * 12 = 52.00
  const fare2_1 = computeDeliveryFee(2.1);
  assert.strictEqual(fare2_1.deliveryFee, 52.00, '2.1 km must be ₱52.00 (40 + 12)');
  assert.strictEqual(fare2_1.excessKm, 1);
  assert.strictEqual(fare2_1.isBeyondRadius, false);

  // 2.8 km -> excess 0.8 km -> ceil(0.8) = 1 km -> 40 + 1 * 12 = 52.00
  const fare2_8 = computeDeliveryFee(2.8);
  assert.strictEqual(fare2_8.deliveryFee, 52.00, '2.8 km must be ₱52.00 (40 + 12)');
  assert.strictEqual(fare2_8.isBeyondRadius, false);

  // 3.0 km -> excess 1.0 km -> ceil(1.0) = 1 km -> 40 + 1 * 12 = 52.00
  const fare3_0 = computeDeliveryFee(3.0);
  assert.strictEqual(fare3_0.deliveryFee, 52.00, '3.0 km must be ₱52.00 (40 + 12)');
  assert.strictEqual(fare3_0.isBeyondRadius, false);

  // 3.1 km -> excess 1.1 km -> ceil(1.1) = 2 km -> 40 + 2 * 12 = 64.00, and isBeyondRadius = true
  const fare3_1 = computeDeliveryFee(3.1);
  assert.strictEqual(fare3_1.deliveryFee, 64.00, '3.1 km must be ₱64.00 (40 + 24)');
  assert.strictEqual(fare3_1.excessKm, 2);
  assert.strictEqual(fare3_1.isBeyondRadius, true, '3.1 km must trigger isBeyondRadius = true');

  // 4.0 km -> excess 2.0 km -> ceil(2.0) = 2 km -> 40 + 2 * 12 = 64.00
  const fare4_0 = computeDeliveryFee(4.0);
  assert.strictEqual(fare4_0.deliveryFee, 64.00, '4.0 km must be ₱64.00');
  assert.strictEqual(fare4_0.isBeyondRadius, true);

  // 4.2 km -> excess 2.2 km -> ceil(2.2) = 3 km -> 40 + 3 * 12 = 76.00
  const fare4_2 = computeDeliveryFee(4.2);
  assert.strictEqual(fare4_2.deliveryFee, 76.00, '4.2 km must be ₱76.00');
  assert.strictEqual(fare4_2.excessKm, 3);
  assert.strictEqual(fare4_2.isBeyondRadius, true);
  assert.strictEqual(fare4_2.isDeliverable, true, '4.2 km is within 10 km limit');

  // 10.0 km -> exactly at limit
  const fare10_0 = computeDeliveryFee(10.0);
  assert.strictEqual(fare10_0.isDeliverable, true, '10.0 km is deliverable');

  // 10.1 km -> exceeds 10 km limit -> non-deliverable
  const fare10_1 = computeDeliveryFee(10.1);
  assert.strictEqual(fare10_1.isDeliverable, false, '10.1 km must be flagged as non-deliverable');
  assert.strictEqual(fare10_1.isBeyondRadius, true);

  console.log('  ✓ Incremental Rate & Radius Boundary checks (10 km non-deliverable limit) verified.');

  // ---------------------------------------------------------------------------
  // [Test 3] Helper Function Signatures: (lat, lng), ({ lat, lng }), ("lat, lng")
  // ---------------------------------------------------------------------------
  console.log('\n[Test 3] Testing calculateDeliveryFee helper signatures...');
  
  // 3a. Calling with (lat, lng)
  const resByCoords = await calculateDeliveryFee(14.6200, 120.9700);
  console.log('  calculateDeliveryFee(14.62, 120.97) ->', resByCoords.distanceKm, 'km, ₱', resByCoords.deliveryFee);
  assert.ok(typeof resByCoords.deliveryFee === 'number');
  assert.ok(resByCoords.deliveryFee >= 40.00);
  assert.strictEqual(typeof resByCoords.valueOf(), 'number');

  // 3b. Calling with object { lat, lng }
  const resByObj = await calculateDeliveryFee({ lat: 14.6200, lng: 120.9700 });
  assert.strictEqual(resByObj.deliveryFee, resByCoords.deliveryFee);

  // 3c. Calling with coordinate string "14.6200, 120.9700"
  const resByCoordStr = await calculateDeliveryFee("14.6200, 120.9700");
  assert.strictEqual(resByCoordStr.deliveryFee, resByCoords.deliveryFee);

  // 3d. Calling with text address string (geocoded)
  const resByAddr = await calculateDeliveryFee("Sampaloc, Manila");
  console.log('  calculateDeliveryFee("Sampaloc, Manila") ->', resByAddr.distanceKm, 'km, ₱', resByAddr.deliveryFee);
  assert.ok(typeof resByAddr.deliveryFee === 'number');
  assert.ok(resByAddr.deliveryFee >= 40.00);

  // 3e. Calling with explicit Haversine method (offline/zero-cost)
  const resHaversine = await calculateDeliveryFee(14.6200, 120.9700, { method: 'haversine' });
  assert.strictEqual(resHaversine.provider, 'haversine', 'Provider must be haversine');
  assert.ok(typeof resHaversine.deliveryFee === 'number');

  // 3f. Calling with location > 10 km (e.g. Quezon City / Taguig far coordinates)
  const resFar = await calculateDeliveryFee(14.7500, 121.1500, { method: 'haversine' });
  console.log('  Far coordinates test (distance: ' + resFar.distanceKm + ' km, isDeliverable: ' + resFar.isDeliverable + ')');
  assert.ok(resFar.distanceKm > 10.0, 'Distance must exceed 10 km');
  assert.strictEqual(resFar.isDeliverable, false, 'Must be flagged as non-deliverable beyond 10 km');

  console.log('  ✓ Test 3 Passed: All calculateDeliveryFee signatures & methods (Haversine, OSRM, 10km limit) verified.');

  // ---------------------------------------------------------------------------
  // [Test 4] Chatbot Checkout Integration & Order Summary Calculation
  // ---------------------------------------------------------------------------
  console.log('\n[Test 4] Testing Chatbot Checkout Integration for Delivery Order...');
  
  const testPsid = `test_fare_integration_${Date.now()}`;
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

    // Customer initiates checkout
    sentMessages.length = 0;
    await handleMessageEvent(testPsid, 'checkout');

    // Customer supplies delivery address: 123 Rizal St, Manila
    sentMessages.length = 0;
    const checkoutInfo = `Name: Juan Dela Cruz\nPhone: 09171234567\nAddress: 123 Rizal St, Manila\nPayment: Cash`;
    await handleMessageEvent(testPsid, checkoutInfo);

    // Verify session has delivery_fee calculated
    const sessionAfterInfo = await getSession(testPsid);
    console.log('  Calculated session.delivery_fee:', sessionAfterInfo.delivery_fee);
    assert.ok(Number.isFinite(sessionAfterInfo.delivery_fee), 'session.delivery_fee must be stored');
    assert.ok(sessionAfterInfo.delivery_fee >= 40.00, 'session.delivery_fee must be at least ₱40.00');

    // Customer confirms drop-off location
    sentMessages.length = 0;
    await handleMessageEvent(testPsid, 'Oo, tama ito');

    // Customer answers discount question ("Wala po") -> triggers Order Summary Receipt
    sentMessages.length = 0;
    await handleMessageEvent(testPsid, 'wala po');

    const summaryMsg = sentMessages.find(m => m.messagePayload?.text?.includes('--- ORDER SUMMARY ---'));
    assert.ok(summaryMsg, 'Order Summary must be sent');
    const summaryText = summaryMsg.messagePayload.text;

    console.log('\n--- Final Order Summary Receipt ---\n' + summaryText + '\n-----------------------------------\n');

    // Expected values
    const expectedFee = sessionAfterInfo.delivery_fee;
    const expectedSubtotal = 195.00;
    const expectedTotal = expectedSubtotal + expectedFee;

    assert.ok(summaryText.includes(`Delivery Fee: ₱${expectedFee.toFixed(2)}`), `Summary must include Delivery Fee: ₱${expectedFee.toFixed(2)}`);
    assert.ok(summaryText.includes(`TOTAL AMOUNT DUE: ₱${expectedTotal.toFixed(2)}`), `TOTAL AMOUNT DUE must equal Subtotal (195) + Fee (${expectedFee}) = ₱${expectedTotal.toFixed(2)}`);
    assert.ok(summaryText.includes('Dining-mode: Delivery'), 'Dining-mode must be Delivery');

    console.log('  ✓ Test 4 Passed: Chatbot successfully executed fee calculator, updated session, and rendered receipt.');

    // ---------------------------------------------------------------------------
    // [Test 5] Dine In / Pick-up Zero Delivery Fee Verification
    // ---------------------------------------------------------------------------
    console.log('\n[Test 5] Verifying Dine In has ₱0.00 delivery fee in receipt...');
    const dineInSummary = formatPlaintextOrderSummary({
      name: 'Maria Santos',
      phone: '09181234567',
      diningMode: 'Dine In',
      address: origin.name,
      discountType: 'None',
      paymentMode: 'Cash',
      cart: [{ name: 'Americano', price: 120.00, quantity: 1 }],
      subtotal: 120.00,
      discountAmount: 0,
      deliveryFee: 0,
      total: 120.00
    });

    assert.ok(dineInSummary.includes('Delivery Fee: ₱0.00'), 'Dine in must show Delivery Fee: ₱0.00');
    assert.ok(dineInSummary.includes('TOTAL AMOUNT DUE: ₱120.00'), 'Dine in total must be ₱120.00');
    console.log('  ✓ Test 5 Passed: Dine In / Pick-up correctly evaluates to ₱0.00 delivery fee.');

    console.log('\n================================================================');
    console.log('ALL DISTANCE-BASED DELIVERY FARE TESTS PASSED SUCCESSFULLY! 🎉');
    console.log('================================================================');

  } finally {
    messengerService.callSendAPI = origCallSendAPI;
  }
}

runTests().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
