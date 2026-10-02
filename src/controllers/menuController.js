/**
 * Menu Management Controller (FR2, FR8)
 * Handles menu categories, items, pricing, images, and availability.
 */

const db = require('../../database/db');
const { broadcastSSE } = require('../services/notificationService');

/**
 * Get all categories with their associated menu items and stock
 */
async function getMenu(req, res) {
  try {
    const [categories] = await db.query(
      `SELECT * FROM categories WHERE is_active = 1 ORDER BY display_order ASC`
    );

    const [items] = await db.query(`
      SELECT 
        m.id,
        m.category_id,
        m.name,
        m.description,
        m.price,
        m.image_url,
        m.is_available,
        m.is_bestseller,
        m.preparation_time_min,
        i.stock_quantity,
        i.low_stock_threshold,
        i.unit
      FROM menu_items m
      LEFT JOIN inventory i ON m.id = i.menu_item_id
      ORDER BY m.is_bestseller DESC, m.name ASC
    `);

    // Group items under categories
    const menu = categories.map(cat => ({
      ...cat,
      items: items.filter(item => item.category_id === cat.id)
    }));

    return res.json({ success: true, categories: menu, allItems: items });
  } catch (err) {
    console.error('[Menu Controller Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve menu.' });
  }
}

/**
 * Create a new menu item
 */
async function createMenuItem(req, res) {
  try {
    const {
      categoryId,
      name,
      description = '',
      price,
      imageUrl = '',
      isAvailable = 1,
      isBestseller = 0,
      prepTimeMin = 15,
      initialStock = 20,
      unit = 'servings'
    } = req.body;

    if (!categoryId || !name || price === undefined) {
      return res.status(400).json({ success: false, message: 'Category, item name, and price are required.' });
    }

    const [result] = await db.query(
      `INSERT INTO menu_items (category_id, name, description, price, image_url, is_available, is_bestseller, preparation_time_min)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [categoryId, name.trim(), description.trim(), parseFloat(price), imageUrl.trim(), isAvailable ? 1 : 0, isBestseller ? 1 : 0, parseInt(prepTimeMin, 10)]
    );

    const menuItemId = result.insertId;

    // Create corresponding inventory record
    await db.query(
      `INSERT INTO inventory (menu_item_id, stock_quantity, low_stock_threshold, unit, last_restocked_at)
       VALUES (?, ?, 10, ?, CURRENT_TIMESTAMP)`,
      [menuItemId, parseInt(initialStock, 10), unit.trim()]
    );

    broadcastSSE('MENU_UPDATED', { action: 'CREATED', menuItemId, name });

    return res.status(201).json({
      success: true,
      message: 'Menu item created successfully.',
      menuItemId
    });
  } catch (err) {
    console.error('[Menu Create Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to create menu item.' });
  }
}

/**
 * Update an existing menu item
 */
async function updateMenuItem(req, res) {
  try {
    const { id } = req.params;
    const {
      categoryId,
      name,
      description,
      price,
      imageUrl,
      isAvailable,
      isBestseller,
      prepTimeMin
    } = req.body;

    await db.query(
      `UPDATE menu_items 
       SET category_id = COALESCE(?, category_id),
           name = COALESCE(?, name),
           description = COALESCE(?, description),
           price = COALESCE(?, price),
           image_url = COALESCE(?, image_url),
           is_available = COALESCE(?, is_available),
           is_bestseller = COALESCE(?, is_bestseller),
           preparation_time_min = COALESCE(?, preparation_time_min),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [categoryId, name, description, price, imageUrl, isAvailable, isBestseller, prepTimeMin, id]
    );

    broadcastSSE('MENU_UPDATED', { action: 'UPDATED', menuItemId: id, name });

    return res.json({ success: true, message: 'Menu item updated successfully.' });
  } catch (err) {
    console.error('[Menu Update Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to update menu item.' });
  }
}

/**
 * Toggle Item Availability on/off
 */
async function toggleAvailability(req, res) {
  try {
    const { id } = req.params;
    const [rows] = await db.query(`SELECT is_available FROM menu_items WHERE id = ?`, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Menu item not found.' });
    }

    const newStatus = rows[0].is_available ? 0 : 1;
    await db.query(`UPDATE menu_items SET is_available = ? WHERE id = ?`, [newStatus, id]);

    broadcastSSE('MENU_UPDATED', { action: 'AVAILABILITY_TOGGLED', menuItemId: id, isAvailable: newStatus });

    return res.json({ success: true, message: `Item availability set to ${newStatus ? 'Available' : 'Unavailable'}.`, isAvailable: newStatus });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to toggle item availability.' });
  }
}

/**
 * Delete Menu Item
 */
async function deleteMenuItem(req, res) {
  try {
    const { id } = req.params;
    await db.query(`DELETE FROM menu_items WHERE id = ?`, [id]);
    broadcastSSE('MENU_UPDATED', { action: 'DELETED', menuItemId: id });
    return res.json({ success: true, message: 'Menu item deleted successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to delete menu item.' });
  }
}

module.exports = {
  getMenu,
  createMenuItem,
  updateMenuItem,
  toggleAvailability,
  deleteMenuItem
};
