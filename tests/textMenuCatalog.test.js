const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const testDbPath = path.join(__dirname, 'test_text_menu.sqlite');
try { if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath); } catch (_) {}

process.env.DB_FORCE_SQLITE = '1';
process.env.SQLITE_PATH = testDbPath;
process.env.NODE_ENV = 'test';

const db = require('../database/db');
const messengerService = require('../src/services/messengerService');
const textMenuService = require('../src/services/textMenuService');
const systemSettingsService = require('../src/services/systemSettingsService');
const { sendFullMenu, handleMessageEvent, getSession } = require('../src/services/nlpEngine');

const sentMessages = [];
const origCallSendAPI = messengerService.callSendAPI;
messengerService.callSendAPI = async (psid, messagePayload) => {
  sentMessages.push({ psid: String(psid), messagePayload });
  return { recipient_id: String(psid), message_id: `mid.menu.${Date.now()}` };
};

function getSent(psid) {
  return sentMessages.filter(m => m.psid === String(psid));
}

test('Categorized Plain-Text Menu & Unicode Strikethrough Suite', async (t) => {
  await db.initDatabase();
  await new Promise(r => setTimeout(r, 300));
  await systemSettingsService.updateSystemSettings({ store_status: 'OPEN', is_manual_override: 1 });

  await t.test('1. applyStrikethrough applies Unicode combining strikethrough (\\u0336) to every character', () => {
    const out = textMenuService.applyStrikethrough('Biscoff Cheesecake - ₱169.00');
    assert.strictEqual(out, 'B\u0336i\u0336s\u0336c\u0336o\u0336f\u0336f\u0336 \u0336C\u0336h\u0336e\u0336e\u0336s\u0336e\u0336c\u0336a\u0336k\u0336e\u0336 \u0336-\u0336 \u0336₱\u03361\u03366\u03369\u0336.\u03360\u03360\u0336');
  });

  await t.test('2. formatMenuItemLine handles in-stock vs is_available=0 / stock<=0 items', () => {
    const availableLine = textMenuService.formatMenuItemLine({
      name: 'Brown Sugar Milktea',
      price: 99,
      is_available: 1,
      stock: 15
    });
    assert.strictEqual(availableLine, '• Brown Sugar Milktea - ₱99.00');

    const zeroStockLine = textMenuService.formatMenuItemLine({
      name: 'Blueberries & Cream',
      price: 149,
      is_available: 1,
      stock: 0
    });
    assert.strictEqual(
      zeroStockLine,
      `• ${textMenuService.applyStrikethrough('Blueberries & Cream - ₱149.00')} (Out of Stock)`
    );

    const unavailableLine = textMenuService.formatMenuItemLine({
      name: 'Meaty Dog',
      price: 159,
      is_available: 0,
      stock: 20
    });
    assert.strictEqual(
      unavailableLine,
      `• ${textMenuService.applyStrikethrough('Meaty Dog - ₱159.00')} (Out of Stock)`
    );
  });

  await t.test('3. buildTextMenuPayload groups by category, splits cleanly under 2000 chars, and adds Quick Replies', () => {
    const sampleItems = [];
    for (let c = 1; c <= 6; c++) {
      const cat = c <= 2 ? `Drinks Category ${c}` : `Food Category ${c}`;
      for (let i = 1; i <= 12; i++) {
        sampleItems.push({
          id: c * 100 + i,
          name: `Signature Item ${c}-${i} Deluxe`,
          price: 120 + i,
          is_available: i === 2 ? 0 : 1,
          stock: i === 3 ? 0 : 25,
          category_name: cat,
          category_slug: cat.toLowerCase().replace(/\s+/g, '-')
        });
      }
    }

    const { messages, quickReplies } = textMenuService.buildTextMenuPayload(sampleItems, {
      view: 'all',
      hasCart: true
    });

    assert.ok(messages.length >= 2, 'Large catalog must split cleanly across multiple messages');
    assert.ok(messages[0].includes("📋 DINER'S CAFE MENU 📋"));
    assert.ok(messages[messages.length - 1].includes('💡 Para mag-order'));
    for (const msg of messages) {
      assert.ok(msg.length <= 2000, `Message exceeds 2000 chars: ${msg.length}`);
    }

    assert.ok(quickReplies.some(q => q.payload === 'VIEW_DRINKS'));
    assert.ok(quickReplies.some(q => q.payload === 'VIEW_FOOD'));
    assert.ok(quickReplies.some(q => q.payload === 'VIEW_CART'));
    assert.ok(quickReplies.some(q => q.payload === 'CONFIRM_CHECKOUT'));

    // Category filter check
    const drinksOnly = textMenuService.buildTextMenuPayload(sampleItems, { view: 'drinks' });
    assert.ok(drinksOnly.messages.join('\n').includes('DRINKS CATEGORY 1'));
    assert.ok(!drinksOnly.messages.join('\n').includes('FOOD CATEGORY 3'));
  });

  await t.test('4. sendFullMenu dispatches plain-text categorized menu (no generic image carousel) and marks out-of-stock items', async () => {
    const psid = `TEST_TEXT_MENU_${Date.now()}`;
    sentMessages.length = 0;

    // Pick first two items and mark one out of stock
    const [rows] = await db.query('SELECT id, name, price FROM menu_items WHERE COALESCE(is_deleted, 0) = 0 ORDER BY id ASC LIMIT 2');
    const outItem = rows[0];
    await db.query('UPDATE inventory SET stock_quantity = 0 WHERE menu_item_id = ?', [outItem.id]);

    const session = await getSession(psid);
    await sendFullMenu(psid, session);

    const msgs = getSent(psid);
    assert.ok(msgs.length >= 1, 'Menu messages must be dispatched');

    // No generic template carousel cards sent
    const carousels = msgs.filter(m => m.messagePayload?.attachment?.type === 'template');
    assert.strictEqual(carousels.length, 0, 'Must NOT send Generic Template image carousel');

    const combinedText = msgs.map(m => m.messagePayload.text || '').join('\n');
    assert.ok(combinedText.includes("📋 DINER'S CAFE MENU 📋"));
    assert.ok(combinedText.includes('--- '));
    assert.ok(combinedText.includes('(Out of Stock)'));
    assert.ok(combinedText.includes(textMenuService.applyStrikethrough(outItem.name)));

    for (const m of msgs) {
      assert.ok((m.messagePayload.text || '').length <= 2000, 'Each message must stay under 2000 chars');
    }

    const lastPayload = msgs[msgs.length - 1].messagePayload;
    assert.ok(Array.isArray(lastPayload.quick_replies));
    assert.ok(lastPayload.quick_replies.some(q => q.payload === 'VIEW_DRINKS'));
    assert.ok(lastPayload.quick_replies.some(q => q.payload === 'VIEW_FOOD'));
    assert.ok(lastPayload.quick_replies.some(q => q.payload === 'VIEW_CART'));

    // Test postback filter VIEW_DRINKS
    sentMessages.length = 0;
    await handleMessageEvent(psid, '', 'VIEW_DRINKS');
    const drinkMsgs = getSent(psid);
    assert.ok(drinkMsgs.some(m => (m.messagePayload.text || '').includes('DRINKS MENU')));

    // Restore stock
    await db.query('UPDATE inventory SET stock_quantity = 50 WHERE menu_item_id = ?', [outItem.id]);
  });

  t.after(async () => {
    messengerService.callSendAPI = origCallSendAPI;
    await systemSettingsService.updateSystemSettings({ is_manual_override: 0 }).catch(() => {});
    try { if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath); } catch (_) {}
  });
});
