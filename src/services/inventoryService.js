/**
 * Inventory Management Service (FR8)
 * Tracks menu item stock, auto-deducts on orders, logs restocks, and alerts on low stock.
 */

const db = require('../../database/db');
const { broadcastSSE } = require('./notificationService');

/**
 * Get all inventory records with menu item details
 */
async function getInventoryList() {
  const [rows] = await db.query(`
    SELECT 
      i.id,
      i.menu_item_id,
      m.name AS item_name,
      c.name AS category_name,
      m.price,
      i.stock_quantity,
      i.low_stock_threshold,
      i.unit,
      i.last_restocked_at,
      i.updated_at,
      CASE 
        WHEN i.stock_quantity <= 0 THEN 'out_of_stock'
        WHEN i.stock_quantity <= i.low_stock_threshold THEN 'low_stock'
        ELSE 'in_stock'
      END AS stock_status
    FROM inventory i
    JOIN menu_items m ON i.menu_item_id = m.id
    JOIN categories c ON m.category_id = c.id
    WHERE COALESCE(m.is_deleted, 0) = 0
    ORDER BY (i.stock_quantity <= i.low_stock_threshold) DESC, m.name ASC
  `);
  return rows;
}

/**
 * Check if enough stock exists for a given list of order items
 * @param {Array<{menuItemId: number, quantity: number}>} items 
 * @returns {Promise<{isAvailable: boolean, unavailableItems: Array}>}
 */
async function verifyStockAvailability(items) {
  const unavailableItems = [];

  for (const item of items) {
    const [rows] = await db.query(
      `SELECT i.stock_quantity, m.name, m.is_available 
       FROM inventory i 
       JOIN menu_items m ON i.menu_item_id = m.id 
       WHERE i.menu_item_id = ?`,
      [item.menuItemId]
    );

    if (rows.length === 0) {
      unavailableItems.push({ menuItemId: item.menuItemId, name: 'Unknown Item', reason: 'Not found in inventory' });
      continue;
    }

    const row = rows[0];
    if (!row.is_available) {
      unavailableItems.push({ menuItemId: item.menuItemId, name: row.name, reason: 'Item is marked unavailable' });
    } else if (row.stock_quantity < item.quantity) {
      unavailableItems.push({
        menuItemId: item.menuItemId,
        name: row.name,
        requested: item.quantity,
        available: row.stock_quantity,
        reason: `Insufficient stock (${row.stock_quantity} left)`
      });
    } else {
      const bomCheck = await checkMenuAvailability(item.menuItemId, item.quantity || 1);
      if (!bomCheck.available && bomCheck.missingIngredients.length > 0) {
        const missingList = bomCheck.missingIngredients.map(m => m.name).join(', ');
        unavailableItems.push({
          menuItemId: item.menuItemId,
          name: row.name,
          requested: item.quantity,
          missingIngredients: bomCheck.missingIngredients,
          reason: `Out of raw ingredients (${missingList})`
        });
      }
    }
  }

  return {
    isAvailable: unavailableItems.length === 0,
    unavailableItems
  };
}

/**
 * Automatically deduct inventory stock when an order is placed
 * @param {Array<{menuItemId: number, quantity: number}>} items 
 * @param {string} orderNumber 
 */
async function deductStockForOrder(items, orderNumber) {
  for (const item of items) {
    const qty = parseInt(item.quantity, 10) || 1;
    const menuItemId = item.menuItemId || item.id;

    // 1. Get current menu item record and decrement stock_quantity
    const [menuRows] = await db.query(
      `SELECT id, stock_quantity, is_available FROM menu_items WHERE id = ?`,
      [menuItemId]
    );

    const currentMenuStock = (menuRows && menuRows.length > 0) ? (menuRows[0].stock_quantity !== undefined ? menuRows[0].stock_quantity : 50) : 50;
    const newMenuStock = Math.max(0, currentMenuStock - qty);
    const newAvailability = newMenuStock > 0 ? 1 : 0;

    // Decrement menu_items.stock_quantity directly
    await db.query(
      `UPDATE menu_items SET stock_quantity = ?, is_available = ? WHERE id = ?`,
      [newMenuStock, newAvailability, menuItemId]
    );

    // 2. Also synchronize inventory table
    const [invRows] = await db.query(
      `SELECT id, stock_quantity, low_stock_threshold FROM inventory WHERE menu_item_id = ?`,
      [menuItemId]
    );

    let invId = null;
    let lowThreshold = 10;
    if (invRows.length > 0) {
      const inv = invRows[0];
      invId = inv.id;
      lowThreshold = inv.low_stock_threshold || 10;
      await db.query(
        `UPDATE inventory SET stock_quantity = ? WHERE id = ?`,
        [newMenuStock, inv.id]
      );
    }

    // 3. Log stock deduction in audit trail
    if (invId) {
      await db.query(
        `INSERT INTO inventory_logs (inventory_id, change_amount, reason, reference_id, logged_by)
         VALUES (?, ?, 'order_placed', ?, 'Order Automation')`,
        [invId, -qty, orderNumber]
      );
    }

    // 4. Broadcast real-time stock alert if low or sold out
    if (newMenuStock <= lowThreshold) {
      broadcastSSE('STOCK_ALERT', {
        menuItemId,
        newStock: newMenuStock,
        threshold: lowThreshold,
        alertType: newMenuStock === 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK'
      });
    }

    // 5. Broadcast general inventory update for live Menu Catalog cards
    broadcastSSE('INVENTORY_UPDATED', {
      menuItemId,
      newStock: newMenuStock,
      isAvailable: newAvailability
    });
  }
}

