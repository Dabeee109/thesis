/**
 * Comprehensive verification for Pre-Menu Event/Promotion Teaser Multi-Message Sequential Dispatch
 */
const assert = require('assert');
const db = require('../database/db');
const messengerService = require('../src/services/messengerService');
const {
  sendFullMenu,
  formatPromotionAnnouncement,
  getActivePromotionForPreMenu
} = require('../src/services/nlpEngine');

async function runTests() {
  console.log('=== STARTING PRE-MENU SEQUENTIAL TEASER TESTS ===\n');

  // -------------------------------------------------------------
  // Test 1: Template string handler formatting
  // -------------------------------------------------------------
  console.log('[Test 1] Testing formatPromotionAnnouncement template string handler...');

  const mockPromo = {
    title: 'Grand Acoustic Night & 20% OFF Cold Brews',
    start_date: '2026-11-14',
    end_date: '2026-11-15',
    description: 'Samahan kami ngayong weekend para sa acoustic music at discounts!',
    perk_description: '20% OFF'
  };

  const formatted = formatPromotionAnnouncement(mockPromo);
  console.log('Generated Announcement Text:\n---\n' + formatted + '\n---');

  const expectedLines = [
    '📢 SPECIAL EVENT ANNOUNCEMENT!',
    '',
    'Grand Acoustic Night & 20% OFF Cold Brews',
    '📅 Petsa: 2026-11-14 to 2026-11-15',
    '',
    'Samahan kami ngayong weekend para sa acoustic music at discounts!',
    '',
    'Bago po kayo mag-order, nais niyo po ba itong i-avail? Eto po ang ating buong menu:'
  ];

  assert.strictEqual(formatted, expectedLines.join('\n'), 'Announcement text must exactly match specified layout');
  console.log('✔ Test 1 Passed: Template string handler matches layout perfectly.\n');

  // -------------------------------------------------------------
  // Test 2: Database Query for Active Promotion
  // -------------------------------------------------------------
  console.log('[Test 2] Testing getActivePromotionForPreMenu with active promotion...');

  const today = new Date().toISOString().split('T')[0];
  const [insertRes] = await db.query(`
    INSERT INTO promotions (title, description, perk_description, promo_type, start_date, end_date, banner_image_url, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `, [
    'Special Weekend Live Fest',
    'Enjoy live music and treats!',
    'Buy 1 Take 1',
    'event',
    today,
    today,
    'https://example.com/posters/live-fest.jpg'
  ]);
  const testPromoId = insertRes.insertId || insertRes.lastID;

  const activePromo = await getActivePromotionForPreMenu();
  assert.ok(activePromo, 'Active promotion must be retrieved');
  console.log(` Retrieved active promo: ID=${activePromo.id}, Title="${activePromo.title}"`);
  assert.strictEqual(activePromo.is_active, 1);
  console.log('✔ Test 2 Passed: Active promo query verified.\n');

  // -------------------------------------------------------------
  // Test 3: Branch A - Multi-Message Sequential Dispatch
  // -------------------------------------------------------------
  console.log('[Test 3] Testing Branch A: Multi-Message Sequential Dispatch (Message 1 -> 2 -> 3)...');

  const dispatchedCalls = [];
  const origCallSendAPI = messengerService.callSendAPI;
  messengerService.callSendAPI = async (recipientPsid, messagePayload, options = {}) => {
    dispatchedCalls.push({
      psid: recipientPsid,
      payload: messagePayload,
      timestamp: Date.now()
    });
    return { recipient_id: recipientPsid, message_id: `mock_mid_${dispatchedCalls.length}` };
  };

  try {
    const sessionMock = {
      dining_mode: 'Dine In',
      cart: [],
      state: 'IDLE'
    };

    dispatchedCalls.length = 0;
    await sendFullMenu('TEST_PSID_BRANCH_A', sessionMock);

    console.log(` Total messages dispatched in Branch A: ${dispatchedCalls.length}`);
    assert.ok(dispatchedCalls.length >= 3, 'At least 3 messages must be dispatched (Poster, Announcement, Menu)');

    // Message 1: Send Poster Image Attachment
    const msg1 = dispatchedCalls[0];
    console.log(' Message 1 Payload:', JSON.stringify(msg1.payload));
    assert.strictEqual(msg1.payload.attachment?.type, 'image', 'Message 1 must be an image attachment');
    assert.ok(msg1.payload.attachment?.payload?.url, 'Message 1 must contain image url');
    assert.strictEqual(msg1.payload.attachment?.payload?.is_reusable, true, 'Message 1 is_reusable must be true');

    // Message 2: Send Structured Text Announcement
    const msg2 = dispatchedCalls[1];
    console.log(' Message 2 Payload Text:\n' + msg2.payload.text);
    assert.ok(msg2.payload.text?.includes('📢 SPECIAL EVENT ANNOUNCEMENT!'), 'Message 2 must have announcement header');
    assert.ok(msg2.payload.text?.includes('Bago po kayo mag-order, nais niyo po ba itong i-avail? Eto po ang ating buong menu:'), 'Message 2 must contain prompt');

    // Message 3: Send Full Menu Catalog (Carousel)
    const msg3 = dispatchedCalls[2];
    assert.strictEqual(msg3.payload.attachment?.type, 'template', 'Message 3 must be a generic template carousel');
    assert.strictEqual(msg3.payload.attachment?.payload?.template_type, 'generic', 'Message 3 template_type must be generic');
    assert.ok(msg3.payload.attachment?.payload?.elements?.length > 0, 'Message 3 must contain menu item elements');

    console.log('✔ Test 3 Passed: Branch A executed strictly in order (Message 1: Poster -> Message 2: Announcement -> Message 3: Menu Catalog).\n');
  } finally {
    // Clean up test promo
    await db.query('DELETE FROM promotions WHERE id = ?', [testPromoId]);
  }

  // -------------------------------------------------------------
  // Test 4: Branch B - NO Active Promo/Event Exists
  // -------------------------------------------------------------
  console.log('[Test 4] Testing Branch B: NO Active Promo (Messages 1 & 2 skipped)...');

  // Deactivate all promotions temporarily
  await db.query('UPDATE promotions SET is_active = 0');

  try {
    const sessionMock = {
      dining_mode: 'Delivery',
      cart: [],
      state: 'IDLE'
    };

    dispatchedCalls.length = 0;
    await sendFullMenu('TEST_PSID_BRANCH_B', sessionMock);

    console.log(` Total messages dispatched in Branch B: ${dispatchedCalls.length}`);

    // Verify Messages 1 and 2 are NOT dispatched
    const hasPoster = dispatchedCalls.some(m => m.payload.attachment?.type === 'image');
    assert.strictEqual(hasPoster, false, 'No poster image should be sent in Branch B');

    const hasAnnouncement = dispatchedCalls.some(m => m.payload.text?.includes('📢 SPECIAL EVENT ANNOUNCEMENT!'));
    assert.strictEqual(hasAnnouncement, false, 'No announcement text should be sent in Branch B');

    // Verify direct menu catalog dispatch
    const hasCarousel = dispatchedCalls.some(m => m.payload.attachment?.payload?.template_type === 'generic');
    assert.strictEqual(hasCarousel, true, 'Direct menu carousel must be dispatched in Branch B');

    console.log('✔ Test 4 Passed: Branch B skips Messages 1 & 2 and presents Menu Catalog directly.\n');
  } finally {
    // Restore promotions active status for valid date ranges
    await db.query('UPDATE promotions SET is_active = 1 WHERE end_date >= ? OR end_date IS NULL', [today]);
    messengerService.callSendAPI = origCallSendAPI;
  }

  console.log('=== ALL PRE-MENU SEQUENTIAL TEASER TESTS PASSED SUCCESSFULLY! ===');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});

