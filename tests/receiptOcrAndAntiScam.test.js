const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, 'test_receipt_antiscam.sqlite');
if (fs.existsSync(testDbPath)) {
  try { fs.unlinkSync(testDbPath); } catch (e) {}
}

process.env.DB_FORCE_SQLITE = '1';
process.env.SQLITE_PATH = testDbPath;
process.env.NODE_ENV = 'test';

const db = require('../database/db');
const messengerService = require('../src/services/messengerService');
const { parseReceiptText, recognizeReceipt, UNREADABLE_REPLY } = require('../src/services/receiptOcrService');
const { verifyPaymentTransaction, resolveOrderTotal, formatAmount } = require('../src/services/paymentVerificationService');
const { handleMessageEvent, getSession, saveSession } = require('../src/services/nlpEngine');

// Mock messenger send
let sentMessages = [];
messengerService.callSendAPI = async (psid, messagePayload, options) => {
  sentMessages.push({ psid: String(psid), messagePayload, options });
  return { recipient_id: String(psid), message_id: `test.mid.${Date.now()}` };
};

function getSent(psid) {
  return sentMessages.filter(m => m.psid === String(psid));
}

function clearSent() {
  sentMessages = [];
}

function containsEmoji(text) {
  // Regex to detect emojis and symbols outside standard ascii and peso sign (₱ is \u20B1)
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  return emojiRegex.test(text);
}

function countSentences(text) {
  if (!text) return 0;
  // Ignore "Ref No." abbreviation and introductory exclamation "Salamat!"
  const clean = text.replace(/Ref\s+No\./gi, 'Ref No').replace(/^Salamat!\s*/i, '');
  const matches = clean.match(/[^.!?]+[.!?]+/g);
  return matches ? matches.length : 1;
}

test('1. Database Schema - admin_gcash_transactions table and order columns exist', async () => {
  await db.initDatabase();

  // Check admin_gcash_transactions table
  const [adminCols] = await db.query('PRAGMA table_info(admin_gcash_transactions)');
  const colNames = adminCols.map(c => c.name);
  assert.ok(colNames.includes('reference_number'), 'admin_gcash_transactions must have reference_number');
  assert.ok(colNames.includes('amount'), 'admin_gcash_transactions must have amount');
  assert.ok(colNames.includes('status'), 'admin_gcash_transactions must have status');
  assert.ok(colNames.includes('created_at'), 'admin_gcash_transactions must have created_at');

  // Check orders table columns
  const [orderCols] = await db.query('PRAGMA table_info(orders)');
  const orderColNames = orderCols.map(c => c.name);
  assert.ok(orderColNames.includes('gcash_ref'), 'orders must have gcash_ref');
  assert.ok(orderColNames.includes('receipt_url'), 'orders must have receipt_url');
});

test('2. Receipt OCR Parser - parses 13-digit reference and amount from text', () => {
  // Spaced format: /\b\d{4}\s?\d{3}\s?\d{6}\b/
  const text1 = 'GCash\nPayment Successful\nAmount: PHP 145.00\nRef No. 1009 876 543210\nThank you';
  const p1 = parseReceiptText(text1);
  assert.strictEqual(p1.referenceNumber, '1009876543210');
  assert.strictEqual(p1.amount, 145.00);

  // Currency symbol and contiguous digits
  const text2 = 'You have paid ₱200.50 to Diner Cafe.\nReference: 9876543210123\nDate: 2026-10-27';
  const p2 = parseReceiptText(text2);
  assert.strictEqual(p2.referenceNumber, '9876543210123');
  assert.strictEqual(p2.amount, 200.50);

  // Unreadable receipt text
  const unreadable = 'Blurry image text without digits here...';
  const p3 = parseReceiptText(unreadable);
  assert.strictEqual(p3.referenceNumber, null);
});

test('3. Receipt OCR Service - returns UNREADABLE_REPLY when receipt cannot be read', async () => {
  const result = await recognizeReceipt({ text: 'Malabong screenshot walang numero' });
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error, 'UNREADABLE_RECEIPT');
  assert.strictEqual(
    result.botReply,
    'Malabo o hindi mabasa ang resibo. Pakisend po ng mas malinaw na screenshot o i-type ang 13-digit Reference Number.'
  );
  assert.strictEqual(containsEmoji(result.botReply), false);
  assert.ok(countSentences(result.botReply) <= 2);
});