/**
 * Restock inventory manually from dashboard
 * @param {number} inventoryId 
 * @param {number} quantityToAdd 
 * @param {string} loggedBy 
 * @param {string} notes 
 */
async function restockItem(inventoryId, quantityToAdd, loggedBy = 'Admin', notes = '') {
  const [invRows] = await db.query(
    `SELECT id, menu_item_id, stock_quantity FROM inventory WHERE id = ?`,
    [inventoryId]
  );

  if (invRows.length === 0) {
    throw new Error('Inventory record not found.');
  }

  const inv = invRows[0];
  const newStock = inv.stock_quantity + parseInt(quantityToAdd, 10);

  await db.query(
    `UPDATE inventory SET stock_quantity = ?, last_restocked_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [newStock, inventoryId]
  );

  // If item was previously unavailable, re-enable it
  if (newStock > 0) {
    await db.query(
      `UPDATE menu_items SET is_available = 1 WHERE id = ?`,
      [inv.menu_item_id]
    );
  }

  // Log in inventory_logs
  await db.query(
    `INSERT INTO inventory_logs (inventory_id, change_amount, reason, reference_id, logged_by)
     VALUES (?, ?, 'manual_restock', ?, ?)`,
    [inventoryId, quantityToAdd, notes || 'Manual Restock via Dashboard', loggedBy]
  );

  broadcastSSE('INVENTORY_UPDATED', {
    inventoryId,
    newStock,
    restockedBy: loggedBy
  });

  return { inventoryId, newStock };
}

/**
 * Helper to execute BOM logic inside an explicit mysql2/promise connection OR db.withTransaction.
 */
async function runInBomTransaction(dbConnection, callback) {
  if (dbConnection && typeof dbConnection.query === 'function') {
    if (typeof dbConnection.beginTransaction === 'function') {
      await dbConnection.beginTransaction();
      try {
        const res = await callback(dbConnection);
        await dbConnection.commit();
        return res;
      } catch (err) {
        await dbConnection.rollback().catch(() => {});
        throw err;
      }
    }
    // Passed a custom transaction/query handle directly
    return await callback(dbConnection);
  }
  return await db.withTransaction(callback);
}

/**
 * Atomically deduct raw ingredients required by an order's line items based on recipe_items (BOM).
 * Idempotent per order_id: prevents double-deduction across confirmed/preparing transitions.
 *
 * @param {number} orderId - Order ID in `orders`
 * @param {Object|null} [dbConnection=null] - Optional mysql2/promise connection or transaction handle
 * @returns {Promise<{ alreadyDeducted?: boolean, orderId: number, deductions: Array }>}
 */
async function deductIngredientsForOrder(orderId, dbConnection = null) {
  if (!orderId) {
    throw new Error('orderId is required for ingredient deduction.');
  }

  const lowStockAlerts = [];
  const deductions = await runInBomTransaction(dbConnection, async (tx) => {
    // 1. Idempotency check: skip if order_deduction already recorded for this order
    const [existingLogs] = await tx.query(
      `SELECT log_id FROM ingredient_logs
       WHERE reference_order_id = ? AND change_type = 'order_deduction'
       LIMIT 1`,
      [orderId]
    );
    if (existingLogs && existingLogs.length > 0) {
      return { alreadyDeducted: true, orderId, deductions: [] };
    }

    // 2. Read ordered items and quantities
    const [orderItems] = await tx.query(
      `SELECT menu_item_id, quantity FROM order_items WHERE order_id = ?`,
      [orderId]
    );
    if (!orderItems || orderItems.length === 0) {
      return { alreadyDeducted: false, orderId, deductions: [] };
    }

    // 3. Aggregate raw ingredient requirements across all order line items
    const requiredMap = new Map();
    for (const line of orderItems) {
      const orderedQty = Number(line.quantity) || 1;
      const [recipeRows] = await tx.query(
        `SELECT r.ingredient_id, r.quantity_required, i.name, i.unit, i.stock_quantity, i.reorder_level
         FROM recipe_items r
         JOIN ingredients i ON i.ingredient_id = r.ingredient_id
         WHERE r.menu_id = ?
         FOR UPDATE`,
        [line.menu_item_id]
      );

      for (const r of (recipeRows || [])) {
        const consumeAmount = Math.round((Number(r.quantity_required) * orderedQty) * 100) / 100;
        const prev = requiredMap.get(r.ingredient_id);
        if (prev) {
          prev.totalRequired = Math.round((prev.totalRequired + consumeAmount) * 100) / 100;
        } else {
          requiredMap.set(r.ingredient_id, {
            ingredient_id: r.ingredient_id,
            name: r.name,
            unit: r.unit,
            currentStock: Number(r.stock_quantity),
            reorderLevel: Number(r.reorder_level || 0),
            totalRequired: consumeAmount
          });
        }
      }
    }

    if (requiredMap.size === 0) {
      return { alreadyDeducted: false, orderId, deductions: [] };
    }

    // 4. Verify sufficient raw stock before applying any deductions (atomic fail-fast triggers ROLLBACK)
    const shortages = [];
    for (const entry of requiredMap.values()) {
      if (entry.currentStock < entry.totalRequired) {
        shortages.push(`${entry.name} (need ${entry.totalRequired}${entry.unit}, have ${entry.currentStock}${entry.unit})`);
      }
    }
    if (shortages.length > 0) {
      throw new Error(`Insufficient raw ingredients for Order #${orderId}: ${shortages.join('; ')}`);
    }

    // 5. Deduct from ingredients and insert negative audit logs
    const applied = [];
    for (const entry of requiredMap.values()) {
      const newStock = Math.round((entry.currentStock - entry.totalRequired) * 100) / 100;
      await tx.query(
        `UPDATE ingredients
         SET stock_quantity = ?, updated_at = CURRENT_TIMESTAMP
         WHERE ingredient_id = ?`,
        [newStock, entry.ingredient_id]
      );

      await tx.query(
        `INSERT INTO ingredient_logs (ingredient_id, change_amount, change_type, reference_order_id)
         VALUES (?, ?, 'order_deduction', ?)`,
        [entry.ingredient_id, -entry.totalRequired, orderId]
      );

      applied.push({
        ingredient_id: entry.ingredient_id,
        name: entry.name,
        unit: entry.unit,
        deducted: entry.totalRequired,
        remainingStock: newStock
      });

      if (newStock <= entry.reorderLevel) {
        lowStockAlerts.push({
          ingredient_id: entry.ingredient_id,
          name: entry.name,
          unit: entry.unit,
          stock_quantity: newStock,
          reorder_level: entry.reorderLevel
        });
      }
    }

    return { alreadyDeducted: false, orderId, deductions: applied };
  });

  for (const alert of lowStockAlerts) {
    broadcastSSE('INGREDIENT_STOCK_ALERT', {
      ...alert,
      alertType: alert.stock_quantity <= 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK'
    });
  }
  if (deductions.deductions && deductions.deductions.length > 0) {
    broadcastSSE('INGREDIENTS_UPDATED', { orderId, deductions: deductions.deductions });
  }

  return deductions;
}

