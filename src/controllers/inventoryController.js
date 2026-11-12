/**
 * Inventory Management Controller (FR8)
 * Handles stock queries, restock actions, and inventory log audit history.
 */

const {
  getInventoryList,
  restockItem,
  listIngredients,
  createIngredient,
  restockIngredient,
  getRecipeByMenuId,
  upsertRecipeForMenuItem
} = require('../services/inventoryService');
const db = require('../../database/db');

/**
 * Get inventory stock list
 */
async function getInventory(req, res) {
  try {
    const inventory = await getInventoryList();
    return res.json({ success: true, count: inventory.length, inventory });
  } catch (err) {
    console.error('[Inventory Controller Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve inventory.' });
  }
}

/**
 * Restock Item
 */
async function restock(req, res) {
  try {
    const { inventoryId, quantityToAdd, notes } = req.body;

    if (!inventoryId || !quantityToAdd || quantityToAdd <= 0) {
      return res.status(400).json({ success: false, message: 'Valid inventoryId and positive quantityToAdd are required.' });
    }

    const loggedBy = req.user ? req.user.name : 'Admin';
    const result = await restockItem(inventoryId, quantityToAdd, loggedBy, notes);

    return res.json({ success: true, message: `Successfully restocked ${quantityToAdd} units.`, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to restock item.' });
  }
}

/**
 * Get Inventory Audit Logs
 */
async function getInventoryLogs(req, res) {
  try {
    const [logs] = await db.query(`
      SELECT 
        l.*,
        m.name AS item_name,
        c.name AS category_name
      FROM inventory_logs l
      JOIN inventory i ON l.inventory_id = i.id
      JOIN menu_items m ON i.menu_item_id = m.id
      JOIN categories c ON m.category_id = c.id
      ORDER BY l.created_at DESC
      LIMIT 100
    `);

    return res.json({ success: true, logs });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to retrieve inventory logs.' });
  }
}

/**
 * GET /api/inventory/ingredients
 * List all raw ingredients, units, stock levels, and low-stock flags (stock_quantity <= reorder_level).
 */
async function getIngredients(req, res) {
  try {
    const ingredients = await listIngredients();
    const lowStockCount = ingredients.filter(i => i.is_low_stock).length;
    return res.json({
      success: true,
      count: ingredients.length,
      lowStockCount,
      ingredients
    });
  } catch (err) {
    console.error('[Inventory Ingredients List Error]', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to list ingredients.' });
  }
}

/**
 * POST /api/inventory/ingredients
 * Create a new raw ingredient record.
 */
async function addIngredient(req, res) {
  try {
    const { name, unit, stock_quantity, reorder_level, cost_per_unit } = req.body || {};
    if (!name || !unit) {
      return res.status(400).json({ success: false, message: 'name and unit are required.' });
    }
    const ingredient = await createIngredient({ name, unit, stock_quantity, reorder_level, cost_per_unit });
    return res.status(201).json({ success: true, ingredient });
  } catch (err) {
    const status = /UNIQUE|Duplicate/i.test(err.message || '') ? 409 : 400;
    return res.status(status).json({ success: false, message: err.message || 'Failed to add ingredient.' });
  }
}

/**
 * PATCH /api/inventory/ingredients/:id/restock
 * Atomically restock a raw ingredient and record a 'restock' log entry.
 */
async function restockRawIngredient(req, res) {
  try {
    const ingredientId = parseInt(req.params.id, 10);
    const amount = Number(req.body?.amount ?? req.body?.quantityToAdd);
    const costPerUnit = req.body?.cost_per_unit ?? req.body?.costPerUnit ?? null;

    if (!ingredientId || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid ingredient id and positive amount are required.' });
    }

    const result = await restockIngredient(ingredientId, amount, costPerUnit);
    return res.json({ success: true, message: `Restocked ${amount} ${result.unit} of ${result.name}.`, ...result });
  } catch (err) {
    const status = /not found/i.test(err.message || '') ? 404 : 400;
    return res.status(status).json({ success: false, message: err.message || 'Failed to restock ingredient.' });
  }
}

/**
 * GET /api/inventory/recipes/:menuId
 * View recipe/ingredients required for a menu item.
 */
async function getRecipe(req, res) {
  try {
    const menuId = parseInt(req.params.menuId, 10);
    if (!menuId) {
      return res.status(400).json({ success: false, message: 'Valid menuId parameter is required.' });
    }
    const data = await getRecipeByMenuId(menuId);
    return res.json({ success: true, ...data });
  } catch (err) {
    const status = /not found/i.test(err.message || '') ? 404 : 500;
    return res.status(status).json({ success: false, message: err.message || 'Failed to load recipe.' });
  }
}

/**
 * POST /api/inventory/recipes
 * Map or update recipe ingredients for a menu item.
 */
async function saveRecipe(req, res) {
  try {
    const menuId = parseInt(req.body?.menu_id ?? req.body?.menuId, 10);
    const items = req.body?.items;
    if (!menuId || !Array.isArray(items)) {
      return res.status(400).json({ success: false, message: 'menu_id and items array are required.' });
    }
    const updated = await upsertRecipeForMenuItem(menuId, items);
    return res.json({ success: true, ...updated });
  } catch (err) {
    const status = /not found/i.test(err.message || '') ? 404 : 400;
    return res.status(status).json({ success: false, message: err.message || 'Failed to save recipe.' });
  }
}

module.exports = {
  getInventory,
  restock,
  getInventoryLogs,
  getIngredients,
  addIngredient,
  restockRawIngredient,
  getRecipe,
  saveRecipe
};
