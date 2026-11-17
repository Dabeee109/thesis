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
});
