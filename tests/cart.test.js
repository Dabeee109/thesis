const test = require('node:test');
const assert = require('node:assert/strict');
const {
  addToCart,
  removeFromCart,
  getCartRemoveButtons,
  calculateCartSubtotal
} = require('../src/services/cartService');

test('addToCart adds new line and increments existing line', () => {
  const cart = [];
  const item1 = { id: 1, name: 'Signature Spanish Latte', price: 145.00 };
  const item2 = { id: 8, name: 'Almond Butter Croissant', price: 95.00 };

  addToCart(cart, item1, 2);
  assert.strictEqual(cart.length, 1);
  assert.strictEqual(cart[0].quantity, 2);

  addToCart(cart, item2, 1);
  assert.strictEqual(cart.length, 2);

  addToCart(cart, item1, 1);
  assert.strictEqual(cart.length, 2);
  assert.strictEqual(cart[0].quantity, 3);
  assert.strictEqual(calculateCartSubtotal(cart), 3 * 145 + 1 * 95);
});

test('removeFromCart decrements when qty specified, removes whole line when null or >= quantity', () => {
  const cart = [
    { menuItemId: 1, name: 'Signature Spanish Latte', price: 145.00, quantity: 3 },
    { menuItemId: 8, name: 'Almond Butter Croissant', price: 95.00, quantity: 1 }
  ];

  // 1. Decrement by 1
  const res1 = removeFromCart(cart, 1, 1);
  assert.strictEqual(res1.name, 'Signature Spanish Latte');
  assert.strictEqual(res1.removed, 1);
  assert.strictEqual(res1.remaining, 2);
  assert.strictEqual(cart[0].quantity, 2);

  // 2. Remove remaining whole line (qty = null)
  const res2 = removeFromCart(cart, 1, null);
  assert.strictEqual(res2.removed, 2);
  assert.strictEqual(res2.remaining, 0);
  assert.strictEqual(cart.length, 1);
  assert.strictEqual(cart[0].menuItemId, 8);

  // 3. Remove with qty greater than quantity
  const res3 = removeFromCart(cart, 8, 5);
  assert.strictEqual(res3.removed, 1);
  assert.strictEqual(res3.remaining, 0);
  assert.strictEqual(cart.length, 0);

  // 4. Remove missing item
  const resMissing = removeFromCart(cart, 999, 1);
  assert.strictEqual(resMissing, null);
});

test('getCartRemoveButtons caps at 12 items plus cancel, with titles <= 20 chars', () => {
  const longNameCart = [];
  for (let i = 1; i <= 15; i++) {
    longNameCart.push({
      menuItemId: i,
      name: `Very Long Menu Item Name Number ${i}`,
      quantity: i
    });
  }

  const buttons = getCartRemoveButtons(longNameCart);
  // Maximum 12 line buttons + 1 Cancel = 13 buttons
  assert.strictEqual(buttons.length, 13);
  assert.strictEqual(buttons[buttons.length - 1].title, 'Cancel');
  assert.strictEqual(buttons[buttons.length - 1].payload, 'VIEW_CART');

  for (const b of buttons) {
    assert.ok(b.title.length <= 20, `Button title exceeds 20 chars: "${b.title}"`);
    assert.ok(b.payload, 'Button must have payload');
  }
});
