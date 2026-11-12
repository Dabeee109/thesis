/**
 * Inventory Management Service (FR8)
 * Tracks menu item stock, auto-deducts on orders, logs restocks, and alerts on low stock.
 */

const db = require('../../database/db');
const { broadcastSSE } = require('./notificationService');
const { INGREDIENT_CATEGORIES, INGREDIENT_UNITS } = require('../../database/bomRecipesSeedData');

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
      `SELECT COALESCE(i.stock_quantity, m.stock_quantity, 50) AS stock_quantity, m.name, m.is_available
       FROM menu_items m
       LEFT JOIN inventory i ON i.menu_item_id = m.id
       WHERE m.id = ? AND COALESCE(m.is_deleted, 0) = 0`,
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
 * Synchronize `menu_items.is_available` & `stock_quantity` against live raw ingredient stock levels.
 * Marks any menu item unavailable if ANY required ingredient in `recipe_items` has
 * `ingredients.stock_quantity < recipe_items.quantity_required`, and re-enables it when restocked.
 *
 * @param {Object|null} [externalConn=null] - Optional active transaction/connection handle
 * @returns {Promise<{ updatedCount: number, disabledMenus: Array, enabledMenus: Array }>}
 */
async function syncMenuAvailability(externalConn = null) {
  const exec = (externalConn && typeof externalConn.query === 'function') ? externalConn : db;

  const [rows] = await exec.query(
    `SELECT r.menu_id, r.ingredient_id, r.quantity_required,
            i.name AS ingredient_name, i.stock_quantity AS ingredient_stock,
            m.name AS menu_name, m.is_available, m.stock_quantity AS menu_stock
     FROM recipe_items r
     JOIN ingredients i ON i.ingredient_id = r.ingredient_id
     JOIN menu_items m ON m.id = r.menu_id
     WHERE COALESCE(m.is_deleted, 0) = 0`
  );

  const byMenu = new Map();
  for (const row of (rows || [])) {
    if (!byMenu.has(row.menu_id)) {
      byMenu.set(row.menu_id, {
        menuId: row.menu_id,
        menuName: row.menu_name,
        isAvailable: row.is_available === 1 || row.is_available === true,
        menuStock: Number(row.menu_stock || 0),
        reqs: []
      });
    }
    byMenu.get(row.menu_id).reqs.push({
      ingredientId: row.ingredient_id,
      ingredientName: row.ingredient_name,
      required: Number(row.quantity_required || 0),
      stock: Number(row.ingredient_stock || 0)
    });
  }

  const disabledMenus = [];
  const enabledMenus = [];

  for (const entry of byMenu.values()) {
    const hasAllIngredients = entry.reqs.every(r => r.stock >= r.required);
    let possibleServings = 0;
    if (hasAllIngredients && entry.reqs.length > 0) {
      possibleServings = Math.floor(
        Math.min(...entry.reqs.map(r => (r.required > 0 ? Math.floor(r.stock / r.required) : 999)))
      );
    }

    if (!hasAllIngredients || possibleServings <= 0) {
      if (entry.isAvailable || entry.menuStock > 0) {
        await exec.query(
          `UPDATE menu_items SET is_available = 0, stock_quantity = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [entry.menuId]
        );
        await exec.query(
          `UPDATE menu_items SET status = 'OUT_OF_STOCK' WHERE id = ?`,
          [entry.menuId]
        ).catch(() => {});
        await exec.query(
          `UPDATE inventory SET stock_quantity = 0, updated_at = CURRENT_TIMESTAMP WHERE menu_item_id = ?`,
          [entry.menuId]
        ).catch(() => {});
        disabledMenus.push({ menuId: entry.menuId, name: entry.menuName });
      }
    } else if (!entry.isAvailable || entry.menuStock <= 0) {
      const restoredStock = Math.max(1, possibleServings);
      await exec.query(
        `UPDATE menu_items SET is_available = 1, stock_quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [restoredStock, entry.menuId]
      );
      await exec.query(
        `UPDATE menu_items SET status = 'AVAILABLE' WHERE id = ?`,
        [entry.menuId]
      ).catch(() => {});
      await exec.query(
        `UPDATE inventory SET stock_quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE menu_item_id = ?`,
        [restoredStock, entry.menuId]
      ).catch(() => {});
      enabledMenus.push({ menuId: entry.menuId, name: entry.menuName, possibleServings: restoredStock });
    }
  }

  const updatedCount = disabledMenus.length + enabledMenus.length;
  if (!externalConn && updatedCount > 0) {
    broadcastSSE('INVENTORY_UPDATED', {
      synced: true,
      disabledMenus,
      enabledMenus
    });
  }

  return { updatedCount, disabledMenus, enabledMenus };
}

/**
 * Atomically deduct raw ingredients required by an order's line items based on recipe_items (BOM).
 * Uses `GREATEST(0, stock_quantity - ?)` (MySQL) / `MAX(0, stock_quantity - ?)` (SQLite),
 * inserts negative audit entries into `ingredient_logs`, and syncs menu availability.
 * Idempotent per order_id: prevents double-deduction across confirmed/preparing transitions.
 *
 * @param {number} orderId - Order ID in `orders`
 * @param {Object|null} [dbConnection=null] - Optional mysql2/promise connection or transaction handle
 * @returns {Promise<{ alreadyDeducted?: boolean, orderId: number, deductions: Array, syncResult?: Object }>}
 */
async function deductIngredientsForOrder(orderId, dbConnection = null) {
  if (!orderId) {
    throw new Error('orderId is required for ingredient deduction.');
  }

  const lowStockAlerts = [];
  const result = await runInBomTransaction(dbConnection, async (tx) => {
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

    // 2. Read ordered items and compute total raw ingredient deduction via recipe_items join
    const [reqRows] = await tx.query(
      `SELECT r.ingredient_id,
              i.name,
              i.unit,
              i.stock_quantity,
              i.reorder_level,
              ROUND(SUM(r.quantity_required * COALESCE(oi.quantity, 1)), 2) AS total_deduction
       FROM order_items oi
       JOIN recipe_items r ON r.menu_id = oi.menu_item_id
       JOIN ingredients i ON i.ingredient_id = r.ingredient_id
       WHERE oi.order_id = ?
       GROUP BY r.ingredient_id, i.name, i.unit, i.stock_quantity, i.reorder_level`,
      [orderId]
    );

    if (!reqRows || reqRows.length === 0) {
      return { alreadyDeducted: false, orderId, deductions: [] };
    }

    const isSqlite = Boolean(tx.isSqlite || (typeof db.isUsingFallback === 'function' && db.isUsingFallback()));
    const applied = [];

    // 3. Deduct using GREATEST(0, ...) / MAX(0, ...) and insert negative audit logs
    for (const entry of reqRows) {
      const deductAmt = Math.round(Number(entry.total_deduction || 0) * 100) / 100;
      if (deductAmt <= 0) continue;

      const updateSql = isSqlite
        ? `UPDATE ingredients SET stock_quantity = MAX(0, ROUND(stock_quantity - ?, 2)), updated_at = CURRENT_TIMESTAMP WHERE ingredient_id = ?`
        : `UPDATE ingredients SET stock_quantity = GREATEST(0, ROUND(stock_quantity - ?, 2)), updated_at = CURRENT_TIMESTAMP WHERE ingredient_id = ?`;

      await tx.query(updateSql, [deductAmt, entry.ingredient_id]);

      const [updatedRows] = await tx.query(
        `SELECT stock_quantity, reorder_level FROM ingredients WHERE ingredient_id = ? LIMIT 1`,
        [entry.ingredient_id]
      );
      const remainingStock = Number(updatedRows?.[0]?.stock_quantity ?? 0);
      const reorderLevel = Number(updatedRows?.[0]?.reorder_level ?? entry.reorder_level ?? 0);

      await tx.query(
        `INSERT INTO ingredient_logs (ingredient_id, change_amount, change_type, reference_order_id, notes)
         VALUES (?, ?, 'order_deduction', ?, ?)`,
        [entry.ingredient_id, -deductAmt, orderId, `Order #${orderId} ingredient deduction (${entry.name})`]
      );

      applied.push({
        ingredient_id: entry.ingredient_id,
        name: entry.name,
        unit: entry.unit,
        deducted: deductAmt,
        remainingStock
      });

      if (remainingStock <= reorderLevel) {
        lowStockAlerts.push({
          ingredient_id: entry.ingredient_id,
          name: entry.name,
          unit: entry.unit,
          stock_quantity: remainingStock,
          reorder_level: reorderLevel
        });
      }
    }

    const syncResult = await syncMenuAvailability(tx);
    return { alreadyDeducted: false, orderId, deductions: applied, syncResult };
  });

  for (const alert of lowStockAlerts) {
    broadcastSSE('INGREDIENT_STOCK_ALERT', {
      ...alert,
      alertType: alert.stock_quantity <= 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK'
    });
  }
  if (result.deductions && result.deductions.length > 0) {
    broadcastSSE('INVENTORY_UPDATED', {
      orderId,
      deductions: result.deductions,
      disabledMenus: result.syncResult?.disabledMenus || []
    });
    broadcastSSE('INGREDIENTS_UPDATED', { orderId, deductions: result.deductions });
  }

  return result;
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
 * Automatically re-enables affected menu items via syncMenuAvailability().
 *
 * @param {number} ingredientId
 * @param {number} amount - Positive quantity added in the ingredient's unit
 * @param {number|null} [costPerUnit=null] - Optional updated unit cost
 * @param {string} [notes='Manual Restock'] - Optional audit log notes
 */
async function restockIngredient(ingredientId, amount, costPerUnit = null, notes = 'Manual Restock') {
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

  const cleanNotes = String(notes || 'Manual Restock').trim().slice(0, 255);

  const result = await db.withTransaction(async (tx) => {
    const [rows] = await tx.query(
      `SELECT ingredient_id, name, category, unit, stock_quantity, cost_per_unit
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
      `INSERT INTO ingredient_logs (ingredient_id, change_amount, change_type, reference_order_id, notes)
       VALUES (?, ?, 'restock', NULL, ?)`,
      [ingredientId, addQty, cleanNotes]
    );

    const syncResult = await syncMenuAvailability(tx);

    return {
      ingredient_id: ing.ingredient_id,
      name: ing.name,
      category: ing.category || 'Produce & Pantry',
      unit: ing.unit,
      previousStock,
      newStock,
      added: addQty,
      cost_per_unit: effectiveCost,
      syncResult
    };
  });

  broadcastSSE('INVENTORY_UPDATED', {
    ingredientId: result.ingredient_id,
    newStock: result.newStock,
    enabledMenus: result.syncResult?.enabledMenus || []
  });
  broadcastSSE('INGREDIENTS_UPDATED', {
    ingredientId: result.ingredient_id,
    newStock: result.newStock
  });

  return result;
}

/**
 * List all raw ingredients with category, units, and low-stock warning flags.
 */
async function listIngredients() {
  const [rows] = await db.query(
    `SELECT ingredient_id, name, category, unit, stock_quantity, reorder_level, cost_per_unit, updated_at
     FROM ingredients
     ORDER BY (stock_quantity <= reorder_level) DESC, category ASC, name ASC`
  );
  return (rows || []).map(r => {
    const stock = Number(r.stock_quantity || 0);
    const reorder = Number(r.reorder_level || 0);
    return {
      ...r,
      category: r.category || 'Produce & Pantry',
      stock_quantity: stock,
      reorder_level: reorder,
      cost_per_unit: Number(r.cost_per_unit || 0),
      is_low_stock: stock <= reorder,
      stock_status: stock <= 0 ? 'out_of_stock' : (stock <= reorder ? 'low_stock' : 'in_stock')
    };
  });
}

/**
 * Return raw ingredients grouped by category for REST API & Dashboard consumption.
 */
async function getIngredientsGrouped() {
  const ingredients = await listIngredients();
  const groupedByCategory = {};
  for (const cat of INGREDIENT_CATEGORIES) {
    groupedByCategory[cat] = [];
  }
  for (const ing of ingredients) {
    const cat = ing.category || 'Produce & Pantry';
    if (!groupedByCategory[cat]) groupedByCategory[cat] = [];
    groupedByCategory[cat].push(ing);
  }
  return {
    ingredients,
    groupedByCategory,
    lowStockCount: ingredients.filter(i => i.is_low_stock).length
  };
}

/**
 * Create a new raw ingredient record (and log initial stock if > 0).
 */
async function createIngredient({ name, category = 'Produce & Pantry', unit, stock_quantity = 0, reorder_level = 0, cost_per_unit = 0 }) {
  const cleanName = String(name || '').trim();
  const cleanUnit = String(unit || '').trim();
  const cleanCategory = String(category || 'Produce & Pantry').trim();
  if (!cleanName || !cleanUnit) {
    throw new Error('Ingredient name and unit are required.');
  }
  if (!INGREDIENT_UNITS.includes(cleanUnit)) {
    throw new Error(`Invalid unit "${cleanUnit}". Allowed units: ${INGREDIENT_UNITS.join(', ')}.`);
  }
  if (!INGREDIENT_CATEGORIES.includes(cleanCategory)) {
    throw new Error(`Invalid category "${cleanCategory}". Allowed categories: ${INGREDIENT_CATEGORIES.join(', ')}.`);
  }

  const initStock = Number(stock_quantity) || 0;
  const reorder = Number(reorder_level) || 0;
  const cost = Number(cost_per_unit) || 0;
  if (initStock < 0 || reorder < 0 || cost < 0) {
    throw new Error('Stock quantity, reorder level, and cost per unit cannot be negative.');
  }

  const created = await db.withTransaction(async (tx) => {
    const [res] = await tx.query(
      `INSERT INTO ingredients (name, category, unit, stock_quantity, reorder_level, cost_per_unit)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [cleanName, cleanCategory, cleanUnit, initStock, reorder, cost]
    );
    const ingredientId = res.insertId;

    if (initStock > 0) {
      await tx.query(
        `INSERT INTO ingredient_logs (ingredient_id, change_amount, change_type, reference_order_id, notes)
         VALUES (?, ?, 'restock', NULL, ?)`,
        [ingredientId, initStock, 'Initial ingredient stock']
      );
    }

    return {
      ingredient_id: ingredientId,
      name: cleanName,
      category: cleanCategory,
      unit: cleanUnit,
      stock_quantity: initStock,
      reorder_level: reorder,
      cost_per_unit: cost,
      is_low_stock: initStock <= reorder,
      stock_status: initStock <= 0 ? 'out_of_stock' : (initStock <= reorder ? 'low_stock' : 'in_stock')
    };
  });

  broadcastSSE('INVENTORY_UPDATED', { ingredientId: created.ingredient_id, added: created });
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
            i.name AS ingredient_name, i.category, i.unit, i.stock_quantity, i.reorder_level, i.cost_per_unit
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

    await syncMenuAvailability(tx);
  });

  broadcastSSE('INVENTORY_UPDATED', { menuId: numericMenuId, recipeUpdated: true });
  return await getRecipeByMenuId(numericMenuId);
}

module.exports = {
  getInventoryList,
  verifyStockAvailability,
  deductStockForOrder,
  restockItem,
  deductIngredientsForOrder,
  syncMenuAvailability,
  checkMenuAvailability,
  restockIngredient,
  listIngredients,
  getIngredientsGrouped,
  createIngredient,
  getRecipeByMenuId,
  upsertRecipeForMenuItem
};
