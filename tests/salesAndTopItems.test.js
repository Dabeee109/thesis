const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

process.env.DB_FORCE_SQLITE = 'true';
process.env.SQLITE_DB_PATH = path.join(__dirname, 'test_sales_kpi.sqlite');

const db = require('../database/db');
const orderController = require('../src/controllers/orderController');
const reportController = require('../src/controllers/reportController');

test("Today's Gross Sales & Top Selling Menu Items Reports", async (t) => {
  // Setup database tables
  await db.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      category_id INTEGER REFERENCES categories(id)
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT UNIQUE NOT NULL,
      customer_id INTEGER DEFAULT 1,
      order_type TEXT DEFAULT 'pickup',
      status TEXT DEFAULT 'pending',
      subtotal REAL DEFAULT 0.00,
      delivery_fee REAL DEFAULT 0.00,
      total_amount REAL DEFAULT 0.00,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
      item_name TEXT NOT NULL,
      unit_price REAL NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      subtotal REAL NOT NULL
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      payment_method TEXT DEFAULT 'cash',
      amount_paid REAL DEFAULT 0.00,
      is_mismatch INTEGER DEFAULT 0,
      status TEXT DEFAULT 'verified'
    );
  `);

  await db.query(`DELETE FROM order_items;`);
  await db.query(`DELETE FROM payments;`);
  await db.query(`DELETE FROM orders;`);
  await db.query(`DELETE FROM menu_items;`);
  await db.query(`DELETE FROM categories;`);

  // Insert test category and items
  await db.query(`INSERT INTO categories (id, name, slug) VALUES (1, 'Drinks & Milktea', 'drinks-milktea')`);
  await db.query(`INSERT INTO menu_items (id, name, price, category, category_id) VALUES (10, 'Signature Spanish Latte', 145.00, 'Drinks & Milktea', 1)`);
  await db.query(`INSERT INTO menu_items (id, name, price, category, category_id) VALUES (20, 'Caramel Macchiato', 155.00, 'Drinks & Milktea', 1)`);

  // Insert delivered order today
  const [ordResult] = await db.query(`
    INSERT INTO orders (id, order_number, customer_id, order_type, status, subtotal, delivery_fee, total_amount, created_at)
    VALUES (101, 'DNR-20261109-1419', 1, 'pickup', 'delivered', 478.00, 0.00, 478.00, datetime('now'))
  `);

  await db.query(`
    INSERT INTO order_items (order_id, menu_item_id, item_name, unit_price, quantity, subtotal)
    VALUES (101, 10, 'Signature Spanish Latte', 145.00, 2, 290.00)
  `);

  await db.query(`
    INSERT INTO order_items (order_id, menu_item_id, item_name, unit_price, quantity, subtotal)
    VALUES (101, 20, 'Caramel Macchiato', 155.00, 1, 155.00)
  `);

  await db.query(`
    INSERT INTO payments (order_id, payment_method, amount_expected, amount_paid, is_mismatch, status)
    VALUES (101, 'cash', 478.00, 478.00, 0, 'verified')
  `);

  await t.test("1. getSummaryKPIs computes Today's Gross Sales with UTC+8 timezone alignment", async () => {
    let responseData = null;
    const req = {};
    const res = {
      json: (data) => {
        responseData = data;
        return data;
      },
      status: () => res
    };

    await orderController.getSummaryKPIs(req, res);

    assert.ok(responseData);
    assert.equal(responseData.success, true);
    assert.equal(responseData.kpi.todays_gross_sales, 478.00);
    assert.equal(responseData.kpi.totalRevenueToday, 478.00);
    assert.equal(responseData.todays_gross_sales, 478.00);
  });

  await t.test("2. getSalesReport populates Top Selling Menu Items with units_sold and revenue", async () => {
    let responseData = null;
    const req = { query: {} };
    const res = {
      json: (data) => {
        responseData = data;
        return data;
      },
      status: () => res
    };

    await reportController.getSalesReport(req, res);

    assert.ok(responseData);
    assert.equal(responseData.success, true);
    assert.ok(Array.isArray(responseData.topItems));
    assert.equal(responseData.topItems.length, 2);

    const top1 = responseData.topItems[0];
    assert.equal(top1.item_name, 'Signature Spanish Latte');
    assert.equal(top1.units_sold, 2);
    assert.equal(top1.total_units_sold, 2);
    assert.equal(top1.revenue, 290.00);
    assert.equal(top1.total_revenue, 290.00);
    assert.equal(top1.category, 'Drinks & Milktea');

    const top2 = responseData.topItems[1];
    assert.equal(top2.item_name, 'Caramel Macchiato');
    assert.equal(top2.units_sold, 1);
    assert.equal(top2.revenue, 155.00);
  });
});
