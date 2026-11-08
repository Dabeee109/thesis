const assert = require('assert');
const { getActiveMenu, checkItemStock } = require('../src/services/menuService');
const menuController = require('../src/controllers/menuController');

function mockRes() {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.data = payload; return this; }
  };
  return res;
}

async function testMenuRefresh() {
  console.log('--- RUNNING MENU REFRESH VERIFICATION TESTS ---');

  // 1. Test getActiveMenu()
  const activeMenu = await getActiveMenu();
  console.log(`[PASS] getActiveMenu returned ${activeMenu.length} active items.`);
  assert(activeMenu.length >= 80, `Expected at least 80 items, got ${activeMenu.length}`);

  // Verify key items exist
  const biscoff = activeMenu.find(i => i.name === 'Biscoff Cheesecake');
  assert(biscoff, 'Biscoff Cheesecake must exist in active menu');
  assert.strictEqual(biscoff.price, 169);
  console.log(`[PASS] Found Biscoff Cheesecake (₱${biscoff.price}, stock: ${biscoff.stock_quantity})`);

  const bbqRibs = activeMenu.find(i => i.name === 'BBQ Ribs');
  assert(bbqRibs, 'BBQ Ribs must exist in active menu');
  assert.strictEqual(bbqRibs.price, 269);
  console.log(`[PASS] Found BBQ Ribs (₱${bbqRibs.price}, stock: ${bbqRibs.stock_quantity})`);

  const tripleCheese = activeMenu.find(i => i.name === 'Triple Cheese Pizza');
  assert(tripleCheese, 'Triple Cheese Pizza must exist in active menu');
  assert.strictEqual(tripleCheese.price, 270);
  console.log(`[PASS] Found Triple Cheese Pizza (₱${tripleCheese.price}, stock: ${tripleCheese.stock_quantity})`);

  // 2. Test checkItemStock()
  const stockCheck = await checkItemStock(biscoff.id, 2);
  assert(stockCheck.available, 'Item should be available');
  console.log('[PASS] checkItemStock for Biscoff Cheesecake succeeded.');

  // 3. Test Controller getMenu()
  const resAll = mockRes();
  await menuController.getMenu({ query: {} }, resAll);
  assert(resAll.data.success, 'getMenu should return success: true');
  assert.strictEqual(resAll.data.categories.length, 8, `Expected 8 categories, got ${resAll.data.categories.length}`);
  console.log(`[PASS] menuController.getMenu returned ${resAll.data.categories.length} categories with ${resAll.data.allItems.length} total items.`);

  // 4. Test Controller with category filter
  const resFiltered = mockRes();
  await menuController.getMenu({ query: { category: 'drinks-milktea' } }, resFiltered);
  assert(resFiltered.data.success, 'Filtered getMenu should succeed');
  assert.strictEqual(resFiltered.data.categories.length, 1, 'Expected 1 filtered category');
  assert.strictEqual(resFiltered.data.categories[0].name, 'Drinks & Milktea');
  console.log(`[PASS] Filtered getMenu(?category=drinks-milktea) returned 1 category: ${resFiltered.data.categories[0].name}`);

  // 5. Test Stock Update
  const resStock = mockRes();
  await menuController.updateMenuItemStock({ params: { id: biscoff.id }, body: { delta: -5 } }, resStock);
  assert(resStock.data.success, 'updateMenuItemStock should succeed');
  assert.strictEqual(resStock.data.stock_quantity, 25);
  console.log(`[PASS] updateMenuItemStock decreased stock to ${resStock.data.stock_quantity} (status: ${resStock.data.status})`);

  // Restore stock back to 30
  await menuController.updateMenuItemStock({ params: { id: biscoff.id }, body: { delta: 5 } }, mockRes());

  console.log('\n>>> ALL MENU REFRESH VERIFICATION TESTS PASSED SUCCESSFULLY! <<<');
}

testMenuRefresh().then(() => process.exit(0)).catch(err => {
  console.error('[TEST FAILURE]', err);
  process.exit(1);
});
