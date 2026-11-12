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

test('BOM Inventory & Recipe Management Subsystem Suite', async (t) => {
  await db.initDatabase();

  const [macchiatoRows] = await db.query(`SELECT id, name, price FROM menu_items WHERE LOWER(name) = 'caramel macchiato' LIMIT 1`);
  const [milkteaRows] = await db.query(`SELECT id, name, price FROM menu_items WHERE LOWER(name) = 'brown sugar milktea' LIMIT 1`);
  const [meatyDogRows] = await db.query(`SELECT id, name, price FROM menu_items WHERE LOWER(name) = 'meaty dog' LIMIT 1`);

  assert.ok(macchiatoRows.length > 0, 'Caramel Macchiato must exist in seeded menu_items');
  assert.ok(milkteaRows.length > 0, 'Brown Sugar Milktea must exist in seeded menu_items');
  assert.ok(meatyDogRows.length > 0, 'Meaty Dog must exist in seeded menu_items');

  const macchiato = macchiatoRows[0];

  await t.test('1. Sample BOM ingredients and 3 recipes are seeded with distinct units', async () => {
    const ingredients = await inventoryService.listIngredients();
    assert.ok(ingredients.length >= 11, 'At least 11 raw ingredients seeded');
    const beans = ingredients.find(i => i.name === 'Espresso Beans');
    const milk = ingredients.find(i => i.name === 'Full Cream Milk');
    const cup = ingredients.find(i => i.name === '16oz Cup');
    assert.strictEqual(beans.unit, 'g');
    assert.strictEqual(milk.unit, 'ml');
    assert.strictEqual(cup.unit, 'pcs');

    const macRecipe = await inventoryService.getRecipeByMenuId(macchiato.id);
    const mtRecipe = await inventoryService.getRecipeByMenuId(milkteaRows[0].id);
    const dogRecipe = await inventoryService.getRecipeByMenuId(meatyDogRows[0].id);
    assert.strictEqual(macRecipe.recipeItems.length, 4, 'Caramel Macchiato recipe has 4 ingredients');
    assert.strictEqual(mtRecipe.recipeItems.length, 5, 'Brown Sugar Milktea recipe has 5 ingredients');
    assert.strictEqual(dogRecipe.recipeItems.length, 4, 'Meaty Dog recipe has 4 ingredients');
  });

  await t.test('2. deductIngredientsForOrder deducts exact amounts atomically on order preparation and is idempotent', async () => {
    const [beforeBeans] = await db.query(`SELECT ingredient_id, stock_quantity FROM ingredients WHERE name = 'Espresso Beans'`);
    const [beforeMilk] = await db.query(`SELECT ingredient_id, stock_quantity FROM ingredients WHERE name = 'Full Cream Milk'`);
    const [beforeSyrup] = await db.query(`SELECT ingredient_id, stock_quantity FROM ingredients WHERE name = 'Caramel Syrup'`);
    const [beforeCup] = await db.query(`SELECT ingredient_id, stock_quantity FROM ingredients WHERE name = '16oz Cup'`);

    const order = await orderService.createOrder(`PSID_BOM_DEDUCT_${Date.now()}`, {
      customerName: 'BOM Tester',
      customerPhone: '09171110001',
      deliveryAddress: 'Store Pickup',
      orderType: 'pickup',
      paymentMethod: 'cash',
      items: [{ menuItemId: macchiato.id, quantity: 2 }], // 2x Caramel Macchiato -> 36g beans, 400ml milk, 60ml syrup, 2 cups
      deliveryFee: 0,
      totalAmount: Number(macchiato.price) * 2
    });

    // Transition to preparing triggers deductIngredientsForOrder(order.orderId)
    await orderService.updateOrderStatus(order.orderId, 'preparing');

    const [afterBeans] = await db.query(`SELECT stock_quantity FROM ingredients WHERE name = 'Espresso Beans'`);
    const [afterMilk] = await db.query(`SELECT stock_quantity FROM ingredients WHERE name = 'Full Cream Milk'`);
    const [afterSyrup] = await db.query(`SELECT stock_quantity FROM ingredients WHERE name = 'Caramel Syrup'`);
    const [afterCup] = await db.query(`SELECT stock_quantity FROM ingredients WHERE name = '16oz Cup'`);

    assert.strictEqual(Number(afterBeans[0].stock_quantity), Number(beforeBeans[0].stock_quantity) - 36);
    assert.strictEqual(Number(afterMilk[0].stock_quantity), Number(beforeMilk[0].stock_quantity) - 400);
    assert.strictEqual(Number(afterSyrup[0].stock_quantity), Number(beforeSyrup[0].stock_quantity) - 60);
    assert.strictEqual(Number(afterCup[0].stock_quantity), Number(beforeCup[0].stock_quantity) - 2);

    const [logs] = await db.query(
      `SELECT ingredient_id, change_amount, change_type FROM ingredient_logs WHERE reference_order_id = ? AND change_type = 'order_deduction'`,
      [order.orderId]
    );
    assert.strictEqual(logs.length, 4, 'Must record 4 audit logs in ingredient_logs');
    assert.ok(logs.every(l => Number(l.change_amount) < 0), 'Deduction log amounts must be negative');

    // Idempotency guard: calling again must NOT double-deduct
    const secondRun = await inventoryService.deductIngredientsForOrder(order.orderId);
    assert.strictEqual(secondRun.alreadyDeducted, true);
    const [beansAfterRepeat] = await db.query(`SELECT stock_quantity FROM ingredients WHERE name = 'Espresso Beans'`);
    assert.strictEqual(Number(beansAfterRepeat[0].stock_quantity), Number(afterBeans[0].stock_quantity));
  });

  await t.test('3. Atomic rollback prevents partial deductions when an ingredient is short; checkMenuAvailability and Messenger cart reject shortage', async () => {
    const [syrupRows] = await db.query(`SELECT ingredient_id, stock_quantity FROM ingredients WHERE name = 'Caramel Syrup'`);
    const [beansBefore] = await db.query(`SELECT stock_quantity FROM ingredients WHERE name = 'Espresso Beans'`);
    const origSyrupStock = Number(syrupRows[0].stock_quantity);

    // Temporarily deplete Caramel Syrup below 30ml needed for 1 macchiato
    await db.query(`UPDATE ingredients SET stock_quantity = 10.00 WHERE ingredient_id = ?`, [syrupRows[0].ingredient_id]);

    const avail = await inventoryService.checkMenuAvailability(macchiato.id, 1);
    assert.strictEqual(avail.available, false);
    assert.strictEqual(avail.missingIngredients[0].name, 'Caramel Syrup');

    // Cart re-pricing flags missing ingredient item as unavailable
    const cartCheck = await cartService.priceCart([{ menuItemId: macchiato.id, name: macchiato.name, price: Number(macchiato.price), quantity: 1 }]);
    assert.strictEqual(cartCheck.unavailable.length, 1);

    // Messenger cart addition rejects item lacking raw ingredients
    const psid = `PSID_BOM_OOS_${Date.now()}`;
    const session = await nlpEngine.getSession(psid);
    session.state = 'ADDING_ITEM';
    session.pendingItem = { id: macchiato.id, name: macchiato.name, price: Number(macchiato.price) };
    await nlpEngine.handleMessageEvent(psid, '1');
    const lastBotMsg = sentMessages.filter(m => m.psid === psid).pop()?.messagePayload?.text || '';
    assert.ok(lastBotMsg.includes('Caramel Syrup'), 'Messenger must warn customer about missing raw ingredient');

    // Direct deductIngredientsForOrder fails atomically and leaves Espresso Beans untouched
    const fakeOrderId = 999991;
    await db.query(
      `INSERT INTO orders (id, order_number, customer_id, order_type, status, total_amount)
       SELECT ?, ?, id, 'pickup', 'pending', 100 FROM customers LIMIT 1`,
      [fakeOrderId, `DNR-BOM-ROLLBACK-${Date.now()}`]
    );
    await db.query(
      `INSERT INTO order_items (order_id, menu_item_id, item_name, unit_price, quantity, subtotal)
       VALUES (?, ?, ?, ?, 1, ?)`,
      [fakeOrderId, macchiato.id, macchiato.name, Number(macchiato.price), Number(macchiato.price)]
    );

    await assert.rejects(
      () => inventoryService.deductIngredientsForOrder(fakeOrderId),
      /Insufficient raw ingredients/
    );

    const [beansAfterRollback] = await db.query(`SELECT stock_quantity FROM ingredients WHERE name = 'Espresso Beans'`);
    assert.strictEqual(Number(beansAfterRollback[0].stock_quantity), Number(beansBefore[0].stock_quantity), 'Atomic rollback must prevent Espresso Beans deduction');

    // Restore syrup via restockIngredient
    await db.query(`UPDATE ingredients SET stock_quantity = 0 WHERE ingredient_id = ?`, [syrupRows[0].ingredient_id]);
    const restocked = await inventoryService.restockIngredient(syrupRows[0].ingredient_id, origSyrupStock, 0.50);
    assert.strictEqual(restocked.newStock, origSyrupStock);
    assert.strictEqual(restocked.cost_per_unit, 0.50);
  });

  await t.test('4. Admin API routes and controller handle ingredients CRUD, restock, low-stock flags, and recipe mapping', async () => {
    assert.ok(inventoryRoutes && Array.isArray(inventoryRoutes.stack), 'inventoryRoutes Express router must be exported');
    const routePaths = inventoryRoutes.stack.filter(l => l.route).map(l => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
    assert.ok(routePaths.includes('GET /ingredients'));
    assert.ok(routePaths.includes('POST /ingredients'));
    assert.ok(routePaths.includes('PATCH /ingredients/:id/restock'));
    assert.ok(routePaths.includes('GET /recipes/:menuId'));
    assert.ok(routePaths.includes('POST /recipes'));

    // POST /api/inventory/ingredients (create a low-stock ingredient)
    const addRes = createMockRes();
    await inventoryController.addIngredient({
      body: { name: 'Matcha Ceremonial Powder', unit: 'g', stock_quantity: 40, reorder_level: 100, cost_per_unit: 3.25 }
    }, addRes);
    assert.strictEqual(addRes.statusCode, 201);
    assert.strictEqual(addRes.body.ingredient.is_low_stock, true);
    const matchaId = addRes.body.ingredient.ingredient_id;

    // PATCH /api/inventory/ingredients/:id/restock
    const restockRes = createMockRes();
    await inventoryController.restockRawIngredient({
      params: { id: String(matchaId) },
      body: { amount: 200, cost_per_unit: 3.10 }
    }, restockRes);
    assert.strictEqual(restockRes.statusCode, 200);
    assert.strictEqual(restockRes.body.newStock, 240);

    // GET /api/inventory/ingredients
    const listRes = createMockRes();
    await inventoryController.getIngredients({}, listRes);
    assert.strictEqual(listRes.statusCode, 200);
    const foundMatcha = listRes.body.ingredients.find(i => i.ingredient_id === matchaId);
    assert.strictEqual(foundMatcha.is_low_stock, false);

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
