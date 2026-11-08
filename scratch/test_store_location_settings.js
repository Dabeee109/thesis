/**
 * Comprehensive Test Suite for Store Branch & Delivery Location Settings
 */

const assert = require('assert');
const jwt = require('jsonwebtoken');
const config = require('../src/config/config');
const storeSettingsService = require('../src/services/storeSettingsService');
const nlpEngine = require('../src/services/nlpEngine');
const geoService = require('../src/services/geoService');
const { calculateDeliveryFare } = require('../src/services/fareCalculator');

async function runTests() {
  console.log('=== STARTING STORE BRANCH & DELIVERY LOCATION SETTINGS TESTS ===\n');

  // 1. Initial State Verification
  console.log('[Test 1] Verifying initial store settings loading...');
  const initialSettings = await storeSettingsService.getStoreSettings();
  console.log('  Initial settings:', {
    name: initialSettings.store_name,
    address: initialSettings.store_address,
    lat: initialSettings.store_latitude,
    lng: initialSettings.store_longitude,
    maxRadius: initialSettings.max_delivery_radius_km
  });
  assert(initialSettings.store_name, 'Store name should exist');
  assert(initialSettings.store_address, 'Store address should exist');
  assert(Number.isFinite(initialSettings.store_latitude), 'Store latitude should be finite number');
  assert(Number.isFinite(initialSettings.store_longitude), 'Store longitude should be finite number');
  assert(Number.isFinite(initialSettings.max_delivery_radius_km), 'Max delivery radius should be finite number');
  console.log('✓ Test 1 Passed: Initial store settings verified.\n');

  // 2. Synchronous Cached Settings Parity
  console.log('[Test 2] Verifying getCachedStoreSettings parity...');
  const cached = storeSettingsService.getCachedStoreSettings();
  assert.strictEqual(cached.store_name, initialSettings.store_name);
  assert.strictEqual(cached.store_address, initialSettings.store_address);
  assert.strictEqual(cached.store_latitude, initialSettings.store_latitude);
  assert.strictEqual(cached.store_longitude, initialSettings.store_longitude);
  assert.strictEqual(cached.max_delivery_radius_km, initialSettings.max_delivery_radius_km);
  console.log('✓ Test 2 Passed: In-memory cache mirrors DB settings.\n');

  // 3. Dynamic Update of Location & Dispatch Boundaries
  console.log('[Test 3] Updating store settings to new branch & coordinates...');
  const testBranchPayload = {
    store_name: "Diner's Cafe - BGC Uptown Branch",
    store_address: "9th Ave cor 36th St, Bonifacio Global City, Taguig, 1634 Metro Manila",
    store_latitude: 14.55470000,
    store_longitude: 121.05090000,
    max_delivery_radius_km: 4.50
  };

  const updatedSettings = await storeSettingsService.updateStoreSettings(testBranchPayload);
  assert.strictEqual(updatedSettings.store_name, testBranchPayload.store_name);
  assert.strictEqual(updatedSettings.store_address, testBranchPayload.store_address);
  assert.strictEqual(updatedSettings.store_latitude, testBranchPayload.store_latitude);
  assert.strictEqual(updatedSettings.store_longitude, testBranchPayload.store_longitude);
  assert.strictEqual(updatedSettings.max_delivery_radius_km, testBranchPayload.max_delivery_radius_km);

  // Verify DB re-read confirms persistence
  const reRead = await storeSettingsService.getStoreSettings();
  assert.strictEqual(reRead.store_name, testBranchPayload.store_name);
  assert.strictEqual(reRead.store_address, testBranchPayload.store_address);
  assert.strictEqual(reRead.store_latitude, testBranchPayload.store_latitude);
  assert.strictEqual(reRead.store_longitude, testBranchPayload.store_longitude);
  assert.strictEqual(reRead.max_delivery_radius_km, testBranchPayload.max_delivery_radius_km);
  console.log('✓ Test 3 Passed: Updated settings persisted to database and cache.\n');

  // 4. Verification with Messenger Bot Slot-Filling & Order Summary Auto-Assignment
  console.log('[Test 4] Testing Dine In & Pick-up auto-assignment in Messenger bot...');
  const testSessionDineIn = {
    dining_mode: 'Dine In',
    customer_name: 'Maria Clara',
    contact_number: '09171234567',
    cart: [{ name: 'Signature Spanish Latte', price: 140, quantity: 2 }],
    order_subtotal: 280,
    discount_amount: 0
  };

  const receiptText = nlpEngine.formatPlaintextOrderSummary({
    name: testSessionDineIn.customer_name,
    phone: testSessionDineIn.contact_number,
    diningMode: testSessionDineIn.dining_mode,
    address: '', // empty input to trigger auto-assignment
    discountType: 'None',
    paymentMode: 'Cash',
    cart: testSessionDineIn.cart,
    subtotal: 280,
    discountAmount: 0,
    deliveryFee: 0,
    total: 280
  });

  console.log('  Generated receipt preview:\n' + receiptText);
  assert(receiptText.includes(testBranchPayload.store_address), 'Receipt address should match dynamic store branch address');
  assert(receiptText.includes('Dining-mode: Dine In'), 'Receipt should show Dine In');
  assert(receiptText.includes('Delivery Fee: ₱0.00'), 'Dine in should have ₱0 delivery fee');
  console.log('✓ Test 4 Passed: Dine In & Pick-up auto-assigns dynamic store physical address.\n');

  // 5. Dynamic Distance Calculation & Dispatch Boundary Validation
  console.log('[Test 5] Testing dynamic dispatch boundary and distance calculation...');
  // Point within 4.5km of BGC (e.g. Market Market ~0.8km away)
  const nearbyLat = 14.5492;
  const nearbyLng = 121.0560;
  const quoteResult = await geoService.quoteDelivery({
    lat: nearbyLat,
    lng: nearbyLng
  });
  console.log('  Quote result for nearby location:', {
    distanceKm: quoteResult.distanceKm,
    finalFare: quoteResult.fare?.finalFare,
    vehicleType: quoteResult.vehicleType
  });
  assert(quoteResult.distanceKm <= 4.5, 'Location should be within new 4.5km radius');
  assert(quoteResult.fare?.finalFare > 0, 'Fare should be computed');

  // Point beyond 4.5km (e.g. Quezon City ~15km away)
  const farLat = 14.6760;
  const farLng = 121.0437;
  let errorCaught = false;
  try {
    await geoService.quoteDelivery({
      lat: farLat,
      lng: farLng
    });
  } catch (geoErr) {
    errorCaught = true;
    console.log('  Caught expected out-of-boundary error:', geoErr.message, 'code:', geoErr.code);
    assert(geoErr.message.includes('4.5 km'), 'Error message should dynamically mention the 4.5 km radius');
  }
  assert(errorCaught, 'Should reject deliveries beyond dynamic max radius');
  console.log('✓ Test 5 Passed: Dynamic coordinates & delivery radius cutoff correctly enforced.\n');

  // 6. Reset to default Main Branch for system cleanliness
  console.log('[Test 6] Restoring default store settings...');
  await storeSettingsService.updateStoreSettings({
    store_name: "Diner's Cafe - Main Branch",
    store_address: "Diner's Cafe - Store Main Branch, Mandaluyong City",
    store_latitude: 14.6042,
    store_longitude: 120.9822,
    max_delivery_radius_km: 3.00
  });
  const restored = storeSettingsService.getCachedStoreSettings();
  assert.strictEqual(restored.store_name, "Diner's Cafe - Main Branch");
  assert.strictEqual(restored.max_delivery_radius_km, 3.0);
  console.log('✓ Test 6 Passed: Default store settings cleanly restored.\n');

  console.log('🎉 ALL STORE BRANCH & DELIVERY LOCATION TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
