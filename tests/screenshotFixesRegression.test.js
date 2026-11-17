process.env.NODE_ENV = 'test';
const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const nlpEngine = require('../src/services/nlpEngine');
const geminiService = require('../src/services/geminiService');
const { getSession, saveSession, resetUserSession } = require('../src/services/sessionManager');
const orderService = require('../src/services/orderService');
const { botMessages } = require('../src/services/botMessages');
const messengerService = require('../src/services/messengerService');
const db = require('../database/db');

const sentMessages = [];
const originalCallSendAPI = messengerService.callSendAPI;
messengerService.callSendAPI = async (psid, messagePayload, options) => {
  sentMessages.push({ psid: String(psid), messagePayload, options });
  if (typeof originalCallSendAPI === 'function') {
    return originalCallSendAPI(psid, messagePayload, options).catch(() => ({ recipient_id: String(psid), message_id: `mid.test.${Date.now()}` }));
  }
  return { recipient_id: String(psid), message_id: `mid.test.${Date.now()}` };
};

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

  it('26. Third-Party Grab/Lalamove: Single confirmation message sent (no duplicate Pending Approval push) and order is mapped cleanly', async () => {
    const psid = `TEST_THIRD_PARTY_HANDOFF_${Date.now()}`;
    const session = await getSession(psid);
    session.dining_mode = 'Delivery';
    session.orderType = 'delivery';
    session.customer_name = 'Francis Dave';
    session.contact_number = '09273844028';
    session.address = 'Block 13/14, Block 41 Zone 8, Addition Hills, Mandaluyong';
    session.delivery_distance_km = 10.77;

    const [rows] = await db.query('SELECT id, name, price FROM menu_items WHERE is_available = 1 LIMIT 1');
    const item = (rows && rows[0]) ? rows[0] : { id: 10555, name: 'Biscoff Cheesecake', price: 140 };
    session.cart = [{ id: item.id, menuItemId: item.id, name: item.name, price: item.price, quantity: 1 }];
    session.state = 'AWAITING_BOUNDARY_PICKUP_SWITCH';

    const res = await nlpEngine.handleTextInput(psid, session, 'Delivery pa din');
    assert.strictEqual(res.intent, 'PENDING_ADMIN_QUOTE');
    assert.match(res.replyLog, /third-party delivery/i);
    assert.match(res.replyLog, /PENDING_ADMIN_QUOTE/i);
    assert.doesNotMatch(res.replyLog, /Pending Approval na sa aming system/i, 'Must not duplicate generic pending approval message');
    assert.strictEqual(session.state, 'PENDING_ADMIN_QUOTE');
    assert.strictEqual(session.cart.length, 0, 'Cart must be cleared after handoff order is placed');
  });

  it('27. Human Handover Pause & Auto-Acknowledge: AI remains muted and sends reassuring note on customer follow-up', async () => {
    const psid = `TEST_HANDOVER_PAUSE_${Date.now()}`;
    const session = await getSession(psid);
    session.state = 'PENDING_ADMIN_QUOTE';
    session.current_step = 'PENDING_ADMIN_QUOTE';
    session.is_bot_paused = true;
    session.handover_mode = true;
    session.handover_at = Date.now();
    session.last_handover_notice_at = 0; // Allow immediate notice

    const res1 = await nlpEngine.handleTextInput(psid, session, 'Magkano po ba ang Grab fee?');
    assert.strictEqual(res1.intent, 'HUMAN_HANDOVER_PAUSED');
    assert.match(res1.replyLog, /Naka-forward na po ang inyong chat sa aming Store Admin/i);
    assert.match(res1.replyLog, /Grab\/Lalamove/i);

    // Rapid successive message within 15s stays completely silent (zero AI intervention)
    const res2 = await nlpEngine.handleTextInput(psid, session, 'Hello? Nandiyan pa ba kayo?');
    assert.strictEqual(res2.intent, 'HUMAN_HANDOVER_SILENT');
  });

  it('28. Human Handover Cancellation Bypass: "Pa cancel na lang po" cancels active quote order and unpauses session', async () => {
    const psid = `TEST_HANDOVER_CANCEL_${Date.now()}`;
    const session = await getSession(psid);
    session.customer_name = 'Francis Dave';
    session.contact_number = '09273844028';
    session.dining_mode = 'Delivery';
    session.orderType = 'delivery';

    const [rows] = await db.query('SELECT id, name, price FROM menu_items WHERE is_available = 1 LIMIT 1');
    const item = (rows && rows[0]) ? rows[0] : { id: 10555, name: 'Biscoff Cheesecake', price: 140 };
    session.cart = [{ id: item.id, menuItemId: item.id, name: item.name, price: item.price, quantity: 1 }];
    session.state = 'AWAITING_BOUNDARY_PICKUP_SWITCH';

    await nlpEngine.handleTextInput(psid, session, 'Delivery pa din');
    assert.strictEqual(session.state, 'PENDING_ADMIN_QUOTE');
    assert.strictEqual(session.is_bot_paused, true);

    const cancelRes = await nlpEngine.handleTextInput(psid, session, 'Pa cancel na lang po');
    assert.strictEqual(cancelRes.intent, 'ORDER_CANCELLED_PENDING');
    assert.match(cancelRes.replyLog, /Matagumpay na pong nakansela/i);
    assert.strictEqual(session.is_bot_paused, false, 'Bot must be unpaused after cancellation');
    assert.strictEqual(session.state, 'IDLE', 'Session must reset to IDLE');
  });

  it('29. Fail-Safe 30-Min Inactivity Timeout: Handover older than 30 mins cleanly unpauses session to IDLE', async () => {
    const psid = `TEST_HANDOVER_TIMEOUT_${Date.now()}`;
    const session = await getSession(psid);
    session.state = 'PENDING_ADMIN_QUOTE';
    session.current_step = 'PENDING_ADMIN_QUOTE';
    session.is_bot_paused = true;
    session.handover_mode = true;
    session.handover_at = Date.now() - (35 * 60 * 1000); // 35 minutes ago

    await nlpEngine.handleTextInput(psid, session, 'Hello po');
    assert.strictEqual(session.is_bot_paused, false, 'Must be unpaused after 30+ min timeout');
    assert.notStrictEqual(session.state, 'PENDING_ADMIN_QUOTE', 'State must not remain stuck in PENDING_ADMIN_QUOTE');
  });

  it('30. Empty Cart Checkout Guard: Rejects checkout and NEVER displays ₱0.00 Order Summary', async () => {
    const psid = `TEST_EMPTY_CHECKOUT_${Date.now()}`;
    const session = await getSession(psid);
    session.cart = [];
    session.customer_name = 'Yza';
    session.phone_number = '09123456789';

    // A. AI PROCEED_CHECKOUT
    const aiRes = await nlpEngine.executeAiAssistantTurn(psid, session, 'Check out', {
      aiResponse: {
        reply_message: 'Sige po! Pwede na po nating i-process ang inyong checkout.',
        detected_action: 'PROCEED_CHECKOUT',
        action_payload: {}
      }
    });
    assert.strictEqual(aiRes.intent, 'AI_PROCEED_CHECKOUT_EMPTY');
    assert.match(aiRes.replyLog, /wala pa po kayong laman sa inyong cart/i);
    assert.doesNotMatch(aiRes.replyLog, /TOTAL AMOUNT DUE/i);

    // B. finalizeOrderSummaryAndPayment with empty cart
    session.cart = [];
    session.order_subtotal = 0;
    const finRes = await nlpEngine.finalizeOrderSummaryAndPayment(psid, session);
    assert.strictEqual(finRes.intent, 'CHECKOUT_EMPTY');
    assert.match(finRes.replyLog, /hindi pa po tayo makakapag-checkout/i);
    assert.doesNotMatch(finRes.replyLog, /TOTAL AMOUNT DUE:\s*₱?0\.00/i);
    assert.strictEqual(session.state, 'IDLE');
  });

  it('31. Zombie / Cancelled Order Filter: handleTrackOrder informs of no active order when latest order is cancelled', async () => {
    const psid = `TEST_ZOMBIE_TRACK_${Date.now()}`;
    const session = await getSession(psid);

    const [rows] = await db.query(`SELECT id, name, price FROM menu_items WHERE is_available = 1 LIMIT 1`);
    const item = rows[0];
    const created = await orderService.createOrder(psid, {
      customerName: 'Yza',
      customerPhone: '09123456789',
      orderType: 'delivery',
      paymentMethod: 'cash',
      deliveryAddress: 'Hulo, Mandaluyong',
      items: [{ menuItemId: item.id, quantity: 1 }],
      deliveryFee: 0,
      totalAmount: Number(item.price)
    });

    // Mark order as cancelled in DB
    await db.query(`UPDATE orders SET status = 'cancelled' WHERE id = ?`, [created.orderId || created.id]);
    session.activeOrderNumber = null;

    sentMessages.length = 0;
    await nlpEngine.handleTrackOrder(psid, session);
    assert.ok(sentMessages.length > 0);
    const replyText = sentMessages[sentMessages.length - 1].messagePayload.text;

    assert.match(replyText, /Wala po kayong aktibong order sa ngayon/i);
    assert.match(replyText, /na-cancel na po/i);
    assert.doesNotMatch(replyText, /Ito po ay na-cancel po!\s*Total:/i, 'Must not report cancelled order as an active ongoing order');
  });

  it('32. resetUserSession purges customer_name, contact_number, cart, address, and stamps reset_at', async () => {
    const psid = `TEST_RESET_PURGE_${Date.now()}`;
    const session = await getSession(psid);
    session.customer_name = 'Yza';
    session.contact_number = '09123456789';
    session.phone_number = '09123456789';
    session.cart = [{ id: 1, name: 'Cheesy Bacon Fries', price: 159, quantity: 1 }];
    session.address = 'El Patron Pares, Marikina';

    const resetSession = await resetUserSession(psid);
    assert.strictEqual(resetSession.customer_name, null);
    assert.strictEqual(resetSession.contact_number, null);
    assert.strictEqual(resetSession.phone_number, null);
    assert.strictEqual(resetSession.cart.length, 0);
    assert.strictEqual(resetSession.address, '');
    assert.ok(resetSession.reset_at > 0);
  });

  it('33. botMessages Taglish Polish: cartEmpty and removedEmpty return polite Taglish, never robotic English', () => {
    const emptyMsg = botMessages.cartEmpty();
    assert.match(emptyMsg.text, /Wala pa po kayong laman sa inyong cart/i);
    assert.doesNotMatch(emptyMsg.text, /Your cart is empty/i);

    const remMsg = botMessages.removedEmpty(1, 'Cheesy Bacon Fries');
    assert.match(remMsg.text, /Naalis na po ang 1x Cheesy Bacon Fries/i);
    assert.doesNotMatch(remMsg.text, /Cart is empty/i);
  });

  it('34. promptDrinkAddons immediately adds the base drink to session.cart (No Ghost Cart)', async () => {
    const psid = `TEST_DRINK_CART_${Date.now()}`;
    const session = await getSession(psid);
    session.cart = [];
    const drinkItem = { id: 101, name: 'Matcha Milktea', price: 1.0, category: 'Drinks & Milktea' };

    await nlpEngine.promptDrinkAddons(psid, session, drinkItem, 1);
    assert.strictEqual(session.cart.length, 1, 'Base drink must be in session.cart immediately');
    assert.strictEqual(session.cart[0].name, 'Matcha Milktea');
    assert.strictEqual(session.cart[0].price, 1.0);
    assert.strictEqual(session.state, 'AWAITING_DRINK_ADDON');
  });

  it('35. Saying "Wala. Check out na" while AWAITING_DRINK_ADDON proceeds to checkout and retains cart', async () => {
    const psid = `TEST_DECLINE_CHECKOUT_${Date.now()}`;
    const session = await getSession(psid);
    session.cart = [];
    const drinkItem = { id: 101, name: 'Matcha Milktea', price: 1.0, category: 'Drinks & Milktea' };
    await nlpEngine.promptDrinkAddons(psid, session, drinkItem, 1);

    sentMessages.length = 0;
    const res = await nlpEngine.handleAddonSelection(psid, session, 'Wala. Check out na');
    assert.strictEqual(session.cart.length, 1, 'Cart must keep the base drink');
    assert.strictEqual(session.cart[0].name, 'Matcha Milktea');
    assert.notStrictEqual(res?.intent, 'CHECKOUT_EMPTY', 'Must NOT trigger empty cart');
    assert.doesNotMatch(JSON.stringify(sentMessages), /Wala pa po kayong laman sa inyong cart/i);
  });

  it('36. finalizeOrderSummaryAndPayment allows items with ₱1.00 base price to check out without subtotal block', async () => {
    const psid = `TEST_ONE_PESO_CHECKOUT_${Date.now()}`;
    const session = await getSession(psid);
    session.customer_name = 'Test User';
    session.contact_number = '09123456789';
    session.dining_mode = 'Dine In';
    session.cart = [{ id: 101, name: 'Matcha Milktea', price: 1.0, unitPrice: 1.0, quantity: 1 }];

    const res = await nlpEngine.finalizeOrderSummaryAndPayment(psid, session);
    assert.notStrictEqual(res.intent, 'CHECKOUT_EMPTY', '₱1.00 item must not trigger CHECKOUT_EMPTY');
  });

  it('37. Selecting an add-on (e.g. Pearls) updates the base drink with +₱20 without duplicating items in cart', async () => {
    const psid = `TEST_ADDON_UPDATE_${Date.now()}`;
    const session = await getSession(psid);
    session.cart = [];
    const drinkItem = { id: 101, name: 'Matcha Milktea', price: 99.0, category: 'Drinks & Milktea' };
    await nlpEngine.promptDrinkAddons(psid, session, drinkItem, 1);

    sentMessages.length = 0;
    await nlpEngine.handleAddonSelection(psid, session, 'Pearls');
    assert.strictEqual(session.cart.length, 1, 'Must still be 1 item in cart, not 2');
    assert.strictEqual(session.cart[0].name, 'Matcha Milktea (w/ Pearls)');
    assert.strictEqual(session.cart[0].price, 119.0, 'Price must be 99 + 20 = 119');
    assert.deepStrictEqual(session.cart[0].addons, ['Pearls']);
  });

  it('38. Details format is distinct: Delivery asks for Address/Landmark; Dine-in/Pick-up asks for Arriving time', () => {
    const deliveryPrompt = nlpEngine.getCheckoutInfoPrompt({ dining_mode: 'Delivery' });
    const dineInPrompt = nlpEngine.getCheckoutInfoPrompt({ dining_mode: 'Dine In' });
    const pickupPrompt = nlpEngine.getCheckoutInfoPrompt({ dining_mode: 'Pick-up' });

    assert.ok(deliveryPrompt.includes('Address:'));
    assert.ok(deliveryPrompt.includes('Landmark:'));
    assert.ok(!deliveryPrompt.includes('Arriving time:'));

    assert.ok(dineInPrompt.includes('Arriving time:'));
    assert.ok(!dineInPrompt.includes('Address:'));
    assert.ok(!dineInPrompt.includes('Landmark:'));

    assert.ok(pickupPrompt.includes('Arriving time:'));
    assert.ok(!pickupPrompt.includes('Address:'));
  });

  it('39. Once guest details are given without payment mode, bot asks for Payment Mode (Cash or GCash)', async () => {
    const psid = `TEST_ASK_PAYMENT_${Date.now()}`;
    const session = await getSession(psid);
    session.cart = [{ id: 101, name: 'Matcha Milktea', price: 99.0, quantity: 1 }];
    session.dining_mode = 'Dine In';
    session.state = 'COLLECTING_CUSTOMER_INFO';
    session.payment_mode = null;

    sentMessages.length = 0;
    const res = await nlpEngine.handleTextInput(psid, session, 'Francis Dave, 09281762895, 2:00 PM');
    assert.strictEqual(session.customer_name, 'Francis Dave');
    assert.ok(session.contact_number.includes('9281762895'));
    assert.strictEqual(session.state, 'AWAITING_PAYMENT_MODE');
    assert.match(res?.replyLog || JSON.stringify(sentMessages), /Cash o GCash/i);
  });

  it('40. Customer updating payment mode at Order Summary immediately re-renders Updated Order Summary', async () => {
    const psid = `TEST_UPDATE_SUMMARY_PAYMENT_${Date.now()}`;
    const session = await getSession(psid);
    session.customer_name = 'Francis Dave';
    session.contact_number = '09281762895';
    session.dining_mode = 'Dine In';
    session.payment_mode = 'Cash';
    session.cart = [{ id: 101, name: 'Matcha Milktea', price: 99.0, unitPrice: 99.0, quantity: 1 }];
    session.state = 'AWAITING_ORDER_SUMMARY_CONFIRM';
    session.current_step = 'AWAITING_ORDER_SUMMARY_CONFIRM';

    sentMessages.length = 0;
    await nlpEngine.handleTextInput(psid, session, 'Gcash ang payment ko');
    assert.strictEqual(session.payment_mode, 'GCash');
    const sentTexts = sentMessages.map(m => m.messagePayload.text).join('\n');
    assert.match(sentTexts, /Payment Mode:\s*GCash/i, 'Must re-send updated order summary with GCash');
    assert.match(sentTexts, /Tama po ba ang lahat ng detalye/i);
  });

  it('41. "Tama po" in AWAITING_ORDER_SUMMARY_CONFIRM finalizes order without looping back to confirmation prompt', async () => {
    const psid = `TEST_CONFIRM_NOLOOP_${Date.now()}`;
    const [itemRows] = await db.query('SELECT id, name, price FROM menu_items WHERE is_available = 1 LIMIT 1');
    const realItem = (itemRows && itemRows[0]) ? itemRows[0] : { id: 1, name: 'Classic Burger', price: 139 };
    const session = await getSession(psid);
    session.customer_name = 'Francis Dave';
    session.contact_number = '09281762895';
    session.dining_mode = 'Dine In';
    session.payment_mode = 'Cash';
    session.cart = [{ id: realItem.id, menuItemId: realItem.id, name: realItem.name, price: Number(realItem.price), unitPrice: Number(realItem.price), quantity: 1 }];
    session.state = 'AWAITING_ORDER_SUMMARY_CONFIRM';
    session.current_step = 'AWAITING_ORDER_SUMMARY_CONFIRM';

    sentMessages.length = 0;
    const res = await nlpEngine.handleTextInput(psid, session, 'Tama po');
    assert.strictEqual(res.intent, 'ORDER_PLACED_CASH');
    assert.strictEqual(session.state, 'IDLE');
    const sentTexts = sentMessages.map(m => m.messagePayload.text).join('\n');
    assert.match(sentTexts, /Na-receive na po namin ang inyong order/i);
    assert.doesNotMatch(sentTexts, /Tama po ba ang lahat ng detalye/i, 'Must NOT repeat the confirmation prompt after user says Tama po');
  });
});
