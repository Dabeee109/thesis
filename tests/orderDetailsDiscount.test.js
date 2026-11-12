const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

// Ensure SQLite mode for isolated fast unit tests
process.env.DB_FORCE_SQLITE = 'true';
process.env.DB_PATH = path.join(__dirname, 'test_order_discount.sqlite');
process.env.JWT_SECRET = 'test-secret-key-123456';

const db = require('../database/db');
const orderService = require('../src/services/orderService');
const orderController = require('../src/controllers/orderController');

describe('Order Details Discount & ID Verification Breakdown Suite', () => {
  let testMenuItemId = 1;

  before(async () => {
    // Ensure migrations in sqlite
    try { await db.query(`ALTER TABLE orders ADD COLUMN discount_type TEXT DEFAULT 'NONE'`); } catch (_) {}
    try { await db.query(`ALTER TABLE orders ADD COLUMN discount_amount REAL DEFAULT 0.00`); } catch (_) {}
    try { await db.query(`ALTER TABLE orders ADD COLUMN discount_id_number TEXT DEFAULT NULL`); } catch (_) {}
    try { await db.query(`ALTER TABLE orders ADD COLUMN discount_id_name TEXT DEFAULT NULL`); } catch (_) {}
    try { await db.query(`ALTER TABLE orders ADD COLUMN discount_id_image_url TEXT DEFAULT NULL`); } catch (_) {}

    // Insert dedicated test menu item priced at 119.00 with sufficient stock
    const [cats] = await db.query(`SELECT id FROM categories LIMIT 1`);
    const catId = cats && cats[0] ? cats[0].id : 1;
    const [ins] = await db.query(`
      INSERT INTO menu_items (name, category_id, category, price, is_available, stock_quantity)
      VALUES ('Matcha Milktea Discount Test', ?, 'Milktea', 119.00, 1, 100)
    `, [catId]);
    testMenuItemId = ins.insertId;
  });

  after(async () => {
    // Clean up test sqlite file if needed
    try {
      if (fs.existsSync(process.env.DB_PATH)) {
        fs.unlinkSync(process.env.DB_PATH);
      }
    } catch (_) {}
  });

  test('1. createOrder stores discount attributes and calculates: Total = (Subtotal - Discount) + Delivery Fee', async () => {
    // Subtotal: 119.00
    // Discount: 23.80 (20% Senior Citizen)
    // Delivery Fee: 0 (Dine-in / Pickup)
    // Expected Total: 95.20
    const payload = {
      customerName: 'Francis Fernandez',
      customerPhone: '09171234567',
      orderType: 'pickup',
      dining_mode: 'Dine-In',
      items: [
        {
          menuItemId: testMenuItemId,
          name: 'Matcha Milktea (w/ Pearls)',
          quantity: 1,
          unitPrice: 119.00
        }
      ],
      discount_type: 'SENIOR_CITIZEN',
      discount_amount: 23.80,
      discount_id_number: '12345678',
      discount_id_name: 'Francis Fernandez',
      discount_id_image_url: 'https://example.com/proofs/sc_id_12345678.jpg',
      deliveryFee: 0.00
    };

    const created = await orderService.createOrder(payload);

    assert.ok(created.orderId, 'Order must have an ID');
    assert.ok(created.orderNumber, 'Order must have an order number');
    assert.equal(created.discount_type, 'SENIOR_CITIZEN');
    assert.equal(created.discount_amount, 23.80);
    assert.equal(created.discount_id_number, '12345678');
    assert.equal(created.discount_id_name, 'Francis Fernandez');
    assert.equal(created.discount_id_image_url, 'https://example.com/proofs/sc_id_12345678.jpg');
    assert.equal(created.totalAmount, 95.20);
    assert.equal(created.total_amount, 95.20);
  });

  test('2. getOrderDetails returns persisted discount fields and accurate computation', async () => {
    const payload = {
      customerName: 'Maria Santos',
      customerPhone: '09189876543',
      orderType: 'delivery',
      deliveryAddress: 'Block 4 Lot 10 Sampaguita St.',
      deliveryFee: 50.00,
      items: [
        {
          menuItemId: testMenuItemId,
          name: 'Matcha Milktea (w/ Pearls)',
          quantity: 2,
          unitPrice: 119.00 // Subtotal = 238.00
        }
      ],
      discount_type: 'PWD',
      discount_amount: 47.60, // 20% of 238.00
      discount_id_number: 'PWD-2026-9999',
      discount_id_name: 'Maria Santos',
      discount_id_image_url: 'https://example.com/proofs/pwd_id.png'
    };

    const created = await orderService.createOrder(payload);
    const details = await orderService.getOrderDetails(created.orderId);

    assert.ok(details, 'Order details must be found');
    assert.equal(details.discount_type, 'PWD');
    assert.equal(Number(details.discount_amount), 47.60);
    assert.equal(details.discount_id_number, 'PWD-2026-9999');
    assert.equal(details.discount_id_name, 'Maria Santos');
    assert.equal(details.discount_id_image_url, 'https://example.com/proofs/pwd_id.png');

    // Subtotal: 238.00 - Discount: 47.60 + Delivery: 50.00 = 240.40
    assert.equal(Number(details.total_amount), 240.40);
  });

  test('3. Discount is never deducted from delivery fee and prevents negative totals', async () => {
    const payload = {
      customerName: 'Juan Dela Cruz',
      customerPhone: '09191112233',
      orderType: 'delivery',
      deliveryFee: 60.00,
      items: [
        {
          menuItemId: testMenuItemId,
          name: 'Matcha Milktea',
          quantity: 1,
          unitPrice: 119.00
        }
      ],
      discount_type: 'SENIOR_CITIZEN',
      discount_amount: 500.00 // Over-stated discount attempting to wipe delivery fee
    };

    const created = await orderService.createOrder(payload);
    const details = await orderService.getOrderDetails(created.orderId);

    // Discount must be capped at Subtotal (119.00)
    assert.equal(Number(details.discount_amount), 119.00);
    // Total Amount = (119 - 119) + 60.00 delivery fee = 60.00
    assert.equal(Number(details.total_amount), 60.00);
  });

  test('4. REST Controller GET /api/orders/:id returns the complete discount payload', async () => {
    const payload = {
      customerName: 'Lola Remedios',
      customerPhone: '09170001122',
      orderType: 'pickup',
      items: [
        {
          menuItemId: testMenuItemId,
          name: 'Matcha Milktea (w/ Pearls)',
          quantity: 1,
          unitPrice: 119.00
        }
      ],
      discount_type: 'SENIOR_CITIZEN',
      discount_amount: 23.80,
      discount_id_number: 'OSCA-654321',
      discount_id_name: 'Remedios Santos',
      discount_id_image_url: 'https://example.com/osca.jpg'
    };

    const created = await orderService.createOrder(payload);

    // Mock Express req and res
    const req = { params: { id: created.orderId } };
    let jsonResult = null;
    let statusCode = 200;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        jsonResult = data;
        return this;
      }
    };

    await orderController.getOrder(req, res);

    assert.equal(statusCode, 200);
    assert.ok(jsonResult.success);
    assert.ok(jsonResult.order);
    assert.equal(jsonResult.order.discount_type, 'SENIOR_CITIZEN');
    assert.equal(Number(jsonResult.order.discount_amount), 23.80);
    assert.equal(jsonResult.order.discount_id_number, 'OSCA-654321');
    assert.equal(jsonResult.order.discount_id_name, 'Remedios Santos');
    assert.equal(jsonResult.order.discount_id_image_url, 'https://example.com/osca.jpg');
    assert.equal(Number(jsonResult.order.total_amount), 95.20);
  });

  test('5. Non-discounted order defaults gracefully to NONE and 0.00 discount_amount', async () => {
    const payload = {
      customerName: 'Regular Customer',
      customerPhone: '09178889900',
      orderType: 'pickup',
      items: [
        {
          menuItemId: testMenuItemId,
          name: 'Matcha Milktea (w/ Pearls)',
          quantity: 1,
          unitPrice: 119.00
        }
      ]
    };

    const created = await orderService.createOrder(payload);
    const details = await orderService.getOrderDetails(created.orderId);

    assert.equal(details.discount_type, 'NONE');
    assert.equal(Number(details.discount_amount), 0.00);
    assert.equal(details.discount_id_number, null);
    assert.equal(Number(details.total_amount), 119.00);
  });
});