/**
 * Check if a sellable menu item has enough raw ingredients in stock per its BOM recipe.
 *
 * @param {number} menuId - Menu item ID (`menu_items.id`)
 * @param {number} [requestedQty=1] - Number of servings being ordered
 * @returns {Promise<{ available: boolean, menuId: number, missingIngredients: Array, reason?: string }>}
 */
async function checkMenuAvailability(menuId, requestedQty = 1) {
  const qty = Math.max(1, parseInt(requestedQty, 10) || 1);

  const [menuRows] = await db.query(
    `SELECT id, name, is_available, stock_quantity FROM menu_items WHERE id = ? LIMIT 1`,
    [menuId]
  );

  if (!menuRows || menuRows.length === 0) {
    return {
      available: false,
      menuId,
      missingIngredients: [],
      reason: 'Menu item not found.'
    };
  }

  const menuItem = menuRows[0];
  const [recipeRows] = await db.query(
    `SELECT r.ingredient_id, r.quantity_required, i.name, i.unit, i.stock_quantity
     FROM recipe_items r
     JOIN ingredients i ON i.ingredient_id = r.ingredient_id
     WHERE r.menu_id = ?`,
    [menuId]
  );

  const missingIngredients = [];
  for (const row of (recipeRows || [])) {
    const required = Math.round((Number(row.quantity_required) * qty) * 100) / 100;
    const available = Number(row.stock_quantity || 0);
    if (available < required) {
      missingIngredients.push({
        ingredient_id: row.ingredient_id,
        name: row.name,
        unit: row.unit,
        required,
        available
      });
    }
  }

  const itemFlagAvailable = menuItem.is_available === 1 || menuItem.is_available === true;
  const available = Boolean(itemFlagAvailable && missingIngredients.length === 0);

  return {
    available,
    menuId: menuItem.id,
    menuName: menuItem.name,
    missingIngredients,
    ...(missingIngredients.length > 0
      ? { reason: `Insufficient ingredients: ${missingIngredients.map(m => m.name).join(', ')}` }
      : (!itemFlagAvailable ? { reason: 'Item is marked unavailable.' } : {}))
  };
}

