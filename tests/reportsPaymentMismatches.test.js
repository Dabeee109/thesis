const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../database/db');
const reportController = require('../src/controllers/reportController');

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

test('Reports & Business Analytics (FR10) Payment Mismatches & Reconciliation Log', async (t) => {
  await db.initDatabase();

  let customerId;
  const createdOrderIds = [];

  await t.test('Setup test customer and verified + mismatched orders (including cancelled/held)', async () => {
    const [custRes] = await db.query(
      `INSERT INTO customers (psid, first_name, last_name, phone_number) VALUES (?, ?, ?, ?)`,
      [`TEST_MISMATCH_PSID_${Date.now()}`, 'Juan', 'Dela Cruz', '09171234567']
    );
    customerId = custRes.insertId;

    // 1. Verified Paid GCash Order (₱150.00)
    const [ord1] = await db.query(
      `INSERT INTO orders (order_number, customer_id, order_type, status, subtotal, delivery_fee, total_amount, payment_status, payment_ref_number, created_at)
       VALUES (?, ?, 'delivery', 'delivered', 150, 0, 150, 'Paid', 'GCASH-OK-1001', '2026-11-14 01:00:00')`,
      [`DNR-TEST-OK-${Date.now()}`, customerId]
    );
    createdOrderIds.push(ord1.insertId);
    await db.query(
      `INSERT INTO payments (order_id, payment_method, amount_expected, amount_paid, reference_no, status, is_mismatch)
       VALUES (?, 'gcash', 150, 150, 'GCASH-OK-1001', 'verified', 0)`,
      [ord1.insertId]
    );

    // 2. Short-paid GCash Order held for review (Expected ₱200.00, Paid ₱150.00 -> -₱50.00 Short)
    const [ord2] = await db.query(
      `INSERT INTO orders (order_number, customer_id, order_type, status, subtotal, delivery_fee, total_amount, payment_status, payment_ref_number, created_at)
       VALUES (?, ?, 'delivery', 'pending', 200, 0, 200, 'MISMATCH', 'GCASH-SHORT-2002', '2026-11-14 02:00:00')`,
      [`DNR-TEST-SHORT-${Date.now()}`, customerId]
    );
    createdOrderIds.push(ord2.insertId);
    await db.query(
      `INSERT INTO payments (order_id, payment_method, amount_expected, amount_paid, reference_no, status, is_mismatch, mismatch_notes)
       VALUES (?, 'gcash', 200, 150, 'GCASH-SHORT-2002', 'mismatch_flagged', 1, 'Short payment of ₱50.00')`,
      [ord2.insertId]
    );

    // 3. Rejected & Cancelled GCash Order (Expected ₱180.00, Paid ₱0.00 -> Cancelled after rejection)
    const [ord3] = await db.query(
      `INSERT INTO orders (order_number, customer_id, order_type, status, subtotal, delivery_fee, total_amount, payment_status, cancellation_reason, payment_ref_number, created_at)
       VALUES (?, ?, 'delivery', 'cancelled', 180, 0, 180, 'REJECTED', 'Invalid / blurry GCash receipt', 'GCASH-REJ-3003', '2026-11-14 03:00:00')`,
      [`DNR-TEST-REJ-${Date.now()}`, customerId]
    );
    createdOrderIds.push(ord3.insertId);
    await db.query(
      `INSERT INTO payments (order_id, payment_method, amount_expected, amount_paid, reference_no, status, is_mismatch, mismatch_notes)
       VALUES (?, 'gcash', 180, 0, 'GCASH-REJ-3003', 'mismatch_flagged', 1, 'Invalid / blurry GCash receipt')`,
      [ord3.insertId]
    );
  });

  await t.test('getSalesReport counts only verified orders in revenue/transactions while surfacing all mismatches (including cancelled/held)', async () => {
    const req = { query: { startDate: '2026-11-14', endDate: '2026-11-14' } };
    const res = createMockRes();
    await reportController.getSalesReport(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);

    const gcashRow = (res.body.paymentBreakdown || []).find(r => r.payment_method === 'gcash');
    assert.ok(gcashRow, 'GCash row should be present in paymentBreakdown');
    assert.ok(Number(gcashRow.mismatch_count) >= 2, `Expected at least 2 GCash mismatches, got ${gcashRow.mismatch_count}`);
    assert.ok(Number(res.body.overall.payment_mismatches) >= 2, 'Overall KPI should include payment_mismatches count');
  });

  await t.test('getPaymentMismatches returns detailed discrepancy audit records with short/overpaid calculations', async () => {
    const req = { query: { startDate: '2026-11-14', endDate: '2026-11-14' } };
    const res = createMockRes();
    await reportController.getPaymentMismatches(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.mismatches), 'mismatches should be an array');

    const shortRecord = res.body.mismatches.find(m => m.reference_number === 'GCASH-SHORT-2002');
    assert.ok(shortRecord, 'Held short-payment order should appear in mismatch log');
    assert.equal(shortRecord.customer_name, 'Juan Dela Cruz');
    assert.equal(shortRecord.payment_method, 'GCASH');
    assert.equal(shortRecord.expected_total, '200.00');
    assert.equal(shortRecord.amount_paid, '150.00');
    assert.equal(shortRecord.discrepancy_label, '-₱50.00 Short');

    const rejectedRecord = res.body.mismatches.find(m => m.reference_number === 'GCASH-REJ-3003');
    assert.ok(rejectedRecord, 'Cancelled/rejected payment order should also appear in mismatch log');
    assert.equal(rejectedRecord.expected_total, '180.00');
    assert.equal(rejectedRecord.order_status.toLowerCase(), 'cancelled');
  });

  await t.test('Dashboard HTML and JS include 5th KPI card and Payment Mismatches & Reconciliation Log table', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');
    const js = fs.readFileSync(path.join(__dirname, '../public/js/dashboard.js'), 'utf8');

    assert.ok(html.includes('id="report-kpi-payment-mismatches"'), '5th KPI card for Payment Mismatches must exist in dashboard.html');
    assert.ok(html.includes('id="report-mismatches-card"'), 'Payment Mismatches & Reconciliation Log card must exist in dashboard.html');
    assert.ok(html.includes('id="report-mismatches-tbody"'), 'Payment Mismatches table body must exist in dashboard.html');
    assert.ok(js.includes('loadPaymentMismatchesLog'), 'loadPaymentMismatchesLog function must exist in dashboard.js');
    assert.ok(js.includes('/reports/payment-mismatches'), 'dashboard.js must fetch /reports/payment-mismatches');
    assert.ok(js.includes('openOrderModal('), 'Order number in mismatch log must open Order Details Modal');
  });

  await t.test('Cleanup test records', async () => {
    for (const ordId of createdOrderIds) {
      await db.query('DELETE FROM payments WHERE order_id = ?', [ordId]);
      await db.query('DELETE FROM orders WHERE id = ?', [ordId]);
    }
    if (customerId) {
      await db.query('DELETE FROM customers WHERE id = ?', [customerId]);
    }
  });
});