test('4. Anti-Scam Step 1: Duplicate check rejects reference number used in prior order', async () => {
  const psid = 'TEST_USER_DUP_' + Date.now();
  const dupRef = '1009876543210';

  // Seed customer and prior order with dupRef
  const [cRes] = await db.query(
    `INSERT INTO customers (psid, first_name, last_name) VALUES (?, 'Existing', 'Customer')`,
    [psid]
  );
  await db.query(
    `INSERT INTO orders (order_number, customer_id, order_type, status, subtotal, delivery_fee, total_amount, gcash_ref)
     VALUES ('DNR-TEST-DUP-1', ?, 'delivery', 'PAID', 145.00, 0, 145.00, ?)`,
    [cRes.insertId, dupRef]
  );

  const session = { order_total: 145.00, state: 'AWAITING_DELIVERY_DETAILS' };
  const result = await verifyPaymentTransaction({ referenceNumber: dupRef, session, psid });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.step, 1);
  assert.strictEqual(result.status, 'DUPLICATE_REFERENCE');
  assert.strictEqual(
    result.botReply,
    'Ang Reference Number na ito ay nagamit na sa ibang order. Pakisend ang bagong resibo.'
  );
  assert.strictEqual(containsEmoji(result.botReply), false);
  assert.ok(countSentences(result.botReply) <= 2);
});

test('5. Anti-Scam Step 2: Unreflected transaction (not in admin records) returns waiting notice', async () => {
  const psid = 'TEST_USER_NOTFOUND_' + Date.now();
  const unknownRef = '5555444433321';
  const session = { order_total: 145.00, state: 'AWAITING_DELIVERY_DETAILS' };

  const result = await verifyPaymentTransaction({ referenceNumber: unknownRef, session, psid });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.step, 2);
  assert.strictEqual(result.status, 'ADMIN_RECORD_NOT_FOUND');
  assert.strictEqual(
    result.botReply,
    `Hindi pa nagre-reflect sa aming GCash ang transaksyon na may Ref No. ${unknownRef}. Pakihintay ng ilang minuto bago subukang muli.`
  );
  assert.strictEqual(containsEmoji(result.botReply), false);
  assert.ok(countSentences(result.botReply) <= 2);
});

test('6. Anti-Scam Step 3a: Exact amount marks order PAID, admin record MATCHED, step order_placed', async () => {
  const psid = 'TEST_USER_EXACT_' + Date.now();
  const exactRef = '9876543210123'; // Seeded with 200.00
  const session = {
    order_total: 200.00,
    state: 'AWAITING_DELIVERY_DETAILS',
    current_step: 'AWAITING_DELIVERY_DETAILS'
  };

  const result = await verifyPaymentTransaction({ referenceNumber: exactRef, session, psid });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.step, 3);
  assert.strictEqual(result.status, 'PAID_EXACT');
  assert.strictEqual(session.current_step, 'order_placed');
  assert.strictEqual(session.state, 'order_placed');
  assert.strictEqual(
    result.botReply,
    'Salamat! Kumpirmado ang inyong bayad na ₱200. Inihahanda na ng kusina ang inyong order.'
  );
  assert.strictEqual(containsEmoji(result.botReply), false);
  assert.ok(countSentences(result.botReply) <= 2);

  // Check admin record status in DB
  const [adminRow] = await db.query(
    `SELECT status FROM admin_gcash_transactions WHERE reference_number = ?`,
    [exactRef]
  );
  assert.strictEqual(adminRow[0].status, 'MATCHED');
});

test('7. Anti-Scam Step 3b: Underpaid calculates kulang, records partial_paid, prompts for balance', async () => {
  const psid = 'TEST_USER_UNDER_' + Date.now();
  const underRef = '1122334455667'; // Seeded with 100.00
  const session = {
    order_total: 145.00,
    state: 'AWAITING_DELIVERY_DETAILS',
    current_step: 'AWAITING_DELIVERY_DETAILS'
  };

  const result = await verifyPaymentTransaction({ referenceNumber: underRef, session, psid });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.step, 3);
  assert.strictEqual(result.status, 'UNDERPAID');
  assert.strictEqual(result.kulang, 45.00);
  assert.strictEqual(session.partial_paid, 100.00);
  assert.strictEqual(
    result.botReply,
    'Natanggap namin ang ₱100, ngunit may kulang pa na ₱45. Paki-send ang karagdagang bayad at ang bagong resibo upang maproseso ang order.'
  );
  assert.strictEqual(containsEmoji(result.botReply), false);
  assert.ok(countSentences(result.botReply) <= 2);

  // Admin record should NOT be marked MATCHED yet
  const [adminRow] = await db.query(
    `SELECT status FROM admin_gcash_transactions WHERE reference_number = ?`,
    [underRef]
  );
  assert.strictEqual(adminRow[0].status, 'UNCLAIMED');
});