/**
 * Atomically restock a raw ingredient and record a positive 'restock' log entry.
 *
 * @param {number} ingredientId
 * @param {number} amount - Positive quantity added in the ingredient's unit
 * @param {number|null} [costPerUnit=null] - Optional updated unit cost
 */
async function restockIngredient(ingredientId, amount, costPerUnit = null) {
  const addQty = Number(amount);
  if (!ingredientId || !Number.isFinite(addQty) || addQty <= 0) {
    throw new Error('Valid ingredientId and positive restock amount are required.');
  }

  const parsedCost = (costPerUnit !== null && costPerUnit !== undefined && costPerUnit !== '')
    ? Number(costPerUnit)
    : null;
  if (parsedCost !== null && (!Number.isFinite(parsedCost) || parsedCost < 0)) {
    throw new Error('costPerUnit must be a non-negative number.');
  }

  const result = await db.withTransaction(async (tx) => {
    const [rows] = await tx.query(
      `SELECT ingredient_id, name, unit, stock_quantity, cost_per_unit
       FROM ingredients
       WHERE ingredient_id = ?
       FOR UPDATE`,
      [ingredientId]
    );
    if (!rows || rows.length === 0) {
      throw new Error(`Ingredient #${ingredientId} not found.`);
    }

    const ing = rows[0];
    const previousStock = Number(ing.stock_quantity || 0);
    const newStock = Math.round((previousStock + addQty) * 100) / 100;
    const effectiveCost = parsedCost !== null ? parsedCost : Number(ing.cost_per_unit || 0);

    await tx.query(
      `UPDATE ingredients
       SET stock_quantity = ?, cost_per_unit = ?, updated_at = CURRENT_TIMESTAMP
       WHERE ingredient_id = ?`,
      [newStock, effectiveCost, ingredientId]
    );

    await tx.query(
      `INSERT INTO ingredient_logs (ingredient_id, change_amount, change_type, reference_order_id)
       VALUES (?, ?, 'restock', NULL)`,
      [ingredientId, addQty]
    );

    return {
      ingredient_id: ing.ingredient_id,
      name: ing.name,
      unit: ing.unit,
      previousStock,
      newStock,
      added: addQty,
      cost_per_unit: effectiveCost
    };
  });

  broadcastSSE('INGREDIENTS_UPDATED', {
    ingredientId: result.ingredient_id,
    newStock: result.newStock
  });

  return result;
}

/**
 * List all raw ingredients with low-stock warning flags (stock_quantity <= reorder_level).
 */
async function listIngredients() {
  const [rows] = await db.query(
    `SELECT ingredient_id, name, unit, stock_quantity, reorder_level, cost_per_unit, updated_at
     FROM ingredients
     ORDER BY (stock_quantity <= reorder_level) DESC, name ASC`
  );
  return (rows || []).map(r => ({
    ...r,
    stock_quantity: Number(r.stock_quantity || 0),
    reorder_level: Number(r.reorder_level || 0),
    cost_per_unit: Number(r.cost_per_unit || 0),
    is_low_stock: Number(r.stock_quantity || 0) <= Number(r.reorder_level || 0)
  }));
}

/**
 * Create a new raw ingredient record (and log initial stock if > 0).
 */
