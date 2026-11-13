const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const db = require('../database/db');
const reportController = require('../src/controllers/reportController');

function createMockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe('Reports & Analytics — Date Range Filter & Payment Method Drill-Down', () => {
  const testOrderIds = [];
  const testCustomerIds = [];

  before(async () => {
    await db.initDatabase();

    const [c1] = await db.query(
      `INSERT INTO customers (psid, first_name, last_name) VALUES (?, 'Maria', 'Clara')`,
      ['TEST-PSID-RPT-1001-' + Date.now()]
    );
    testCustomerIds.push(c1.insertId);

    const [c2] = await db.query(
      `INSERT INTO customers (psid, first_name, last_name) VALUES (?, 'Crisostomo', 'Ibarra')`,
      ['TEST-PSID-RPT-1002-' + Date.now()]
    );
    testCustomerIds.push(c2.insertId);

    const [c3] = await db.query(
      `INSERT INTO customers (psid, first_name, last_name) VALUES (?, 'Elias', 'Salome')`,
      ['TEST-PSID-RPT-1003-' + Date.now()]
    );
    testCustomerIds.push(c3.insertId);

    // Order 1: CASH on 2026-11-10 (₱150.00)
    const [o1] = await db.query(
      `INSERT INTO orders (order_number, customer_id, order_type, status, payment_status, subtotal, total_amount, created_at)
       VALUES (?, ?, 'pickup', 'delivered', 'Paid', 150.00, 150.00, '2026-11-10 10:15:00')`,
      ['DNR-TEST-RPT-1001', c1.insertId]
    );
    testOrderIds.push(o1.insertId);
    await db.query(
      `INSERT INTO payments (order_id, payment_method, amount_expected, amount_paid, status, created_at)
       VALUES (?, 'cash', 150.00, 150.00, 'verified', '2026-11-10 10:15:05')`,
      [o1.insertId]
    );

    // Order 2: GCASH on 2026-11-12 (₱275.50) with reference number
    const [o2] = await db.query(
      `INSERT INTO orders (order_number, customer_id, order_type, status, payment_status, payment_ref_number, subtotal, total_amount, created_at)
       VALUES (?, ?, 'delivery', 'delivered', 'Paid', '9001234567890', 275.50, 275.50, '2026-11-12 14:30:00')`,
      ['DNR-TEST-RPT-1002', c2.insertId]
    );
    testOrderIds.push(o2.insertId);
    await db.query(
      `INSERT INTO payments (order_id, payment_method, reference_no, amount_expected, amount_paid, status, created_at)
       VALUES (?, 'gcash', '9001234567890', 275.50, 275.50, 'verified', '2026-11-12 14:30:10')`,
      [o2.insertId]
    );

    // Order 3: CASH on 2026-11-12 (₱320.00)
    const [o3] = await db.query(
      `INSERT INTO orders (order_number, customer_id, order_type, status, payment_status, subtotal, total_amount, created_at)
       VALUES (?, ?, 'pickup', 'delivered', 'Paid', 320.00, 320.00, '2026-11-12 18:45:00')`,
      ['DNR-TEST-RPT-1003', c3.insertId]
    );
    testOrderIds.push(o3.insertId);
    await db.query(
      `INSERT INTO payments (order_id, payment_method, amount_expected, amount_paid, status, created_at)
       VALUES (?, 'cash', 320.00, 320.00, 'verified', '2026-11-12 18:45:05')`,
      [o3.insertId]
    );
  });

  after(async () => {
    for (const id of testOrderIds) {
      await db.query('DELETE FROM payments WHERE order_id = ?', [id]);
      await db.query('DELETE FROM orders WHERE id = ?', [id]);
    }
    for (const cid of testCustomerIds) {
      await db.query('DELETE FROM customers WHERE id = ?', [cid]);
    }
  });

  it('1. getSalesReport filters inclusively by startDate and endDate and validates End Date >= Start Date', async () => {
    const badReq = { query: { startDate: '2026-11-15', endDate: '2026-11-10' } };
    const badRes = createMockRes();
    await reportController.getSalesReport(badReq, badRes);
    assert.equal(badRes.statusCode, 400);
    assert.equal(badRes.body.success, false);

    const reqNov12 = { query: { startDate: '2026-11-12', endDate: '2026-11-12' } };
    const resNov12 = createMockRes();
    await reportController.getSalesReport(reqNov12, resNov12);

    assert.equal(resNov12.statusCode, 200);
    assert.equal(resNov12.body.success, true);
    assert.equal(resNov12.body.startDate, '2026-11-12');
    assert.equal(resNov12.body.endDate, '2026-11-12');

    const cashRow = (resNov12.body.paymentBreakdown || []).find(
      r => String(r.payment_method).toLowerCase() === 'cash'
    );
    const gcashRow = (resNov12.body.paymentBreakdown || []).find(
      r => String(r.payment_method).toLowerCase() === 'gcash'
    );
    assert.ok(cashRow, 'Expected CASH row on 2026-11-12');
    assert.ok(gcashRow, 'Expected GCASH row on 2026-11-12');
  });

  it('2. getTransactionsByMethod returns exact drill-down transactions whose sum matches paymentBreakdown', async () => {
    const startDate = '2026-11-10';
    const endDate = '2026-11-12';

    const salesRes = createMockRes();
    await reportController.getSalesReport({ query: { startDate, endDate } }, salesRes);
    assert.equal(salesRes.body.success, true);

    for (const summaryRow of salesRes.body.paymentBreakdown) {
      const method = summaryRow.payment_method;
      const drillRes = createMockRes();
      await reportController.getTransactionsByMethod(
        { query: { method, startDate, endDate } },
        drillRes
      );

      assert.equal(drillRes.statusCode, 200);
      assert.equal(drillRes.body.success, true);
      assert.equal(drillRes.body.totalCount, Number(summaryRow.transaction_count));
      assert.equal(
        Number(drillRes.body.totalAmountPaid).toFixed(2),
        Number(summaryRow.total_revenue).toFixed(2)
      );

      const manualSum = drillRes.body.transactions.reduce(
        (acc, tx) => acc + Number(tx.amount_paid || 0),
        0
      );
      assert.equal(manualSum.toFixed(2), Number(summaryRow.total_revenue).toFixed(2));
    }

    const cashDrillRes = createMockRes();
    await reportController.getTransactionsByMethod(
      { query: { method: 'CASH', startDate, endDate } },
      cashDrillRes
    );
    const testCashTx = cashDrillRes.body.transactions.find(
      t => t.order_number === '#DNR-TEST-RPT-1001'
    );
    assert.ok(testCashTx);
    assert.equal(testCashTx.customer_name, 'Maria Clara');
    assert.equal(testCashTx.reference_number, 'N/A');
    assert.equal(testCashTx.amount_paid, '150.00');

    const gcashDrillRes = createMockRes();
    await reportController.getTransactionsByMethod(
      { query: { method: 'GCASH', startDate, endDate } },
      gcashDrillRes
    );
    const testGcashTx = gcashDrillRes.body.transactions.find(
      t => t.order_number === '#DNR-TEST-RPT-1002'
    );
    assert.ok(testGcashTx);
    assert.equal(testGcashTx.customer_name, 'Crisostomo Ibarra');
    assert.equal(testGcashTx.reference_number, '9001234567890');
    assert.equal(testGcashTx.amount_paid, '275.50');
  });

  it('3. Frontend HTML and JS contain the Date Range Filter bar and Payment Method Transactions Modal', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');
    const js = fs.readFileSync(path.join(__dirname, '../public/js/dashboard.js'), 'utf8');

    assert.ok(html.includes('id="report-start-date"'));
    assert.ok(html.includes('id="report-end-date"'));
    assert.ok(html.includes('id="btn-preset-today"'));
    assert.ok(html.includes('id="btn-preset-last7"'));
    assert.ok(html.includes('id="btn-preset-month"'));
    assert.ok(html.includes('id="btn-preset-all"'));
    assert.ok(html.includes('id="modal-payment-method-transactions"'));
    assert.ok(html.includes('id="payment-drilldown-tbody"'));
    assert.ok(html.includes('id="payment-drilldown-total-amount"'));

    assert.ok(js.includes('function openPaymentMethodModal'));
    assert.ok(js.includes('function setReportDatePreset'));
    assert.ok(js.includes('function applyReportDateFilter'));
    assert.ok(js.includes('/reports/transactions-by-method'));
    assert.ok(js.includes('View Details →'));
  });
});
