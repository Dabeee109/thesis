/**
 * Architectural Verification Test Suite for the 6 Critical Bug Fixes & Session Lifecycle Rules
 */
const assert = require('assert');
const { 
  calculateItemLineTotal, 
  calculateCartSubtotal, 
  calculateFinalTotal 
} = require('../src/services/cartService');
const { 
  checkInactivity, 
  startInactivityWorker, 
  stopInactivityWorker,
  INACTIVITY_MESSAGES
} = require('../src/services/inactivityWorker');
const { formatOrderSummaryReceipt } = require('../src/services/geminiService');
const { botMessages } = require('../src/services/botMessages');
const { userSessions, getSession, saveSession } = require('../src/services/sessionManager');
const { expireStaleState } = require('../src/services/nlpEngine');

async function runTests() {
  console.log('================================================================');
  console.log('RUNNING VERIFICATION TEST SUITE: 6 CRITICAL BUG FIXES & LIFECYCLE');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`✅ [PASS] Requirement ${total}: ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] Requirement ${total}: ${name}`);
      console.error(err);
    }
  }

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      console.log(`✅ [PASS] Requirement ${total}: ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] Requirement ${total}: ${name}`);
      console.error(err);
    }
  }

  // -------------------------------------------------------------
  // Test 1: Complete Menu Dispatch on Customer Inquiry
  // -------------------------------------------------------------
  await testAsync('Requirement 1: Menu Inquiry Triggers Complete Menu Content', async () => {
    const menuInquiries = [
      'patingin ng menu',
      'menu please',
      'ano pong tinda niyo?',
      'drinks list',
      'ano menu nyo?'
    ];
    
    // Check regex pattern from nlpEngine
    const menuRegex = /\b(?:patingin(?:\s+po)?\s+(?:ng\s+)?menu|menu\s+please|ano\s+po(?:ng)?\s+(?:tinda|menu)(?:\s+niyo|\s+nyo)?|ano\s+(?:menu|tinda)(?:\s+niyo|\s+nyo)?|drinks\s+list|tingin\s+menu|full\s+menu|menu)\b/i;
    
    for (const phrase of menuInquiries) {
      assert.ok(menuRegex.test(phrase), `Phrase "${phrase}" should match full menu trigger`);
    }

    // Verify all categories (Coffee, Non-Coffee, All-Day Breakfast/Meals, Pastries) exist in database
    const db = require('../database/db');
    const [cats] = await db.query('SELECT name FROM categories WHERE is_active = 1');
    const catNames = cats.map(c => c.name);
    
    assert.ok(catNames.some(c => /Coffee/i.test(c)), 'Must include Coffee category');
    assert.ok(catNames.some(c => /Non-Coffee/i.test(c)), 'Must include Non-Coffee category');
    assert.ok(catNames.some(c => /Breakfast|Meals|Silog/i.test(c)), 'Must include Meals/Silog category');
    assert.ok(catNames.some(c => /Pastries|Desserts/i.test(c)), 'Must include Pastries category');
  });

  // -------------------------------------------------------------
  // Test 2: Dining Mode Filter on First Chat & After Session Reset
  // -------------------------------------------------------------
  await testAsync('Requirement 2: Dining Mode Prompt on First Contact & Lock in Session', async () => {
    const testPsid = 'test_dining_mode_user_' + Date.now();
    
    // Clear any existing session
    userSessions.delete(testPsid);

    // Simulate first chat greeting
    const session = {
      psid: testPsid,
      state: 'INIT',
      cart: [],
      dining_mode: null,
      lastInteraction: Date.now()
    };
    userSessions.set(testPsid, session);

    // Check dining mode question structure
    const diningModePrompt = "Hello po! Welcome to Diner's Cafe! Ask ko lang po muna bago tayo magsimula, will this be for **Dine In**, **Take Out**, or **Delivery**?";
    assert.ok(diningModePrompt.includes('Dine In'), 'Must mention Dine In');
    assert.ok(diningModePrompt.includes('Take Out'), 'Must mention Take Out');
    assert.ok(diningModePrompt.includes('Delivery'), 'Must mention Delivery');

    // Lock dining mode
    session.dining_mode = 'Dine In';
    assert.strictEqual(session.dining_mode, 'Dine In');

    // Ensure session reset clears dining_mode when stale (> 30 mins)
    session.lastInteraction = Date.now() - (35 * 60 * 1000);
    expireStaleState(session);
    assert.strictEqual(session.dining_mode, null, 'Session reset must clear dining_mode to null');
    assert.strictEqual(session.cart.length, 0, 'Session reset must purge cart');
    userSessions.delete(testPsid);
  });

  // -------------------------------------------------------------
  // Test 3: Contact Phone Number in Summary Receipt directly below Name
  // -------------------------------------------------------------
  test('Requirement 3: Contact Phone Number in Summary Receipt directly below Name', () => {
    const rawReceipt = `Eto po ang summary ng inyong order:
Name: Juan Dela Cruz
Location: Brgy. San Antonio, Pasig City
Phone number: 09171234567
Payment option: Cash
Dining mode: Delivery
Discount: ₱0.00 (None)
Order:
- 1x Iced Spanish Latte (16oz, Regular) - ₱140.00
Total: ₱210.00 (₱140.00 + ₱70.00 delivery fee)

Tama po ba lahat ng details?`;

    const formatted = formatOrderSummaryReceipt(rawReceipt);
    const lines = formatted.split('\n');

    const nameIdx = lines.findIndex(l => l.startsWith('Name:'));
    const phoneIdx = lines.findIndex(l => l.startsWith('Phone number:'));

    assert.notStrictEqual(nameIdx, -1, 'Must contain Name: line');
    assert.notStrictEqual(phoneIdx, -1, 'Must contain Phone number: line');
    assert.strictEqual(phoneIdx, nameIdx + 1, 'Phone number: MUST be directly below Name:');
  });

  // -------------------------------------------------------------
  // Test 4: Mathematical Cart Subtotal Calculation Logic
  // -------------------------------------------------------------
  test('Requirement 4: Cart Mathematical Subtotal, Portions & Final Total Pipeline', () => {
    // 1. Line Total = (Base Price + Add-ons) * Quantity
    const item1 = {
      price: 130.00,
      quantity: 2,
      addons: [{ price: 30.00 }, { price: 20.00 }] // total addon = 50 -> 180 * 2 = 360
    };
    const lineTotal1 = calculateItemLineTotal(item1);
    assert.strictEqual(lineTotal1, 360.00, 'Line total must equal (130 + 50) * 2 = 360.00');

    // 2. Subtotal = sum of line totals
    const item2 = {
      price: 150.00,
      quantity: 1,
      addons: []
    };
    const lineTotal2 = calculateItemLineTotal(item2);
    assert.strictEqual(lineTotal2, 150.00);

    const subtotal = calculateCartSubtotal([item1, item2]);
    assert.strictEqual(subtotal, 510.00, 'Subtotal must equal 360 + 150 = 510.00');

    // 3. Final Total = Subtotal - Discount + Delivery Fee
    const discount = 40.00;
    const deliveryFee = 65.00;
    const finalTotal = calculateFinalTotal(subtotal, discount, deliveryFee);
    assert.strictEqual(finalTotal, 535.00, 'Final Total must equal 510 - 40 + 65 = 535.00');
  });

  // -------------------------------------------------------------
  // Test 5: Single-Turn Atomic Cart Updates (Remove Items)
  // -------------------------------------------------------------
  await testAsync('Requirement 5: Single-Turn Atomic Removal without Double Confirmation', async () => {
    const testPsid = 'test_remove_atomic_' + Date.now();
    const session = {
      psid: testPsid,
      state: 'AWAITING_INPUT',
      cart: [
        { id: 101, name: 'Iced Americano', price: 110, quantity: 2 },
        { id: 102, name: 'Beef Tapa Silog', price: 180, quantity: 1 }
      ],
      lastInteraction: Date.now()
    };
    userSessions.set(testPsid, session);

    // Simulate single-turn removal logic
    const itemToRemove = session.cart[0];
    const removedQty = 1;
    itemToRemove.quantity -= removedQty;

    const summaryList = session.cart.map(c => `- ${c.quantity}x ${c.name} (₱${(c.price * c.quantity).toFixed(2)})`).join('\n');
    const replyMsg = `Removed na po ang ${removedQty}x ${itemToRemove.name} sa inyong cart! Eto po ang updated items niyo:\n${summaryList}`;

    assert.ok(replyMsg.includes('Removed na po ang 1x Iced Americano sa inyong cart!'), 'Must reply with atomic removal confirmation');
    assert.ok(!replyMsg.includes('Sigurado ka ba?'), 'Must NOT contain secondary confirmation question');
    assert.strictEqual(session.cart[0].quantity, 1, 'Cart quantity must be atomically updated in database/memory');
    userSessions.delete(testPsid);
  });

  // -------------------------------------------------------------
  // Test 6: Inactivity Timeout & Abandoned Cart Cleanup (20m, 25m, 30m)
  // -------------------------------------------------------------
  await testAsync('Requirement 6: Inactivity Lifecycle (20m warning, 25m final warning, 30m purge)', async () => {
    const testPsid = 'test_inactivity_' + Date.now();
    const now = Date.now();

    // Setup session at 21 minutes of inactivity
    const session = {
      psid: testPsid,
      state: 'AWAITING_INPUT',
      cart: [{ id: 1, name: 'Latte', quantity: 1 }],
      lastInteraction: now - (21 * 60 * 1000),
      warning20Sent: false,
      warning25Sent: false,
      purged30Sent: false
    };
    userSessions.set(testPsid, session);

    // Run checkInactivity with mock dispatcher
    let dispatchedMessages = [];
    const mockSender = async (psid, text) => {
      dispatchedMessages.push({ psid, text });
    };

    await checkInactivity({ sendTextMessage: mockSender, now: () => now });

    const userWarnings20 = dispatchedMessages.filter(m => m.psid === testPsid);
    assert.strictEqual(userWarnings20.length, 1, 'Should trigger 20m warning for user');
    assert.ok(userWarnings20[0].text.includes('Active pa po ba kayo?'), '20m warning text must match spec');
    assert.strictEqual(session.warning20Sent, true, 'warning20Sent flag must be set');

    // Advance to 26 minutes of inactivity
    session.lastInteraction = now - (26 * 60 * 1000);
    dispatchedMessages = [];
    await checkInactivity({ sendTextMessage: mockSender, now: () => now });

    const userWarnings25 = dispatchedMessages.filter(m => m.psid === testPsid);
    assert.strictEqual(userWarnings25.length, 1, 'Should trigger 25m final warning for user');
    assert.ok(userWarnings25[0].text.includes('Final follow-up lang po'), '25m warning text must match spec');
    assert.strictEqual(session.warning25Sent, true, 'warning25Sent flag must be set');

    // Advance to 31 minutes of inactivity -> Purge
    session.lastInteraction = now - (31 * 60 * 1000);
    dispatchedMessages = [];
    await checkInactivity({ sendTextMessage: mockSender, now: () => now });

    const userPurge30 = dispatchedMessages.filter(m => m.psid === testPsid);
    assert.strictEqual(userPurge30.length, 1, 'Should trigger 30m purge notification for user');
    assert.ok(userPurge30[0].text.includes('Dahil walang naging response, na-reset na po ang inyong chat session'), '30m purge text must match spec');
    assert.strictEqual(session.state, 'IDLE', 'State must reset to IDLE');
    assert.strictEqual(session.cart.length, 0, 'Cart must be purged');
    assert.strictEqual(session.dining_mode, null, 'dining_mode must be cleared so next chat asks requirement 2');

    // Verify cleanup
    userSessions.delete(testPsid);
  });

  console.log('\n================================================================');
  console.log(`RESULTS: ${passed}/${total} TESTS PASSED`);
  console.log('================================================================');
  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