async function createIngredient({ name, unit, stock_quantity = 0, reorder_level = 0, cost_per_unit = 0 }) {
  const cleanName = String(name || '').trim();
  const cleanUnit = String(unit || '').trim();
  if (!cleanName || !cleanUnit) {
    throw new Error('Ingredient name and unit are required.');
  }

  const initStock = Number(stock_quantity) || 0;
  const reorder = Number(reorder_level) || 0;
  const cost = Number(cost_per_unit) || 0;
  if (initStock < 0 || reorder < 0 || cost < 0) {
    throw new Error('Stock quantity, reorder level, and cost per unit cannot be negative.');
  }

  const created = await db.withTransaction(async (tx) => {
    const [res] = await tx.query(
      `INSERT INTO ingredients (name, unit, stock_quantity, reorder_level, cost_per_unit)
       VALUES (?, ?, ?, ?, ?)`,
      [cleanName, cleanUnit, initStock, reorder, cost]
    );
    const ingredientId = res.insertId;

    if (initStock > 0) {
      await tx.query(
        `INSERT INTO ingredient_logs (ingredient_id, change_amount, change_type, reference_order_id)
         VALUES (?, ?, 'restock', NULL)`,
        [ingredientId, initStock]
      );
    }

    return {
      ingredient_id: ingredientId,
      name: cleanName,
      unit: cleanUnit,
      stock_quantity: initStock,
      reorder_level: reorder,
      cost_per_unit: cost,
      is_low_stock: initStock <= reorder
    };
  });

  return created;
}

/**
 * Retrieve all BOM recipe ingredients for a specific menu item.
 */
async function getRecipeByMenuId(menuId) {
  const [menuRows] = await db.query(
    `SELECT id, name, price, category FROM menu_items WHERE id = ? LIMIT 1`,
    [menuId]
  );
  if (!menuRows || menuRows.length === 0) {
    throw new Error(`Menu item #${menuId} not found.`);
  }

  const [recipeRows] = await db.query(
    `SELECT r.recipe_id, r.menu_id, r.ingredient_id, r.quantity_required,
            i.name AS ingredient_name, i.unit, i.stock_quantity, i.reorder_level, i.cost_per_unit
     FROM recipe_items r
     JOIN ingredients i ON i.ingredient_id = r.ingredient_id
     WHERE r.menu_id = ?
     ORDER BY i.name ASC`,
    [menuId]
  );

  return {
    menuItem: menuRows[0],
    recipeItems: (recipeRows || []).map(r => ({
      ...r,
      quantity_required: Number(r.quantity_required),
      stock_quantity: Number(r.stock_quantity),
      cost_per_unit: Number(r.cost_per_unit)
    }))
  };
}

/**
 * Map/replace recipe ingredients for a menu item inside an atomic transaction.
 */
async function upsertRecipeForMenuItem(menuId, items = []) {
  const numericMenuId = parseInt(menuId, 10);
  if (!numericMenuId) {
    throw new Error('Valid menu_id is required.');
  }
  if (!Array.isArray(items)) {
    throw new Error('items array is required.');
  }

  const normalized = [];
  for (const entry of items) {
    const ingId = parseInt(entry.ingredient_id || entry.ingredientId, 10);
    const qtyReq = Number(entry.quantity_required ?? entry.quantityRequired);
    if (!ingId || !Number.isFinite(qtyReq) || qtyReq <= 0) {
      throw new Error('Each recipe item must specify a valid ingredient_id and positive quantity_required.');
    }
    normalized.push({ ingredient_id: ingId, quantity_required: Math.round(qtyReq * 100) / 100 });
  }

  await db.withTransaction(async (tx) => {
    const [menuRows] = await tx.query(`SELECT id FROM menu_items WHERE id = ? LIMIT 1`, [numericMenuId]);
    if (!menuRows || menuRows.length === 0) {
      throw new Error(`Menu item #${numericMenuId} not found.`);
    }

    await tx.query(`DELETE FROM recipe_items WHERE menu_id = ?`, [numericMenuId]);

    for (const row of normalized) {
      await tx.query(
        `INSERT INTO recipe_items (menu_id, ingredient_id, quantity_required) VALUES (?, ?, ?)`,
        [numericMenuId, row.ingredient_id, row.quantity_required]
      );
    }
  });

  return await getRecipeByMenuId(numericMenuId);
}

module.exports = {
  getInventoryList,
  verifyStockAvailability,
  deductStockForOrder,
  restockItem,
  deductIngredientsForOrder,
  checkMenuAvailability,
  restockIngredient,
  listIngredients,
  createIngredient,
  getRecipeByMenuId,
  upsertRecipeForMenuItem
};
