const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// Ensure SQLite test mode
process.env.DB_FORCE_SQLITE = 'true';
process.env.SQLITE_DB_PATH = path.join(__dirname, 'test_addons.sqlite');

const nlpEngine = require('../src/services/nlpEngine');
const messengerService = require('../src/services/messengerService');

test('Drinks & Milktea Add-ons Upselling Flow', async (t) => {
  let sentMessages = [];

  // Mock callSendAPI
  const origCallSendAPI = messengerService.callSendAPI;
  messengerService.callSendAPI = async (psid, messagePayload, options) => {
    sentMessages.push({ psid, messagePayload, options });
    return { recipient_id: psid, message_id: 'mid_mock' };
  };

  const fakeDrinkItem = {
    id: 101,
    name: 'Signature Spanish Latte',
    price: 125.00,
    category: 'Drinks & Milktea',
    is_available: 1,
    stock_quantity: 50
  };

  await t.test('1. Interception: Ordering drinks triggers AWAITING_DRINK_ADDON state and prompt', async () => {
    sentMessages = [];
    const session = { psid: 'test_user_addon_1', cart: [], dining_mode: 'Dine In' };

    await nlpEngine.promptDrinkAddons(session.psid, session, fakeDrinkItem, 1);

    assert.equal(session.state, 'AWAITING_DRINK_ADDON');
    assert.equal(session.current_step, 'AWAITING_DRINK_ADDON');
    assert.ok(session.current_drink_item);
    assert.equal(session.current_drink_item.item.name, 'Signature Spanish Latte');
    assert.equal(session.current_drink_item.quantity, 1);

    assert.equal(sentMessages.length, 1);
    const m0 = sentMessages[0].messagePayload;
    assert.ok(m0.text.includes('Nais niyo po ba itong lagyan ng Add-ons tulad ng Pearls, Nata de Coco, o Cream Cheese (+₱20 bawat isa)?'));
    assert.equal(m0.quick_replies, undefined);
  });

  await t.test('2. Scenario C: User inquires about options ("Ano ang mga add-ons?")', async () => {
    sentMessages = [];
    const session = {
      psid: 'test_user_addon_2',
      cart: [],
      dining_mode: 'Dine In',
      state: 'AWAITING_DRINK_ADDON',
      current_step: 'AWAITING_DRINK_ADDON',
      current_drink_item: { item: fakeDrinkItem, quantity: 1 }
    };

    await nlpEngine.handleAddonSelection(session.psid, session, 'Ano ang mga add-ons?');

    // Must remain in AWAITING_DRINK_ADDON
    assert.equal(session.state, 'AWAITING_DRINK_ADDON');
    assert.equal(session.current_step, 'AWAITING_DRINK_ADDON');

    assert.equal(sentMessages.length, 1);
    const m0 = sentMessages[0].messagePayload;
    assert.ok(m0.text.includes('Narito po ang mga available naming Add-ons (+₱20 bawat isa):'));
    assert.ok(m0.text.includes('• Pearls'));
    assert.ok(m0.text.includes('• Nata de Coco'));
    assert.ok(m0.text.includes('• Cream Cheese'));
    assert.ok(m0.text.includes('• Coffee Jelly'));
    assert.ok(m0.text.includes('• Egg Pudding'));
    assert.ok(m0.text.includes("Alin po rito ang nais ninyong idagdag? (O sabihin lamang ang 'Wala' kung ayaw mag-add)."));
    assert.equal(m0.quick_replies, undefined);
  });

  await t.test('3. Scenario A: User selects Pearls', async () => {
    sentMessages = [];
    const session = {
      psid: 'test_user_addon_3',
      cart: [],
      dining_mode: 'Dine In',
      state: 'AWAITING_DRINK_ADDON',
      current_step: 'AWAITING_DRINK_ADDON',
      current_drink_item: { item: fakeDrinkItem, quantity: 1 }
    };

    await nlpEngine.handleAddonSelection(session.psid, session, 'ADDON_PEARLS');

    assert.equal(session.state, 'COLLECTING_CUSTOMER_INFO');
    assert.equal(session.current_step, 'COLLECTING_CUSTOMER_INFO');
    assert.equal(session.cart.length, 1);

    const line = session.cart[0];
    assert.equal(line.name, 'Signature Spanish Latte (w/ Pearls)');
    assert.equal(line.quantity, 1);
    // Line subtotal with add-on
    const lineTotal = (line.price + 20.0) * line.quantity;
    assert.equal(lineTotal, 145.00);

    // Confirmation message and customer info collection prompt sent
    assert.equal(sentMessages.length, 2);
    assert.ok(sentMessages[0].messagePayload.text.includes('Sige po, nailagay na ang Pearls (+₱20)!'));
    assert.ok(sentMessages[1].messagePayload.text.includes('Pakibigay po ang sumusunod para sa inyong order:'));
    assert.ok(sentMessages[1].messagePayload.text.includes('Arriving time:'));
  });

  await t.test('4. Scenario B: User declines ("Wala / Skip" or "Wag na")', async () => {
    sentMessages = [];
    const session = {
      psid: 'test_user_addon_4',
      cart: [],
      dining_mode: 'Delivery',
      state: 'AWAITING_DRINK_ADDON',
      current_step: 'AWAITING_DRINK_ADDON',
      current_drink_item: { item: fakeDrinkItem, quantity: 1 }
    };

    await nlpEngine.handleAddonSelection(session.psid, session, 'Wag na po');

    assert.equal(session.state, 'COLLECTING_CUSTOMER_INFO');
    assert.equal(session.current_step, 'COLLECTING_CUSTOMER_INFO');
    assert.equal(session.cart.length, 1);

    const line = session.cart[0];
    assert.equal(line.name, 'Signature Spanish Latte');
    assert.equal(line.quantity, 1);
    assert.equal(line.price, 125.00);

    assert.equal(sentMessages.length, 2);
    assert.ok(sentMessages[0].messagePayload.text.includes('Sige po, walang add-ons.'));
    assert.ok(sentMessages[1].messagePayload.text.includes('Pakibigay po ang sumusunod para sa inyong order:'));
    assert.ok(sentMessages[1].messagePayload.text.includes('Address:'));
  });

  await t.test('5. Summary Template includes formatted (w/ Add-on) line and correct subtotal', async () => {
    const session = {
      name: 'Maria Santos',
      phone: '09171234567',
      dining_mode: 'Dine In',
      cart: [
        {
          name: 'Signature Spanish Latte (w/ Pearls)',
          price: 125.00,
          quantity: 1,
          addOns: [{ name: 'Pearls', price: 20.0 }]
        }
      ],
      order_subtotal: 145.00,
      total_amount: 145.00,
      payment_method: 'Cash'
    };

    const summary = nlpEngine.formatPlaintextOrderSummary(session);
    assert.ok(summary.includes('- 1x Signature Spanish Latte (w/ Pearls) (₱145.00)'));
    assert.ok(summary.includes('Subtotal: ₱145.00'));
    assert.ok(summary.includes('TOTAL AMOUNT DUE: ₱145.00'));
  });

  // Restore mocks
  messengerService.callSendAPI = origCallSendAPI;
});
