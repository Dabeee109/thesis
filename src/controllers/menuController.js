/**
 * Menu Management Controller (FR2, FR8)
 * Handles menu categories, items, pricing, images, and availability.
 */

const path = require('path');
const fs = require('fs');
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
      WHERE COALESCE(m.is_deleted, 0) = 0
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
 * Safely handles items with past order history via soft-delete to preserve receipts,
 * while cleanly hard-deleting unreferenced items.
 */
async function deleteMenuItem(req, res) {
  try {
    const { id } = req.params;

    // Verify item exists
    const [existing] = await db.query(`SELECT id, name FROM menu_items WHERE id = ?`, [id]);
    if (!existing || existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Menu item not found.' });
    }

    const itemName = existing[0].name;

    // Check if the item is referenced in any customer orders
    const [orderRefs] = await db.query(
      `SELECT COUNT(*) AS count FROM order_items WHERE menu_item_id = ?`,
      [id]
    );
    const refCount = orderRefs && orderRefs[0] ? (orderRefs[0].count || orderRefs[0]['COUNT(*)'] || 0) : 0;

    if (refCount === 0) {
      // No past order history: perform clean hard delete
      try {
        const [invRows] = await db.query(`SELECT id FROM inventory WHERE menu_item_id = ?`, [id]);
        if (invRows && invRows.length > 0) {
          const invId = invRows[0].id;
          await db.query(`DELETE FROM inventory_logs WHERE inventory_id = ?`, [invId]).catch(() => {});
          await db.query(`DELETE FROM inventory WHERE id = ?`, [invId]).catch(() => {});
        }
        await db.query(`DELETE FROM menu_items WHERE id = ?`, [id]);
      } catch (hardDelErr) {
        console.warn(`[Menu Delete] Hard delete rejected (${hardDelErr.message}), falling back to soft delete.`);
        await db.query(`UPDATE menu_items SET is_deleted = 1, is_available = 0 WHERE id = ?`, [id]);
        await db.query(`DELETE FROM inventory WHERE menu_item_id = ?`, [id]).catch(async () => {
          await db.query(`UPDATE inventory SET stock_quantity = 0 WHERE menu_item_id = ?`, [id]).catch(() => {});
        });
      }
    } else {
      // Historical orders reference this item: soft-delete to preserve receipt integrity and prevent FK violation
      await db.query(
        `UPDATE menu_items SET is_deleted = 1, is_available = 0 WHERE id = ?`,
        [id]
      );
      // Remove or zero out active inventory so it doesn't appear in low-stock or active inventory tables
      await db.query(`DELETE FROM inventory WHERE menu_item_id = ?`, [id]).catch(async () => {
        await db.query(`UPDATE inventory SET stock_quantity = 0 WHERE menu_item_id = ?`, [id]).catch(() => {});
      });
    }

    broadcastSSE('MENU_UPDATED', { action: 'DELETED', menuItemId: id, name: itemName });
    return res.json({ success: true, message: 'Menu item deleted successfully.' });
  } catch (err) {
    console.error('[Menu Delete Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to delete menu item.' });
  }
}

/**
 * Upload an image from device for a menu item
 */
async function uploadMenuImage(req, res) {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ success: false, message: 'Image data is required.' });
    }

    const uploadsDir = path.join(__dirname, '../../public/uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const matches = imageBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    let ext = 'jpg';
    let buffer;

    if (matches && matches.length === 3) {
      const mime = matches[1].toLowerCase();
      if (mime.includes('png')) ext = 'png';
      else if (mime.includes('webp')) ext = 'webp';
      else if (mime.includes('gif')) ext = 'gif';
      else ext = 'jpg';
      buffer = Buffer.from(matches[2], 'base64');
    } else {
      buffer = Buffer.from(imageBase64, 'base64');
    }

    // Limit image file size to 8MB
    if (buffer.length > 8 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: 'Image file size exceeds limit of 8MB.' });
    }

    const filename = `menu_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
    const filePath = path.join(uploadsDir, filename);
    fs.writeFileSync(filePath, buffer);

    const imageUrl = `/uploads/${filename}`;
    return res.json({
      success: true,
      imageUrl,
      message: 'Image uploaded successfully.'
    });
  } catch (err) {
    console.error('[Menu Image Upload Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to upload image.' });
  }
}

module.exports = {
  getMenu,
  createMenuItem,
  updateMenuItem,
  toggleAvailability,
  deleteMenuItem,
  uploadMenuImage
};
