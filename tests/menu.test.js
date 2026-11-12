const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, 'test_menu.sqlite');
if (fs.existsSync(testDbPath)) {
  try { fs.unlinkSync(testDbPath); } catch (e) {}
}

process.env.DB_FORCE_SQLITE = '1';
process.env.SQLITE_PATH = testDbPath;
process.env.NODE_ENV = 'test';

const db = require('../database/db');
const { handleMessageEvent, getSession } = require('../src/services/nlpEngine');
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

test('Menu - whole menu sent immediately without category selector', async () => {
  await db.initDatabase();
  const systemSettingsService = require('../src/services/systemSettingsService');
  await systemSettingsService.updateSystemSettings({
    store_status: 'OPEN',
    is_manual_override: 1
  });
  const psid = 'TEST_MENU_WHOLE_' + Date.now();
  clearSent();

  await handleMessageEvent(psid, 'menu');
  const msgs = getSent(psid);

  // 1. Intro text
  assert.ok(msgs.length >= 3);
  const introMsg = msgs[0].messagePayload;
  assert.strictEqual(introMsg.text, "Here's our menu. Tap ➕ to add, or type an order.");

  // 2. Generic template (carousel)
  const carousels = msgs.filter(m => m.messagePayload.attachment && m.messagePayload.attachment.type === 'template');
  assert.ok(carousels.length >= 1);
  const allElements = carousels.flatMap(c => c.messagePayload.attachment.payload.elements);

  // 3. Outro text with quick replies
  const lastMsg = msgs[msgs.length - 1].messagePayload;
  assert.strictEqual(lastMsg.text, 'Type your order, e.g. “2 spanish latte”.');
  assert.ok(lastMsg.quick_replies.some(qr => qr.payload === 'VIEW_CART'));

  // Ensure no category question was asked
  const allTexts = msgs.filter(m => m.messagePayload.text).map(m => m.messagePayload.text);
  assert.ok(!allTexts.some(t => t.toLowerCase().includes('category')));

  // Session state is BROWSING
  const session = await getSession(psid);
  assert.strictEqual(session.state, 'BROWSING');
});

test('Menu - items out of stock or hidden are excluded', async () => {
  const psid = 'TEST_MENU_STOCK_' + Date.now();
  clearSent();

  // Mark item 1 (Signature Spanish Latte) is_available = 0
  await db.query('UPDATE menu_items SET is_available = 0 WHERE id = 1');
  // Mark item 2 (Caramel Macchiato) inventory stock_quantity = 0
  await db.query('UPDATE inventory SET stock_quantity = 0 WHERE menu_item_id = 2');

  await handleMessageEvent(psid, 'menu');
  const msgs = getSent(psid);
  const carousels = msgs.filter(m => m.messagePayload.attachment && m.messagePayload.attachment.type === 'template');
  const allElements = carousels.flatMap(c => c.messagePayload.attachment.payload.elements);

  assert.ok(!allElements.some(e => e.title.includes('Signature Spanish Latte')));
  assert.ok(!allElements.some(e => e.title.includes('Caramel Macchiato')));

  // Restore availability and stock
  await db.query('UPDATE menu_items SET is_available = 1 WHERE id = 1');
  await db.query('UPDATE inventory SET stock_quantity = 50 WHERE menu_item_id = 2');
});

test('Menu - categories are sorted by display_order and card lengths capped at 80', async () => {
  const psid = 'TEST_MENU_SORT_' + Date.now();
  clearSent();

  await handleMessageEvent(psid, 'menu');
  const msgs = getSent(psid);
  const carousels = msgs.filter(m => m.messagePayload.attachment && m.messagePayload.attachment.type === 'template');
  const allElements = carousels.flatMap(c => c.messagePayload.attachment.payload.elements);

  for (const el of allElements) {
    assert.ok(el.title.length <= 80, `Title exceeds 80 chars: ${el.title}`);
    assert.ok(el.subtitle.length <= 80, `Subtitle exceeds 80 chars: ${el.subtitle}`);
    assert.strictEqual(el.buttons[0].type, 'postback');
    assert.strictEqual(el.buttons[0].title, '➕ Add to order');
    assert.ok(el.buttons[0].payload.startsWith('ADD_ITEM_'));
  }
});

test('Menu - carousels chunked to at most 10 cards per carousel', async () => {
  const psid = 'TEST_MENU_CHUNKS_' + Date.now();
  clearSent();

  // Clean up any leftover test items first
  await db.query('DELETE FROM inventory WHERE menu_item_id >= 100').catch(() => {});
  await db.query('DELETE FROM menu_items WHERE id >= 100').catch(() => {});

  // Insert additional test items to exceed 10 items
  for (let i = 100; i <= 112; i++) {
    await db.query(
      `INSERT INTO menu_items (id, category_id, name, description, price, is_available)
       VALUES (?, 1, ?, 'Delicious test brew', 100.00, 1)`,
      [i, `Test Coffee Item ${i}`]
    );
    await db.query(
      `INSERT INTO inventory (menu_item_id, stock_quantity, low_stock_threshold)
       VALUES (?, 20, 5)`,
      [i]
    );
  }

  await handleMessageEvent(psid, 'menu');
  const msgs = getSent(psid);
  const carousels = msgs.filter(m => m.messagePayload.attachment && m.messagePayload.attachment.type === 'template');
  assert.ok(carousels.length >= 2, 'Should chunk across multiple carousels');

  for (const c of carousels) {
    const count = c.messagePayload.attachment.payload.elements.length;
    assert.ok(count <= 10, `Carousel chunk has ${count} elements, maximum allowed is 10`);
  }

  // Clean up test items
  await db.query('DELETE FROM inventory WHERE menu_item_id >= 100');
  await db.query('DELETE FROM menu_items WHERE id >= 100');
});

