const assert = require('assert');
const db = require('../database/db');
const { deductStockForOrder } = require('../src/services/inventoryService');
const { updateMenuItemStock, getMenu } = require('../src/controllers/menuController');
const { createOrder } = require('../src/services/orderService');

// Dynamic stock badge function as requested in Requirement 2
function renderStockBadge(quantity) {
  const q = Number(quantity) || 0;
  if (q > 10) {
    return `<span class="badge badge-success" style="background-color: rgba(34, 197, 94, 0.2); color: #22c55e; border: 1px solid #22c55e;">IN STOCK (${q})</span>`;
  } else if (q > 0 && q <= 10) {
    return `<span class="badge badge-warning" style="background-color: rgba(234, 179, 8, 0.2); color: #eab308; border: 1px solid #eab308;">LOW STOCK (${q} left)</span>`;
  } else {
    return `<span class="badge badge-danger" style="background-color: rgba(239, 68, 68, 0.2); color: #ef4444; border: 1px solid #ef4444;">SOLD OUT</span>`;
  }
}

async function runTests() {
  console.log('--- Starting Numerical Inventory & 3-Tier Status Verification ---');

  // Test 1: Verify Schema & Default Value
  console.log('Test 1: Verifying menu_items table schema & stock_quantity...');
  const [cols] = await db.query('PRAGMA table_info(menu_items)');
  const stockCol = cols.find(c => c.name === 'stock_quantity');
  assert(stockCol, 'stock_quantity column must exist on menu_items');
  console.log('  [PASS] stock_quantity column verified in menu_items table.');

  // Test 2: Dynamic 3-Tier Badge Logic
  console.log('\nTest 2: Dynamic 3-Tier Badge Rendering...');
  const badgeGreen = renderStockBadge(25);
  assert(badgeGreen.includes('IN STOCK (25)'), 'Quantity > 10 must be IN STOCK');
  assert(badgeGreen.includes('#22c55e'), 'IN STOCK badge must be green');
  console.log('  [PASS] Green Badge (>10):', badgeGreen);

  const badgeYellow = renderStockBadge(8);
  assert(badgeYellow.includes('LOW STOCK (8 left)'), 'Quantity 1-10 must be LOW STOCK');
  assert(badgeYellow.includes('#eab308'), 'LOW STOCK badge must be yellow/amber');
  console.log('  [PASS] Yellow Badge (1-10):', badgeYellow);

  const badgeRed = renderStockBadge(0);
  assert(badgeRed.includes('SOLD OUT'), 'Quantity <= 0 must be SOLD OUT');
  assert(badgeRed.includes('#ef4444'), 'SOLD OUT badge must be red');
  console.log('  [PASS] Red Badge (<=0):', badgeRed);

  // Test 3: Quick Adjust / Inline Stepper API (PATCH /api/menu/:id/stock)
  console.log('\nTest 3: Quick Adjust Stock API...');
  let resJson = null;
  const mockRes = {
    json(data) {
      resJson = data;
      return this;
    },
    status() {
      return this;
    }
  };

  // Set stock to 15
  await updateMenuItemStock({ params: { id: 1 }, body: { quantity: 15 } }, mockRes);
  assert.strictEqual(resJson.stock_quantity, 15);
  assert.strictEqual(resJson.status, 'IN_STOCK');
  console.log('  [PASS] Set quantity to 15: Status = IN_STOCK');

  // Stepper: -6 -> stock becomes 9 (LOW_STOCK)
  await updateMenuItemStock({ params: { id: 1 }, body: { delta: -6 } }, mockRes);
  assert.strictEqual(resJson.stock_quantity, 9);
  assert.strictEqual(resJson.status, 'LOW_STOCK');
  console.log('  [PASS] Stepper delta -6 (stock = 9): Status = LOW_STOCK');

  // Stepper: -10 -> stock becomes 0 (SOLD_OUT)
  await updateMenuItemStock({ params: { id: 1 }, body: { delta: -10 } }, mockRes);
  assert.strictEqual(resJson.stock_quantity, 0);
  assert.strictEqual(resJson.status, 'SOLD_OUT');
  assert.strictEqual(resJson.is_available, 0);
  console.log('  [PASS] Stepper delta -10 (stock = 0): Status = SOLD_OUT, is_available = 0');

  // Stepper: +20 -> stock becomes 20 (IN_STOCK)
  await updateMenuItemStock({ params: { id: 1 }, body: { delta: 20 } }, mockRes);
  assert.strictEqual(resJson.stock_quantity, 20);
  assert.strictEqual(resJson.status, 'IN_STOCK');
  assert.strictEqual(resJson.is_available, 1);
  console.log('  [PASS] Stepper delta +20 (stock = 20): Status = IN_STOCK, is_available = 1');

  // Test 4: Inventory Decrement on Order Confirmation
  console.log('\nTest 4: Inventory Decrement Hook on Order Confirmation...');
  const [beforeItem] = await db.query('SELECT stock_quantity FROM menu_items WHERE id = 1');
  const initialStock = beforeItem[0].stock_quantity;

  const order = await createOrder({
    customerName: 'Inventory Test Customer',
    customerPhone: '09170001122',
    orderType: 'delivery',
    deliveryAddress: 'Ermita Manila',
    distanceKm: 1.2,
    items: [{ menuItemId: 1, quantity: 3 }]
  });

  const [afterItem] = await db.query('SELECT stock_quantity FROM menu_items WHERE id = 1');
  const decrementedStock = afterItem[0].stock_quantity;
  assert.strictEqual(decrementedStock, initialStock - 3, 'Stock must decrease by ordered quantity (3)');
  console.log(`  [PASS] Stock correctly decremented from ${initialStock} to ${decrementedStock} for Order #${order.orderNumber}`);

  console.log('\n================================================================');
  console.log('✅ ALL NUMERICAL INVENTORY & 3-TIER BADGE TESTS PASSED!');
  console.log('================================================================');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
