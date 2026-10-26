const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalize,
  classifyShort,
  parseQuantity,
  matchItems,
  validateName,
  normalizePhone,
  validateAddress,
  peso
} = require('../src/services/textMatch');

test('classifyShort returns YES for affirmative inputs', () => {
  const yesCases = ['yes', 'Yep', 'sure!', 'ok', 'okay po', 'go ahead', 'proceed', 'sige', 'opo', 'yess', 'suree', '👍'];
  for (const input of yesCases) {
    assert.strictEqual(classifyShort(input), 'YES', `Expected YES for "${input}"`);
  }
});

test('classifyShort returns NO for negative inputs', () => {
  const noCases = ['no', 'nope', 'not yet', 'hindi pa', 'wag muna', 'cancel', '👎'];
  for (const input of noCases) {
    assert.strictEqual(classifyShort(input), 'NO', `Expected NO for "${input}"`);
  }
});

test('classifyShort returns null for non-answers or mixed inputs', () => {
  const nullCases = ['yes but add fries', 'ok 2 fries', 'maybe', 'po', '', null, undefined, '    '];
  for (const input of nullCases) {
    assert.strictEqual(classifyShort(input), null, `Expected null for "${input}"`);
  }
});

test('parseQuantity extracts numbers correctly and ignores invalid numbers', () => {
  assert.strictEqual(parseQuantity('2 spanish latte'), 2);
  assert.strictEqual(parseQuantity('one croissant'), 1);
  assert.strictEqual(parseQuantity('isa pang spanish latte'), 1);
  assert.strictEqual(parseQuantity('another cookie'), 1);
  assert.strictEqual(parseQuantity('QTY_4'), 4);
  assert.strictEqual(parseQuantity('tatlo'), 3);
  assert.strictEqual(parseQuantity('sampu'), 10);
  assert.strictEqual(parseQuantity('croissant'), null);
  assert.strictEqual(parseQuantity('0'), null);
  assert.strictEqual(parseQuantity('100'), null);
});

test('matchItems matches menu items against seeded menu', () => {
  const candidates = [
    { id: 1, name: 'Signature Spanish Latte', synonyms: 'spanish latte, spanish, spanish coffee' },
    { id: 2, name: 'Caramel Macchiato', synonyms: 'macchiato, caramel' },
    { id: 3, name: 'Iced Americano', synonyms: 'americano, iced americano' },
    { id: 4, name: 'Kyoto Uji Matcha Latte', synonyms: 'matcha, matcha latte, kyoto matcha' },
    { id: 5, name: 'Hibiscus Berry Iced Tea', synonyms: 'hibiscus, berry tea, iced tea' },
    { id: 6, name: 'Classic Beef Tapa Rice Bowl', synonyms: 'tapa, beef tapa, tapsilog, rice bowl' },
    { id: 7, name: 'Creamy Truffle Bacon Carbonara', synonyms: 'carbonara, pasta, truffle pasta' },
    { id: 8, name: 'Almond Butter Croissant', synonyms: 'croissant, almond croissant' },
    { id: 9, name: 'Dark Chocolate Chunk Cookie', synonyms: 'cookie, chocolate cookie, choco cookie' },
    { id: 10, name: 'Grilled Chicken Pesto Panini', synonyms: 'panini, chicken panini, pesto panini' }
  ];

  // 1. "ok" -> none (never "Cookie")
  const okRes = matchItems('ok', candidates);
  assert.strictEqual(okRes.status, 'none', 'ok should match none');

  // 2. "spanish latt" -> accept: Signature Spanish Latte
  const spanishRes = matchItems('spanish latt', candidates);
  assert.strictEqual(spanishRes.status, 'accept');
  assert.strictEqual(spanishRes.matches[0].id, 1);

  // 3. "latte" -> ambiguous: Signature Spanish Latte and Kyoto Uji Matcha Latte
  const latteRes = matchItems('latte', candidates);
  assert.strictEqual(latteRes.status, 'ambiguous');
  const matchedIds = latteRes.matches.slice(0, 2).map(m => m.id);
  assert.ok(matchedIds.includes(1) && matchedIds.includes(4));

  // 4. "americano" -> accept: Iced Americano
  const americanoRes = matchItems('americano', candidates);
  assert.strictEqual(americanoRes.status, 'accept');
  assert.strictEqual(americanoRes.matches[0].id, 3);

  // 5. "matcha" -> accept: Kyoto Uji Matcha Latte
  const matchaRes = matchItems('matcha', candidates);
  assert.strictEqual(matchaRes.status, 'accept');
  assert.strictEqual(matchaRes.matches[0].id, 4);

  // 6. "chocolat cokie" -> accept or confirm: Dark Chocolate Chunk Cookie
  const cookieRes = matchItems('chocolat cokie', candidates);
  assert.ok(cookieRes.status === 'accept' || cookieRes.status === 'confirm');
  assert.strictEqual(cookieRes.matches[0].id, 9);

  // 7. "croissant" -> accept: Almond Butter Croissant
  const croissantRes = matchItems('croissant', candidates);
  assert.strictEqual(croissantRes.status, 'accept');
  assert.strictEqual(croissantRes.matches[0].id, 8);

  // 8. "pizza" -> none
  const pizzaRes = matchItems('pizza', candidates);
  assert.strictEqual(pizzaRes.status, 'none');
});

test('validateName validates customer names correctly', () => {
  assert.strictEqual(validateName('Juan Dela Cruz').ok, true);
  assert.strictEqual(validateName('Maria Clara O\'Connor').ok, true);
  assert.strictEqual(validateName('Dr. Jose Rizal-Mercado').ok, true);

  assert.strictEqual(validateName('J').ok, false); // too short
  assert.strictEqual(validateName('12345').ok, false); // digits
  assert.strictEqual(validateName('😀😎').ok, false); // emoji only
  assert.strictEqual(validateName('<script>alert(1)</script>').ok, false); // markup
  assert.strictEqual(validateName('https://phish.com').ok, false); // link
});

test('normalizePhone validates and normalizes PH mobile numbers', () => {
  assert.strictEqual(normalizePhone('0917 123 4567'), '+639171234567');
  assert.strictEqual(normalizePhone('0918-234-5678'), '+639182345678');
  assert.strictEqual(normalizePhone('9193456789'), '+639193456789');
  assert.strictEqual(normalizePhone('+639171234567'), '+639171234567');
  assert.strictEqual(normalizePhone('639171234567'), '+639171234567');

  assert.strictEqual(normalizePhone('123'), null);
  assert.strictEqual(normalizePhone('0281234567'), null); // landline
  assert.strictEqual(normalizePhone('not-a-number'), null);
});

test('validateAddress validates address format', () => {
  assert.strictEqual(validateAddress('Unit 402 Acacia Heights, Maple St, near church').ok, true);
  assert.strictEqual(validateAddress('Short').ok, false);
  assert.strictEqual(validateAddress('123456789012345').ok, false); // only one word
  assert.strictEqual(validateAddress('<script>alert("xss")</script>').ok, false);
});

test('peso formats currency with ₱ symbol and two decimals', () => {
  assert.strictEqual(peso(290), '₱290.00');
  assert.strictEqual(peso(95.5), '₱95.50');
  assert.strictEqual(peso(1234.5), '₱1,234.50');
});
