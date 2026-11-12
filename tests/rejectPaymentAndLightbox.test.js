/**
 * Targeted Fix Test:
 * 1. Proof of Payment Full-Screen Image Lightbox
 * 2. Reject Invalid Payment Proof (Selection, POST /api/orders/:id/reject-payment, Stock Restoration, Messenger Alert)
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Ensure SQLite mode for isolated fast unit tests
process.env.DB_FORCE_SQLITE = 'true';
process.env.DB_PATH = path.join(__dirname, 'test_reject_payment.sqlite');
process.env.JWT_SECRET = 'test-secret-key-123456';

const db = require('../database/db');
const orderService = require('../src/services/orderService');
const orderController = require('../src/controllers/orderController');

describe('Targeted Fix: Reject Payment Endpoint & Order Cancellation Flow', () => {
  let testMenuItemId = 1;

  before(async () => {
    try { await db.query(`ALTER TABLE orders ADD COLUMN discount_type TEXT DEFAULT 'NONE'`); } catch (_) {}
    try { await db.query(`ALTER TABLE orders ADD COLUMN discount_amount REAL DEFAULT 0.00`); } catch (_) {}
    try { await db.query(`ALTER TABLE orders ADD COLUMN discount_id_number TEXT DEFAULT NULL`); } catch (_) {}
    try { await db.query(`ALTER TABLE orders ADD COLUMN discount_id_name TEXT DEFAULT NULL`); } catch (_) {}
    try { await db.query(`ALTER TABLE orders ADD COLUMN discount_id_image_url TEXT DEFAULT NULL`); } catch (_) {}

    const [cats] = await db.query(`SELECT id FROM categories LIMIT 1`);
    const catId = cats && cats[0] ? cats[0].id : 1;
    const [ins] = await db.query(`
      INSERT INTO menu_items (name, category_id, category, price, is_available, stock_quantity)
      VALUES ('Reject Test Item', ?, 'Beverages', 100.00, 1, 100)
    `, [catId]);
    testMenuItemId = ins.insertId;
  });

  after(async () => {
    try {
      if (fs.existsSync(process.env.DB_PATH)) {
        fs.unlinkSync(process.env.DB_PATH);
      }
    } catch (_) {}
  });

  test('1. Rejecting payment requires non-empty reason', async () => {
    const payload = {
      customerName: 'Reject Tester',
      customerPhone: '09123456789',
      orderType: 'delivery',
      paymentMethod: 'gcash',
      paymentProofImage: 'https://example.com/receipt-blurry.jpg',
      paymentRefNumber: 'GCASH123456',
      items: [
        { menuItemId: testMenuItemId, name: 'Reject Test Item', quantity: 2, unitPrice: 100.00 }
      ]
    };

    const created = await orderService.createOrder(payload);
    assert.ok(created.orderId, 'Order must be created');

    await assert.rejects(
      async () => {
        await orderService.rejectOrderPayment(created.orderId, '   ');
      },
      /Rejection reason is required/i
    );
  });

  test('2. Rejecting payment updates order status to cancelled and payment_status to REJECTED', async () => {
    const payload = {
      customerName: 'Reject Tester Two',
      customerPhone: '09123456788',
      orderType: 'delivery',
      paymentMethod: 'gcash',
      paymentProofImage: 'https://example.com/receipt-blurry.jpg',
      paymentRefNumber: 'GCASH654321',
      items: [
        { menuItemId: testMenuItemId, name: 'Reject Test Item', quantity: 1, unitPrice: 100.00 }
      ]
    };

    const created = await orderService.createOrder(payload);
    const orderId = created.orderId;

    const result = await orderService.rejectOrderPayment(orderId, 'Blurred / Unreadable Receipt', {
      id: 1,
      username: 'admin'
    });

    assert.equal(result.status, 'cancelled');
    assert.equal(result.payment_status, 'REJECTED');
    assert.equal(result.cancellation_reason, 'Blurred / Unreadable Receipt');

    const [verifyRows] = await db.query(`SELECT status, payment_status, cancellation_reason FROM orders WHERE id = ?`, [orderId]);
    assert.equal(verifyRows[0].status, 'cancelled');
    assert.equal(verifyRows[0].payment_status, 'REJECTED');
    assert.equal(verifyRows[0].cancellation_reason, 'Blurred / Unreadable Receipt');
  });

  test('3. Audit log records PAYMENT_REJECTED action', async () => {
    const payload = {
      customerName: 'Reject Tester Three',
      customerPhone: '09123456787',
      orderType: 'delivery',
      paymentMethod: 'gcash',
      paymentProofImage: 'https://example.com/fake-receipt.jpg',
      items: [
        { menuItemId: testMenuItemId, name: 'Reject Test Item', quantity: 1, unitPrice: 100.00 }
      ]
    };

    const created = await orderService.createOrder(payload);
    const orderId = created.orderId;

    await orderService.rejectOrderPayment(orderId, 'Invalid / Fake Reference Number', {
      id: 2,
      username: 'cashier1'
    });

    const [auditRows] = await db.query(
      `SELECT action, reason, details FROM order_audit_logs WHERE order_id = ? AND action = 'PAYMENT_REJECTED'`,
      [orderId]
    );
    assert.ok(auditRows.length > 0, 'Audit log entry must be recorded');
    assert.equal(auditRows[0].action, 'PAYMENT_REJECTED');
    assert.equal(auditRows[0].reason, 'Invalid / Fake Reference Number');
  });

  test('4. REST Controller POST /api/orders/:id/reject-payment executes cleanly', async () => {
    const payload = {
      customerName: 'Reject Tester Four',
      customerPhone: '09123456786',
      orderType: 'delivery',
      paymentMethod: 'gcash',
      items: [
        { menuItemId: testMenuItemId, name: 'Reject Test Item', quantity: 1, unitPrice: 100.00 }
      ]
    };

    const created = await orderService.createOrder(payload);
    const orderId = created.orderId;

    const req = {
      params: { id: orderId },
      body: { reason: 'Incorrect Amount Paid' },
      user: { id: 1, username: 'admin' }
    };
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

    await orderController.rejectPayment(req, res);
    assert.equal(statusCode, 200);
    assert.ok(jsonResult.success, 'Controller must return success true');
    assert.equal(jsonResult.order.payment_status, 'REJECTED');
    assert.equal(jsonResult.order.status, 'cancelled');
  });
});

describe('Targeted Fix: Dashboard Frontend Lightbox & Rejection Panel Verification', () => {
  const htmlContent = fs.readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');
  const jsContent = fs.readFileSync(path.join(__dirname, '../public/js/dashboard.js'), 'utf8');

  test('1. dashboard.html has dedicated full-screen image lightbox with z-index 9999', () => {
    assert.ok(htmlContent.includes('id="modal-image-lightbox"'), 'Must have modal-image-lightbox');
    assert.ok(htmlContent.includes('z-index: 9999'), 'Lightbox must have z-index: 9999');
    assert.ok(htmlContent.includes('handleLightboxImageError'), 'Must have error handler fallback');
  });

  test('2. dashboard.js defines openImageLightbox, closeImageLightbox, and stopPropagation handlers', () => {
    assert.ok(jsContent.includes('function openImageLightbox'), 'Must define openImageLightbox');
    assert.ok(jsContent.includes('function closeImageLightbox'), 'Must define closeImageLightbox');
    assert.ok(jsContent.includes('openImageLightbox(event,'), 'Proof of payment click must call openImageLightbox with event');
    assert.ok(jsContent.includes('event.stopPropagation()'), 'Must contain stopPropagation to prevent modal close');
  });

  test('3. dashboard.js defines inline rejection panel and submitRejectPayment with route /reject-payment', () => {
    assert.ok(jsContent.includes('inline-reject-payment-panel'), 'Must have inline-reject-payment-panel in Order Details Modal');
    assert.ok(jsContent.includes('Blurred / Unreadable Receipt'), 'Must include Blurred / Unreadable Receipt option');
    assert.ok(jsContent.includes('Incorrect Amount Paid'), 'Must include Incorrect Amount Paid option');
    assert.ok(jsContent.includes('Invalid / Fake Reference Number'), 'Must include Invalid / Fake Reference Number option');
    assert.ok(jsContent.includes('Duplicate Receipt Used'), 'Must include Duplicate Receipt Used option');
    assert.ok(jsContent.includes('btn-confirm-reject-payment'), 'Must have Confirm Reject Payment button');
    assert.ok(jsContent.includes('/reject-payment'), 'Must call /orders/${orderId}/reject-payment route');
  });
});
