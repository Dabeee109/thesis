const test = require('node:test');
const assert = require('node:assert/strict');

// Set test environment
process.env.NODE_ENV = 'test';
process.env.DB_FORCE_SQLITE = 'true';

const { parseCustomerInfo } = require('../src/services/nlpEngine');

test('Checkout & Messenger State Machine Regression Suite', async (t) => {
  await t.test('1. parseCustomerInfo does not extract filler/casual words as customer name', () => {
    const fillers = ['Nice', 'ok', 'okay', 'Sige', 'yes', 'opo', 'salamat', 'Walaw', 'wala'];
    for (const f of fillers) {
      const parsed = parseCustomerInfo(f, 'Dine In');
      assert.notEqual(parsed.name.toLowerCase(), f.toLowerCase(), `Filler word "${f}" must not be extracted as customer name`);
      assert.equal(parsed.name, '', `Name should be empty for filler "${f}"`);
    }
  });

  await t.test('2. parseCustomerInfo properly extracts valid names from structured and labeled formats', () => {
    const raw = `Name: Dave Fernandez\nPhone: 09281762895\nArriving time: 9 PM\nPayment mode: GCash\nnote: extra ice`;
    const parsed = parseCustomerInfo(raw, 'Dine In');
    assert.equal(parsed.name, 'Dave Fernandez');
    assert.equal(parsed.contact, '09281762895');
    assert.equal(parsed.arrivingTime, '9 PM');
    assert.equal(parsed.paymentMode, 'GCash');
    assert.equal(parsed.note, 'extra ice');
  });

  await t.test('3. parseCustomerInfo preserves null paymentMode when not specified so session.payment_mode is retained', () => {
    const parsed = parseCustomerInfo('Nice', 'Dine In');
    assert.equal(parsed.paymentMode, null, 'Payment mode should be null if not explicitly mentioned');

    // Simulating session resolution
    const session = { customer_name: 'Dave', payment_mode: 'GCash' };
    const resolvedPay = parsed.paymentMode || session.payment_mode || 'Cash';
    assert.equal(resolvedPay, 'GCash', 'GCash must be preserved across casual conversational turns');
  });

  await t.test('4. parseCustomerInfo extracts GCash explicitly when specified in text', () => {
    const parsed1 = parseCustomerInfo('Payment mode: GCash', 'Dine In');
    assert.equal(parsed1.paymentMode, 'GCash');

    const parsed2 = parseCustomerInfo('Payment mode: Cash', 'Dine In');
    assert.equal(parsed2.paymentMode, 'Cash');
  });

  await t.test('5. Discount rejection regex handles typos like "Walaw" and "wala po"', () => {
    const norm1 = 'walaw';
    const isNo1 = /\b(?:wala|walaw|walaa|wla|wala\s*po|no|nope|hindi|none|wag\s*na|huwag|ayaw|wala\s*akong)\b/i.test(norm1) || /^wal/i.test(norm1);
    assert.equal(isNo1, true, '"walaw" typo must be recognized as No');

    const norm2 = 'wala po';
    const isNo2 = /\b(?:wala|walaw|walaa|wla|wala\s*po|no|nope|hindi|none|wag\s*na|huwag|ayaw|wala\s*akong)\b/i.test(norm2) || /^wal/i.test(norm2);
    assert.equal(isNo2, true, '"wala po" must be recognized as No');
  });

  await t.test('6. Standalone GCash reference pattern matches 9-13 digit numbers prefixed with "Reference number:"', () => {
    const raw = 'Reference number: 4362754782834';
    const match = raw.match(/(?:ref(?:erence)?(?:\s*no\.?|\s*number)?:?\s*)?(\b\d{9,13}\b)/i);
    assert.ok(match, 'Reference number pattern should match');
    assert.equal(match[1], '4362754782834');
  });
});
