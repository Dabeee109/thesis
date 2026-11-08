const assert = require('assert');
const jwt = require('jsonwebtoken');
const config = require('../src/config/config');
const db = require('../database/db');
const { handleTextInput } = require('../src/services/nlpEngine');
const { getSession, saveSession } = require('../src/services/sessionManager');

const token = jwt.sign({ id: 1, username: 'admin', role: 'admin' }, config.jwtSecret, { expiresIn: '1h' });

async function runTests() {
  console.log('--- STARTING STOCK QUANTITY & INVENTORY MANAGEMENT TESTS ---');

  // Test 1: Update menu item stock and availability via PUT /api/admin/menu/:id
  console.log('\n[Test 1] Testing PUT /api/admin/menu/:id with stock quantity...');
  const res1 = await fetch('http://localhost:3000/api/admin/menu/2', {
    method: 'PUT',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      stock_quantity: 35,
      is_available: 1
    })
  });
  const data1 = await res1.json();
  assert.strictEqual(data1.success, true);
  assert.ok(data1.item, 'Expected updated item object returned in response');
  assert.strictEqual(data1.item.stock_quantity, 35);
  assert.strictEqual(data1.item.is_available, 1);
  console.log('✓ Test 1 Passed: Menu item stock updated to 35 and returned updated item object.');

  // Test 2: If stock_quantity <= 0, automatically set is_available = false (0)
  console.log('\n[Test 2] Testing auto out-of-stock when stock_quantity = 0...');
  const res2 = await fetch('http://localhost:3000/api/admin/menu/2', {
    method: 'PUT',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      stock_quantity: 0,
      is_available: 1 // Attempt to enable, but stock is 0
    })
  });
  const data2 = await res2.json();
  assert.strictEqual(data2.success, true);
  assert.strictEqual(data2.item.stock_quantity, 0);
  assert.strictEqual(data2.item.is_available, 0, 'is_available must automatically be set to 0 when stock <= 0');
  console.log('✓ Test 2 Passed: is_available was automatically set to 0 when stock_quantity was set to 0.');

  // Test 3: Verify GET /api/menu returns stock_quantity and is_available
  console.log('\n[Test 3] Testing GET /api/menu includes stock_quantity...');
  const res3 = await fetch('http://localhost:3000/api/menu');
  const data3 = await res3.json();
  assert.strictEqual(data3.success, true);
  const item2 = (data3.allItems || []).find(i => i.id === 2);
  assert.ok(item2);
  assert.strictEqual(item2.stock_quantity, 0);
  assert.strictEqual(item2.is_available, 0);
  console.log('✓ Test 3 Passed: GET /api/menu accurately exposes stock_quantity and availability status.');

  // Test 4: Messenger Ordering Bot Guard for Sold Out item
  console.log('\n[Test 4] Testing Messenger Ordering Bot Guard for sold out item...');
  const testPsid = 'TEST_STOCK_GUARD_' + Date.now();
  const session = await getSession(testPsid);
  session.cart = [];
  session.dining_mode = 'Delivery';
  session.state = 'ordering';
  await saveSession(session);

  // Attempt to order Caramel Macchiato (id: 2, which is now sold out)
  const result = await handleTextInput(testPsid, session, '1 caramel macchiato');
  const sessionAfterBlock = await getSession(testPsid);
  assert.strictEqual(sessionAfterBlock.cart.length, 0, 'Cart should remain empty for sold out items');
  console.log('✓ Test 4 Passed: Sold out item was blocked from being added to the cart.');

  // Test 5: Re-stock item and verify it can now be ordered
  console.log('\n[Test 5] Re-stocking item and testing successful addition...');
  await fetch('http://localhost:3000/api/admin/menu/2', {
    method: 'PUT',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      stock_quantity: 40,
      is_available: 1
    })
  });

  const sessionBeforeAdd = await getSession(testPsid);
  await handleTextInput(testPsid, sessionBeforeAdd, '1 caramel macchiato');
  const updatedSession = await getSession(testPsid);
  assert.strictEqual(updatedSession.cart.length, 1, 'Cart should now contain the re-stocked item');
  assert.strictEqual(updatedSession.cart[0].name, 'Caramel Macchiato');
  console.log('✓ Test 5 Passed: Re-stocked item was successfully added to cart.');

  console.log('\n🎉 ALL STOCK QUANTITY & INVENTORY MANAGEMENT TESTS PASSED SUCCESSFULLY!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
