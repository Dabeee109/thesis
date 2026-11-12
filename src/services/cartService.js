/**
 * Cart Operations Service (Task 6 & Task 8)
 * Manages item addition, removal, line decrementing, cart buttons, and database cart re-pricing.
 */

const db = require('../../database/db');
const { peso } = require('./textMatch');

/**
 * Add an item to the session cart
 * @param {Array} cart 
 * @param {Object} item - { id, name, price, stock_quantity, is_available }
 * @param {number} qty 
 * @returns {Object} line item or { outOfStock: true, name }
 */
function addToCart(cart, item, qty = 1) {
  // Guard: Verify stock quantity and availability before adding (Requirement 4)
  const stock = item.stock_quantity !== undefined ? item.stock_quantity : 999;
  const isAvail = item.is_available === undefined || item.is_available === 1 || item.is_available === true;
  if (stock <= 0 || !isAvail) {
    return { outOfStock: true, name: item.name };
  }

  const quantity = Math.max(1, parseInt(qty, 10) || 1);
  const addons = Array.isArray(item.addons)
    ? item.addons
    : (Array.isArray(item.addOns) ? item.addOns : (item.addon ? [item.addon] : []));
  const addonKey = addons.map(a => typeof a === 'object' ? a.name : a).sort().join('+');

  const idx = cart.findIndex(c => (c.menuItemId === item.id || c.id === item.id) && (c.addonKey || '') === addonKey);

  if (idx >= 0) {
    cart[idx].quantity += quantity;
    return cart[idx];
  }

  const line = {
    menuItemId: item.id,
    name: item.name,
    price: parseFloat(item.price) || 0.00,
    quantity,
    addons,
    addOns: addons,
    addonKey
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
 * Calculate line total for an individual cart item
 * Item Line Total = (Base Price + Add-ons/Upgrades) * Quantity
 * @param {Object} item 
 * @returns {number}
 */
function calculateItemLineTotal(item) {
  if (!item) return 0;
  const basePrice = parseFloat(item.price || item.unitPrice || 0.0);
  let addOnsPrice = parseFloat(item.addOnsPrice || item.customizationPrice || 0.0);

  if (Array.isArray(item.addOns)) {
    addOnsPrice = item.addOns.reduce((sum, a) => sum + (typeof a === 'object' ? (parseFloat(a.price) || 20.0) : 20.0), 0.0);
  } else if (Array.isArray(item.addons)) {
    addOnsPrice = item.addons.reduce((sum, a) => sum + (typeof a === 'object' ? (parseFloat(a.price) || 20.0) : 20.0), 0.0);
  } else if (item.customizations && typeof item.customizations === 'object') {
    if (item.customizations.size === '22oz' && !addOnsPrice) addOnsPrice += 20.0;
    if (String(item.customizations.milk || '').toLowerCase().includes('oat') && !addOnsPrice) addOnsPrice += 40.0;
    if (String(item.customizations.foam || '').toLowerCase().includes('sea salt') && !addOnsPrice) addOnsPrice += 30.0;
  }

  const effectiveUnitPrice = basePrice + addOnsPrice;
  const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
  return Math.round(effectiveUnitPrice * quantity * 100) / 100;
}

/**
 * Calculate cart subtotal from session lines
 * Subtotal = Sum of Item Line Totals
 * @param {Array} cart 
 * @returns {number}
 */
function calculateCartSubtotal(cart) {
  if (!cart || !Array.isArray(cart) || cart.length === 0) return 0.0;
  const sum = cart.reduce((total, item) => total + calculateItemLineTotal(item), 0.0);
  return Math.round(sum * 100) / 100;
}

/**
 * Calculate final order total
 * Final Total = Subtotal - Senior/PWD Discount + Delivery Fee
 * @param {Object} params
 * @param {number} params.subtotal
 * @param {number} [params.discount=0]
 * @param {number} [params.deliveryFee=0]
 * @returns {number}
 */
function calculateFinalTotal({ subtotal, discount = 0, deliveryFee = 0 }) {
  const sub = Math.max(0, parseFloat(subtotal) || 0.0);
  const disc = Math.max(0, parseFloat(discount) || 0.0);
  const fee = Math.max(0, parseFloat(deliveryFee) || 0.0);
  const finalTotal = Math.max(0, sub - disc + fee);
  return Math.round(finalTotal * 100) / 100;
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

    const { checkMenuAvailability } = require('./inventoryService');
    const bomAvail = await checkMenuAvailability(c.menuItemId, qty);
    if (!bomAvail.available) {
      unavailable.push({
        menuItemId: c.menuItemId,
        name: dbItem.name,
        available: false,
        stock: 0,
        requested: qty,
        missingIngredients: bomAvail.missingIngredients
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
  calculateItemLineTotal,
  calculateCartSubtotal,
  calculateFinalTotal,
  priceCart
};
