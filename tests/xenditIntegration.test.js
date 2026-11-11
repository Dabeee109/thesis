const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_FORCE_SQLITE = 'true';
process.env.XENDIT_SECRET_KEY = 'xnd_development_test_key_123';
process.env.XENDIT_CALLBACK_TOKEN = 'test_callback_token_abc';
process.env.APP_BASE_URL = 'https://diners-cafe-bot1.onrender.com';

const { initDatabase, query } = require('../database/db');
const xenditService = require('../src/services/xenditService');
const xenditController = require('../src/controllers/xenditController');
const orderService = require('../src/services/orderService');
const nlpEngine = require('../src/services/nlpEngine');

function createMockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    send(data) {
      this.body = data;
      return this;
    }
  };
  return res;
}

test('Xendit Payment Gateway Integration Suite', async (t) => {
  await initDatabase();

  await t.test('1. xenditService.verifyCallbackToken validates matching and rejects mismatched tokens', () => {
    assert.strictEqual(xenditService.verifyCallbackToken('test_callback_token_abc'), true);
    assert.strictEqual(xenditService.verifyCallbackToken('wrong_token'), false);
    assert.strictEqual(xenditService.verifyCallbackToken(''), false);
  });

  await t.test('2. xenditService.createInvoice sends Basic Auth and returns checkout invoice_url', async () => {
    const origFetch = global.fetch;
    let capturedUrl = null;
    let capturedInit = null;

    global.fetch = async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'inv_xendit_001',
          external_id: 'DNR-20261112-TEST1',
          status: 'PENDING',
          invoice_url: 'https://checkout-staging.xendit.co/web/inv_xendit_001'
        })
      };
    };

    try {
      const res = await xenditService.createInvoice({
        orderNumber: 'DNR-20261112-TEST1',
        amount: 345.5,
        customerName: 'Juan Dela Cruz',
        customerPhone: '09171234567'
      });

      assert.strictEqual(capturedUrl, 'https://api.xendit.co/v2/invoices');
      assert.strictEqual(capturedInit.method, 'POST');
      assert.ok(capturedInit.headers.Authorization.startsWith('Basic '));

      const body = JSON.parse(capturedInit.body);
      assert.strictEqual(body.external_id, 'DNR-20261112-TEST1');
      assert.strictEqual(body.amount, 345.5);
      assert.strictEqual(body.currency, 'PHP');
      assert.ok(body.success_redirect_url.includes('https://diners-cafe-bot1.onrender.com/payment/xendit/return'));

      assert.strictEqual(res.invoice_url, 'https://checkout-staging.xendit.co/web/inv_xendit_001');
    } finally {
      global.fetch = origFetch;
    }
  });

  await t.test('3. xenditController.handleWebhook rejects invalid X-CALLBACK-TOKEN with 401', async () => {
    const req = {
      headers: { 'x-callback-token': 'invalid_token' },
      body: { external_id: 'invoice_123124123', status: 'PAID' }
    };
    const res = createMockRes();

    await xenditController.handleWebhook(req, res);
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.body.success, false);
  });

  await t.test('4. xenditController.handleWebhook acknowledges Xendit dashboard test ping (200 OK)', async () => {
    const req = {
      headers: { 'x-callback-token': 'test_callback_token_abc' },
      body: { id: '579c8d61f23fa4ca35e52da4', external_id: 'invoice_123124123', status: 'PAID', amount: 50000 }
    };
    const res = createMockRes();

    await xenditController.handleWebhook(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.received, true);
    assert.strictEqual(res.body.matched, false);
  });

  await t.test('5. xenditController.handleWebhook marks real order Paid, moves to preparing, and is idempotent', async () => {
    const [menuRows] = await query('SELECT id, name, price FROM menu_items WHERE is_available = 1 LIMIT 1');
    assert.ok(menuRows.length > 0, 'Menu must have at least one item');
    const item = menuRows[0];

    const created = await orderService.createOrder(`POS_MANUAL_XENDIT_${Date.now()}`, {
      customerName: 'Maria Xendit',
      customerPhone: '09179998888',
      deliveryAddress: 'Store Counter Pickup',
      orderType: 'pickup',
      dining_mode: 'Pick-up',
      paymentMethod: 'xendit',
      amountPaid: 0,
      items: [{ menuItemId: item.id, name: item.name, quantity: 1, unitPrice: item.price }],
      deliveryFee: 0,
      totalAmount: item.price,
      paymentStatus: 'Pending'
    });

    const req = {
      headers: { 'x-callback-token': 'test_callback_token_abc' },
      body: {
        id: 'inv_live_987654',
        external_id: created.orderNumber,
        status: 'PAID',
        paid_amount: item.price,
        payment_method: 'EWALLET',
        payment_channel: 'GCASH'
      }
    };
    const res1 = createMockRes();
    await xenditController.handleWebhook(req, res1);

    assert.strictEqual(res1.statusCode, 200);
    assert.strictEqual(res1.body.verified, true);

    const [orderRows] = await query('SELECT status, payment_status, payment_ref_number FROM orders WHERE id = ?', [created.orderId]);
    assert.strictEqual(orderRows[0].payment_status, 'Paid');
    assert.strictEqual(orderRows[0].status, 'preparing');
    assert.ok(orderRows[0].payment_ref_number.includes('GCASH (inv_live_987654)'));

    const [payRows] = await query('SELECT payment_method, status, amount_paid FROM payments WHERE order_id = ?', [created.orderId]);
    assert.strictEqual(payRows[0].payment_method, 'xendit');
    assert.strictEqual(payRows[0].status, 'verified');
    assert.strictEqual(Number(payRows[0].amount_paid), Number(item.price));

    // Idempotent duplicate webhook
    const res2 = createMockRes();
    await xenditController.handleWebhook(req, res2);
    assert.strictEqual(res2.statusCode, 200);
    assert.strictEqual(res2.body.alreadyPaid, true);
  });

  await t.test('6. Checkout prompt and parser support Xendit / Online Payment alongside Cash', () => {
    const prompt = nlpEngine.getCheckoutInfoPrompt({ dining_mode: 'Delivery' });
    assert.ok(prompt.includes('Cash or Online Payment / Xendit'));

    const pXendit = nlpEngine.parseCustomerInfo('Name: Juan\nPhone number: 09171234567\nAddress: Manila\nPayment mode: Xendit', 'Delivery');
    assert.strictEqual(pXendit.paymentMode, 'Xendit');

    const pOnline = nlpEngine.parseCustomerInfo('Name: Ana\nPhone number: 09171234567\nPayment mode: Online Payment', 'Pick-up');
    assert.strictEqual(pOnline.paymentMode, 'Xendit');

    const pCash = nlpEngine.parseCustomerInfo('Name: Pedro\nPhone number: 09171234567\nPayment mode: Cash', 'Pick-up');
    assert.strictEqual(pCash.paymentMode, 'Cash');
  });

  await t.test('7. xenditService.createGcashCharge calls /ewallets/charges with PH_GCASH and returns checkout_url', async () => {
    const origFetch = global.fetch;
    let capturedUrl = null;
    let capturedInit = null;

    global.fetch = async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return {
        ok: true,
        status: 202,
        json: async () => ({
          id: 'ewc_test_gcash_001',
          reference_id: 'DNR-20261112-GCASH1',
          status: 'PENDING',
          channel_code: 'PH_GCASH',
          actions: {
            desktop_web_checkout_url: 'https://ewallet-mock-connector.xendit.co/v1/ewallet_connector/checkouts?token=abc',
            mobile_web_checkout_url: 'https://ewallet-mock-connector.xendit.co/v1/ewallet_connector/checkouts?token=abc',
            mobile_deeplink_checkout_url: null
          }
        })
      };
    };

    try {
      const res = await xenditService.createGcashCharge({
        orderNumber: 'DNR-20261112-GCASH1',
        amount: 209,
        customerName: 'Dave',
        customerPhone: '09281762895'
      });

      assert.strictEqual(capturedUrl, 'https://api.xendit.co/ewallets/charges');
      const body = JSON.parse(capturedInit.body);
      assert.strictEqual(body.reference_id, 'DNR-20261112-GCASH1');
      assert.strictEqual(body.channel_code, 'PH_GCASH');
      assert.strictEqual(body.checkout_method, 'ONE_TIME_PAYMENT');
      assert.strictEqual(res.checkout_url, 'https://ewallet-mock-connector.xendit.co/v1/ewallet_connector/checkouts?token=abc');
    } finally {
      global.fetch = origFetch;
    }
  });

  await t.test('8. xenditController.handleWebhook handles ewallet.capture SUCCEEDED payload cleanly', async () => {
    const [menuRows] = await query('SELECT id, name, price FROM menu_items WHERE is_available = 1 LIMIT 1');
    const item = menuRows[0];

    const created = await orderService.createOrder(`POS_MANUAL_EWALLET_${Date.now()}`, {
      customerName: 'Dave GCash',
      customerPhone: '09281762895',
      deliveryAddress: 'Store Counter Pickup',
      orderType: 'pickup',
      dining_mode: 'Pick-up',
      paymentMethod: 'xendit',
      amountPaid: 0,
      items: [{ menuItemId: item.id, name: item.name, quantity: 1, unitPrice: item.price }],
      deliveryFee: 0,
      totalAmount: item.price,
      paymentStatus: 'Pending'
    });

    const req = {
      headers: { 'x-callback-token': 'test_callback_token_abc' },
      body: {
        event: 'ewallet.capture',
        data: {
          id: 'ewc_live_555',
          reference_id: created.orderNumber,
          status: 'SUCCEEDED',
          charge_amount: item.price,
          capture_amount: item.price,
          channel_code: 'PH_GCASH'
        }
      }
    };

    const res = createMockRes();
    await xenditController.handleWebhook(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.verified, true);

    const [orderRows] = await query('SELECT status, payment_status, payment_ref_number FROM orders WHERE id = ?', [created.orderId]);
    assert.strictEqual(orderRows[0].payment_status, 'Paid');
    assert.strictEqual(orderRows[0].status, 'preparing');
    assert.ok(orderRows[0].payment_ref_number.includes('PH_GCASH (ewc_live_555)'));
  });
});