test('8. Anti-Scam Step 3c: Overpaid calculates sobra, marks PAID with OVERPAID note, admin MATCHED', async () => {
  const psid = 'TEST_USER_OVER_' + Date.now();
  const overRef = '9988776655443'; // Seeded with 250.00
  const session = {
    order_total: 145.00,
    state: 'AWAITING_DELIVERY_DETAILS',
    current_step: 'AWAITING_DELIVERY_DETAILS'
  };

  const result = await verifyPaymentTransaction({ referenceNumber: overRef, session, psid });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.step, 3);
  assert.strictEqual(result.status, 'OVERPAID');
  assert.strictEqual(result.sobra, 105.00);
  assert.strictEqual(session.current_step, 'order_placed');
  assert.strictEqual(session.state, 'order_placed');
  assert.strictEqual(
    result.botReply,
    'Salamat! Kumpirmado ang bayad. May labis kayong ₱105 na ibabalik kasabay ng inyong delivery. Inihahanda na ang inyong order.'
  );
  assert.strictEqual(containsEmoji(result.botReply), false);

  // Admin record should be marked MATCHED
  const [adminRow] = await db.query(
    `SELECT status FROM admin_gcash_transactions WHERE reference_number = ?`,
    [overRef]
  );
  assert.strictEqual(adminRow[0].status, 'MATCHED');
});

test('9. Webhook Integration - image attachment in AWAITING_DELIVERY_DETAILS processes OCR and verifies', async () => {
  const psid = 'TEST_WEBHOOK_IMG_' + Date.now();
  clearSent();

  // Create admin transaction for test
  const testRef = '2233445566778';
  await db.query(
    `INSERT INTO admin_gcash_transactions (reference_number, amount, status) VALUES (?, 145.00, 'UNCLAIMED')`,
    [testRef]
  );

  const session = await getSession(psid);
  session.state = 'AWAITING_DELIVERY_DETAILS';
  session.current_step = 'AWAITING_DELIVERY_DETAILS';
  session.order_total = 145.00;
  await saveSession(session);

  // Send image attachment with mock text payload
  const attachments = [
    {
      type: 'image',
      payload: {
        url: { text: `GCash Payment\nAmount: PHP 145.00\nRef No. 2233 445 566778\nSuccess` }
      }
    }
  ];

  await handleMessageEvent(psid, '', null, null, attachments);

  const sent = getSent(psid);
  assert.ok(sent.length >= 1, 'Bot should have replied to attachment');
  const lastMsg = sent[sent.length - 1].messagePayload.text;
  assert.strictEqual(
    lastMsg,
    'Salamat! Kumpirmado ang inyong bayad na ₱145. Inihahanda na ng kusina ang inyong order.'
  );
  assert.strictEqual(containsEmoji(lastMsg), false);
  assert.ok(countSentences(lastMsg) <= 2);

  const sUpdated = await getSession(psid);
  assert.strictEqual(sUpdated.current_step, 'order_placed');
});

test('10. Webhook Integration - typed 13-digit Reference Number in AWAITING_DELIVERY_DETAILS verifies', async () => {
  const psid = 'TEST_WEBHOOK_TYPED_' + Date.now();
  clearSent();

  const testRef = '3344556677889';
  await db.query(
    `INSERT INTO admin_gcash_transactions (reference_number, amount, status) VALUES (?, 145.00, 'UNCLAIMED')`,
    [testRef]
  );

  const session = await getSession(psid);
  session.state = 'AWAITING_DELIVERY_DETAILS';
  session.current_step = 'AWAITING_DELIVERY_DETAILS';
  session.order_total = 145.00;
  await saveSession(session);

  // User types 13-digit reference number directly
  await handleMessageEvent(psid, `Ref No. 3344 556 677889`);

  const sent = getSent(psid);
  assert.ok(sent.length >= 1);
  const lastMsg = sent[sent.length - 1].messagePayload.text;
  assert.strictEqual(
    lastMsg,
    'Salamat! Kumpirmado ang inyong bayad na ₱145. Inihahanda na ng kusina ang inyong order.'
  );
  assert.strictEqual(containsEmoji(lastMsg), false);
  assert.ok(countSentences(lastMsg) <= 2);
});

test('11. Global Reset/Cancel Intercept resets session immediately', async () => {
  const psid = 'TEST_RESET_' + Date.now();
  clearSent();

  const session = await getSession(psid);
  session.state = 'AWAITING_DELIVERY_DETAILS';
  session.current_step = 'AWAITING_DELIVERY_DETAILS';
  session.cart = [{ menuItemId: 1, name: 'Latte', price: 145, quantity: 1 }];
  await saveSession(session);

  await handleMessageEvent(psid, 'reset');

  const sent = getSent(psid);
  assert.ok(sent.length >= 1);
  const lastMsg = sent[sent.length - 1].messagePayload.text;
  assert.strictEqual(lastMsg, 'Na-reset na ang iyong session. Paano kita matutulungan ngayon?');
  assert.strictEqual(containsEmoji(lastMsg), false);

  const sReset = await getSession(psid);
  assert.strictEqual(sReset.cart.length, 0);
  assert.strictEqual(sReset.current_step, 'idle');
});
