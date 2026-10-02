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
    // 1. Get current inventory record
    const [invRows] = await db.query(
      `SELECT id, stock_quantity, low_stock_threshold FROM inventory WHERE menu_item_id = ?`,
      [item.menuItemId]
    );

    if (invRows.length > 0) {
      const inv = invRows[0];
      const newStock = Math.max(0, inv.stock_quantity - item.quantity);

      // Update inventory stock
      await db.query(
        `UPDATE inventory SET stock_quantity = ? WHERE id = ?`,
        [newStock, inv.id]
      );

      // Auto-toggle menu item availability if stock hits 0
      if (newStock === 0) {
        await db.query(
          `UPDATE menu_items SET is_available = 0 WHERE id = ?`,
          [item.menuItemId]
        );
      }

      // Log stock deduction in audit trail
      await db.query(
        `INSERT INTO inventory_logs (inventory_id, change_amount, reason, reference_id, logged_by)
         VALUES (?, ?, 'order_placed', ?, 'Order Automation')`,
        [inv.id, -item.quantity, orderNumber]
      );

      // Check if threshold crossed
      if (newStock <= inv.low_stock_threshold) {
        broadcastSSE('STOCK_ALERT', {
          inventoryId: inv.id,
          menuItemId: item.menuItemId,
          newStock,
          threshold: inv.low_stock_threshold,
          alertType: newStock === 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK'
        });
      }
    }
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

module.exports = {
  getInventoryList,
  verifyStockAvailability,
  deductStockForOrder,
  restockItem
};
