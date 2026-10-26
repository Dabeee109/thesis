/**
 * Cart Operations Service (Task 6 & Task 8)
 * Manages item addition, removal, line decrementing, cart buttons, and database cart re-pricing.
 */

const db = require('../../database/db');
const { peso } = require('./textMatch');

/**
 * Add an item to the session cart
 * @param {Array} cart 
 * @param {Object} item - { id, name, price }
 * @param {number} qty 
 * @returns {Object} line item
 */
function addToCart(cart, item, qty = 1) {
  const quantity = Math.max(1, parseInt(qty, 10) || 1);
  const idx = cart.findIndex(c => c.menuItemId === item.id);

  if (idx >= 0) {
    cart[idx].quantity += quantity;
    return cart[idx];
  }

  const line = {
    menuItemId: item.id,
    name: item.name,
    price: parseFloat(item.price) || 0.00,
    quantity
  };
  cart.push(line);
  return line;
}

/**
 * Remove or decrement an item from the cart
 * @param {Array} cart 
 * @param {number} menuItemId 
 * @param {number|null} qty - null means remove whole line
 * @returns {Object|null} { name, removed, remaining } or null if not found
 */
function removeFromCart(cart, menuItemId, qty = null) {
  const i = cart.findIndex(c => c.menuItemId === menuItemId);
  if (i < 0) return null;

  const line = cart[i];
  const removed = (qty == null || qty >= line.quantity) ? line.quantity : qty;
  const remaining = line.quantity - removed;

  if (remaining <= 0) {
    cart.splice(i, 1);
  } else {
    line.quantity = remaining;
  }

  return {
    name: line.name,
    removed,
    remaining: Math.max(0, remaining)
  };
}

/**
 * Generate Quick Reply buttons for each distinct cart line (max 12 + Cancel)
 * @param {Array} cart 
 * @returns {Array} quick reply buttons
 */
function getCartRemoveButtons(cart) {
  const buttons = cart.slice(0, 12).map(c => {
    const raw = `${c.name} x${c.quantity}`;
    const title = raw.length > 20 ? raw.substring(0, 20) : raw;
    return {
      title,
      payload: `REMOVE_ITEM_${c.menuItemId}`
    };
  });
  buttons.push({ title: 'Cancel', payload: 'VIEW_CART' });
  return buttons;
}

/**
 * Calculate cart total from session lines without DB query
 * @param {Array} cart 
 * @returns {number}
 */
function calculateCartSubtotal(cart) {
  return (cart || []).reduce((sum, item) => sum + (parseFloat(item.price) || 0) * (item.quantity || 1), 0);
}

/**
 * Re-price cart from the database for accurate prices and availability check.
 * One query joined to inventory.
 * @param {Array} cart - Active session cart
 * @returns {Promise<{ lines: Array, subtotal: number, subtotalFormatted: string, unavailable: Array }>}
 */
async function priceCart(cart) {
  if (!cart || !Array.isArray(cart) || cart.length === 0) {
    return {
      lines: [],
      subtotal: 0,
      subtotalFormatted: '₱0.00',
      unavailable: []
    };
  }

  const itemIds = cart.map(c => c.menuItemId);
  const placeholders = itemIds.map(() => '?').join(',');

  const [dbItems] = await db.query(
    `SELECT m.id, m.name, m.price, m.is_available, i.stock_quantity
     FROM menu_items m
     JOIN inventory i ON i.menu_item_id = m.id
     WHERE m.id IN (${placeholders})`,
    itemIds
  );

  const dbMap = new Map();
  (dbItems || []).forEach(it => {
    dbMap.set(it.id, it);
  });

  const lines = [];
  const unavailable = [];
  let subtotal = 0;

  for (const c of cart) {
    const dbItem = dbMap.get(c.menuItemId);
    const qty = c.quantity || 1;

    if (!dbItem || dbItem.is_available !== 1 || dbItem.stock_quantity < qty) {
      unavailable.push({
        menuItemId: c.menuItemId,
        name: dbItem ? dbItem.name : c.name,
        available: dbItem ? dbItem.is_available === 1 : false,
        stock: dbItem ? dbItem.stock_quantity : 0,
        requested: qty
      });
      continue;
    }

    const unitPrice = parseFloat(dbItem.price);
    const lineTotal = unitPrice * qty;
    subtotal += lineTotal;

    // Update in-memory item price if changed
    c.price = unitPrice;
    c.name = dbItem.name;

    lines.push({
      menuItemId: c.menuItemId,
      name: dbItem.name,
      qty,
      unitPrice,
      unitPriceFormatted: peso(unitPrice),
      lineTotal: peso(lineTotal),
      lineTotalNum: lineTotal
    });
  }

  return {
    lines,
    subtotal: Math.round(subtotal * 100) / 100,
    subtotalFormatted: peso(subtotal),
    unavailable
  };
}

module.exports = {
  addToCart,
  removeFromCart,
  getCartRemoveButtons,
  calculateCartSubtotal,
  priceCart
};
