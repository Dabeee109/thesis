const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const testDbPath = path.join(__dirname, 'test_item_photo.sqlite');
try { if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath); } catch (_) {}

process.env.DB_FORCE_SQLITE = '1';
process.env.SQLITE_PATH = testDbPath;
process.env.NODE_ENV = 'test';
process.env.APP_BASE_URL = 'https://diners-cafe-bot1.onrender.com';

const db = require('../database/db');
const messengerService = require('../src/services/messengerService');
const systemSettingsService = require('../src/services/systemSettingsService');
const itemPhotoService = require('../src/services/itemPhotoService');
const { handleMessageEvent } = require('../src/services/nlpEngine');

const sentMessages = [];
const origCallSendAPI = messengerService.callSendAPI;
messengerService.callSendAPI = async (psid, messagePayload) => {
  sentMessages.push({ psid: String(psid), messagePayload });
  return { recipient_id: String(psid), message_id: `mid.photo.${Date.now()}` };
};

function getSent(psid) {
  return sentMessages.filter(m => m.psid === String(psid));
}

test('On-Demand Item Photo Request Suite', async (t) => {
  await db.initDatabase();
  await systemSettingsService.updateSystemSettings({ store_status: 'OPEN', is_manual_override: 1 });

  await t.test('1. Intent detection and entity extraction parse Taglish/English photo inquiries accurately', () => {
    assert.strictEqual(itemPhotoService.isItemPhotoRequest('Patingin ng picture ng Biscoff Cheesecake'), true);
    assert.strictEqual(itemPhotoService.extractPhotoItemQuery('Patingin ng picture ng Biscoff Cheesecake'), 'Biscoff Cheesecake');

    assert.strictEqual(itemPhotoService.isItemPhotoRequest('What does Meaty Dog look like?'), true);
    assert.strictEqual(itemPhotoService.extractPhotoItemQuery('What does Meaty Dog look like?'), 'Meaty Dog');

    assert.strictEqual(itemPhotoService.isItemPhotoRequest('May pic ka ba ng Spanish Latte?'), true);
    assert.strictEqual(itemPhotoService.extractPhotoItemQuery('May pic ka ba ng Spanish Latte?'), 'Spanish Latte');

    assert.strictEqual(itemPhotoService.isItemPhotoRequest('Anong itsura ng Twisted Fries'), true);
    assert.strictEqual(itemPhotoService.extractPhotoItemQuery('Anong itsura ng Twisted Fries'), 'Twisted Fries');

    // Negative guards
    assert.strictEqual(itemPhotoService.isItemPhotoRequest('Patingin ng menu'), false);
    assert.strictEqual(itemPhotoService.isItemPhotoRequest('Ito po ang picture ng GCash receipt'), false);
  });

  await t.test('2. Scenario A: Item and image_url exist -> sends image attachment + details + Quick Replies', async () => {
    const psid = `TEST_PHOTO_A_${Date.now()}`;
    sentMessages.length = 0;

    const [rows] = await db.query(
      `SELECT id, name, price, description FROM menu_items WHERE LOWER(name) LIKE '%biscoff cheesecake%' LIMIT 1`
    );
    assert.ok(rows.length > 0, 'Biscoff Cheesecake should exist in seeded menu');
    const item = rows[0];

    await db.query(
      `UPDATE menu_items SET image_url = '/uploads/menu/biscoff.jpg', is_available = 1 WHERE id = ?`,
      [item.id]
    );
    await db.query(`UPDATE inventory SET stock_quantity = 25 WHERE menu_item_id = ?`, [item.id]);

    const res = await handleMessageEvent(psid, 'Patingin ng picture ng Biscoff Cheesecake');
    assert.strictEqual(res.intent, 'ITEM_PHOTO_SENT');

    const msgs = getSent(psid);
    assert.strictEqual(msgs.length, 2, 'Must send image attachment followed by text description + Quick Replies');

    const imgMsg = msgs[0].messagePayload;
    assert.strictEqual(imgMsg.attachment.type, 'image');
    assert.strictEqual(imgMsg.attachment.payload.is_reusable, true);
    assert.strictEqual(imgMsg.attachment.payload.url, 'https://diners-cafe-bot1.onrender.com/uploads/menu/biscoff.jpg');

    const textMsg = msgs[1].messagePayload;
    assert.ok(textMsg.text.includes(`Ito po ang ating ${item.name} (₱${Number(item.price).toFixed(2)}).`));
    assert.ok(textMsg.quick_replies.some(q => q.payload === `ADD_ITEM_${item.id}` && q.title.startsWith('+ Order ')));
    assert.ok(textMsg.quick_replies.some(q => q.payload === 'MENU_HOME'));
  });

  await t.test('3. Scenario A (Out of Stock): Sends photo + Out of Stock warning without Order button', async () => {
    const psid = `TEST_PHOTO_OOS_${Date.now()}`;
    sentMessages.length = 0;

    const [rows] = await db.query(
      `SELECT id, name FROM menu_items WHERE LOWER(name) LIKE '%meaty dog%' LIMIT 1`
    );
    assert.ok(rows.length > 0);
    const item = rows[0];

    await db.query(`UPDATE menu_items SET image_url = 'https://example.com/meatydog.jpg', stock_quantity = 0 WHERE id = ?`, [item.id]);
    await db.query(`UPDATE inventory SET stock_quantity = 0 WHERE menu_item_id = ?`, [item.id]);

    const res = await handleMessageEvent(psid, 'Anong itsura ng Meaty Dog?');
    assert.strictEqual(res.intent, 'ITEM_PHOTO_SENT_OOS');

    const msgs = getSent(psid);
    assert.strictEqual(msgs[0].messagePayload.attachment.type, 'image');
    assert.ok(msgs[1].messagePayload.text.includes('Out of Stock'));
    assert.ok(!msgs[1].messagePayload.quick_replies.some(q => q.payload.startsWith('ADD_ITEM_')));
    assert.ok(msgs[1].messagePayload.quick_replies.some(q => q.payload === 'MENU_HOME'));

    // Restore stock
    await db.query(`UPDATE menu_items SET stock_quantity = 50 WHERE id = ?`, [item.id]);
    await db.query(`UPDATE inventory SET stock_quantity = 50 WHERE menu_item_id = ?`, [item.id]);
  });

  await t.test('4. Scenario B: Item exists but image_url is null/empty -> sends polite text fallback + Quick Replies', async () => {
    const psid = `TEST_PHOTO_B_${Date.now()}`;
    sentMessages.length = 0;

    const [rows] = await db.query(
      `SELECT id, name, price FROM menu_items WHERE LOWER(name) LIKE '%twisted fries%' LIMIT 1`
    );
    assert.ok(rows.length > 0);
    const item = rows[0];

    await db.query(`UPDATE menu_items SET image_url = NULL, is_available = 1 WHERE id = ?`, [item.id]);
    await db.query(`UPDATE inventory SET stock_quantity = 30 WHERE menu_item_id = ?`, [item.id]);

    const res = await handleMessageEvent(psid, 'Show me a picture of Twisted Fries');
    assert.strictEqual(res.intent, 'ITEM_PHOTO_MISSING');

    const msgs = getSent(psid);
    assert.strictEqual(msgs.length, 1);
    assert.strictEqual(
      msgs[0].messagePayload.text,
      `Paumanhin po, wala pa pong uploaded na picture para sa ${item.name}, pero available po ito sa halagang ₱${Number(item.price).toFixed(2)}. Nais niyo po ba itong subukan?`
    );
    assert.ok(msgs[0].messagePayload.quick_replies.some(q => q.payload === `ADD_ITEM_${item.id}`));
  });

  await t.test('5. Scenario C: Item not found -> sends helpful fallback directing user to Menu', async () => {
    const psid = `TEST_PHOTO_C_${Date.now()}`;
    sentMessages.length = 0;

    const res = await handleMessageEvent(psid, 'Patingin ng picture ng Unicorn Ramen');
    assert.strictEqual(res.intent, 'ITEM_PHOTO_NOT_FOUND');

    const msgs = getSent(psid);
    assert.strictEqual(msgs.length, 1);
    assert.strictEqual(
      msgs[0].messagePayload.text,
      "Paumanhin po, hindi ko po nahanap ang item na iyon. Maaari niyo pong i-type ang 'Menu' para makita ang listahan ng available nating pagkain at inumin."
    );
    assert.ok(msgs[0].messagePayload.quick_replies.some(q => q.payload === 'MENU_HOME'));
  });

  t.after(async () => {
    messengerService.callSendAPI = origCallSendAPI;
    await systemSettingsService.updateSystemSettings({ is_manual_override: 0 }).catch(() => {});
    try { if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath); } catch (_) {}
  });
});
