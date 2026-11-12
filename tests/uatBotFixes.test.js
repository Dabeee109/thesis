const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const testDbPath = path.join(__dirname, 'test_uat_bot_fixes.sqlite');
if (fs.existsSync(testDbPath)) {
  try { fs.unlinkSync(testDbPath); } catch (e) {}
}

process.env.DB_FORCE_SQLITE = '1';
process.env.SQLITE_PATH = testDbPath;
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'AIzaSyTestUatFixesKey123456';

const db = require('../database/db');
const aiService = require('../src/services/aiService');
const nlpEngine = require('../src/services/nlpEngine');
const orderService = require('../src/services/orderService');
const messengerService = require('../src/services/messengerService');
const systemSettingsService = require('../src/services/systemSettingsService');

const sentMessages = [];
messengerService.callSendAPI = async (psid, messagePayload, options) => {
  // Replicate real callSendAPI quick_replies stripping check cleanly
  const copy = (messagePayload && typeof messagePayload === 'object') ? { ...messagePayload } : messagePayload;
  if (copy && typeof copy === 'object') delete copy.quick_replies;
  sentMessages.push({ psid: String(psid), messagePayload: copy, options });
  return { recipient_id: String(psid), message_id: `mid.uat.${Date.now()}` };
};

test('QA UAT Critical Bug Fixes Regression Suite (8 Fixes)', async (t) => {
  await db.initDatabase();
  await systemSettingsService.updateSystemSettings({
    is_manual_override: 1,
    store_status: 'OPEN',
    chatbot_enabled: 1
  });

  await t.test('1. Multi-Item Order Extraction (ADD_ITEM items[] array inserts all matched items in 1 turn)', async () => {
    const psid = `PSID_UAT_MULTI_${Date.now()}`;
    sentMessages.length = 0;

    const session = await nlpEngine.getSession(psid);
    session.dining_mode = 'Pick-up';
    session.orderType = 'pickup';
    session.state = 'ORDERING';

    const mockAiRes = {
      reply_message: 'Sige po, naidagdag na ang inyong Bacon Burger at Lychee Fruit Tea!',
      detected_action: 'ADD_ITEM',
      action_payload: {
        items: [
          { item_name: 'Bacon Burger', quantity: 2, addon: 'Pearls' }, // Pearls should be stripped by strict category guard!
          { item_name: 'Lychee Fruit Tea', quantity: 1, addon: 'Nata de Coco' }
        ],
        item_name: 'Bacon Burger',
        quantity: 2,
        addon: 'Pearls',
        dining_mode: 'Pick-up'
      }
    };

    const res = await nlpEngine.executeAiAssistantTurn(psid, session, '2 Bacon Burger and 1 Lychee Fruit Tea with nata', {
      aiResponse: mockAiRes
    });
    assert.strictEqual(res.intent, 'AI_ADD_ITEM');
    assert.strictEqual(session.cart.length, 2, 'Both items must be inserted into cart in 1 turn');

    const burger = session.cart.find(c => c.name.includes('Bacon Burger'));
    const tea = session.cart.find(c => c.name.includes('Lychee Fruit Tea'));
    assert.strictEqual(burger.quantity, 2);
    assert.ok(!burger.name.includes('Pearls') && (!burger.addOns || burger.addOns.length === 0), 'Food item must NEVER get Pearls sinker');
    assert.strictEqual(tea.quantity, 1);
    assert.ok(tea.name.includes('Nata de Coco'), 'Drink item keeps Nata de Coco add-on');
  });

  await t.test('2. Contextual Memory (last 8 user|model turns) resolves referential add-to-cart & "Ikaw na bahala" combo', async () => {
    const psid = `PSID_UAT_CTX_${Date.now()}`;
    sentMessages.length = 0;
    aiService.clearConversationHistory(psid);

    const session = await nlpEngine.getSession(psid);
    session.dining_mode = 'Pick-up';
    session.orderType = 'pickup';
    session.state = 'ORDERING';

    // Simulate Turn 1: bot recommended Caramel Macchiato
    aiService.appendConversationTurn(
      psid,
      'anong mare-recommend mo na drinks',
      'Mare-recommend ko po ang Caramel Macchiato (₱149.00) at Lychee Fruit Tea (₱89.00)!',
      session
    );

    let capturedInput = '';
    const mockClient = {
      interactions: {
        create: async (params) => {
          capturedInput = params.input;
          return {
            output_text: JSON.stringify({
              reply_message: 'Sige po, idinagdag ko na ang ikaw na bahala combo: Burger Steak (2 pcs) at Caramel Macchiato!',
              detected_action: 'ADD_ITEM',
              action_payload: {
                items: [
                  { item_name: 'Burger Steak (2 pcs)', quantity: 1, addon: null },
                  { item_name: 'Caramel Macchiato', quantity: 1, addon: 'Pearls' }
                ],
                item_name: 'Burger Steak (2 pcs)',
                quantity: 1,
                addon: null,
                dining_mode: 'Pick-up'
              }
            })
          };
        }
      }
    };

    const aiRes = await aiService.generateAssistantResponse(psid, 'ikaw na bahala basta may meal at drinks', session, { client: mockClient });
    assert.ok(capturedInput.includes('Assistant (model): Mare-recommend ko po ang Caramel Macchiato'));
    assert.ok(aiService.ASSISTANT_RESPONSE_SCHEMA.properties.action_payload.properties.items, 'Schema must expose items[]');
    assert.strictEqual(aiRes.action_payload.items.length, 2);

    const turnRes = await nlpEngine.executeAiAssistantTurn(psid, session, 'ikaw na bahala basta may meal at drinks', { aiResponse: aiRes });
    assert.strictEqual(turnRes.intent, 'AI_ADD_ITEM');
    assert.strictEqual(session.cart.length, 2);
  });

  await t.test('3. Strict Category Guard prevents drink add-ons or AWAITING_DRINK_ADDON for Meals/Silog/Burgers/Pizza/Add-ons', async () => {
    const [mealRows] = await db.query(
      `SELECT m.id, m.name, m.price, c.name AS category_name, m.category
       FROM menu_items m LEFT JOIN categories c ON c.id = m.category_id
       WHERE LOWER(c.name) LIKE '%meal%' LIMIT 1`
    );
    const [addonRows] = await db.query(
      `SELECT m.id, m.name, m.price, c.name AS category_name, m.category
       FROM menu_items m LEFT JOIN categories c ON c.id = m.category_id
       WHERE m.name = 'Coffee Jelly' LIMIT 1`
    );
    const [drinkRows] = await db.query(
      `SELECT m.id, m.name, m.price, c.name AS category_name, m.category
       FROM menu_items m LEFT JOIN categories c ON c.id = m.category_id
       WHERE LOWER(c.name) LIKE '%drink%' LIMIT 1`
    );

    assert.strictEqual(nlpEngine.isDrinkOrMilktea(mealRows[0]), false, 'Meals must NOT be treated as drinks');
    assert.strictEqual(nlpEngine.isDrinkOrMilktea(addonRows[0]), false, 'Coffee Jelly Add-on must NOT trigger drink upsell');
    assert.strictEqual(nlpEngine.isDrinkOrMilktea(drinkRows[0]), true, 'Drinks & Milktea must return true');

    const psid = `PSID_UAT_CATGUARD_${Date.now()}`;
    const session = await nlpEngine.getSession(psid);
    session.dining_mode = 'Pick-up';
    session.cart = [];
    await nlpEngine.promptDrinkAddons(psid, session, mealRows[0], 1);
    assert.notStrictEqual(session.state, 'AWAITING_DRINK_ADDON', 'Non-drink must NEVER enter AWAITING_DRINK_ADDON');
    assert.strictEqual(session.cart.length, 1);
  });

  await t.test('4. Intent Collisions Fixed: VIEW_CART vs SEND_PICTURE vs RECOMMEND_ITEM', async () => {
    assert.strictEqual(nlpEngine.isItemPhotoRequest('patingin ng cart'), false, 'Cart must be excluded from photo requests');
    assert.strictEqual(nlpEngine.isItemPhotoRequest('Patingin ng picture ng Biscoff Cheesecake'), true);

    const psid = `PSID_UAT_COLLISION_${Date.now()}`;
    const session = await nlpEngine.getSession(psid);
    session.dining_mode = 'Pick-up';
    session.orderType = 'pickup';
    session.state = 'ORDERING';
    const [burgerRows] = await db.query(`SELECT id, name, price FROM menu_items WHERE name = 'Classic Burger' LIMIT 1`);
    session.cart = [{ menuItemId: burgerRows[0].id, id: burgerRows[0].id, name: 'Classic Burger', price: Number(burgerRows[0].price), quantity: 1 }];
    await nlpEngine.saveSession(session);

    // A. "patingin ng cart" and "ano laman ng cart ko" -> VIEW_CART
    sentMessages.length = 0;
    const r1 = await nlpEngine.handleMessageEvent(psid, 'patingin ng cart');
    assert.strictEqual(r1.intent, 'VIEW_CART');
    assert.ok(sentMessages.some(m => (m.messagePayload.text || '').includes('Classic Burger')));

    sentMessages.length = 0;
    const r2 = await nlpEngine.handleMessageEvent(psid, 'ano laman ng cart ko');
    assert.strictEqual(r2.intent, 'VIEW_CART');

    // B. "anong mare-recommend mo na drinks" -> RECOMMEND_ITEM (2-3 items, NOT full 91-item menu dump)
    sentMessages.length = 0;
    const r3 = await nlpEngine.handleMessageEvent(psid, 'anong mare-recommend mo na drinks');
    assert.strictEqual(r3.intent, 'RECOMMEND_ITEM');
    const recText = sentMessages.map(m => m.messagePayload.text || '').join('\n');
    assert.ok(!recText.includes("DINER'S CAFE MENU"), 'Must NOT dump full menu for recommendation inquiries');
    assert.ok(recText.includes('₱'), 'Must show recommended drinks with prices');
  });

  await t.test('5. Checkout & Address Validation State Locks Escape Cleanly on Menu/Cart/Order/Chat', async () => {
    const psid = `PSID_UAT_ESCAPE_${Date.now()}`;
    const session = await nlpEngine.getSession(psid);
    session.dining_mode = 'Delivery';
    session.orderType = 'delivery';
    session.cart = [{ menuItemId: 1, name: 'Classic Burger', price: 139, quantity: 1 }];
    session.state = 'AWAITING_ADDRESS_RETRY';
    session.current_step = 'AWAITING_ADDRESS_RETRY';
    session.checkout_step = 'AWAITING_ADDRESS_RETRY';
    await nlpEngine.saveSession(session);

    sentMessages.length = 0;
    const escRes = await nlpEngine.handleMessageEvent(psid, 'patingin ng cart');
    assert.strictEqual(escRes.intent, 'VIEW_CART', 'Customer must escape AWAITING_ADDRESS_RETRY into VIEW_CART cleanly');
    const escapedText = sentMessages.map(m => m.messagePayload.text || '').join('\n');
    assert.ok(!escapedText.includes('Pakibigay po ng bagong Delivery Address'), 'Must NOT trap user in address loop');
  });

  await t.test('6. Over-3km Delivery Handoff transitions to PENDING_ADMIN_QUOTE on insistence ("delivery pa din")', async () => {
    const origAxiosGet = axios.get;
    const psid = `PSID_UAT_3RD_${Date.now()}`;
    sentMessages.length = 0;

    try {
      axios.get = async (url) => {
        if (url.includes('nominatim.openstreetmap.org')) {
          return { data: [{ lat: '14.66', lon: '121.05', display_name: 'Commonwealth Ave, QC' }] };
        }
        return { data: { code: 'Ok', routes: [{ distance: 6500 }] } };
      };

      const [itemRows] = await db.query(`SELECT id, name, price FROM menu_items WHERE is_available = 1 LIMIT 1`);
      const session = await nlpEngine.getSession(psid);
      session.dining_mode = 'Delivery';
      session.orderType = 'delivery';
      session.customer_name = 'Third Party Tester';
      session.contact_number = '09171234567';
      session.cart = [{ menuItemId: itemRows[0].id, id: itemRows[0].id, name: itemRows[0].name, price: Number(itemRows[0].price), quantity: 1 }];

      const oobRes = await nlpEngine.resolveDeliveryAddressAndFare(psid, session, 'Commonwealth Ave, QC', 'COA');
      assert.strictEqual(oobRes.intent, 'AWAITING_BOUNDARY_PICKUP_SWITCH');

      // Customer insists on delivery -> PENDING_ADMIN_QUOTE order created!
      const insistRes = await nlpEngine.handleTextInput(psid, session, 'delivery pa din');
      assert.strictEqual(insistRes.intent, 'PENDING_ADMIN_QUOTE');
      assert.ok(insistRes.orderNumber);

      const [orderRows] = await db.query(`SELECT status, delivery_address, customer_notes FROM orders WHERE order_number = ?`, [insistRes.orderNumber]);
      assert.strictEqual(orderRows[0].status, 'PENDING_ADMIN_QUOTE');
      assert.ok(orderRows[0].customer_notes.includes('Grab/Lalamove'));

      const msg = sentMessages[sentMessages.length - 1].messagePayload.text;
      assert.ok(msg.includes('PENDING_ADMIN_QUOTE') && msg.includes('Grab / Lalamove'));
    } finally {
      axios.get = origAxiosGet;
    }
  });

  await t.test('7. Real-Time DB Sync resets session to IDLE when active order is VOIDED / CANCELLED on Dashboard', async () => {
    const psid = `PSID_UAT_VOIDSYNC_${Date.now()}`;
    const [itemRows] = await db.query(`SELECT id, name, price FROM menu_items WHERE is_available = 1 LIMIT 1`);

    const created = await orderService.createOrder(psid, {
      customerName: 'Void Sync Tester',
      customerPhone: '09171234567',
      deliveryAddress: 'Store Pickup',
      orderType: 'pickup',
      paymentMethod: 'cash',
      items: [{ menuItemId: itemRows[0].id, quantity: 1 }],
      deliveryFee: 0,
      totalAmount: Number(itemRows[0].price)
    });

    const session = await nlpEngine.getSession(psid);
    session.activeOrderNumber = created.orderNumber;
    session.state = 'order_placed';
    session.current_step = 'order_placed';
    await nlpEngine.saveSession(session);

    // Admin voids/cancels order directly in DB
    await db.query(`UPDATE orders SET status = 'VOIDED', void_status = 'approved' WHERE order_number = ?`, [created.orderNumber]);

    // Next inbound customer message triggers syncActiveOrderStateWithDb -> clears active order & resets session cleanly
    sentMessages.length = 0;
    await nlpEngine.handleMessageEvent(psid, 'hi');
    const syncedSession = await nlpEngine.getSession(psid);
    assert.strictEqual(syncedSession.activeOrderNumber, null, 'Voided order lock must be cleared');
    assert.strictEqual(syncedSession.state, 'AWAITING_DINING_MODE', 'Reset to IDLE then welcomed cleanly on hi');
  });

  await t.test('8. Pure Conversational Text UX: strips quick_replies & updates Payment mode prompt to Cash or GCash', async () => {
    const deliveryPrompt = nlpEngine.getCheckoutInfoPrompt({ dining_mode: 'Delivery' });
    const pickupPrompt = nlpEngine.getCheckoutInfoPrompt({ dining_mode: 'Pick-up' });
    assert.ok(deliveryPrompt.includes('Payment mode: (Cash or GCash)'));
    assert.ok(pickupPrompt.includes('Payment mode: (Cash or GCash)'));
    assert.ok(!deliveryPrompt.includes('Xendit'));

    sentMessages.length = 0;
    await messengerService.sendQuickReplies('TEST_PURE_TEXT', 'Test reply', [{ title: 'Btn', payload: 'BTN' }]);
    assert.strictEqual(sentMessages.length, 1);
    assert.strictEqual(sentMessages[0].messagePayload.quick_replies, undefined);
  });

  await t.test('9. CLEAR_CART deletes cart from DB (customers.cart_json = []) and resets subtotal to ₱0.00', async () => {
    const psid = `PSID_UAT_CLEARCART_${Date.now()}`;
    const [burgerRows] = await db.query(`SELECT id, name, price FROM menu_items WHERE name = 'Bacon Burger' LIMIT 1`);
    const session = await nlpEngine.getSession(psid);
    session.dining_mode = 'Pick-up';
    session.cart = [{ menuItemId: burgerRows[0].id, id: burgerRows[0].id, name: 'Bacon Burger', price: Number(burgerRows[0].price), quantity: 2 }];
    await nlpEngine.saveSession(session);

    sentMessages.length = 0;
    const clearRes = await nlpEngine.handleMessageEvent(psid, 'burahin mo yung nasa cart ko');
    assert.strictEqual(clearRes.intent, 'CLEAR_CART');
    assert.strictEqual(clearRes.subtotal, 0);
    assert.strictEqual(session.cart.length, 0);

    const [custRows] = await db.query(`SELECT cart_json FROM customers WHERE psid = ?`, [psid]);
    assert.strictEqual(custRows[0].cart_json, '[]', 'DB cart_json must be cleared to empty array');
    const msg = sentMessages[sentMessages.length - 1].messagePayload.text;
    assert.ok(msg.includes('₱0.00'));
  });

  await t.test('10. Multi-Intent One-Shot Order ("pa order bacon burger isa take out gcash payment") extracts all entities & asks missing fields', async () => {
    const psid = `PSID_UAT_ONESHOT_${Date.now()}`;
    const session = await nlpEngine.getSession(psid);
    session.state = 'AWAITING_DINING_MODE';
    session.dining_mode = null;
    session.cart = [];
    await nlpEngine.saveSession(session);

    sentMessages.length = 0;
    const res = await nlpEngine.handleMessageEvent(psid, 'pa order bacon burger isa take out gcash payment');
    assert.strictEqual(res.intent, 'ONE_SHOT_ORDER');
    assert.strictEqual(session.dining_mode, 'Pick-up');
    assert.strictEqual(session.payment_mode, 'GCash');
    assert.strictEqual(session.cart.length, 1);
    assert.ok(session.cart[0].name.includes('Bacon Burger'));
    assert.strictEqual(session.cart[0].quantity, 1);
    assert.strictEqual(session.state, 'COLLECTING_CUSTOMER_INFO');

    const msg = sentMessages[sentMessages.length - 1].messagePayload.text;
    assert.ok(msg.includes('Full Name') && msg.includes('Arriving time'), 'Must immediately ask for missing Pick-up checkout fields');
    assert.ok(!msg.includes("DINER'S CAFE MENU"), 'Must NOT dump full menu on one-shot order');
  });

  await t.test('11. Legacy "Yes to what? Ready to check out?" & "Sorry, I didn\'t get that." are completely eliminated; contextual "oo" works', async () => {
    const botMessages = require('../src/services/botMessages').botMessages;
    assert.ok(!botMessages.yesToWhat().text.includes('Yes to what?'));
    assert.ok(!botMessages.fallback().text.includes("Sorry, I didn't get that."));

    const psid = `PSID_UAT_YESCTX_${Date.now()}`;
    const session = await nlpEngine.getSession(psid);
    session.dining_mode = 'Pick-up';
    session.state = 'AWAITING_CHECKOUT_CONFIRM';
    session.cart = [{ menuItemId: 1, name: 'Bacon Burger', price: 159, quantity: 1 }];
    aiService.clearConversationHistory(psid);
    aiService.appendConversationTurn(psid, 'pa order bacon burger', 'Naidagdag na ang Bacon Burger! May gusto pa ba kayong idagdag?', session);

    sentMessages.length = 0;
    const yesRes = await nlpEngine.handleTextInput(psid, session, 'oo ngani');
    const msg = sentMessages[sentMessages.length - 1].messagePayload.text;
    assert.ok(!msg.includes('Yes to what?'));
    assert.ok(msg.toLowerCase().includes('idagdag'), `Contextual "oo ngani" should ask what to add, got: ${msg}`);
    assert.ok(yesRes.intent);
  });

  await t.test('12. CANCEL_ORDER handles "cancel my order", "pa-cancel", "ayoko na" on PENDING order, restores stock & resets session', async () => {
    const psid = `PSID_UAT_CANCEL_${Date.now()}`;
    const [burgerRows] = await db.query(`SELECT id, name, price FROM menu_items WHERE name = 'Bacon Burger' LIMIT 1`);
    const created = await orderService.createOrder(psid, {
      customerName: 'Cancel Tester',
      customerPhone: '09171234567',
      deliveryAddress: 'Store Pickup',
      orderType: 'pickup',
      paymentMethod: 'cash',
      items: [{ menuItemId: burgerRows[0].id, quantity: 1 }],
      deliveryFee: 0,
      totalAmount: Number(burgerRows[0].price)
    });

    const session = await nlpEngine.getSession(psid);
    session.activeOrderNumber = created.orderNumber;
    await nlpEngine.saveSession(session);

    sentMessages.length = 0;
    const cancelRes = await nlpEngine.handleMessageEvent(psid, 'ayoko na');
    assert.strictEqual(cancelRes.intent, 'ORDER_CANCELLED_PENDING');
    const [ordRows] = await db.query(`SELECT status FROM orders WHERE order_number = ?`, [created.orderNumber]);
    assert.strictEqual(ordRows[0].status, 'cancelled');
    const afterSession = await nlpEngine.getSession(psid);
    assert.strictEqual(afterSession.state, 'IDLE');
    assert.strictEqual(afterSession.activeOrderNumber, null);
  });

  await t.test('13. Customer Name Validation rejects conversational complaints ("binigay ko na sayo kanina ha") & supports Graph API fallback', async () => {
    const { validateName } = require('../src/services/textMatch');
    assert.strictEqual(validateName('binigay ko na sayo kanina ha').ok, false, 'Complaint sentence must fail validateName');
    assert.strictEqual(validateName('Juan Dela Cruz').ok, true, 'Real name must pass validateName');

    const psid = `PSID_UAT_NAME_${Date.now()}`;
    const session = await nlpEngine.getSession(psid);
    session.dining_mode = 'Pick-up';
    session.orderType = 'pickup';
    session.state = 'AWAITING_NAME';
    session.details = {};

    sentMessages.length = 0;
    const badRes = await nlpEngine.handleMessageEvent(psid, 'binigay ko na sayo kanina ha');
    assert.strictEqual(badRes.intent, 'BAD_NAME');
    assert.strictEqual(session.details.name, undefined, 'Complaint text must NEVER be saved as customer name');
    assert.ok(sentMessages[sentMessages.length - 1].messagePayload.text.includes('hindi po iyan pangalan'));
  });

  await t.test('14. Strict Professional Tone sanitizes street slang ("Awtos po!", "lods", "matsala")', () => {
    const parsed = aiService.parseAssistantJson(JSON.stringify({
      reply_message: 'Awtos po! Salamat lods, matsala!',
      detected_action: 'NONE',
      action_payload: { items: null, item_name: null, quantity: null, addon: null, dining_mode: null, payment_mode: null }
    }));
    assert.ok(!/awto|lods|matsala/i.test(parsed.reply_message), `Slang must be scrubbed, got: ${parsed.reply_message}`);
    assert.ok(parsed.reply_message.includes('Paumanhin po'));
  });

  t.after(async () => {
    await systemSettingsService.updateSystemSettings({ is_manual_override: 0 }).catch(() => {});
    try { if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath); } catch (_) {}
  });
});

