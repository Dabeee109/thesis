/**
 * Inventory Management Controller (FR8)
 * Handles stock queries, restock actions, and inventory log audit history.
 */

const { getInventoryList, restockItem } = require('../services/inventoryService');
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

module.exports = {
  getInventory,
  restock,
  getInventoryLogs
};
