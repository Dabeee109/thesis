const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, 'test_bom_inventory.sqlite');
if (fs.existsSync(testDbPath)) {
  try { fs.unlinkSync(testDbPath); } catch (e) {}
}

process.env.DB_FORCE_SQLITE = '1';
process.env.SQLITE_PATH = testDbPath;
process.env.NODE_ENV = 'test';

const db = require('../database/db');
const inventoryService = require('../src/services/inventoryService');
const orderService = require('../src/services/orderService');
const cartService = require('../src/services/cartService');
const nlpEngine = require('../src/services/nlpEngine');
const messengerService = require('../src/services/messengerService');
const inventoryController = require('../src/controllers/inventoryController');
const inventoryRoutes = require('../src/routes/inventoryRoutes');
const { INGREDIENT_CATEGORIES } = require('../database/bomRecipesSeedData');

const sentMessages = [];
messengerService.callSendAPI = async (psid, messagePayload, options) => {
  sentMessages.push({ psid: String(psid), messagePayload, options });
  return { recipient_id: String(psid), message_id: `mid.bom.${Date.now()}` };
};

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

test('BOM Inventory & 91-Recipe Management Subsystem Suite', async (t) => {
  await db.initDatabase();

  const [macchiatoRows] = await db.query(`SELECT id, name, price FROM menu_items WHERE LOWER(name) = 'caramel macchiato' LIMIT 1`);
  const [milkteaRows] = await db.query(`SELECT id, name, price FROM menu_items WHERE LOWER(name) = 'brown sugar milktea' LIMIT 1`);
  const [meatyDogRows] = await db.query(`SELECT id, name, price FROM menu_items WHERE LOWER(name) = 'meaty dog' LIMIT 1`);
  const [addonRows] = await db.query(`SELECT id, name, price FROM menu_items WHERE LOWER(name) = 'tapioca pearls' LIMIT 1`);

  assert.ok(macchiatoRows.length > 0, 'Caramel Macchiato must exist in seeded menu_items');
  assert.ok(milkteaRows.length > 0, 'Brown Sugar Milktea must exist in seeded menu_items');
  assert.ok(meatyDogRows.length > 0, 'Meaty Dog must exist in seeded menu_items');
  assert.ok(addonRows.length > 0, 'Tapioca Pearls add-on must exist in seeded menu_items');

  const macchiato = macchiatoRows[0];

  await t.test('1. Full 114 raw ingredients and 91 menu recipes are seeded with categories and units (g, ml, pcs)', async () => {
    const ingredients = await inventoryService.listIngredients();
    assert.strictEqual(ingredients.length, 114, 'All 114 unique raw ingredients must be seeded');

    const [mappedMenuRows] = await db.query(`SELECT COUNT(DISTINCT menu_id) AS cnt FROM recipe_items`);
    const mappedCount = Number(mappedMenuRows[0].cnt || mappedMenuRows[0]['COUNT(DISTINCT menu_id)']);
    assert.strictEqual(mappedCount, 91, 'All 91 menu items must have BOM recipes mapped');

    const beans = ingredients.find(i => i.name === 'Espresso Beans');
    const milk = ingredients.find(i => i.name === 'Fresh Milk');
    const cup = ingredients.find(i => i.name === 'Cup/Lid/Straw Set');
    assert.strictEqual(beans.unit, 'g');
    assert.strictEqual(beans.category, 'Beverage Base & Syrups');
    assert.strictEqual(milk.unit, 'ml');
    assert.strictEqual(milk.category, 'Dairy & Toppings');
    assert.strictEqual(cup.unit, 'pcs');
    assert.strictEqual(cup.category, 'Packaging');

    const macRecipe = await inventoryService.getRecipeByMenuId(macchiato.id);
    const mtRecipe = await inventoryService.getRecipeByMenuId(milkteaRows[0].id);
    const dogRecipe = await inventoryService.getRecipeByMenuId(meatyDogRows[0].id);
    const addonRecipe = await inventoryService.getRecipeByMenuId(addonRows[0].id);

    assert.strictEqual(macRecipe.recipeItems.length, 5, 'Caramel Macchiato recipe has 5 ingredients');
    assert.strictEqual(mtRecipe.recipeItems.length, 5, 'Brown Sugar Milktea recipe has 5 ingredients');
    assert.strictEqual(dogRecipe.recipeItems.length, 5, 'Meaty Dog recipe has 5 ingredients');
    assert.strictEqual(addonRecipe.recipeItems.length, 1, 'Tapioca Pearls add-on has 1 ingredient');
  });

  await t.test('2. deductIngredientsForOrder deducts exact amounts atomically on order preparation and is idempotent', async () => {
    const [beforeBeans] = await db.query(`SELECT ingredient_id, stock_quantity FROM ingredients WHERE name = 'Espresso Beans'`);
    const [beforeMilk] = await db.query(`SELECT ingredient_id, stock_quantity FROM ingredients WHERE name = 'Fresh Milk'`);
    const [beforeCaramel] = await db.query(`SELECT ingredient_id, stock_quantity FROM ingredients WHERE name = 'Caramel Syrup'`);
    const [beforeVanilla] = await db.query(`SELECT ingredient_id, stock_quantity FROM ingredients WHERE name = 'Vanilla Syrup'`);
    const [beforeCup] = await db.query(`SELECT ingredient_id, stock_quantity FROM ingredients WHERE name = 'Cup/Lid/Straw Set'`);

    const order = await orderService.createOrder(`PSID_BOM_DEDUCT_${Date.now()}`, {
      customerName: 'BOM Tester',
      customerPhone: '09171110001',
      deliveryAddress: 'Store Pickup',
      orderType: 'pickup',
      paymentMethod: 'cash',
      items: [{ menuItemId: macchiato.id, quantity: 2 }], // 2x -> 36g beans, 400ml milk, 50ml caramel, 20ml vanilla, 2 cup sets
      deliveryFee: 0,
      totalAmount: Number(macchiato.price) * 2
    });

    await orderService.updateOrderStatus(order.orderId, 'preparing');

    const [afterBeans] = await db.query(`SELECT stock_quantity FROM ingredients WHERE name = 'Espresso Beans'`);
    const [afterMilk] = await db.query(`SELECT stock_quantity FROM ingredients WHERE name = 'Fresh Milk'`);
    const [afterCaramel] = await db.query(`SELECT stock_quantity FROM ingredients WHERE name = 'Caramel Syrup'`);
    const [afterVanilla] = await db.query(`SELECT stock_quantity FROM ingredients WHERE name = 'Vanilla Syrup'`);
    const [afterCup] = await db.query(`SELECT stock_quantity FROM ingredients WHERE name = 'Cup/Lid/Straw Set'`);

    assert.strictEqual(Number(afterBeans[0].stock_quantity), Number(beforeBeans[0].stock_quantity) - 36);
    assert.strictEqual(Number(afterMilk[0].stock_quantity), Number(beforeMilk[0].stock_quantity) - 400);
    assert.strictEqual(Number(afterCaramel[0].stock_quantity), Number(beforeCaramel[0].stock_quantity) - 50);
    assert.strictEqual(Number(afterVanilla[0].stock_quantity), Number(beforeVanilla[0].stock_quantity) - 20);
    assert.strictEqual(Number(afterCup[0].stock_quantity), Number(beforeCup[0].stock_quantity) - 2);

    const [logs] = await db.query(
      `SELECT ingredient_id, change_amount, change_type, notes FROM ingredient_logs WHERE reference_order_id = ? AND change_type = 'order_deduction'`,
      [order.orderId]
    );
    assert.strictEqual(logs.length, 5, 'Must record 5 audit logs in ingredient_logs');
    assert.ok(logs.every(l => Number(l.change_amount) < 0 && l.notes && l.notes.includes(String(order.orderId))));

    // Idempotency guard: calling again must NOT double-deduct
    const secondRun = await inventoryService.deductIngredientsForOrder(order.orderId);
    assert.strictEqual(secondRun.alreadyDeducted, true);
    const [beansAfterRepeat] = await db.query(`SELECT stock_quantity FROM ingredients WHERE name = 'Espresso Beans'`);
    assert.strictEqual(Number(beansAfterRepeat[0].stock_quantity), Number(afterBeans[0].stock_quantity));
  });

  await t.test('3. syncMenuAvailability auto-disables OOS menu items, Messenger rejects shortages, and restock re-enables them', async () => {
    const [syrupRows] = await db.query(`SELECT ingredient_id, stock_quantity FROM ingredients WHERE name = 'Caramel Syrup'`);
    const syrupId = syrupRows[0].ingredient_id;
    const origSyrupStock = Number(syrupRows[0].stock_quantity);

    // Simulate depletion of Caramel Syrup below 25ml needed for Caramel Macchiato -> trigger syncMenuAvailability
    await db.query(`UPDATE ingredients SET stock_quantity = 10.00 WHERE ingredient_id = ?`, [syrupId]);
    const syncOut = await inventoryService.syncMenuAvailability();
    assert.ok(syncOut.disabledMenus.some(m => m.menuId === macchiato.id), 'Caramel Macchiato must be marked unavailable');

    const [macDbOut] = await db.query(`SELECT is_available, stock_quantity FROM menu_items WHERE id = ?`, [macchiato.id]);
    assert.strictEqual(macDbOut[0].is_available, 0);
    assert.strictEqual(Number(macDbOut[0].stock_quantity), 0);

    // checkMenuAvailability & cartService reject depleted item
    const avail = await inventoryService.checkMenuAvailability(macchiato.id, 1);
    assert.strictEqual(avail.available, false);
    assert.strictEqual(avail.missingIngredients[0].name, 'Caramel Syrup');

    const cartCheck = await cartService.priceCart([{ menuItemId: macchiato.id, name: macchiato.name, price: Number(macchiato.price), quantity: 1 }]);
    assert.strictEqual(cartCheck.unavailable.length, 1);

    // Messenger bot rejects adding unavailable item
    const psid = `PSID_BOM_OOS_${Date.now()}`;
    const session = await nlpEngine.getSession(psid);
    session.state = 'ADDING_ITEM';
    session.pendingItem = { id: macchiato.id, name: macchiato.name, price: Number(macchiato.price) };
    await nlpEngine.handleMessageEvent(psid, '1');
    const lastBotMsg = sentMessages.filter(m => m.psid === psid).pop()?.messagePayload?.text || '';
    assert.ok(lastBotMsg.includes('Caramel Syrup') || lastBotMsg.toLowerCase().includes('stock') || lastBotMsg.toLowerCase().includes('ubos'), 'Messenger must warn customer when ingredients run out');

    // Clamp deduction on an order exceeding tiny remaining stock clamps to 0.00 cleanly
    const clampOrderId = 999991;
    await db.query(
      `INSERT INTO orders (id, order_number, customer_id, order_type, status, total_amount)
       SELECT ?, ?, id, 'pickup', 'pending', 100 FROM customers LIMIT 1`,
      [clampOrderId, `DNR-BOM-CLAMP-${Date.now()}`]
    );
    await db.query(
      `INSERT INTO order_items (order_id, menu_item_id, item_name, unit_price, quantity, subtotal)
       VALUES (?, ?, ?, ?, 1, ?)`,
      [clampOrderId, macchiato.id, macchiato.name, Number(macchiato.price), Number(macchiato.price)]
    );
    await inventoryService.deductIngredientsForOrder(clampOrderId);
    const [syrupClamped] = await db.query(`SELECT stock_quantity FROM ingredients WHERE ingredient_id = ?`, [syrupId]);
    assert.strictEqual(Number(syrupClamped[0].stock_quantity), 0, 'Deduction beyond current stock must clamp safely to 0.00');

    // Restock Caramel Syrup via POST /api/inventory/restock controller -> auto re-enables Caramel Macchiato!
    const restockRes = createMockRes();
    await inventoryController.restock({
      body: { ingredient_id: syrupId, amount: origSyrupStock, notes: 'Emergency Restock Batch' }
    }, restockRes);
    assert.strictEqual(restockRes.statusCode, 200);
    assert.strictEqual(restockRes.body.newStock, origSyrupStock);

    const [macDbRestored] = await db.query(`SELECT is_available, stock_quantity FROM menu_items WHERE id = ?`, [macchiato.id]);
    assert.strictEqual(macDbRestored[0].is_available, 1, 'Restocking ingredient must automatically re-enable Caramel Macchiato');
    assert.ok(Number(macDbRestored[0].stock_quantity) > 0);
  });

  await t.test('4. REST API endpoints GET /api/inventory (grouped), POST /ingredients, POST /restock, and recipes CRUD work cleanly', async () => {
    assert.ok(inventoryRoutes && Array.isArray(inventoryRoutes.stack));
    const routePaths = inventoryRoutes.stack.filter(l => l.route).map(l => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
    assert.ok(routePaths.includes('GET /ingredients'));
    assert.ok(routePaths.includes('POST /ingredients'));
    assert.ok(routePaths.includes('GET /recipes/:menuId'));
    assert.ok(routePaths.includes('POST /recipes'));

    // GET /api/inventory returns grouped categories & unit badges
    const invRes = createMockRes();
    await inventoryController.getInventory({}, invRes);
    assert.strictEqual(invRes.statusCode, 200);
    assert.strictEqual(invRes.body.count, 114);
    for (const cat of INGREDIENT_CATEGORIES) {
      assert.ok(Array.isArray(invRes.body.groupedByCategory[cat]), `Category group "${cat}" must exist`);
    }

    // POST /api/inventory/ingredients
    const addRes = createMockRes();
    await inventoryController.addIngredient({
      body: {
        name: 'Matcha Ceremonial Powder',
        category: 'Beverage Base & Syrups',
        unit: 'g',
        stock_quantity: 40,
        reorder_level: 100,
        cost_per_unit: 3.25
      }
    }, addRes);
    assert.strictEqual(addRes.statusCode, 201);
    assert.strictEqual(addRes.body.ingredient.is_low_stock, true);
    assert.strictEqual(addRes.body.ingredient.category, 'Beverage Base & Syrups');
    const matchaId = addRes.body.ingredient.ingredient_id;

    // POST /api/inventory/restock with notes
    const postRestockRes = createMockRes();
    await inventoryController.restock({
      body: { ingredient_id: matchaId, amount: 200, cost_per_unit: 3.10, notes: 'Supplier PO-402' }
    }, postRestockRes);
    assert.strictEqual(postRestockRes.statusCode, 200);
    assert.strictEqual(postRestockRes.body.newStock, 240);

    // GET /api/inventory/logs records restock note
    const logsRes = createMockRes();
    await inventoryController.getInventoryLogs({}, logsRes);
    assert.strictEqual(logsRes.statusCode, 200);
    const matchingLog = logsRes.body.logs.find(l => l.ingredient_id === matchaId && l.notes === 'Supplier PO-402');
    assert.ok(matchingLog, 'Restock audit log with notes must exist in ingredient_logs');

    // POST /api/inventory/recipes & GET /api/inventory/recipes/:menuId
    const [otherMenu] = await db.query(`SELECT id FROM menu_items WHERE id NOT IN (?, ?, ?) LIMIT 1`, [
      macchiato.id, milkteaRows[0].id, meatyDogRows[0].id
    ]);
    const targetMenuId = otherMenu[0].id;

    const saveRecRes = createMockRes();
    await inventoryController.saveRecipe({
      body: {
        menu_id: targetMenuId,
        items: [{ ingredient_id: matchaId, quantity_required: 15 }]
      }
    }, saveRecRes);
    assert.strictEqual(saveRecRes.statusCode, 200);
    assert.strictEqual(saveRecRes.body.recipeItems.length, 1);

    const getRecRes = createMockRes();
    await inventoryController.getRecipe({ params: { menuId: String(targetMenuId) } }, getRecRes);
    assert.strictEqual(getRecRes.statusCode, 200);
    assert.strictEqual(getRecRes.body.recipeItems[0].ingredient_name, 'Matcha Ceremonial Powder');
    assert.strictEqual(getRecRes.body.recipeItems[0].quantity_required, 15);
  });
});
