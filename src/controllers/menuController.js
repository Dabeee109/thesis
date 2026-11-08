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
        COALESCE(m.stock_quantity, i.stock_quantity, 0) AS stock_quantity,
        COALESCE(i.low_stock_threshold, 10) AS low_stock_threshold,
        COALESCE(i.unit, 'servings') AS unit
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
      category_id,
      name,
      description = '',
      price,
      imageUrl = '',
      image_url = '',
      isAvailable,
      is_available,
      isBestseller = 0,
      is_bestseller = 0,
      prepTimeMin = 15,
      preparation_time_min,
      initialStock,
      stock_quantity,
      stockQuantity,
      unit = 'servings'
    } = req.body;

    const catId = categoryId || category_id;
    if (!catId || !name || price === undefined) {
      return res.status(400).json({ success: false, message: 'Category, item name, and price are required.' });
    }

    let finalStock = stock_quantity !== undefined ? parseInt(stock_quantity, 10) : (stockQuantity !== undefined ? parseInt(stockQuantity, 10) : (initialStock !== undefined ? parseInt(initialStock, 10) : 25));
    if (isNaN(finalStock) || finalStock < 0) finalStock = 0;

    let finalAvail = is_available !== undefined ? is_available : (isAvailable !== undefined ? isAvailable : 1);
    if (finalStock <= 0) {
      finalAvail = 0;
    } else {
      finalAvail = (finalAvail === 1 || finalAvail === true || finalAvail === '1' || finalAvail === 'true') ? 1 : 0;
    }

    const finalImage = imageUrl || image_url || '';
    const finalPrep = prepTimeMin !== undefined ? parseInt(prepTimeMin, 10) : (preparation_time_min !== undefined ? parseInt(preparation_time_min, 10) : 15);
    const finalBest = isBestseller || is_bestseller ? 1 : 0;

    const [result] = await db.query(
      `INSERT INTO menu_items (category_id, name, description, price, image_url, is_available, is_bestseller, preparation_time_min, stock_quantity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [catId, name.trim(), description.trim(), parseFloat(price), finalImage.trim(), finalAvail, finalBest, finalPrep, finalStock]
    );

    const menuItemId = result.insertId;

    // Create corresponding inventory record
    try {
      await db.query(
        `INSERT INTO inventory (menu_item_id, stock_quantity, low_stock_threshold, unit, last_restocked_at)
         VALUES (?, ?, 10, ?, CURRENT_TIMESTAMP)`,
        [menuItemId, finalStock, unit.trim()]
      );
    } catch (e) {}

    // Fetch created item
    const [createdRows] = await db.query(
      `SELECT m.*, COALESCE(m.stock_quantity, i.stock_quantity, 0) AS stock_quantity
       FROM menu_items m
       LEFT JOIN inventory i ON m.id = i.menu_item_id
       WHERE m.id = ?`,
      [menuItemId]
    );
    const createdItem = createdRows && createdRows[0] ? createdRows[0] : null;

    broadcastSSE('MENU_UPDATED', { action: 'CREATED', menuItemId, name, item: createdItem });

    return res.status(201).json({
      success: true,
      message: 'Menu item created successfully.',
      menuItemId,
      item: createdItem
    });
  } catch (err) {
    console.error('[Menu Create Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to create menu item.' });
  }
}

/**
 * Update an existing menu item (Requirement 2)
 * Accepts stock_quantity and is_available. If stock_quantity <= 0, automatically sets is_available = false.
 * Returns updated item object on success.
 */
async function updateMenuItem(req, res) {
  try {
    const { id } = req.params;
    const {
      categoryId,
      category_id,
      name,
      description,
      price,
      imageUrl,
      image_url,
      isAvailable,
      is_available,
      isBestseller,
      is_bestseller,
      prepTimeMin,
      preparation_time_min,
      stockQuantity,
      stock_quantity
    } = req.body;

    const [existing] = await db.query('SELECT * FROM menu_items WHERE id = ?', [id]);
    if (!existing || existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Menu item not found.' });
    }
    const current = existing[0];

    const finalCatId = categoryId !== undefined ? categoryId : (category_id !== undefined ? category_id : current.category_id);
    const finalName = name !== undefined ? name.trim() : current.name;
    const finalDesc = description !== undefined ? description : current.description;
    const finalPrice = price !== undefined ? parseFloat(price) : current.price;
    const finalImg = imageUrl !== undefined ? imageUrl : (image_url !== undefined ? image_url : current.image_url);
    const finalPrep = prepTimeMin !== undefined ? parseInt(prepTimeMin, 10) : (preparation_time_min !== undefined ? parseInt(preparation_time_min, 10) : current.preparation_time_min);
    const finalBest = isBestseller !== undefined ? (isBestseller ? 1 : 0) : (is_bestseller !== undefined ? (is_bestseller ? 1 : 0) : current.is_bestseller);

    // Stock quantity handling
    let finalStock = stock_quantity !== undefined ? parseInt(stock_quantity, 10) : (stockQuantity !== undefined ? parseInt(stockQuantity, 10) : (current.stock_quantity !== undefined ? current.stock_quantity : 0));
    if (isNaN(finalStock) || finalStock < 0) finalStock = 0;

    // Availability status: If stock_quantity <= 0, automatically set is_available = false / 0
    let finalAvail;
    if (finalStock <= 0) {
      finalAvail = 0;
    } else {
      const availInput = is_available !== undefined ? is_available : (isAvailable !== undefined ? isAvailable : current.is_available);
      finalAvail = (availInput === 1 || availInput === true || availInput === '1' || availInput === 'true') ? 1 : 0;
    }

    await db.query(
      `UPDATE menu_items 
       SET category_id = ?,
           name = ?,
           description = ?,
           price = ?,
           image_url = ?,
           is_available = ?,
           is_bestseller = ?,
           preparation_time_min = ?,
           stock_quantity = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [finalCatId, finalName, finalDesc, finalPrice, finalImg, finalAvail, finalBest, finalPrep, finalStock, id]
    );

    // Sync inventory table if present
    try {
      await db.query(
        `UPDATE inventory SET stock_quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE menu_item_id = ?`,
        [finalStock, id]
      );
    } catch (e) {}

    // Fetch and return the updated item object
    const [updatedRows] = await db.query(
      `SELECT m.*, COALESCE(m.stock_quantity, i.stock_quantity, 0) AS stock_quantity
       FROM menu_items m
       LEFT JOIN inventory i ON m.id = i.menu_item_id
       WHERE m.id = ?`,
      [id]
    );
    const updatedItem = updatedRows && updatedRows[0] ? updatedRows[0] : null;

    broadcastSSE('MENU_UPDATED', { action: 'UPDATED', menuItemId: id, name: finalName, item: updatedItem });

    return res.json({
      success: true,
      message: 'Menu item updated successfully.',
      item: updatedItem
    });
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
