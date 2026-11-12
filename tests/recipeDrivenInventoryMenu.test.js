const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, 'test_recipe_inventory.sqlite');
if (fs.existsSync(testDbPath)) {
  try { fs.unlinkSync(testDbPath); } catch (e) {}
}

process.env.DB_FORCE_SQLITE = '1';
process.env.SQLITE_PATH = testDbPath;
process.env.NODE_ENV = 'test';

const db = require('../database/db');
const inventoryService = require('../src/services/inventoryService');
const orderService = require('../src/services/orderService');
const menuController = require('../src/controllers/menuController');
const aiService = require('../src/services/aiService');

test('Recipe-Driven 3-Tier Inventory & Menu Availability Suite', async (t) => {
  await db.initDatabase();

  let caramelSyrupId = null;
  let espressoBeansId = null;
  let macchiatoItem = null;

  await t.test('1. Setup BOM ingredients, recipes, and test menu items', async () => {
    const [ingRows] = await db.query(
      `SELECT ingredient_id, name, stock_quantity FROM ingredients WHERE name IN ('Caramel Syrup', 'Espresso Beans')`
    );
    for (const ing of ingRows) {
      if (ing.name === 'Caramel Syrup') caramelSyrupId = ing.ingredient_id;
      if (ing.name === 'Espresso Beans') espressoBeansId = ing.ingredient_id;
    }

    const [menuRows] = await db.query(`SELECT id, name, is_available FROM menu_items WHERE name = 'Caramel Macchiato' LIMIT 1`);
    assert.ok(menuRows.length > 0, 'Caramel Macchiato should exist');
    macchiatoItem = menuRows[0];

    // Ensure Caramel Macchiato has recipe: 18g espresso beans, 25ml caramel syrup
    await db.query(
      `INSERT OR REPLACE INTO recipe_items (menu_id, ingredient_id, quantity_required) VALUES (?, ?, 25.00)`,
      [macchiatoItem.id, caramelSyrupId]
    );
    await db.query(
      `INSERT OR REPLACE INTO recipe_items (menu_id, ingredient_id, quantity_required) VALUES (?, ?, 18.00)`,
      [macchiatoItem.id, espressoBeansId]
    );
  });

  await t.test('2. 3-Tier Status Thresholds: AVAILABLE (>=15), LOW ON STOCK (1-14), OUT OF STOCK (<=0)', async () => {
    // A. Set stock for >= 15 servings: 20 servings = 500ml syrup (25ml each), 360g espresso (18g each)
    await db.query(`UPDATE ingredients SET stock_quantity = 500.00 WHERE ingredient_id = ?`, [caramelSyrupId]);
    await db.query(`UPDATE ingredients SET stock_quantity = 360.00 WHERE ingredient_id = ?`, [espressoBeansId]);
    await db.query(`UPDATE menu_items SET is_available = 1 WHERE id = ?`, [macchiatoItem.id]);

    let req = { query: {} };
    let resData = null;
    let res = { json: (d) => { resData = d; return d; }, status: () => res };
    await menuController.getMenu(req, res);

    let found = resData.allItems.find(i => i.id === macchiatoItem.id);
    assert.ok(found);
    assert.strictEqual(found.max_servings, 20);
    assert.strictEqual(found.status, 'AVAILABLE', '>= 15 servings must be AVAILABLE');

    // B. Set stock for 1 <= max_servings < 15: 5 servings = 125ml syrup
    await db.query(`UPDATE ingredients SET stock_quantity = 125.00 WHERE ingredient_id = ?`, [caramelSyrupId]);
    await menuController.getMenu(req, res);
    found = resData.allItems.find(i => i.id === macchiatoItem.id);
    assert.strictEqual(found.max_servings, 5);
    assert.strictEqual(found.status, 'LOW_STOCK', '1-14 servings must be LOW_STOCK');

    // C. Set stock to 0: 0 servings = 0ml syrup
    await db.query(`UPDATE ingredients SET stock_quantity = 0.00 WHERE ingredient_id = ?`, [caramelSyrupId]);
    await menuController.getMenu(req, res);
    found = resData.allItems.find(i => i.id === macchiatoItem.id);
    assert.strictEqual(found.max_servings, 0);
    assert.strictEqual(found.status, 'OUT_OF_STOCK', '<= 0 servings must be OUT_OF_STOCK');

    // D. Hidden toggle: When is_available = 0, status is HIDDEN regardless of ingredient stock
    await db.query(`UPDATE ingredients SET stock_quantity = 500.00 WHERE ingredient_id = ?`, [caramelSyrupId]);
    await db.query(`UPDATE menu_items SET is_available = 0 WHERE id = ?`, [macchiatoItem.id]);
    await menuController.getMenu(req, res);
    found = resData.allItems.find(i => i.id === macchiatoItem.id);
    assert.strictEqual(found.status, 'HIDDEN', 'When is_available = 0, status must be HIDDEN');
  });

  await t.test('3. Fallback rule: Menu items without recipe linked default to AVAILABLE when visible', async () => {
    // Create test item without recipe
    const [ins] = await db.query(
      `INSERT INTO menu_items (category_id, name, price, is_available) VALUES (1, 'Unlinked Mystery Drink', 99.00, 1)`
    );
    const unlinkedId = ins.insertId;

    let resData = null;
    let res = { json: (d) => { resData = d; return d; }, status: () => res };
    await menuController.getMenu({ query: {} }, res);

    const found = resData.allItems.find(i => i.id === unlinkedId);
    assert.ok(found);
    assert.strictEqual(found.has_recipe, false);
    assert.strictEqual(found.status, 'AVAILABLE', 'Unlinked item with is_available=1 should default to AVAILABLE');
  });

  await t.test('4. Automated Stock Deduction & Restoration on Orders', async () => {
    // Set 20 servings: 500ml syrup, 360g espresso
    await db.query(`UPDATE ingredients SET stock_quantity = 500.00 WHERE ingredient_id = ?`, [caramelSyrupId]);
    await db.query(`UPDATE ingredients SET stock_quantity = 360.00 WHERE ingredient_id = ?`, [espressoBeansId]);
    await db.query(`UPDATE menu_items SET is_available = 1 WHERE id = ?`, [macchiatoItem.id]);

    // Create Customer
    const [custRes] = await db.query(
      `INSERT INTO customers (psid, first_name, last_name, phone_number) VALUES ('TEST_DEDUCT_PSID', 'Test', 'Customer', '09123456789')`
    );
    const custId = custRes.insertId;

    // Create Order: 2x Caramel Macchiato
    const orderData = {
      customerId: custId,
      orderType: 'pickup',
      diningMode: 'Pick-up',
      paymentMethod: 'cash',
      items: [
        {
          menuItemId: macchiatoItem.id,
          name: macchiatoItem.name,
          unitPrice: 149.00,
          quantity: 2,
          subtotal: 298.00
        }
      ]
    };

    const createdOrder = await orderService.createOrder(orderData);
    assert.ok(createdOrder.orderId);

    // 1. Advance to preparing: Deducts 2 servings = 50ml syrup (2x25ml) & 36g espresso (2x18g)
    await orderService.updateOrderStatus(createdOrder.orderId, 'preparing');

    const [syrupAfterDeduct] = await db.query(`SELECT stock_quantity FROM ingredients WHERE ingredient_id = ?`, [caramelSyrupId]);
    const [beansAfterDeduct] = await db.query(`SELECT stock_quantity FROM ingredients WHERE ingredient_id = ?`, [espressoBeansId]);

    assert.strictEqual(Number(syrupAfterDeduct[0].stock_quantity), 450.00, '500ml - 50ml = 450ml');
    assert.strictEqual(Number(beansAfterDeduct[0].stock_quantity), 324.00, '360g - 36g = 324g');

    // 2. Cancel order: Restores 50ml syrup and 36g espresso back to ingredients
    await orderService.updateOrderStatus(createdOrder.orderId, 'cancelled', {
      cancellationReason: 'Customer changed mind'
    });

    const [syrupAfterCancel] = await db.query(`SELECT stock_quantity FROM ingredients WHERE ingredient_id = ?`, [caramelSyrupId]);
    const [beansAfterCancel] = await db.query(`SELECT stock_quantity FROM ingredients WHERE ingredient_id = ?`, [espressoBeansId]);

    assert.strictEqual(Number(syrupAfterCancel[0].stock_quantity), 500.00, 'Restored to 500ml');
    assert.strictEqual(Number(beansAfterCancel[0].stock_quantity), 360.00, 'Restored to 360g');

    // Verify idempotency: Repeating cancel does not double-restore
    await inventoryService.restoreIngredientsForOrder(createdOrder.orderId);
    const [syrupRepeat] = await db.query(`SELECT stock_quantity FROM ingredients WHERE ingredient_id = ?`, [caramelSyrupId]);
    assert.strictEqual(Number(syrupRepeat[0].stock_quantity), 500.00, 'Repeat restore must be idempotent');
  });

  await t.test('5. Sync with Messenger AI Bot (loadOperationalContext & catalog block)', async () => {
    // Deplete Caramel Syrup to 0 -> Caramel Macchiato is 0 servings
    await db.query(`UPDATE ingredients SET stock_quantity = 0.00 WHERE ingredient_id = ?`, [caramelSyrupId]);

    const context = await aiService.loadOperationalContext('TEST_AI_PSID');
    const macAiItem = context.menuItems.find(i => i.id === macchiatoItem.id);
    assert.ok(macAiItem);
    assert.strictEqual(macAiItem.max_servings, 0);

    const systemInstruction = aiService.buildAssistantSystemInstruction(context);
    assert.ok(
      systemInstruction.includes('Caramel Macchiato') && systemInstruction.includes('[OUT OF STOCK - DO NOT SELL]'),
      'AI instruction must flag 0-serving item as OUT OF STOCK - DO NOT SELL'
    );

    // Restock to 20 servings -> Caramel Macchiato is AVAILABLE
    await db.query(`UPDATE ingredients SET stock_quantity = 500.00 WHERE ingredient_id = ?`, [caramelSyrupId]);
    const context2 = await aiService.loadOperationalContext('TEST_AI_PSID');
    const macAiItem2 = context2.menuItems.find(i => i.id === macchiatoItem.id);
    assert.strictEqual(macAiItem2.max_servings, 20);

    const systemInstruction2 = aiService.buildAssistantSystemInstruction(context2);
    assert.ok(
      systemInstruction2.includes('Caramel Macchiato') && systemInstruction2.includes('[AVAILABLE | Servings: 20]'),
      'AI instruction must show [AVAILABLE | Servings: 20]'
    );
  });

  await t.test('6. Edit Raw Ingredient & Stock Correction (Mistaken Restock Undo/Edit)', async () => {
    const inventoryController = require('../src/controllers/inventoryController');

    // Simulate accidental restock error: Staff entered 99999 instead of 500
    await db.query(`UPDATE ingredients SET stock_quantity = 99999.00 WHERE ingredient_id = ?`, [caramelSyrupId]);

    // Use edit endpoint / service to correct back to 350.00
    let resJson = null;
    const req = {
      params: { id: caramelSyrupId },
      body: {
        stock_quantity: 350.00,
        reorder_level: 150.00,
        cost_per_unit: 0.85,
        notes: 'Mistaken restock corrected via Dashboard'
      }
    };
    const res = {
      json: (d) => { resJson = d; return d; },
      status: () => res
    };

    await inventoryController.updateIngredient(req, res);
    assert.ok(resJson.success, 'updateIngredient must succeed');
    assert.strictEqual(Number(resJson.ingredient.stock_quantity), 350.00);

    // Verify audit log recorded adjustment
    const [logRows] = await db.query(
      `SELECT * FROM ingredient_logs WHERE ingredient_id = ? AND change_type = 'adjustment' ORDER BY log_id DESC LIMIT 1`,
      [caramelSyrupId]
    );
    assert.ok(logRows.length > 0, 'Audit log must record adjustment');
    assert.strictEqual(logRows[0].notes, 'Mistaken restock corrected via Dashboard');

    // Verify database reflects corrected stock
    const [dbRows] = await db.query(`SELECT stock_quantity, reorder_level FROM ingredients WHERE ingredient_id = ?`, [caramelSyrupId]);
    assert.strictEqual(Number(dbRows[0].stock_quantity), 350.00);
    assert.strictEqual(Number(dbRows[0].reorder_level), 150.00);
  });
});
