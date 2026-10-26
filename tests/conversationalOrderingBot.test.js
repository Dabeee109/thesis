const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database/db');
const { findMenuItemByName, matchMenuItem, scoreItemMatch } = require('../src/services/itemMatchEngine');
const { getEntityValue, mapWitIntent, localNluParse, parseWitResponse, extractTagalogQuantity } = require('../src/services/witAiService');
const { getSession, saveSession, clearSessionCart, clearMemorySessions } = require('../src/services/sessionManager');
const { handleMessageEvent } = require('../src/services/nlpEngine');
const { updateOrderStatus, dispatchDeliveryFeedbackNotification } = require('../src/services/orderService');

test('Conversational Ordering Bot Refactor & Bug Fixes Test Suite', async (t) => {

  // Initialize DB before tests
  await db.initDatabase();

  // --------------------------------------------------------------------------
  // Bug 1: Substring Collision in findMenuItemByName()
  // --------------------------------------------------------------------------
  await t.test('1. Substring Collision in findMenuItemByName(): "ok" must NEVER match "Dark Chocolate Chunk Cookie"', async () => {
    // Test direct DB call
    const result = await findMenuItemByName('ok');
    assert.equal(result, null, '"ok" should not match any menu item');

    // Test detailed match info
    const detailed = await findMenuItemByName('ok', { detailed: true });
    assert.equal(detailed.status, 'NONE');
    assert.equal(detailed.item, null);
    assert.equal(detailed.similarity, 0.0);

    // Affirmation words and stop words must not match items
    for (const word of ['ok', 'yes', 'no', 'opo', 'sige', 'cge', 'hi', 'menu', 'cart']) {
      const match = await findMenuItemByName(word);
      assert.equal(match, null, `Stop/affirmation word "${word}" should not match items`);
    }

    // Direct match queries
    const cookie = await findMenuItemByName('cookie');
    assert.ok(cookie, 'Query "cookie" should match Dark Chocolate Chunk Cookie');
    assert.equal(cookie.name, 'Dark Chocolate Chunk Cookie');

    const spanish = await findMenuItemByName('spanish latte');
    assert.ok(spanish, 'Query "spanish latte" should match Signature Spanish Latte');
    assert.equal(spanish.name, 'Signature Spanish Latte');

    // Typo tolerance
    const typoLate = await findMenuItemByName('spanis late');
    assert.ok(typoLate, 'Typo "spanis late" should match Signature Spanish Latte with >= 0.78 similarity');
    assert.equal(typoLate.name, 'Signature Spanish Latte');

    const typoCroisant = await findMenuItemByName('croisant');
    assert.ok(typoCroisant, 'Typo "croisant" should match Almond Butter Croissant with >= 0.78 similarity');
    assert.equal(typoCroisant.name, 'Almond Butter Croissant');
  });

  await t.test('1b. Item Match Engine: Disambiguation within 0.08 similarity', async () => {
    // "latte" matches both Signature Spanish Latte and Kyoto Uji Matcha Latte closely
    const match = await findMenuItemByName('latte', { detailed: true });
    assert.equal(match.status, 'DISAMBIGUATE', '"latte" should trigger disambiguation between multiple lattes');
    assert.equal(match.candidates.length, 2);
    assert.ok(match.scoreDiff <= 0.08, `Score difference ${match.scoreDiff} must be <= 0.08`);
  });

  // --------------------------------------------------------------------------
  // Bug 2: Intent Parsing Collision in mapWitIntent()
  // --------------------------------------------------------------------------
  await t.test('2. Intent Parsing Collision in mapWitIntent(): cancel_order vs clear_cart vs remove_item', () => {
    // cancel_order must NOT be overwritten by order rules or clear_cart
    assert.equal(mapWitIntent('cancel_order', 'cancel my order'), 'cancel_order');
    assert.equal(mapWitIntent('void_order', 'void order'), 'cancel_order');

    // clear_cart
    assert.equal(mapWitIntent('clear_cart', 'clear my cart'), 'clear_cart');
    assert.equal(mapWitIntent('empty_cart', 'empty the cart'), 'clear_cart');
    assert.equal(mapWitIntent('reset_cart', 'reset cart'), 'clear_cart');

    // remove_item
    assert.equal(mapWitIntent('remove_item', 'remove the croissant'), 'remove_item');
    assert.equal(mapWitIntent('cancel_item', 'cancel the cookie'), 'remove_item');
    assert.equal(mapWitIntent('delete_item', 'delete spanish latte'), 'remove_item');
    assert.equal(mapWitIntent('alisin', 'alisin ang kape'), 'remove_item');

    // place_order evaluated after operational intents
    assert.equal(mapWitIntent('order_item', 'pa-order ng kape'), 'place_order');
    assert.equal(mapWitIntent('place_order', '2 spanish latte'), 'place_order');
    assert.equal(mapWitIntent('add_to_cart', 'add croissant'), 'place_order');

    // checkout
    assert.equal(mapWitIntent('checkout', 'bayad na'), 'checkout');
    assert.equal(mapWitIntent('check_out', 'proceed to checkout'), 'checkout');

    // confirm_yes & confirm_no
    assert.equal(mapWitIntent('confirm_yes', 'yes'), 'confirm_yes');
    assert.equal(mapWitIntent('confirm_no', 'no'), 'confirm_no');
  });

  // --------------------------------------------------------------------------
  // Bug 3: Wit.ai Entity Keying (getEntityValue())
  // --------------------------------------------------------------------------
  await t.test('3. Wit.ai Entity Keying in getEntityValue(): parses composite name:role keys', () => {
    const mockWitEntities = {
      'menu_item:menu_item': [
        { id: '123', name: 'menu_item', role: 'menu_item', start: 0, end: 13, body: 'spanish latte', value: 'Signature Spanish Latte', confidence: 0.98 }
      ],
      'wit$number:quantity': [
        { id: '456', name: 'wit$number', role: 'quantity', start: 0, end: 1, body: '2', value: 2, confidence: 0.99 }
      ],
      'payment_method:payment_method': [
        { id: '789', name: 'payment_method', role: 'payment_method', start: 0, end: 5, body: 'gcash', value: 'gcash', confidence: 0.95 }
      ],
      'wit$location:address': [
        { id: '101', name: 'wit$location', role: 'address', start: 0, end: 10, body: 'Manila City', value: 'Manila City', confidence: 0.92 }
      ],
      'plain_key': [
        { value: 'plain_val' }
      ]
    };

    // Composite name:role parsing
    assert.equal(getEntityValue(mockWitEntities, 'menu_item'), 'Signature Spanish Latte');
    assert.equal(getEntityValue(mockWitEntities, 'quantity'), 2);
    assert.equal(getEntityValue(mockWitEntities, 'payment_method'), 'gcash');
    assert.equal(getEntityValue(mockWitEntities, 'address'), 'Manila City');

    // Plain key parsing
    assert.equal(getEntityValue(mockWitEntities, 'plain_key'), 'plain_val');

    // Non-existent key
    assert.equal(getEntityValue(mockWitEntities, 'non_existent'), null);
  });

  // --------------------------------------------------------------------------
  // Bug 4: Quantity & Remove Item Logic (Tagalog numerals & null vs integer)
  // --------------------------------------------------------------------------
  await t.test('4. Quantity & Remove Logic: parses Tagalog numerals and distinguishes remove vs remove 1', () => {
    // Tagalog numerals parsing
    assert.equal(extractTagalogQuantity('pa-order po ng isang spanish latte'), 1);
    assert.equal(extractTagalogQuantity('dalawang caramel macchiato'), 2);
    assert.equal(extractTagalogQuantity('tatlong croissant'), 3);
    assert.equal(extractTagalogQuantity('apat na iced americano'), 4);
    assert.equal(extractTagalogQuantity('limang cookie'), 5);

    // Quantity differentiation: "remove iced coffee" -> quantity is null (remove entire item)
    const witNoQty = {
      intents: [{ name: 'remove_item', confidence: 0.95 }],
      entities: {
        'menu_item:menu_item': [{ value: 'iced coffee', body: 'iced coffee' }]
      }
    };
    const parsedNoQty = parseWitResponse(witNoQty, 'remove iced coffee');
    assert.equal(parsedNoQty.quantity, null, 'No quantity specified should yield null');

    // Quantity differentiation: "remove 1 iced coffee" -> quantity is 1 (decrement)
    const witWithQty = {
      intents: [{ name: 'remove_item', confidence: 0.95 }],
      entities: {
        'menu_item:menu_item': [{ value: 'iced coffee', body: 'iced coffee' }],
        'wit$number:quantity': [{ value: 1, body: '1' }]
      }
    };
    const parsedWithQty = parseWitResponse(witWithQty, 'remove 1 iced coffee');
    assert.equal(parsedWithQty.quantity, 1, 'Quantity of 1 specified should yield 1');
  });

  // --------------------------------------------------------------------------
  // Bug 7: Session Persistence (saveSession() check-and-insert upsert)
  // --------------------------------------------------------------------------
  await t.test('5. Session Persistence: saveSession() successfully persists new first-time customer', async () => {
    const testPsid = `PSID_UNITTEST_${Date.now()}`;
    clearMemorySessions();

    const session = await getSession(testPsid);
    assert.equal(session.psid, testPsid);
    assert.equal(session.customerId, null);
    assert.equal(session.state, 'idle');

    // Update session state & cart
    session.state = 'ordering';
    session.cart = [{ menuItemId: 1, name: 'Signature Spanish Latte', price: 145.0, quantity: 2 }];
    await saveSession(session);

    assert.ok(session.customerId, 'saveSession must populate customerId for first-time customer');

    // Verify record in database
    const [rows] = await db.query('SELECT * FROM customers WHERE psid = ?', [testPsid]);
    assert.equal(rows.length, 1, 'Customer record must be inserted');
    assert.equal(rows[0].conversation_state, 'ordering');
    assert.ok(rows[0].cart_json.includes('Signature Spanish Latte'));

    // Update existing customer record
    session.state = 'awaiting_checkout';
    session.address = '123 Rizal St, Manila';
    await saveSession(session);

    const [updatedRows] = await db.query('SELECT * FROM customers WHERE psid = ?', [testPsid]);
    assert.equal(updatedRows.length, 1, 'No duplicate record created');
    assert.equal(updatedRows[0].conversation_state, 'awaiting_checkout');
    assert.equal(updatedRows[0].delivery_address, '123 Rizal St, Manila');
  });

  // --------------------------------------------------------------------------
  // State Machine Lifecycle (5 States) & Dedicated Confirmation States
  // --------------------------------------------------------------------------
  await t.test('6. State Machine: 5-state lifecycle and dedicated binary confirmation states', async () => {
    const testPsid = `PSID_STATETEST_${Date.now()}`;
    clearMemorySessions();

    // 1. Idle -> Ordering on order/menu
    let session = await getSession(testPsid);
    assert.equal(session.state, 'idle');

    await handleMessageEvent(testPsid, '2 spanish latte');
    session = await getSession(testPsid);
    assert.equal(session.state, 'ordering');
    assert.equal(session.cart.length, 1);
    assert.equal(session.cart[0].quantity, 2);

    // 2. Ordering: remove 1 item decrements quantity
    await handleMessageEvent(testPsid, 'remove 1 spanish latte');
    session = await getSession(testPsid);
    assert.equal(session.state, 'ordering');
    assert.equal(session.cart[0].quantity, 1);

    // 3. Ordering -> awaiting_checkout on checkout intent
    await handleMessageEvent(testPsid, 'bayad na');
    session = await getSession(testPsid);
    assert.equal(session.state, 'awaiting_checkout');

    // 4. awaiting_checkout: "hindi pa" returns to ordering
    await handleMessageEvent(testPsid, 'hindi pa');
    session = await getSession(testPsid);
    assert.equal(session.state, 'ordering');

    // 5. Binary confirmation state: awaiting_checkout_confirmation
    session.state = 'awaiting_checkout_confirmation';
    await saveSession(session);
    await handleMessageEvent(testPsid, 'sige');
    session = await getSession(testPsid);
    assert.equal(session.state, 'awaiting_checkout');
  });

  // --------------------------------------------------------------------------
  // Bug 6: Delivery Push Notification & State 4 -> State 5 -> State 1
  // --------------------------------------------------------------------------
  await t.test('7. Delivery Status Push Notification: status = delivered triggers Messenger Send & sets awaiting_feedback', async () => {
    const testPsid = `PSID_DELIVTEST_${Date.now()}`;
    clearMemorySessions();

    const session = await getSession(testPsid);
    session.state = 'order_placed';
    session.activeOrderNumber = 'DNR-20260901-001';
    await saveSession(session);

    // Simulate backend status update = delivered
    await dispatchDeliveryFeedbackNotification(testPsid, 'DNR-20260901-001', 1);

    const updatedSession = await getSession(testPsid);
    assert.equal(updatedSession.state, 'awaiting_feedback', 'Customer session must transition to awaiting_feedback on delivery push');
    assert.equal(updatedSession.pendingFeedbackOrderId, 1);

    // Customer submits rating (1 to 5) while in awaiting_feedback
    await handleMessageEvent(testPsid, '5');
    const finalSession = await getSession(testPsid);
    assert.equal(finalSession.state, 'idle', 'Rating saved must transition state back to idle');
    assert.equal(finalSession.cart.length, 0, 'Cart must be cleared on rating saved');
  });

  // --------------------------------------------------------------------------
  // Taglish Ordering Phrases & Brevity
  // --------------------------------------------------------------------------
  await t.test('8. Taglish Phrase Parsing & Affirmation Handling', () => {
    // Taglish phrases mapped properly
    assert.equal(localNluParse('pa-order po ng 1 cookie').intent, 'place_order');
    assert.equal(localNluParse('tingin menu').intent, 'browse_menu');
    assert.equal(localNluParse('magkano na').intent, 'view_cart');
    assert.equal(localNluParse('bayad na').intent, 'checkout');
    assert.equal(localNluParse('alisin ang cookie').intent, 'remove_item');
    assert.equal(localNluParse('sige').intent, 'confirm_yes');
    assert.equal(localNluParse('opo').intent, 'confirm_yes');
    assert.equal(localNluParse('hindi pa').intent, 'confirm_no');
    assert.equal(localNluParse('mamaya na').intent, 'confirm_no');
    assert.equal(localNluParse('saan na order').intent, 'track_order');
    assert.equal(localNluParse('usap sa tao').intent, 'request_agent');

    // Real Facebook Messenger conversation cases & typos
    assert.equal(localNluParse('patingin ng menu').intent, 'browse_menu');
    assert.equal(localNluParse('patingin ng meni').intent, 'browse_menu');
    assert.equal(localNluParse('Can i see the menu').intent, 'browse_menu');
    assert.equal(localNluParse('menu pla').intent, 'browse_menu');

    // Recommendations & Bestsellers
    assert.equal(localNluParse('ano masarap').intent, 'recommendation');
    assert.equal(localNluParse('what do you recommend').intent, 'recommendation');
    assert.equal(localNluParse('bestsellers').intent, 'recommendation');

    // Broad Category Inquiries
    const coffeeReq = localNluParse('Coffee please');
    assert.equal(coffeeReq.intent, 'category_browse');
    assert.equal(coffeeReq.category, 'coffee');

    const kapeReq = localNluParse('kape');
    assert.equal(kapeReq.intent, 'category_browse');
    assert.equal(kapeReq.category, 'coffee');

    const pastriesReq = localNluParse('pastries');
    assert.equal(pastriesReq.intent, 'category_browse');
    assert.equal(pastriesReq.category, 'pastries');

    // Gibberish / Out of scope: must NEVER be marked as place_order with moderate confidence!
    const gibberish = localNluParse('qwertyui');
    assert.equal(gibberish.intent, 'out_of_scope');
    assert.ok(gibberish.confidence < 0.50, 'Gibberish must have low confidence to prevent bogus "Did you mean to order qwertyui?" prompt');
  });
});
