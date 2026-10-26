const test = require('node:test');
const assert = require('node:assert/strict');
const {
  mapWitIntent,
  getEntity,
  getEntityValue,
  parseWitResponse,
  localNluParse
} = require('../src/services/witAiService');

test('mapWitIntent maps exact intents to system constants and unknown to UNKNOWN', () => {
  assert.strictEqual(mapWitIntent('greet'), 'GREETING');
  assert.strictEqual(mapWitIntent('browse_menu'), 'BROWSE_MENU');
  assert.strictEqual(mapWitIntent('place_order'), 'ORDER_ITEM');
  assert.strictEqual(mapWitIntent('remove_item'), 'REMOVE_ITEM');
  assert.strictEqual(mapWitIntent('view_cart'), 'VIEW_CART');
  assert.strictEqual(mapWitIntent('clear_cart'), 'CLEAR_CART');
  assert.strictEqual(mapWitIntent('checkout'), 'CHECKOUT');
  assert.strictEqual(mapWitIntent('confirm_yes'), 'CONFIRM_YES');
  assert.strictEqual(mapWitIntent('confirm_no'), 'CONFIRM_NO');
  assert.strictEqual(mapWitIntent('track_order'), 'TRACK_ORDER');
  assert.strictEqual(mapWitIntent('store_info'), 'STORE_INFO');
  assert.strictEqual(mapWitIntent('request_agent'), 'REQUEST_AGENT');
  assert.strictEqual(mapWitIntent('out_of_scope'), 'OUT_OF_SCOPE');

  // Unknown or substring intent should NOT falsely match
  assert.strictEqual(mapWitIntent('cancel_order'), 'UNKNOWN');
  assert.strictEqual(mapWitIntent('order_something_else'), 'UNKNOWN');
  assert.strictEqual(mapWitIntent('unknown_random'), 'UNKNOWN');
  assert.strictEqual(mapWitIntent(''), 'UNKNOWN');
  assert.strictEqual(mapWitIntent(null), 'UNKNOWN');
});

test('getEntity extracts composite name:role entities and wit$number', () => {
  const realisticEntities = {
    'menu_item:menu_item': [
      { id: '123', name: 'menu_item', role: 'menu_item', start: 2, end: 15, value: 'spanish latte', confidence: 0.98 }
    ],
    'wit$number:quantity': [
      { id: '456', name: 'wit$number', role: 'quantity', start: 0, end: 1, value: 2, confidence: 0.99 }
    ]
  };

  const itemEnt = getEntity(realisticEntities, 'menu_item');
  assert.ok(itemEnt);
  assert.strictEqual(itemEnt.value, 'spanish latte');
  assert.strictEqual(itemEnt.confidence, 0.98);

  const qtyEnt = getEntity(realisticEntities, 'quantity');
  assert.ok(qtyEnt);
  assert.strictEqual(qtyEnt.value, 2);

  const missing = getEntity(realisticEntities, 'nonexistent');
  assert.strictEqual(missing, null);
});

test('parseWitResponse handles realistic Wit.ai JSON, null quantity when absent, and multi-item pairing', () => {
  // Case 1: Multi-item message "2 spanish latte and 1 croissant"
  const multiItemWit = {
    text: '2 spanish latte and 1 croissant',
    intents: [{ id: '1', name: 'place_order', confidence: 0.95 }],
    entities: {
      'wit$number:quantity': [
        { start: 0, end: 1, value: 2, confidence: 0.99 },
        { start: 20, end: 21, value: 1, confidence: 0.99 }
      ],
      'menu_item:menu_item': [
        { start: 2, end: 15, value: 'spanish latte', confidence: 0.95 },
        { start: 22, end: 31, value: 'croissant', confidence: 0.93 }
      ]
    }
  };

  const parsedMulti = parseWitResponse(multiItemWit, multiItemWit.text);
  assert.strictEqual(parsedMulti.intent, 'ORDER_ITEM');
  assert.strictEqual(parsedMulti.confidence, 0.95);
  assert.strictEqual(parsedMulti.menuItems.length, 2);
  assert.strictEqual(parsedMulti.menuItems[0].value, 'spanish latte');
  assert.strictEqual(parsedMulti.menuItems[0].quantity, 2);
  assert.strictEqual(parsedMulti.menuItems[1].value, 'croissant');
  assert.strictEqual(parsedMulti.menuItems[1].quantity, 1);
  assert.strictEqual(parsedMulti.quantity, 2);

  // Case 2: Item without quantity stated
  const noQtyWit = {
    text: 'iced tea',
    intents: [{ id: '2', name: 'place_order', confidence: 0.88 }],
    entities: {
      'menu_item:menu_item': [
        { start: 0, end: 8, value: 'iced tea', confidence: 0.88 }
      ]
    }
  };

  const parsedNoQty = parseWitResponse(noQtyWit, noQtyWit.text);
  assert.strictEqual(parsedNoQty.intent, 'ORDER_ITEM');
  assert.strictEqual(parsedNoQty.menuItems.length, 1);
  assert.strictEqual(parsedNoQty.menuItems[0].value, 'iced tea');
  assert.strictEqual(parsedNoQty.menuItems[0].quantity, null);
  assert.strictEqual(parsedNoQty.quantity, null); // must be null, never 1
});

test('localNluParse returns 0.6 for regex hits and 0.0 for fallback guesses', () => {
  const menuRes = localNluParse('menu');
  assert.strictEqual(menuRes.intent, 'BROWSE_MENU');
  assert.strictEqual(menuRes.confidence, 0.6);

  const checkoutRes = localNluParse('checkout');
  assert.strictEqual(checkoutRes.intent, 'CHECKOUT');
  assert.strictEqual(checkoutRes.confidence, 0.6);

  const removeRes = localNluParse('remove the latte');
  assert.strictEqual(removeRes.intent, 'REMOVE_ITEM');
  assert.strictEqual(removeRes.confidence, 0.6);

  const guessRes = localNluParse('random unknown dish');
  assert.strictEqual(guessRes.confidence, 0.0);
});
