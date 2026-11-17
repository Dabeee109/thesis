process.env.NODE_ENV = 'test';
const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const nlpEngine = require('../src/services/nlpEngine');
const geminiService = require('../src/services/geminiService');
const { getSession, saveSession } = require('../src/services/sessionManager');
const db = require('../database/db');

describe('Screenshot Bug Fixes & Multi-Key AI Pool Verification', () => {
  before(async () => {
    await db.query("UPDATE customers SET cart_json = '[]', conversation_state = 'IDLE', updated_at = datetime('now', '-5 hours')").catch(() => {});
  });

  it('1. Multi-key pool detects and loads all 4 Gemini API keys', () => {
    const keys = geminiService.resolveApiKeyPool ? geminiService.resolveApiKeyPool() : [];
    // At least 4 keys must be resolved from .env
    assert.ok(keys.length >= 4, `Expected at least 4 API keys in pool, found ${keys.length}`);
    keys.forEach(k => {
      assert.ok(k.startsWith('AQ.'), `Key should start with AQ.: ${k.slice(0, 8)}...`);
    });
  });

  it('2. "Mali pala phone number ko" in AWAITING_DISCOUNT_CONFIRMATION does NOT loop/repeat discount prompt', async () => {
    const psid = `TEST_DISCOUNT_BREAKOUT_${Date.now()}`;
    const session = await getSession(psid);
    session.customer_name = 'Francis';
    session.contact_number = '09501975648';
    session.dining_mode = 'Dine In';
    session.cart = [{ menuItemId: 10202, name: 'Coffee Jelly', price: 20, quantity: 1 }];
    session.state = 'AWAITING_DISCOUNT_CONFIRMATION';
    session.current_step = 'AWAITING_DISCOUNT_CONFIRMATION';

    const res = await nlpEngine.handleTextInput(psid, session, 'Mali pala phone number ko');
    assert.notStrictEqual(res.intent, 'AWAITING_DISCOUNT_CONFIRMATION_RETRY', 'Must not loop back to discount prompt');
    assert.strictEqual(session.state, 'COLLECTING_CUSTOMER_INFO', 'Must transition to collecting info to allow revision');
    assert.match(res.replyLog, /tamang detalye/i);
  });

  it('3. Direct phone update "09191234567" with edit keyword updates contact number seamlessly', async () => {
    const psid = `TEST_DIRECT_PHONE_UPDATE_${Date.now()}`;
    const session = await getSession(psid);
    session.customer_name = 'Francis';
    session.contact_number = '09501975648';
    session.dining_mode = 'Dine In';
    session.cart = [{ menuItemId: 10202, name: 'Coffee Jelly', price: 20, quantity: 1 }];
    session.state = 'AWAITING_DISCOUNT_CONFIRMATION';
    session.current_step = 'AWAITING_DISCOUNT_CONFIRMATION';

    const res = await nlpEngine.handleTextInput(psid, session, 'Palitan ko phone: 09191234567');
    assert.strictEqual(session.contact_number, '09191234567');
    assert.match(res.replyLog, /09191234567/);
  });

  it('4. "Wala akong discount" in AWAITING_DISCOUNT_PROOF does NOT apply 20% discount', async () => {
    const psid = `TEST_NO_DISCOUNT_PROOF_${Date.now()}`;
    const session = await getSession(psid);
    session.customer_name = 'Francis';
    session.contact_number = '09281762895';
    session.dining_mode = 'Dine In';
    session.cart = [{ menuItemId: 10202, name: 'Coffee Jelly', price: 20, quantity: 1 }];
    session.order_subtotal = 20.00;
    session.state = 'AWAITING_DISCOUNT_PROOF';
    session.current_step = 'AWAITING_DISCOUNT_PROOF';

    const res = await nlpEngine.handleTextInput(psid, session, 'Wala akong discount');
    assert.strictEqual(session.discount.applied, false, 'Discount must NOT be applied');
    assert.strictEqual(session.discount.amount, 0, 'Discount amount must be 0');
    assert.strictEqual(session.discount_amount, 0, 'Discount amount must be 0');
    assert.match(res.replyLog, /Discount: None/i);
    assert.match(res.replyLog, /Discount: ₱0\.00/i);
  });

  it('5. Exact customer name: Single name "Francis" clears stale last name and does NOT append Fernandez', async () => {
    const psid = `TEST_EXACT_NAME_${Date.now()}`;
    const orderService = require('../src/services/orderService');

    // Simulate pre-existing customer record with old profile last name "Fernandez"
    await orderService.upsertCustomer({
      psid,
      firstName: 'Francis',
      lastName: 'Fernandez',
      phone: '09281762895'
    });

    // Now customer explicitly checks out with single name "Francis"
    const nameParts = 'Francis'.trim().split(' ');
    const firstName = nameParts[0] || 'Customer';
    const lastName = nameParts.slice(1).join(' ') || '';

    await orderService.upsertCustomer({
      psid,
      firstName,
      lastName,
      phone: '09281762895'
    });

    const [rows] = await db.query('SELECT first_name, last_name FROM customers WHERE psid = ?', [psid]);
    assert.strictEqual(rows[0].first_name, 'Francis');
    assert.strictEqual(rows[0].last_name, '', 'Stale last_name must be cleared when customer provides single name');
    const fullName = `${rows[0].first_name} ${rows[0].last_name}`.trim();
    assert.strictEqual(fullName, 'Francis', 'Full customer name must be exactly Francis without Fernandez');
  });

  it('6. "menu" in AWAITING_SUGGESTION_CONFIRMATION breaks out cleanly without "Pakisagot po ng yes..."', async () => {
    const psid = `TEST_SUGGESTION_BREAKOUT_${Date.now()}`;
    const session = await getSession(psid);
    session.state = 'AWAITING_SUGGESTION_CONFIRMATION';
    session.current_step = 'AWAITING_SUGGESTION_CONFIRMATION';
    session.pending_suggestion = { name: 'Classic Milktea', quantity: 1, price: 99 };

    const res = await nlpEngine.handleTextInput(psid, session, 'menu');
    assert.notStrictEqual(res.intent, 'AWAITING_SUGGESTION_CONFIRMATION_RETRY', 'Must not loop back to yes/no prompt');
    assert.doesNotMatch(res.replyLog || '', /Pakisagot po ng yes/i);
    assert.strictEqual(session.pending_suggestion, null, 'Pending suggestion must be cleared');
  });

  it('7. "isang oreo blast, pick up, gcash payment" sets Pick-up and does NOT dump menu', async () => {
    const psid = `TEST_OREO_BLAST_ONESHOT_${Date.now()}`;
    const session = await getSession(psid);
    session.state = 'INITIAL';
    session.current_step = 'INITIAL';
    session.dining_mode = null;

    const res = await nlpEngine.handleTextInput(psid, session, 'isang oreo blast, pick up, gcash payment');
    assert.strictEqual(session.dining_mode, 'Pick-up', 'Must lock dining mode to Pick-up');
    assert.notStrictEqual(res.intent, 'DINING_MODE_TAKE_OUT', 'Must not treat one-shot order as standalone dining mode selection');
    assert.doesNotMatch(res.replyLog || '', /Eto po ang aming menu para makapili kayo/i, 'Must not dump the full menu list');
  });

  it('8. "sige lahat yan" resolves to ADD_ITEM from last_recommended_items and never sets customer_name', async () => {
    const psid = `TEST_SIGE_LAHAT_${Date.now()}`;
    const session = await getSession(psid);
    session.last_recommended_items = ['Classic Burger', 'Biscoff Cheesecake'];
    session.cart = [];

    const res = await nlpEngine.executeAiAssistantTurn(psid, session, 'sige lahat yan', {
      aiResponse: {
        reply_message: 'Sige po! Idinagdag ko na po ang Classic Burger at Biscoff Cheesecake sa inyong cart.',
        detected_action: 'SET_DETAILS',
        action_payload: {
          customer_name: 'sige lahat yan',
          items: []
        }
      }
    });

    assert.notStrictEqual(session.customer_name, 'sige lahat yan', 'Must NOT set customer_name to sige lahat yan');
    assert.strictEqual(session.cart.length >= 1, true, 'Cart must contain the recommended items');
    assert.ok(session.cart.some(it => it.name.includes('Classic Burger') || it.name.includes('Biscoff Cheesecake')));
  });

  it('9. Gemini AI primary model is upgraded to gemini-3.8-flash', () => {
    const aiService = require('../src/services/aiService');
    const geminiService = require('../src/services/geminiService');
    assert.strictEqual(aiService.PRIMARY_AI_MODEL, 'gemini-3.8-flash');
    assert.strictEqual(geminiService.PRIMARY_MODEL, 'gemini-3.8-flash');
  });

  it('10. "Pa add lahat ng recomedation mo" adds recommended items to cart, NEVER sets customer_name to "Pa" or "Kuya Pa"', async () => {
    const psid = `TEST_PA_ADD_${Date.now()}`;
    const session = await getSession(psid);
    session.last_recommended_items = ['Classic Burger', 'Biscoff Cheesecake'];
    session.cart = [];
    session.customer_name = null;

    const res = await nlpEngine.executeAiAssistantTurn(psid, session, 'Pa add lahat ng recomedation mo', {
      aiResponse: {
        reply_message: 'Sige po! Idinagdag ko na po ang Classic Burger at Biscoff Cheesecake sa inyong cart.',
        detected_action: 'SET_DETAILS',
        action_payload: {
          customer_name: 'Pa',
          items: []
        }
      }
    });

    assert.strictEqual(session.customer_name, null, 'Must NEVER set customer_name to "Pa"');
    assert.strictEqual(session.cart.length >= 1, true, 'Cart must have the recommended items added');
    assert.ok(session.cart.some(it => it.name.includes('Classic Burger') || it.name.includes('Biscoff Cheesecake')));
  });

  it('11. Inquiries like "Ano ba mga d mo kayang gawin?" do NOT loop back to "will this be for Dine In, Delivery, or Take Out?"', async () => {
    const psid = `TEST_CAPABILITIES_INQ_${Date.now()}`;
    const session = await getSession(psid);
    session.current_step = 'INITIAL';
    session.dining_mode = null;

    const res = await nlpEngine.handleTextInput(psid, session, 'Ano ba mga d mo kayang gawin?');
    assert.notStrictEqual(res.intent, 'AWAITING_DINING_MODE_GATEWAY', 'Must not trap inquiry into rigid dining mode greeting');
    assert.doesNotMatch(res.replyLog || '', /Ask ko lang po muna bago tayo magsimula, will this be for Dine In, Delivery, or Take Out\?/i);
  });

  it('12. "Sige nga dine in ako" sets session.dining_mode = "Dine In" and persists cleanly without appending dining mode question', async () => {
    const psid = `TEST_DINE_IN_${Date.now()}`;
    const session = await getSession(psid);
    session.dining_mode = null;

    await nlpEngine.executeAiAssistantTurn(psid, session, 'Sige nga dine in ako', {
      aiResponse: {
        reply_message: 'Sige po, Dine-in ang napili ninyo. Ano po ang gusto ninyong i-order mula sa ating menu ngayon?',
        detected_action: 'NONE',
        action_payload: {}
      }
    });

    assert.strictEqual(session.dining_mode, 'Dine In');
    assert.strictEqual(session.orderType, 'dine_in');

    // Subsequent inquiry must NOT have the appended question
    const recTurn = await nlpEngine.executeAiAssistantTurn(psid, session, 'Ano bang ma recomend mo saakin dyan?', {
      aiResponse: {
        reply_message: 'Para po sa rekomendasyon, subukan po natin ang ating Biscoff Cheesecake at Bacon Burger!',
        detected_action: 'NONE',
        action_payload: {}
      }
    });

    assert.doesNotMatch(recTurn.replyLog || '', /Bago po tayo mag-order, ask ko lang po: will this be for Dine In/i);
  });

  it('13. Multi-key pool detects separate GEMINI_API_KEY_1..4 variables', () => {
    const geminiService = require('../src/services/geminiService');
    process.env.GEMINI_API_KEY_99 = 'AIzaSyTestKeySeparate99';
    const pool = geminiService.resolveApiKeyPool();
    assert.ok(pool.includes('AIzaSyTestKeySeparate99'), 'Pool must include GEMINI_API_KEY_99');
    delete process.env.GEMINI_API_KEY_99;
  });

  it('14. "Sa pag babayad gamit gcash kaya mo ba akong matulungan if oorder ako?" never triggers "Your cart is empty."', async () => {
    const psid = `TEST_GCASH_INQUIRY_${Date.now()}`;
    const session = await getSession(psid);
    session.cart = [];
    session.state = 'IDLE';

    const res = await nlpEngine.handleTextInput(psid, session, 'Sa pag babayad gamit gcash kaya mo ba akong matulungan if oorder ako?');
    assert.notStrictEqual(res.intent, 'CHECKOUT', 'Must not trigger checkout flow');
    assert.doesNotMatch(res.replyLog || '', /Your cart is empty/i, 'Must NEVER reply "Your cart is empty." to inquiry');
    assert.match(res.replyLog || '', /gcash/i, 'Must provide helpful GCash payment assistance');
  });

  it('15. Emergency Barista Safety Net provides warm cafe guidance without robotic fallback on AI outage', async () => {
    const psid = `TEST_BARISTA_FALLBACK_${Date.now()}`;
    const session = await getSession(psid);

    const gcashInq = await nlpEngine.handleEmergencyBaristaFallback(psid, session, 'paano magbayad gamit gcash?');
    assert.strictEqual(gcashInq.intent, 'AI_EMERGENCY_BARISTA_FALLBACK');
    assert.match(gcashInq.replyLog, /gcash/i);
    assert.doesNotMatch(gcashInq.replyLog, /hindi ko po lubos na naintindihan/i);

    const menuInq = await nlpEngine.handleEmergencyBaristaFallback(psid, session, 'ano masarap na kape?');
    assert.match(menuInq.replyLog, /bestsellers|Latte/i);

    const locationInq = await nlpEngine.handleEmergencyBaristaFallback(psid, session, 'saan kayo located at anong oras bukas?');
    assert.match(locationInq.replyLog, /Bulacan|8:00 AM/i);

    const chitchat = await nlpEngine.handleEmergencyBaristaFallback(psid, session, 'nag tatanong ako');
    assert.match(chitchat.replyLog, /Magandang araw po! Nandito po ako upang tulungan kayo/i);
    assert.doesNotMatch(chitchat.replyLog, /hindi ko po lubos na naintindihan/i);
  });

  it('16. Screenshot 1 & 2: "pwedeng no pearl?" adds drink at base price ₱99 without pearls, and "99 lang" cleans pearls', async () => {
    const psid = `TEST_NO_PEARLS_${Date.now()}`;
    const session = await getSession(psid);
    session.cart = [];

    // Add item with explicit "no pearl" in rawText
    const addTurn = await nlpEngine.executeAiAssistantTurn(psid, session, 'Yung classic milktea nalang, pwedeng no pearl?', {
      aiResponse: {
        reply_message: 'Sige po! Idinagdag ko na ang Classic Milktea sa inyong cart.',
        detected_action: 'ADD_ITEM',
        action_payload: {
          item_name: 'Classic Milktea',
          quantity: 1,
          addon: null
        }
      }
    });

    assert.strictEqual(session.cart.length, 1);
    assert.strictEqual(session.cart[0].price, 99);
    assert.doesNotMatch(session.cart[0].name, /\(w\/\s*pearls?\)/i, 'Cart item must not contain (w/ Pearls)');

    // Now test if cart had pearls and customer corrects "Kala ko 99 lang yung classic milktea? No pearl yan ha"
    session.cart = [{ id: 1, name: 'Classic Milktea (w/ Pearls)', price: 119, quantity: 1, addons: ['Pearls'] }];
    await nlpEngine.executeAiAssistantTurn(psid, session, 'Kala ko 99 lang yung classic milktea? No pearl yan ha', {
      aiResponse: {
        reply_message: 'Tama po kayo, ₱99 lang po ang ating Classic Milktea na walang pearls!',
        detected_action: 'NONE',
        action_payload: {}
      }
    });

    assert.strictEqual(session.cart[0].price, 99, 'Price must be reset to base ₱99');
    assert.strictEqual(session.cart[0].name, 'Classic Milktea', 'Pearls suffix must be stripped');
    assert.deepStrictEqual(session.cart[0].addons, [], 'Addons must be empty');
  });

  it('17. Screenshot 3, 4, 6: Identity denial phrases clear customer name and never save as customer_name', async () => {
    const psid = `TEST_IDENTITY_DENIAL_${Date.now()}`;
    const session = await getSession(psid);
    session.customer_name = 'Francis';
    session.contact_number = '09273844028';

    // Denial 1: "Wala pa akong binibigay na details"
    await nlpEngine.executeAiAssistantTurn(psid, session, 'Wala pa akong binibigay na details', {
      aiResponse: {
        reply_message: 'Ay pasensya na po! Sige po, simulan na po natin.',
        detected_action: 'SET_DETAILS',
        action_payload: {}
      }
    });
    assert.strictEqual(session.customer_name, null, 'customer_name must be cleared');
    assert.strictEqual(session.contact_number, null, 'contact_number must be cleared');

    // Denial 2: "Wag mong ibibigay yung order summary na may pangalan, eh hindi naman ako yan"
    session.customer_name = 'Francis';
    await nlpEngine.executeAiAssistantTurn(psid, session, 'Wag mong ibibigay yung order summary na may pangalan, eh hindi naman ako yan', {
      aiResponse: {
        reply_message: 'Pasensya na po ulit sa paulit-ulit na pagtanong!',
        detected_action: 'SET_DETAILS',
        action_payload: {
          customer_name: 'eh hindi naman ako yan'
        }
      }
    });
    assert.strictEqual(session.customer_name, null, 'Must reject "eh hindi naman ako yan" and clear name');
  });

  it('18. Screenshot 7: "Wala" in AWAITING_DISCOUNT_CONFIRMATION cleanly sets discount to None and advances to summary', async () => {
    const psid = `TEST_DISCOUNT_WALA_${Date.now()}`;
    const session = await getSession(psid);
    session.customer_name = 'Dos';
    session.contact_number = '09123456789';
    session.phone_number = '09123456789';
    session.dining_mode = 'Delivery';
    session.address = 'Tondo Manila';
    session.landmark = 'DMCI homes landmark';
    session.cart = [{ id: 1, name: 'Classic Burger', price: 139, quantity: 1 }];
    session.state = 'AWAITING_DISCOUNT_CONFIRMATION';
    session.current_step = 'AWAITING_DISCOUNT_CONFIRMATION';

    // User replies "Wala"
    const res = await nlpEngine.handleTextInput(psid, session, 'Wala');
    assert.strictEqual(session.discount.applied, false);
    assert.strictEqual(session.discount.type, 'None');
    assert.strictEqual(session.discount_amount, 0);
    assert.strictEqual(session.state, 'AWAITING_ORDER_SUMMARY_CONFIRM', 'Must advance directly to Order Summary confirmation');
    assert.match(res.replyLog, /ORDER SUMMARY/i, 'Must render Order Summary');
    assert.match(res.replyLog, /Dos/i, 'Must have customer name Dos');
    assert.doesNotMatch(res.replyLog, /Mayroon po ba kayong Senior Citizen/i, 'Must NOT re-ask discount question');
  });

  it('19. Screenshot 8 & 9: Cancel trigger recognizes "paki cancel nalang" and inquiry "Paanong nacancel agad" is not a cancel trigger', () => {
    assert.strictEqual(nlpEngine.isCancelTriggerWord('paki cancel nalang pala pending approval pa naman yan diba', 'Paki cancel nalang pala pending approval pa naman yan diba?'), true);
    assert.strictEqual(nlpEngine.isCancelTriggerWord('gusto konh icancel nalang yan', 'Gusto konh icancel nalang yan'), true);
    assert.strictEqual(nlpEngine.isCancelTriggerWord('paanong nacancel agad e karerequest ko lang', 'Paanong nacancel agad e karerequest ko lang'), false, 'Inquiries about cancellation must not be cancel triggers');
  });

  it('20. Screenshot 12: Pick-up order with arriving time & note never triggers 3km boundary violation or distance fare', async () => {
    const psid = `TEST_PICKUP_NOTE_${Date.now()}`;
    const session = await getSession(psid);
    session.dining_mode = 'Pick-up';
    session.orderType = 'pickup';
    session.cart = [{ id: 1, name: 'Classic Milktea', price: 99, quantity: 1 }];
    session.customer_name = 'Francis';
    session.contact_number = '09273844028';

    const res = await nlpEngine.resolveDeliveryAddressAndFare(psid, session, 'ang sarap ko', 'none');
    assert.strictEqual(session.delivery_fee, 0, 'Pickup delivery fee must be ₱0');
    assert.strictEqual(session.state, 'AWAITING_DISCOUNT_CONFIRMATION', 'Must advance to discount confirmation, not boundary switch');
    assert.notStrictEqual(res.intent, 'AWAITING_BOUNDARY_PICKUP_SWITCH', 'Must NEVER trigger boundary violation on Pick-up');
  });

  it('21. Out-of-bounds boundary check: customer typing "pa cancel na lng" cleanly cancels draft cart without robotic fallback', async () => {
    const psid = `TEST_BOUNDARY_LNG_${Date.now()}`;
    const session = await getSession(psid);
    session.dining_mode = 'Delivery';
    session.orderType = 'delivery';
    session.state = 'AWAITING_BOUNDARY_PICKUP_SWITCH';
    session.checkout_step = 'AWAITING_BOUNDARY_PICKUP_SWITCH';
    session.cart = [{ id: 1, name: 'Burger', price: 100, quantity: 1 }];

    const res = await nlpEngine.handleTextInput(psid, session, 'pa cancel na lng');
    assert.strictEqual(res.intent, 'BOUNDARY_ORDER_CANCELLED');
    assert.match(res.replyLog, /Kinansela na po namin/i);
    assert.doesNotMatch(res.replyLog, /hindi ko po lubos na naintindihan/i);
    assert.strictEqual(session.cart.length, 0, 'Cart must be cleared on cancellation');
  });

  it('22. Screenshot 1: Recommendation inquiry "Ano ang ma recomend mo saakin?" does NOT auto-add items to cart', async () => {
    const psid = `TEST_RECOM_INQ_${Date.now()}`;
    const session = await getSession(psid);
    session.cart = [];
    session.last_recommended_items = ['Classic Burger', 'Dark Chocolate Milktea'];

    const res = await nlpEngine.executeAiAssistantTurn(psid, session, 'Ano ang ma recomend mo saakin?', {
      aiResponse: {
        reply_message: 'Inirerekomenda ko po ang ating masarap na Classic Burger at refreshing na Dark Chocolate Milktea! Nais niyo po bang idagdag ang mga ito sa inyong cart?',
        detected_action: 'RECOMMEND_ITEMS',
        action_payload: {}
      }
    });

    assert.strictEqual((session.cart || []).length, 0, 'Cart must remain empty on recommendation inquiry');
    assert.notStrictEqual(res?.aiAction, 'ADD_ITEM');
  });

  it('23. Screenshot 2: "Cge checkout na" without dining mode prompts for Dining Mode ONLY without double discount prompt', async () => {
    const psid = `TEST_CHECKOUT_DOUBLE_${Date.now()}`;
    const session = await getSession(psid);
    session.cart = [{ id: 1, name: 'Classic Burger', price: 139, quantity: 1 }];
    session.dining_mode = null;
    session.orderType = null;

    const res = await nlpEngine.executeAiAssistantTurn(psid, session, 'Cge checkout na', {
      aiResponse: {
        reply_message: 'Sige po! Para sa ating checkout, ano po ang gagamitin nating dining mode: Delivery, Pick-up, o Dine-in po?',
        detected_action: 'PROCEED_CHECKOUT',
        action_payload: {}
      }
    });

    assert.strictEqual(session.state, 'AWAITING_DINING_MODE');
    assert.match(res.replyLog, /dining mode/i);
    assert.doesNotMatch(res.replyLog, /Senior Citizen/i, 'Must not send Senior Citizen discount prompt before dining mode is selected');
  });

  it('24. Screenshot 3: "Palitan ko na lang ung address ko" in AWAITING_BOUNDARY_PICKUP_SWITCH transitions to AWAITING_ADDRESS_RETRY', async () => {
    const psid = `TEST_BOUNDARY_CHANGE_${Date.now()}`;
    const session = await getSession(psid);
    session.state = 'AWAITING_BOUNDARY_PICKUP_SWITCH';
    session.checkout_step = 'AWAITING_BOUNDARY_PICKUP_SWITCH';
    session.address = 'Block 13/14, Block 41 Zone 8, Addition Hills, Mandaluyong';
    session.cart = [{ id: 1, name: 'Classic Burger', price: 139, quantity: 1 }];

    const res = await nlpEngine.handleTextInput(psid, session, 'Palitan ko na lang ung address ko');
    assert.strictEqual(session.state, 'AWAITING_ADDRESS_RETRY');
    assert.strictEqual(res.intent, 'AWAITING_ADDRESS_RETRY');
    assert.match(res.replyLog, /bagong Delivery Address/i);
    assert.doesNotMatch(res.replyLog, /10\.77/i, 'Must not repeat out of bounds distance error');
  });

  it('25. Screenshot 4: SET_DETAILS does not re-trigger 3km boundary violation when customer replies "Gcash ako" or answers discount', async () => {
    const psid = `TEST_NO_REBOUNDARY_${Date.now()}`;
    const session = await getSession(psid);
    session.dining_mode = 'Delivery';
    session.orderType = 'delivery';
    session.address = 'Block 13/14, Block 41 Zone 8, Addition Hills, Mandaluyong';
    session.delivery_distance_km = 10.77;
    session.is_third_party_courier = true;
    session.thirdPartyDelivery = true;
    session.cart = [{ id: 1, name: 'Classic Burger', price: 139, quantity: 1 }];
    session.state = 'AWAITING_PAYMENT_MODE';

    const res = await nlpEngine.executeAiAssistantTurn(psid, session, 'Gcash ako', {
      aiResponse: {
        reply_message: 'Sige po, GCash payment po.',
        detected_action: 'SET_DETAILS',
        action_payload: { payment_mode: 'GCash' }
      }
    });

    assert.notStrictEqual(session.state, 'AWAITING_BOUNDARY_PICKUP_SWITCH', 'Must not reset state back to AWAITING_BOUNDARY_PICKUP_SWITCH');
    assert.doesNotMatch(res.replyLog, /lampas sa aming/i, 'Must not re-send out-of-bounds warning message');
  });
});
