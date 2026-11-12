/**
 * Inventory Management Controller (FR8)
 * Handles stock queries, restock actions, and inventory log audit history.
 */

const {
  getInventoryList,
  restockItem,
  listIngredients,
  getIngredientsGrouped,
  createIngredient,
  restockIngredient,
  getRecipeByMenuId,
  upsertRecipeForMenuItem
} = require('../services/inventoryService');
const db = require('../../database/db');

/**
 * GET /api/inventory
 * Returns all raw ingredients grouped by category, units ('g', 'ml', 'pcs'),
 * current stock, reorder levels, and low-stock flags.
 */
async function getInventory(req, res) {
  try {
    const data = await getIngredientsGrouped();
    return res.json({
      success: true,
      count: data.ingredients.length,
      lowStockCount: data.lowStockCount,
      ingredients: data.ingredients,
      groupedByCategory: data.groupedByCategory,
      categories: data.groupedByCategory,
      inventory: data.ingredients
    });
  } catch (err) {
    console.error('[Inventory Controller Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve inventory.' });
  }
}

/**
 * POST /api/inventory/restock
 * Add stock (+amount) to a raw ingredient and record a 'restock' entry in ingredient_logs.
 */
async function restock(req, res) {
  try {
    const {
      ingredient_id,
      ingredientId,
      amount,
      quantityToAdd,
      cost_per_unit,
      costPerUnit,
      notes,
      inventoryId
    } = req.body || {};

    const targetIngId = parseInt(ingredient_id ?? ingredientId, 10);
    const addAmount = Number(amount ?? quantityToAdd);

    if (targetIngId) {
      if (!Number.isFinite(addAmount) || addAmount <= 0) {
        return res.status(400).json({ success: false, message: 'Valid positive amount is required.' });
      }
      const result = await restockIngredient(
        targetIngId,
        addAmount,
        cost_per_unit ?? costPerUnit ?? null,
        notes || 'Manual Restock via Dashboard'
      );
      return res.json({
        success: true,
        message: `Restocked +${addAmount} ${result.unit} of ${result.name}.`,
        ...result
      });
    }

    if (!inventoryId || !Number.isFinite(addAmount) || addAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid ingredient_id and positive amount are required.'
      });
    }

    const loggedBy = req.user ? req.user.name : 'Admin';
    const result = await restockItem(inventoryId, addAmount, loggedBy, notes);

    return res.json({ success: true, message: `Successfully restocked ${addAmount} units.`, ...result });
  } catch (err) {
    const status = /not found/i.test(err.message || '') ? 404 : 500;
    return res.status(status).json({ success: false, message: err.message || 'Failed to restock item.' });
  }
}

/**
 * GET /api/inventory/logs
 * Get BOM Ingredient Stock Audit Logs
 */
async function getInventoryLogs(req, res) {
  try {
    const [logs] = await db.query(`
      SELECT 
        l.log_id,
        l.ingredient_id,
        i.name AS ingredient_name,
        i.category,
        i.unit,
        l.change_amount,
        l.change_type,
        l.reference_order_id,
        l.notes,
        l.created_at
      FROM ingredient_logs l
      JOIN ingredients i ON l.ingredient_id = i.ingredient_id
      ORDER BY l.created_at DESC
      LIMIT 100
    `);

    return res.json({ success: true, logs });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to retrieve ingredient logs.' });
  }
}

/**
 * GET /api/inventory/ingredients
 * List all raw ingredients, categories, units, stock levels, and low-stock flags.
 */
async function getIngredients(req, res) {
  try {
    const data = await getIngredientsGrouped();
    return res.json({
      success: true,
      count: data.ingredients.length,
      lowStockCount: data.lowStockCount,
      groupedByCategory: data.groupedByCategory,
      ingredients: data.ingredients
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
    const { name, category, unit, stock_quantity, reorder_level, cost_per_unit } = req.body || {};
    if (!name || !unit) {
      return res.status(400).json({ success: false, message: 'name and unit are required.' });
    }
    const ingredient = await createIngredient({ name, category, unit, stock_quantity, reorder_level, cost_per_unit });
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
    const notes = req.body?.notes || 'Manual Restock via Dashboard';

    if (!ingredientId || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid ingredient id and positive amount are required.' });
    }

    const result = await restockIngredient(ingredientId, amount, costPerUnit, notes);
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
