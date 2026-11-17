/**
 * Test Suite: Late Payment Recovery, Underpayment Guard, and Paid Signal Deadlock Prevention
 */

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const { getSession, saveSession } = require('../src/services/sessionManager');
const nlpEngine = require('../src/services/nlpEngine');
const { parseReceiptText } = require('../src/services/receiptOcrService');
const db = require('../database/db');

describe('Late Payment Recovery & Underpayment Guard Test Suite', () => {
  let validMenuItemId = 10202;

  before(async () => {
    await db.query("UPDATE customers SET cart_json = '[]', conversation_state = 'IDLE', updated_at = datetime('now', '-5 hours')").catch(() => {});
    try {
      const [rows] = await db.query("SELECT id FROM menu_items WHERE is_available = 1 AND COALESCE(is_deleted, 0) = 0 LIMIT 1");
      if (rows && rows.length > 0) {
        validMenuItemId = rows[0].id;
      }
    } catch (_) {}
    await db.query(`UPDATE menu_items SET is_available = 1, stock_quantity = 50 WHERE id = ${validMenuItemId}`).catch(() => {});
  });

  it('1. parseReceiptText correctly extracts amount from "₱20.00 transfer completed" and currency variants', () => {
    const rawSample = `
      FR****S DA*E F.
      +63 928 176 2895
      Amount 20.00
      Total Amount Sent P 20.00
      P20.00 transfer completed
      Ref No. 7047160660300
    `;
    const parsed = parseReceiptText(rawSample);
    assert.strictEqual(parsed.amount, 20.00);
    assert.strictEqual(parsed.referenceNumber, '7047160660300');
  });

  it('2. checkPendingGcashGuard preserves expiredPendingGCashOrder when 20m window expires', async () => {
    const psid = `TEST_EXPIRED_GUARD_${Date.now()}`;
    const session = await getSession(psid);
    session.pendingGCashOrder = {
      orderId: 'DRAFT_123',
      grandTotal: 338.00,
      customerName: 'Francis',
      expiresAt: Date.now() - 1000 // expired
    };
    session.checkout_step = 'AWAITING_PAYMENT_PROOF';
    session.state = 'AWAITING_PAYMENT_PROOF';

    const guardRes = await nlpEngine.checkPendingGcashGuard(psid, session);
    assert.strictEqual(guardRes.blocked, true);
    assert.strictEqual(guardRes.intent, 'GCASH_CHECKOUT_EXPIRED');
    assert.strictEqual(session.pendingGCashOrder, null);
    assert.ok(session.expiredPendingGCashOrder, 'Must preserve expiredPendingGCashOrder for recovery');
    assert.strictEqual(session.expiredPendingGCashOrder.grandTotal, 338.00);
  });

  it('3. handlePaymentProofUpload revives expired pending GCash order when late receipt arrives', async () => {
    const psid = `TEST_REVIVE_PROOF_${Date.now()}`;
    const session = await getSession(psid);
    session.expiredPendingGCashOrder = {
      grandTotal: 169.00,
      customerName: 'Francis',
      contactNumber: '09281762895',
      address: "Diner's Cafe, Tondo, Manila",
      items: [{ menuItemId: validMenuItemId, name: 'Biscoff Cheesecake', price: 169.00, quantity: 1 }],
      expiredAt: Date.now() - (10 * 60 * 1000) // expired 10 minutes ago
    };
    session.state = 'IDLE';

    // Mock receipt attachment with unique reference number
    const randomRef = `7047160${Math.floor(100000 + Math.random() * 900000)}`;
    const fakeAttachment = {
      text: `Amount: PHP 169.00 Ref No: ${randomRef}`
    };

    const res = await nlpEngine.handlePaymentProofUpload(psid, session, fakeAttachment);
    assert.ok(session.activeOrderNumber || session.state === 'AWAITING_DELIVERY' || session.state === 'order_placed', 'Order must be placed into database');
    assert.strictEqual(session.expiredPendingGCashOrder, undefined);
  });

  it('4. Underpayment detection calculates remaining balance (kulang) and alerts customer politely', async () => {
    const psid = `TEST_UNDERPAYMENT_${Date.now()}`;
    const session = await getSession(psid);
    session.pendingGCashOrder = {
      grandTotal: 338.00,
      customerName: 'Francis',
      items: [{ menuItemId: 1, name: 'Biscoff Cheesecake', price: 169.00, quantity: 2 }],
      expiresAt: Date.now() + (20 * 60 * 1000)
    };
    session.state = 'AWAITING_PAYMENT_PROOF';
    session.checkout_step = 'AWAITING_PAYMENT_PROOF';

    // Underpayment: customer sent 20.00 instead of 338.00
    const underpaidAttachment = {
      text: 'Amount: PHP 20.00 Ref No: 7047160660302'
    };

    const res = await nlpEngine.handlePaymentProofUpload(psid, session, underpaidAttachment);
    assert.strictEqual(res.intent, 'PAYMENT_AMOUNT_MISMATCH');
    assert.match(res.replyLog, /Mas mababa po ang nakitang halaga sa resibo/);
    assert.match(res.replyLog, /Kulang pa po ng ₱318\.00/);
  });

  it('5. "Ayan na ohh bayad na ako" does not seenzone and revives expired order to prompt for receipt', async () => {
    const psid = `TEST_SEENZONE_FIX_${Date.now()}`;
    const session = await getSession(psid);
    session.customer_name = 'Francis';
    session.state = 'IDLE';
    session.expiredPendingGCashOrder = {
      grandTotal: 338.00,
      customerName: 'Francis',
      items: [{ menuItemId: 1, name: 'Biscoff Cheesecake', price: 169.00, quantity: 2 }],
      expiredAt: Date.now() - (5 * 60 * 1000)
    };

    const res = await nlpEngine.handleTextInput(psid, session, 'Ayan na ohh bayad na ako');
    assert.strictEqual(res.intent, 'AWAITING_PAYMENT_PROOF_SIGNAL');
    assert.match(res.replyLog, /Salamat po sa inyong abiso, Francis!/);
    assert.match(res.replyLog, /Pakisend po rito ang screenshot ng inyong GCash receipt/);
    assert.strictEqual(session.state, 'AWAITING_PAYMENT_PROOF');
    assert.ok(session.pendingGCashOrder, 'Pending order must be revived upon paid signal');
  });

  it('6. "P20.00 transfer completed" automatically detects transfer and creates order in Pending Approval', async () => {
    const psid = `TEST_TRANSFER_COMPLETED_${Date.now()}`;
    const session = await getSession(psid);
    session.customer_name = 'Francis';
    session.contact_number = '09281762895';
    session.pendingGCashOrder = {
      grandTotal: 169.00,
      customerName: 'Francis',
      contactNumber: '09281762895',
      address: "Diner's Cafe, Tondo, Manila",
      items: [{ menuItemId: validMenuItemId, name: 'Biscoff Cheesecake', price: 169.00, quantity: 1 }],
      expiresAt: Date.now() + (20 * 60 * 1000)
    };
    session.state = 'AWAITING_PAYMENT_PROOF';
    session.checkout_step = 'AWAITING_PAYMENT_PROOF';

    const res = await nlpEngine.handleTextInput(psid, session, '₱20.00 transfer completed');
    assert.strictEqual(res.intent, 'PAYMENT_TRANSFER_COMPLETED');
    assert.match(res.replyLog, /Pending Approval/i);
    assert.ok(session.activeOrderNumber, 'Order number must be assigned');
    assert.strictEqual(session.state, 'AWAITING_DELIVERY');
  });

  it('7. Uploading receipt screenshot with Buffer automatically submits order to Pending Approval', async () => {
    const psid = `TEST_SCREENSHOT_BUFFER_${Date.now()}`;
    const session = await getSession(psid);
    session.customer_name = 'Francis';
    session.contact_number = '09281762895';
    session.pendingGCashOrder = {
      grandTotal: 169.00,
      customerName: 'Francis',
      contactNumber: '09281762895',
      address: "Diner's Cafe, Tondo, Manila",
      items: [{ menuItemId: validMenuItemId, name: 'Biscoff Cheesecake', price: 169.00, quantity: 1 }],
      expiresAt: Date.now() + (20 * 60 * 1000)
    };
    session.state = 'AWAITING_PAYMENT_PROOF';
    session.checkout_step = 'AWAITING_PAYMENT_PROOF';

    // Mock valid 1x1 PNG image attachment Buffer
    const fakeImgBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    const imgAttachment = {
      type: 'image',
      payload: { url: 'https://example.com/mock-receipt.png' },
      buffer: fakeImgBuffer
    };

    const res = await nlpEngine.handlePaymentProofUpload(psid, session, imgAttachment);
    assert.ok(session.activeOrderNumber, 'Order must be created and assigned');
    assert.match(res.replyLog, /Pending Approval|kusina|cashier/i);
    assert.strictEqual(session.state, 'IDLE');
  });
});
