const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');

process.env.DB_FORCE_SQLITE = 'true';
process.env.NODE_ENV = 'test';

const {
  getCheckoutInfoPrompt,
  parseCustomerInfo,
  formatPlaintextOrderSummary,
  finalizeOrderSummaryAndPayment,
  executeFinalOrderPlacement,
  handleTextInput,
  getSession,
  saveSession,
  resetUserSession,
  getStoreAddress
} = require('../src/services/nlpEngine');

const { checkInactivity, INACTIVITY_MESSAGES } = require('../src/services/inactivityWorker');
const { userSessions } = require('../src/services/sessionManager');
const textMatch = require('../src/services/textMatch');

describe('Ordering Flow Phases & Business Rules Verification', () => {

  describe('Phase 1 & 2: Dining Mode Gateway & Separate Templates', () => {
    it('Phase 2: getCheckoutInfoPrompt returns distinct templates for Delivery vs Dine-in/Pick-up', () => {
      const deliveryPrompt = getCheckoutInfoPrompt({ dining_mode: 'Delivery' });
      assert.ok(deliveryPrompt.includes('Address:'), 'Delivery prompt must contain Address:');
      assert.ok(deliveryPrompt.includes('Landmark:'), 'Delivery prompt must contain Landmark:');
      assert.ok(!deliveryPrompt.includes('Arriving time:'), 'Delivery prompt must NOT contain Arriving time:');

      const dineInPrompt = getCheckoutInfoPrompt({ dining_mode: 'Dine In' });
      assert.ok(dineInPrompt.includes('Arriving time:'), 'Dine In prompt must contain Arriving time:');
      assert.ok(!dineInPrompt.includes('Address:'), 'Dine In prompt must NOT contain Address:');
      assert.ok(!dineInPrompt.includes('Landmark:'), 'Dine In prompt must NOT contain Landmark:');

      const pickupPrompt = getCheckoutInfoPrompt({ dining_mode: 'Pick-up' });
      assert.ok(pickupPrompt.includes('Arriving time:'), 'Pick-up prompt must contain Arriving time:');
      assert.ok(!pickupPrompt.includes('Address:'), 'Pick-up prompt must NOT contain Address:');
    });

    it('Rule 1: Strict Customer Name Fidelity - preserves literal name without modifying or adding honorifics', () => {
      const parsed1 = parseCustomerInfo(`Name: Juan Dela Cruz Jr.
Phone number: 09171234567
Address: 123 Boni Ave
Landmark: tapat ng 7-11
Payment mode: Cash
note: extra napkins`);

      assert.strictEqual(parsed1.name, 'Juan Dela Cruz Jr.', 'Must retain literal customer name verbatim');

      const parsed2 = parseCustomerInfo(`delivery sa 456 Shaw Blvd, ako si Maria Clara Santos, 09281234567`);
      assert.strictEqual(parsed2.name, 'Maria Clara Santos', 'Must extract natural sentence name verbatim');
    });

    it('Rule 2: Philippine Phone Number Lock - validates and accepts valid Philippine numbers and rejects invalid', () => {
      // Valid PH numbers
      assert.strictEqual(textMatch.normalizePhone('09171234567'), '+639171234567');
      assert.strictEqual(textMatch.normalizePhone('+639171234567'), '+639171234567');
      assert.strictEqual(textMatch.normalizePhone('639171234567'), '+639171234567');
      assert.strictEqual(textMatch.normalizePhone('9171234567'), '+639171234567');

      // Invalid / foreign / short numbers
      assert.strictEqual(textMatch.normalizePhone('12345'), null);
      assert.strictEqual(textMatch.normalizePhone('0281234567'), null, 'Landlines without 9 are rejected');
      assert.strictEqual(textMatch.normalizePhone('+12025550123'), null, 'US numbers are rejected');
      assert.strictEqual(textMatch.normalizePhone('not-a-number'), null);
    });
  });

  describe('Phase 3: Auto-Store Address & Order Summary Confirmation Gateway', () => {
    it('Automatically assigns store address and ₱0.00 delivery fee for Dine-in and Pick-up in order summary', () => {
      const storeAddr = getStoreAddress();
      const dineInSummary = formatPlaintextOrderSummary({
        name: 'Carlos Rivera',
        phone: '09171234567',
        diningMode: 'Dine In',
        cart: [{ name: 'Americano', price: 120, quantity: 2 }],
        subtotal: 240,
        discountAmount: 0,
        deliveryFee: 0,
        total: 240
      });

      assert.ok(dineInSummary.includes(storeAddr), 'Dine In summary must automatically include store address');
      assert.ok(dineInSummary.includes('Delivery Fee: ₱0.00'), 'Dine In delivery fee must be ₱0.00');
      assert.ok(dineInSummary.includes('Dine In'), 'Dining mode must state Dine In');
    });

    it('finalizeOrderSummaryAndPayment sends order summary and transitions to AWAITING_ORDER_SUMMARY_CONFIRM', async () => {
      const psid = `PSID_SUMMARY_CONFIRM_${Date.now()}`;
      const session = await getSession(psid);
      session.cart = [{ menuItemId: 1, name: 'Cafe Latte', price: 140, quantity: 1 }];
      session.order_subtotal = 140;
      session.dining_mode = 'Pick-up';
      session.payment_mode = 'Cash';
      session.customer_name = 'Bea Alonzo';
      session.contact_number = '+639181234567';
      session.phone_number = '+639181234567';
      await saveSession(session);

      const res = await finalizeOrderSummaryAndPayment(psid, session);
      assert.strictEqual(res.intent, 'AWAITING_ORDER_SUMMARY_CONFIRM');
      assert.ok(res.replyLog.includes('Tama po ba ang lahat ng detalye ng inyong order?'));

      const updated = await getSession(psid);
      assert.strictEqual(updated.state, 'AWAITING_ORDER_SUMMARY_CONFIRM');
    });

    it('AWAITING_ORDER_SUMMARY_CONFIRM: Option [2] May babaguhin allows customer to edit details', async () => {
      const psid = `PSID_EDIT_CONFIRM_${Date.now()}`;
      const session = await getSession(psid);
      session.state = 'AWAITING_ORDER_SUMMARY_CONFIRM';
      session.current_step = 'AWAITING_ORDER_SUMMARY_CONFIRM';
      session.dining_mode = 'Delivery';
      session.cart = [{ menuItemId: 1, name: 'Burger', price: 150, quantity: 1 }];
      await saveSession(session);

      const editRes = await handleTextInput(psid, session, '2');
      assert.strictEqual(editRes.intent, 'ORDER_SUMMARY_EDIT');

      const updated = await getSession(psid);
      assert.strictEqual(updated.state, 'COLLECTING_CUSTOMER_INFO');
    });

    it('AWAITING_ORDER_SUMMARY_CONFIRM: Option [1] Oo, tama proceeds to final order placement', async () => {
      const db = require('../database/db');
      const [items] = await db.query('SELECT id, name, price FROM menu_items WHERE is_available = 1 LIMIT 1');
      const testItem = (items && items.length > 0)
        ? items[0]
        : { id: 999, name: 'Test Coffee', price: 100 };

      if (!items || items.length === 0) {
        await db.query('INSERT OR IGNORE INTO menu_items (id, name, price, is_available) VALUES (999, "Test Coffee", 100, 1)');
        await db.query('INSERT OR IGNORE INTO inventory (menu_item_id, stock_quantity) VALUES (999, 50)');
      }

      const psid = `PSID_YES_CONFIRM_${Date.now()}`;
      const session = await getSession(psid);
      session.state = 'AWAITING_ORDER_SUMMARY_CONFIRM';
      session.current_step = 'AWAITING_ORDER_SUMMARY_CONFIRM';
      session.dining_mode = 'Dine In';
      session.payment_mode = 'Cash';
      session.customer_name = 'Liza Soberano';
      session.contact_number = '+639179998877';
      session.phone_number = '+639179998877';
      session.cart = [{ menuItemId: testItem.id, name: testItem.name, price: Number(testItem.price), quantity: 1 }];
      session.order_subtotal = Number(testItem.price);
      await saveSession(session);

      const confirmRes = await handleTextInput(psid, session, '1');
      assert.strictEqual(confirmRes.intent, 'ORDER_PLACED_CASH');
      assert.ok(confirmRes.replyLog.includes('Pending Approval'), 'Cash order must state Pending Approval');

      const after = await getSession(psid);
      assert.strictEqual(after.state.toUpperCase(), 'IDLE', 'Session must return to IDLE after cash order placement');
    });
  });

  describe('Phase 4: Inactivity Watchdog Lifecycle (20m warning, 25m warning, 30m reset)', () => {
    it('Dispatches 20-min warning (10m remaining), 25-min warning (5m remaining), and 30-min auto-reset', async () => {
      const psid = `PSID_INACTIVITY_${Date.now()}`;
      const session = await getSession(psid);
      session.cart = [{ menuItemId: 1, name: 'Cold Brew', price: 130, quantity: 1 }];
      session.state = 'ORDERING';
      const now = Date.now();

      // Test 1: 20 minutes elapsed -> 1st Warning
      session.lastInteraction = now - (20.5 * 60 * 1000);
      session.warning20Sent = false;
      session.warning25Sent = false;
      session.purged30Sent = false;
      await saveSession(session);

      const sentMessages = [];
      const mockSend = async (to, msg) => { sentMessages.push({ to, msg }); };

      const res20 = await checkInactivity({ now: () => now, sendTextMessage: mockSend });
      assert.strictEqual(res20.warnings20, 1, 'Must dispatch 20M warning');
      assert.ok(sentMessages.some(m => m.msg.includes('10 minutes')), '20M warning must notify reset in 10 minutes');

      // Test 2: 25 minutes elapsed -> 2nd Warning (5m remaining)
      session.lastInteraction = now - (25.5 * 60 * 1000);
      await saveSession(session);

      const res25 = await checkInactivity({ now: () => now, sendTextMessage: mockSend });
      assert.strictEqual(res25.warnings25, 1, 'Must dispatch 25M warning');
      assert.ok(sentMessages.some(m => m.msg.includes('5 minutes')), '25M warning must notify reset in 5 minutes');

      // Test 3: 30 minutes elapsed -> Full session reset to IDLE and cart clear
      session.lastInteraction = now - (31 * 60 * 1000);
      await saveSession(session);

      const res30 = await checkInactivity({ now: () => now, sendTextMessage: mockSend });
      assert.strictEqual(res30.purges30, 1, 'Must dispatch 30M purge');
      assert.ok(sentMessages.some(m => m.msg.includes('na-reset na po ang inyong chat session')), '30M message must confirm reset');

      const updated = await getSession(psid);
      assert.strictEqual(updated.state, 'IDLE', 'Session must be IDLE after 30M reset');
      assert.strictEqual((updated.cart || []).length, 0, 'Cart must be cleared after 30M reset');
    });
  });

  describe('Phase 5 & 6: Order Cancellation & Feedback Submission Auto-Reset', () => {
    it('Phase 5: Self-service order cancellation resets session to IDLE', async () => {
      const psid = `PSID_CANCEL_RESET_${Date.now()}`;
      const session = await getSession(psid);
      session.state = 'AWAITING_CANCEL_CONFIRMATION';
      session.cart = [{ menuItemId: 1, name: 'Burger', price: 150, quantity: 1 }];
      await saveSession(session);

      const cancelRes = await handleTextInput(psid, session, 'yes');
      assert.ok(cancelRes.intent === 'ORDER_CANCELLED' || cancelRes.intent === 'CANCEL_CART');

      const updated = await getSession(psid);
      assert.strictEqual(updated.state.toUpperCase(), 'IDLE');
      assert.strictEqual((updated.cart || []).length, 0);
    });

    it('Phase 6: resetUserSession resets state, dining mode, and unfinalized cart to IDLE', async () => {
      const psid = `PSID_FEEDBACK_RESET_${Date.now()}`;
      const session = await getSession(psid);
      session.state = 'AWAITING_ORDER_SUMMARY_CONFIRM';
      session.dining_mode = 'Delivery';
      session.cart = [{ menuItemId: 2, name: 'Matcha Latte', price: 160, quantity: 1 }];
      await saveSession(session);

      await resetUserSession(psid, { targetState: 'IDLE' });

      const updated = await getSession(psid);
      assert.strictEqual(updated.state.toUpperCase(), 'IDLE');
      assert.strictEqual(updated.dining_mode, null);
      assert.strictEqual((updated.cart || []).length, 0);
    });
  });

});
