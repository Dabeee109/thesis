const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, 'test_suggestion_flow.sqlite');
if (fs.existsSync(testDbPath)) {
  try { fs.unlinkSync(testDbPath); } catch (e) {}
}

process.env.DB_FORCE_SQLITE = '1';
process.env.SQLITE_PATH = testDbPath;
process.env.NODE_ENV = 'test';

const db = require('../database/db');
const { handleMessageEvent, getSession, saveSession } = require('../src/services/nlpEngine');
const messengerService = require('../src/services/messengerService');

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
  if (!text) return false;
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/u;
  return emojiRegex.test(text);
}

test('0. Setup Database and Seed Menu Items', async () => {
  await db.initDatabase();
});

test('1. Fuzzy search triggers "Did you mean: [item]?" and sets AWAITING_SUGGESTION_CONFIRMATION', async () => {
  const psid = 'TEST_SUGG_TRIGGER_' + Date.now();
  clearSent();

  // "caramello" has ~0.72 similarity to "Caramel Macchiato" (confirm status)
  await handleMessageEvent(psid, '2 caramello');

  const sent = getSent(psid);
  assert.strictEqual(sent.length, 1, 'Must send exactly 1 response asking Did you mean');
  const text = sent[0].messagePayload.text;

  assert.ok(text.includes('Did you mean: Caramel Macchiato?'), `Bot reply was: "${text}"`);
  assert.strictEqual(containsEmoji(text), false, 'Prompt must contain zero emojis');

  const session = await getSession(psid);
  assert.strictEqual(session.current_step, 'AWAITING_SUGGESTION_CONFIRMATION');
  assert.strictEqual(session.state, 'AWAITING_SUGGESTION_CONFIRMATION');
  assert.ok(session.pending_suggestion, 'session.pending_suggestion must be saved');
  assert.strictEqual(session.pending_suggestion.name, 'Caramel Macchiato');
  assert.strictEqual(session.pending_suggestion.quantity, 2);
});

test('2. Replying "yes", "oo", "opo", "yep", "sige" adds item to cart and returns confirmation', async () => {
  const affirmativeKeywords = ['yes', 'oo', 'opo', 'yep', 'sige'];

  for (const aff of affirmativeKeywords) {
    const psid = `TEST_AFF_${aff}_${Date.now()}`;
    clearSent();

    const session = await getSession(psid);
    session.current_step = 'AWAITING_SUGGESTION_CONFIRMATION';
    session.state = 'AWAITING_SUGGESTION_CONFIRMATION';
    session.pending_suggestion = {
      name: 'Signature Spanish Latte',
      quantity: 1,
      price: 150,
      id: 1,
      menuItemId: 1
    };
    session.cart = [];
    await saveSession(session);

    await handleMessageEvent(psid, aff);

    const sent = getSent(psid);
    assert.strictEqual(sent.length, 1, `Must send 1 response for '${aff}'`);
    const text = sent[0].messagePayload.text;

    // Must NOT say "Yes to what? Ready to check out?"
    assert.strictEqual(text.includes('Yes to what?'), false, 'Must NOT trigger generic Yes to what response');
    
    // Expected exact message:
    const expected = 'Naidagdag sa iyong cart ang 1 Signature Spanish Latte. Nais mo pa bang magdagdag ng iba o mag-checkout na?';
    assert.strictEqual(text, expected, `Bot reply must match exact format for '${aff}'`);
    assert.strictEqual(containsEmoji(text), false, `Must contain zero emojis for '${aff}'`);

    const updated = await getSession(psid);
    assert.strictEqual(updated.current_step, 'ordering');
    assert.strictEqual(updated.state, 'ordering');
    assert.strictEqual(updated.pending_suggestion, null, 'pending_suggestion must be cleared');
    assert.strictEqual(updated.cart.length, 1, 'Cart must have 1 item');
    assert.strictEqual(updated.cart[0].name, 'Signature Spanish Latte');
    assert.strictEqual(updated.cart[0].quantity, 1);
  }
});

