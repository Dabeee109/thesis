const assert = require('assert');
const path = require('path');
const fs = require('fs');
const db = require('../database/db');
const promotionController = require('../src/controllers/promotionController');
const messengerService = require('../src/services/messengerService');

const sentMessages = [];
messengerService.callSendAPI = async (psid, payload, options) => {
  sentMessages.push({ psid, payload, timestamp: Date.now() });
  return { recipient_id: psid, message_id: `mid.broadcast.${Date.now()}` };
};

function createMockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status: function(code) {
      this.statusCode = code;
      return this;
    },
    json: function(data) {
      this.body = data;
      return this;
    }
  };
  return res;
}

async function runTests() {
  console.log('--- STARTING PROMOTIONS & EVENTS / BROADCAST ENGINE TESTS ---');

  // Initialize database schema
  await db.initDatabase();

  // Ensure test customers with valid PSIDs exist for broadcast test
  await db.query(`
    INSERT OR IGNORE INTO customers (psid, first_name, last_name, phone_number)
    VALUES 
    ('PSID_BROADCAST_TEST_1', 'Juan', 'Dela Cruz', '09171234567'),
    ('PSID_BROADCAST_TEST_2', 'Maria', 'Clara', '09189876543')
  `);

  // TEST 1: Get Promotions
  console.log('\n[Test 1] Testing GET /promotions...');
  const res1 = createMockRes();
  await promotionController.getPromotions({}, res1);
  assert.strictEqual(res1.statusCode, 200);
  assert.ok(res1.body.success, 'GET /promotions should succeed');
  assert.ok(Array.isArray(res1.body.promotions), 'Should return array of promotions');
  console.log(`✓ Test 1 Passed: Retrieved ${res1.body.count} promotions with computed status`);

  // TEST 2: Photo Upload (JPG / PNG / WebP max 5MB)
  console.log('\n[Test 2] Testing Photo Poster Upload...');
  // 1x1 transparent PNG base64
  const sampleBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const res2 = createMockRes();
  await promotionController.uploadPromotionPoster({ body: { imageBase64: sampleBase64 } }, res2);
  assert.strictEqual(res2.statusCode, 200);
  assert.ok(res2.body.success, 'Upload should succeed');
  assert.ok(res2.body.imageUrl.startsWith('/uploads/promotions/'), 'Poster URL must be in /uploads/promotions/');
  
  const savedFileDisk = path.join(__dirname, '../public', res2.body.imageUrl);
  assert.ok(fs.existsSync(savedFileDisk), 'File must exist on disk');
  console.log('✓ Test 2 Passed: Event poster photo saved to /public/uploads/promotions/');

  // TEST 3: Create Promo / Event
  console.log('\n[Test 3] Testing Create Promo / Event...');
  const res3 = createMockRes();
  const newPromoData = {
    title: 'Weekend Acoustic Live Session & 20% OFF',
    promo_type: 'Cafe Event',
    banner_image_url: res2.body.imageUrl,
    perk_description: '20% OFF on all Iced Brews',
    applicable_scope: 'Cold Brew & Iced Lattes',
    start_date: '2026-11-14',
    end_date: '2026-11-15',
    description: 'Live performance by local indie artists starting 6:00 PM!',
    is_active: 1
  };
  await promotionController.createPromotion({ body: newPromoData }, res3);
  assert.strictEqual(res3.statusCode, 201);
  assert.ok(res3.body.success);
  const createdPromoId = res3.body.promotionId;
  assert.ok(createdPromoId, 'Should return promotionId');
  console.log(`✓ Test 3 Passed: Created Promo with ID #${createdPromoId}`);

  // TEST 4: Toggle Active/Inactive Status
  console.log('\n[Test 4] Testing Toggle Promo Status...');
  const res4 = createMockRes();
  await promotionController.togglePromotionStatus({ params: { id: createdPromoId } }, res4);
  assert.strictEqual(res4.body.is_active, 0, 'Status should toggle to 0 (Inactive)');
  await promotionController.togglePromotionStatus({ params: { id: createdPromoId } }, res4);
  assert.strictEqual(res4.body.is_active, 1, 'Status should toggle back to 1 (Active)');
  console.log('✓ Test 4 Passed: Toggle switch toggles active/inactive state cleanly');

  // TEST 5: Broadcast Recipients Count
  console.log('\n[Test 5] Testing Recipients Count Endpoint...');
  const res5 = createMockRes();
  await promotionController.getBroadcastRecipientsCount({}, res5);
  assert.strictEqual(res5.statusCode, 200);
  assert.ok(res5.body.count >= 2, 'Recipients count should find unique customers');
  console.log(`✓ Test 5 Passed: Broadcast engine detected ${res5.body.count} unique customer recipients`);

  // TEST 6: Messenger Mass Broadcast Throttled Dispatch
  console.log('\n[Test 6] Testing Throttled Messenger Broadcast...');
  sentMessages.length = 0;
  const res6 = createMockRes();
  
  const startTime = Date.now();
  await promotionController.broadcastPromotion({ params: { id: createdPromoId } }, res6);
  const elapsedMs = Date.now() - startTime;

  assert.strictEqual(res6.statusCode, 200);
  assert.ok(res6.body.success, 'Broadcast should succeed');
  assert.ok(res6.body.sentCount >= 2, 'Should send to all unique recipients');
  
  // Verify rate-limiting throttle (delay between users is 75ms)
  console.log(`Broadcast dispatch elapsed time: ${elapsedMs}ms for ${res6.body.totalRecipients} recipients`);
  assert.ok(elapsedMs >= 75 * (res6.body.totalRecipients - 1), 'Dispatch should be rate-limited/throttled');

  // Check Message 1: Image attachment
  const imageMsgs = sentMessages.filter(m => m.payload?.attachment?.type === 'image');
  assert.ok(imageMsgs.length > 0, 'Must send image attachment poster');
  assert.ok(imageMsgs[0].payload.attachment.payload.url.includes('/uploads/promotions/'), 'Poster URL must be included');

  // Check Message 2: Exact announcement layout
  const textMsgs = sentMessages.filter(m => m.payload?.text?.includes('📢 SPECIAL EVENT ANNOUNCEMENT!'));
  assert.ok(textMsgs.length > 0, 'Must send exact text announcement header');
  const annText = textMsgs[0].payload.text;
  assert.ok(annText.includes('Weekend Acoustic Live Session'), 'Must include event title');
  assert.ok(annText.includes('📅 Petsa: 2026-11-14 to 2026-11-15'), 'Must include date range');
  assert.ok(annText.includes('Bisitahin kami sa Diner\'s Cafe o mag-reply lang dito para mag-order!'), 'Must include call-to-action');
  console.log('✓ Test 6 Passed: Throttled broadcast dispatched poster + exact text announcement layout');

  // TEST 7: Delete Promotion
  console.log('\n[Test 7] Testing Delete Promotion...');
  const res7 = createMockRes();
  await promotionController.deletePromotion({ params: { id: createdPromoId } }, res7);
  assert.strictEqual(res7.statusCode, 200);
  console.log('✓ Test 7 Passed: Promotion deleted cleanly');

  console.log('\n🎉 ALL PROMOTIONS & EVENTS / BROADCAST TESTS PASSED SUCCESSFULLY!');
}

runTests().then(() => process.exit(0)).catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