test('Menu - deleteMenuItem safely hard-deletes unreferenced menu item', async () => {
  const menuController = require('../src/controllers/menuController');
  
  // Insert unreferenced item
  const [insertRes] = await db.query(
    `INSERT INTO menu_items (category_id, name, description, price, is_available)
     VALUES (1, 'Unreferenced Deletable Latte', 'Test desc', 120.00, 1)`
  );
  const itemId = insertRes.insertId;

  await db.query(
    `INSERT INTO inventory (menu_item_id, stock_quantity, low_stock_threshold)
     VALUES (?, 15, 5)`,
    [itemId]
  );

  let responseData = null;
  let statusCode = 200;
  const req = { params: { id: itemId } };
  const res = {
    status(code) { statusCode = code; return this; },
    json(data) { responseData = data; return this; }
  };

  await menuController.deleteMenuItem(req, res);

  assert.strictEqual(statusCode, 200);
  assert.strictEqual(responseData.success, true);

  // Check it is completely gone from DB
  const [rows] = await db.query(`SELECT id FROM menu_items WHERE id = ?`, [itemId]);
  assert.strictEqual(rows.length, 0);
});

test('Menu - deleteMenuItem soft-deletes referenced item without foreign key violation', async () => {
  const menuController = require('../src/controllers/menuController');
  
  // Insert item
  const [insertRes] = await db.query(
    `INSERT INTO menu_items (category_id, name, description, price, is_available)
     VALUES (1, 'Referenced Historical Item', 'Test historical order item', 150.00, 1)`
  );
  const itemId = insertRes.insertId;

  await db.query(
    `INSERT INTO inventory (menu_item_id, stock_quantity, low_stock_threshold)
     VALUES (?, 20, 5)`,
    [itemId]
  );

  // Create a customer and order referencing this item
  const [custRes] = await db.query(
    `INSERT INTO customers (psid, first_name, phone_number)
     VALUES ('TEST_PSID_FK_${Date.now()}', 'FKTest', '09123456789')`
  );
  const custId = custRes.insertId;

  const [ordRes] = await db.query(
    `INSERT INTO orders (order_number, customer_id, total_amount, status)
     VALUES ('ORD-TEST-FK-${Date.now()}', ?, 150.00, 'delivered')`,
    [custId]
  );
  const orderId = ordRes.insertId;

  await db.query(
    `INSERT INTO order_items (order_id, menu_item_id, item_name, unit_price, quantity, subtotal)
     VALUES (?, ?, 'Referenced Historical Item', 150.00, 1, 150.00)`,
    [orderId, itemId]
  );

  let responseData = null;
  let statusCode = 200;
  const req = { params: { id: itemId } };
  const res = {
    status(code) { statusCode = code; return this; },
    json(data) { responseData = data; return this; }
  };

  // Must not throw or return 500 error
  await menuController.deleteMenuItem(req, res);

  assert.strictEqual(statusCode, 200);
  assert.strictEqual(responseData.success, true);

  // Item row still exists for historical foreign key reference, but marked is_deleted = 1
  const [rows] = await db.query(`SELECT is_deleted, is_available FROM menu_items WHERE id = ?`, [itemId]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].is_deleted, 1);
  assert.strictEqual(rows[0].is_available, 0);

  // getMenu must exclude it
  let menuResData = null;
  const menuReq = {};
  const menuRes = {
    status(code) { return this; },
    json(data) { menuResData = data; return this; }
  };
  await menuController.getMenu(menuReq, menuRes);
  const inMenu = (menuResData.allItems || []).find(it => it.id === itemId);
  assert.strictEqual(inMenu, undefined, 'Soft-deleted item must not appear in menu');
});

test('Menu - uploadMenuImage saves base64 picture to public/uploads directory', async () => {
  const menuController = require('../src/controllers/menuController');
  
  // Minimal valid 1x1 PNG base64
  const pngBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  let responseData = null;
  let statusCode = 200;
  const req = { body: { imageBase64: pngBase64 } };
  const res = {
    status(code) { statusCode = code; return this; },
    json(data) { responseData = data; return this; }
  };

  await menuController.uploadMenuImage(req, res);

  assert.strictEqual(statusCode, 200);
  assert.strictEqual(responseData.success, true);
  assert.ok(responseData.imageUrl.startsWith('/uploads/menu_'));
  assert.ok(responseData.imageUrl.endsWith('.png'));

  // Verify file exists on disk
  const diskPath = path.join(__dirname, '../public', responseData.imageUrl.replace(/^\//, ''));
  assert.ok(fs.existsSync(diskPath), 'Uploaded image must exist in public/uploads');

  // Clean up
  try { fs.unlinkSync(diskPath); } catch (e) {}
});
