/**
 * Menu Service
 * Manages active menu items, stock status checks, and catalog queries for Chatbot & API.
 */

const db = require('../../database/db');

/**
 * Retrieves all active, in-stock dishes ready for ordering.
 * Filters out HIDDEN dishes or dishes with zero stock.
 */
async function getActiveMenu(categoryId = null) {
  let query = `
    SELECT 
      m.id,
      m.category_id,
      COALESCE(m.category, c.name) AS category,
      m.name,
      m.description,
      m.price,
      m.image_url,
      m.is_available,
      m.is_bestseller,
      m.preparation_time_min,
      COALESCE(m.stock_quantity, i.stock_quantity, 0) AS stock_quantity,
      COALESCE(m.status, CASE WHEN COALESCE(m.stock_quantity, i.stock_quantity, 0) <= 0 THEN 'OUT_OF_STOCK' ELSE 'AVAILABLE' END) AS status,
      c.slug AS category_slug,
      c.display_order
    FROM menu_items m
    LEFT JOIN categories c ON c.id = m.category_id
    LEFT JOIN inventory i ON i.menu_item_id = m.id
    WHERE m.is_available = 1 
      AND COALESCE(m.is_deleted, 0) = 0
      AND (m.status != 'HIDDEN' OR m.status IS NULL)
      AND COALESCE(m.stock_quantity, i.stock_quantity, 0) > 0
  `;
  const params = [];

  if (categoryId) {
    query += ` AND (m.category_id = ? OR c.slug = ?)`;
    params.push(categoryId, categoryId);
  }

  query += ` ORDER BY c.display_order ASC, m.is_bestseller DESC, m.name ASC`;

  const [items] = await db.query(query, params);
  return items || [];
}

/**
 * Check if a specific menu item is available and has adequate stock.
 */
async function checkItemStock(menuItemId, requestedQuantity = 1) {
  const [rows] = await db.query(
    `SELECT m.id, m.name, m.price, m.is_available, m.status,
            COALESCE(m.stock_quantity, i.stock_quantity, 0) AS stock_quantity
     FROM menu_items m
     LEFT JOIN inventory i ON i.menu_item_id = m.id
     WHERE m.id = ? AND COALESCE(m.is_deleted, 0) = 0`,
    [menuItemId]
  );

  if (!rows || rows.length === 0) {
    return { available: false, reason: 'NOT_FOUND', item: null };
  }

  const item = rows[0];
  const stock = Number(item.stock_quantity) || 0;

  if (item.is_available === 0 || item.status === 'HIDDEN' || item.status === 'OUT_OF_STOCK' || stock <= 0) {
    return { available: false, reason: 'OUT_OF_STOCK', item, stock };
  }

  if (stock < requestedQuantity) {
    return { available: false, reason: 'INSUFFICIENT_STOCK', item, stock };
  }

  return { available: true, item, stock };
}

module.exports = {
  getActiveMenu,
  checkItemStock
};

