/**
 * Test Suite for GCash Payment Configuration & Store Location Settings Integration
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const config = require('../src/config/config');
const storeSettingsService = require('../src/services/storeSettingsService');
const nlpEngine = require('../src/services/nlpEngine');

async function runTests() {
  console.log('=== STARTING GCASH & STORE LOCATION CONFIGURATION TESTS ===\n');

  const adminToken = jwt.sign(
    { id: 1, email: 'admin@dinerscafe.ph', role: 'admin' },
    config.jwtSecret,
    { expiresIn: '1h' }
  );

  // 1. Test GET /api/admin/settings/general
  console.log('[Test 1] Testing GET /api/admin/settings/general...');
  const resGeneral = await fetch('http://localhost:3000/api/admin/settings/general', {
    headers: { 'Authorization': 'Bearer ' + adminToken }
  });
  const dataGeneral = await resGeneral.json();
  console.log('  General settings response:', {
    success: dataGeneral.success,
    gcashName: dataGeneral.gcash?.gcash_account_name,
    gcashNumber: dataGeneral.gcash?.gcash_account_number,
    storeName: dataGeneral.location?.store_name,
    storeAddress: dataGeneral.location?.store_address,
    maxRadius: dataGeneral.location?.max_delivery_radius_km
  });
  assert(dataGeneral.success, 'General settings should succeed');
  assert(dataGeneral.gcash?.gcash_account_name, 'GCash account name should exist');
  assert(dataGeneral.location?.store_name, 'Store name should exist');
  console.log('✓ Test 1 Passed: GET /api/admin/settings/general returned both GCash and Location data.\n');

  // 2. Test PUT /api/admin/settings/gcash with JSON
  console.log('[Test 2] Testing PUT /api/admin/settings/gcash with JSON...');
  const resPutGcash = await fetch('http://localhost:3000/api/admin/settings/gcash', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + adminToken
    },
    body: JSON.stringify({
      gcash_account_name: "Diner's Cafe - Tondo Branch",
      gcash_account_number: "09171234567"
    })
  });
  const dataPutGcash = await resPutGcash.json();
  console.log('  PUT GCash response:', dataPutGcash);
  assert(dataPutGcash.success, 'PUT GCash should succeed');
  assert.strictEqual(dataPutGcash.settings.gcash_account_name, "Diner's Cafe - Tondo Branch");
  assert.strictEqual(dataPutGcash.settings.gcash_account_number, "09171234567");
  console.log('✓ Test 2 Passed: Updated GCash credentials saved.\n');

  // 3. Test PUT /api/admin/settings/gcash with multipart/form-data QR upload
  console.log('[Test 3] Testing PUT /api/admin/settings/gcash with file upload (FormData)...');
  const sampleQrPath = path.join(__dirname, '../public/uploads/qr/gcash_qr_CHECKOUT.png');
  const qrBuffer = fs.existsSync(sampleQrPath) ? fs.readFileSync(sampleQrPath) : Buffer.from('fake-qr-content');
  const blob = new Blob([qrBuffer], { type: 'image/png' });
  const formData = new FormData();
  formData.append('gcash_account_name', "Diner's Cafe Official");
  formData.append('gcash_account_number', "09281762895");
  formData.append('gcash_qr_image', blob, 'sample_test_qr.png');

  const resUpload = await fetch('http://localhost:3000/api/admin/settings/gcash', {
    method: 'PUT',
    headers: {
      'Authorization': 'Bearer ' + adminToken
    },
    body: formData
  });
  const dataUpload = await resUpload.json();
  console.log('  Upload response:', dataUpload);
  assert(dataUpload.success, 'Upload should succeed');
  assert(dataUpload.settings.gcash_qr_image_url.startsWith('/uploads/qr/'), 'QR URL should point to /uploads/qr/');
  assert(fs.existsSync(path.join(__dirname, '../public', dataUpload.settings.gcash_qr_image_url)), 'Uploaded file should exist on disk');
  console.log('✓ Test 3 Passed: Multipart QR Code file uploaded and saved to /public/uploads/qr/.\n');

  // 4. Test PUT /api/admin/settings/location
  console.log('[Test 4] Testing PUT /api/admin/settings/location...');
  const resLocation = await fetch('http://localhost:3000/api/admin/settings/location', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + adminToken
    },
    body: JSON.stringify({
      store_name: "Diner's Cafe Tondo",
      store_address: "Diner's Cafe Tondo, Manila",
      store_latitude: 14.6144,
      store_longitude: 120.9642,
      max_delivery_radius_km: 3.00
    })
  });
  const dataLocation = await resLocation.json();
  console.log('  PUT Location response:', dataLocation);
  assert(dataLocation.success, 'PUT Location should succeed');
  assert.strictEqual(dataLocation.settings.store_name, "Diner's Cafe Tondo");
  assert.strictEqual(dataLocation.settings.store_latitude, 14.6144);
  assert.strictEqual(dataLocation.settings.store_longitude, 120.9642);
  console.log('✓ Test 4 Passed: Location and dispatch boundaries updated successfully.\n');

  // 5. Test Bot GCash Checkout Flow uses new dynamic credentials and QR
  console.log('[Test 5] Testing Messenger Bot GCash Checkout Flow with dynamic settings...');
  const testPsid = 'test_user_gcash_cfg_' + Date.now();
  const session = {
    psid: testPsid,
    customer_name: 'Aling Nena',
    contact_number: '09181112233',
    phone_number: '09181112233',
    dining_mode: 'Dine In',
    cart: [{ id: 1, name: 'Signature Spanish Latte', price: 145, quantity: 1 }],
    order_subtotal: 145,
    order_total: 145,
    discount_amount: 0,
    payment_mode: 'GCash'
  };

  const checkoutResult = await nlpEngine.finalizeOrderSummaryAndPayment(testPsid, session);
  console.log('  Bot checkout result:', checkoutResult);
  assert.strictEqual(checkoutResult.intent, 'AWAITING_PAYMENT_PROOF', 'Should enter AWAITING_PAYMENT_PROOF');
  console.log('✓ Test 5 Passed: GCash checkout successfully dispatched using dynamic credentials.\n');

  // 6. Test Bot Auto-Fill for Pick-up / Dine-in with dynamic store address
  console.log('[Test 6] Testing Dine In & Pick-up auto-fill with updated store address...');
  await storeSettingsService.getStoreSettings();
  const receipt = nlpEngine.formatPlaintextOrderSummary({
    name: 'Aling Nena',
    phone: '09181112233',
    diningMode: 'Pick-up',
    address: '',
    discountType: 'None',
    paymentMode: 'GCash',
    cart: [{ name: 'Cold Brew', price: 120, quantity: 1 }],
    subtotal: 120,
    discountAmount: 0,
    deliveryFee: 0,
    total: 120
  });
  console.log('  Receipt preview:\n' + receipt);
  assert(receipt.includes("Diner's Cafe Tondo, Manila"), 'Should auto-fill updated store address');
  console.log('✓ Test 6 Passed: Dynamic store address auto-assigned into customer receipt.\n');

  // 7. Restore Defaults
  console.log('[Test 7] Restoring standard defaults...');
  await storeSettingsService.updateStoreSettings({
    store_name: "Diner's Cafe - Main Branch",
    store_address: "123 Boni Ave, Mandaluyong City",
    store_latitude: 14.5794,
    store_longitude: 121.0359,
    max_delivery_radius_km: 3.00
  });
  await storeSettingsService.updateGcashSettings({
    gcash_account_name: "Diner's Cafe",
    gcash_account_number: "0928 176 2895",
    gcash_qr_image_url: "/uploads/qr/gcash_qr_CHECKOUT.png"
  });
  console.log('✓ Test 7 Passed: Default settings cleanly restored.\n');

  console.log('🎉 ALL GCASH & STORE LOCATION CONFIGURATION TESTS PASSED!\n');
}

runTests().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