test('3. Replying "no", "hindi", "ayaw" declines suggestion and prompts to repeat order', async () => {
  const negativeKeywords = ['no', 'hindi', 'ayaw'];

  for (const neg of negativeKeywords) {
    const psid = `TEST_NEG_${neg}_${Date.now()}`;
    clearSent();

    const session = await getSession(psid);
    session.current_step = 'AWAITING_SUGGESTION_CONFIRMATION';
    session.state = 'AWAITING_SUGGESTION_CONFIRMATION';
    session.pending_suggestion = {
      name: 'Caramel Macchiato',
      quantity: 1,
      price: 160,
      id: 2,
      menuItemId: 2
    };
    session.cart = [];
    await saveSession(session);

    await handleMessageEvent(psid, neg);

    const sent = getSent(psid);
    assert.strictEqual(sent.length, 1, `Must send 1 response for '${neg}'`);
    const text = sent[0].messagePayload.text;

    const expected = 'Pakiulit ng order.';
    assert.strictEqual(text, expected, `Bot reply must match exact format for '${neg}'`);
    assert.strictEqual(containsEmoji(text), false, `Must contain zero emojis for '${neg}'`);

    const updated = await getSession(psid);
    assert.strictEqual(updated.current_step, 'ordering');
    assert.strictEqual(updated.state, 'ordering');
    assert.strictEqual(updated.pending_suggestion, null, 'pending_suggestion must be cleared');
    assert.strictEqual(updated.cart.length, 0, 'Cart must remain empty');
  }
});

test('4. Ambiguous / invalid reply prompts retry without leaving state', async () => {
  const psid = 'TEST_AMBIGUOUS_' + Date.now();
  clearSent();

  const session = await getSession(psid);
  session.current_step = 'AWAITING_SUGGESTION_CONFIRMATION';
  session.state = 'AWAITING_SUGGESTION_CONFIRMATION';
  session.pending_suggestion = {
    name: 'Caramel Macchiato',
    quantity: 1,
    price: 160
  };
  await saveSession(session);

  await handleMessageEvent(psid, 'ano po yun?');

  const sent = getSent(psid);
  assert.strictEqual(sent.length, 1);
  const text = sent[0].messagePayload.text;

  const expected = 'Pakisagot po ng yes kung ito ang iyong ibig sabihin, o no para ulitin ang order.';
  assert.strictEqual(text, expected);
  assert.strictEqual(containsEmoji(text), false);

  const updated = await getSession(psid);
  assert.strictEqual(updated.current_step, 'AWAITING_SUGGESTION_CONFIRMATION');
  assert.strictEqual(updated.state, 'AWAITING_SUGGESTION_CONFIRMATION');
  assert.ok(updated.pending_suggestion, 'pending_suggestion must still be preserved');
});

test('5. Quick reply payload CONFIRM_YES and CONFIRM_NO work properly', async () => {
  // Test CONFIRM_YES payload
  const psidYes = 'TEST_PAYLOAD_YES_' + Date.now();
  clearSent();

  const sessionYes = await getSession(psidYes);
  sessionYes.current_step = 'AWAITING_SUGGESTION_CONFIRMATION';
  sessionYes.state = 'AWAITING_SUGGESTION_CONFIRMATION';
  sessionYes.pending_suggestion = {
    name: 'Caramel Macchiato',
    quantity: 2,
    price: 160
  };
  await saveSession(sessionYes);

  await handleMessageEvent(psidYes, 'Yes', 'CONFIRM_YES');

  let sent = getSent(psidYes);
  assert.strictEqual(sent.length, 1);
  assert.ok(sent[0].messagePayload.text.includes('Naidagdag sa iyong cart ang 2 Caramel Macchiato'));

  let updated = await getSession(psidYes);
  assert.strictEqual(updated.current_step, 'ordering');
  assert.strictEqual(updated.cart[0].quantity, 2);

  // Test CONFIRM_NO payload
  const psidNo = 'TEST_PAYLOAD_NO_' + Date.now();
  clearSent();

  const sessionNo = await getSession(psidNo);
  sessionNo.current_step = 'AWAITING_SUGGESTION_CONFIRMATION';
  sessionNo.state = 'AWAITING_SUGGESTION_CONFIRMATION';
  sessionNo.pending_suggestion = {
    name: 'Caramel Macchiato',
    quantity: 1,
    price: 160
  };
  await saveSession(sessionNo);

  await handleMessageEvent(psidNo, 'No', 'CONFIRM_NO');

  sent = getSent(psidNo);
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].messagePayload.text, 'Pakiulit ng order.');

  updated = await getSession(psidNo);
  assert.strictEqual(updated.current_step, 'ordering');
  assert.strictEqual(updated.cart.length, 0);
});
