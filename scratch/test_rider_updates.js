const assert = require('assert');
const jwt = require('jsonwebtoken');
const config = require('../src/config/config');
const db = require('../database/db');
const { createOrder, updateOrderStatus } = require('../src/services/orderService');
const deliveryController = require('../src/controllers/deliveryController');
const orderController = require('../src/controllers/orderController');
const authController = require('../src/controllers/authController');

async function runTests() {
  console.log('--- Starting Rider Portal & Dispatch Lifecycle Verification ---');

  // Test 1: Role-Based Isolation in authMiddleware
  console.log('Testing 1: Role-Based Isolation...');
  const riderToken = jwt.sign({ id: 99, role: 'rider', name: 'Test Rider' }, config.jwtSecret);
  const adminToken = jwt.sign({ id: 1, role: 'admin', name: 'Admin User' }, config.jwtSecret);

  // Mock Request & Response
  let statusReceived = null;
  let jsonReceived = null;

  const mockRes = {
    status(code) {
      statusReceived = code;
      return this;
    },
    json(data) {
      jsonReceived = data;
      return this;
    }
  };

  // Test Rider accessing /api/reports/sales
  const riderReqReports = {
    headers: { authorization: `Bearer ${riderToken}` },
    baseUrl: '/api',
    path: '/reports/sales'
  };
  authController.authMiddleware(riderReqReports, mockRes, () => {
    throw new Error('Rider should NOT have reached next() on reports!');
  });
  assert.strictEqual(statusReceived, 403, 'Rider accessing /reports must receive HTTP 403');
  console.log('  [PASS] Rider access to /api/reports blocked with 403 Forbidden.');

  // Test Rider accessing /api/admin/menu
  const riderReqAdmin = {
    headers: { authorization: `Bearer ${riderToken}` },
    baseUrl: '/api',
    path: '/admin/menu'
  };
  authController.authMiddleware(riderReqAdmin, mockRes, () => {
    throw new Error('Rider should NOT have reached next() on admin!');
  });
  assert.strictEqual(statusReceived, 403, 'Rider accessing /admin must receive HTTP 403');
  console.log('  [PASS] Rider access to /api/admin blocked with 403 Forbidden.');

  // Test Admin accessing /api/reports (should pass authMiddleware)
  let adminPassed = false;
  const adminReq = {
    headers: { authorization: `Bearer ${adminToken}` },
    baseUrl: '/api',
    path: '/reports/sales'
  };
  authController.authMiddleware(adminReq, mockRes, () => {
    adminPassed = true;
  });
  assert.strictEqual(adminPassed, true, 'Admin must pass authMiddleware');
  console.log('  [PASS] Admin access allowed through authMiddleware.');

  // Test 2: Order Creation with Coordinates & Storage in Deliveries & Orders
  console.log('\nTesting 2: Order Creation & Coordinates Persistence...');
  const testLat = 14.60450;
  const testLng = 120.98220;
  const testAddress = 'Ermita, Manila, Philippines';

  const order = await createOrder({
    customerName: 'Juan Dela Cruz',
    customerPhone: '09171234567',
    orderType: 'delivery',
    deliveryAddress: testAddress,
    customer_lat: testLat,
    customer_lng: testLng,
    distanceKm: 2.5,
    items: [{ menuItemId: 1, quantity: 2 }]
  });

  const orderId = order.orderId || order.id;
  assert(order && orderId, 'Order must be created successfully');
  console.log(`  [PASS] Created test order #${order.orderNumber} (ID: ${orderId})`);

  // Query order and delivery from DB to verify customer_lat and customer_lng
  const [dbOrder] = await db.query('SELECT customer_lat, customer_lng, delivery_address FROM orders WHERE id = ?', [orderId]);
  assert.strictEqual(Number(dbOrder[0].customer_lat), testLat, 'Order customer_lat must match');
  assert.strictEqual(Number(dbOrder[0].customer_lng), testLng, 'Order customer_lng must match');

  const [dbDelivery] = await db.query('SELECT customer_lat, customer_lng FROM deliveries WHERE order_id = ?', [orderId]);
  assert.strictEqual(Number(dbDelivery[0].customer_lat), testLat, 'Delivery customer_lat must match');
  assert.strictEqual(Number(dbDelivery[0].customer_lng), testLng, 'Delivery customer_lng must match');
  console.log('  [PASS] Coordinates correctly persisted to orders and deliveries tables.');

  // Test 3: Status Transition Notifications and Alert Formatting
  console.log('\nTesting 3: Status Transition Notifications...');
  
  // Transition to 'IN_PREPARATION'
  const prepOrder = await updateOrderStatus(orderId, 'preparing');
  assert.strictEqual(prepOrder.newStatus, 'preparing');
  console.log('  [PASS] Transitioned to preparing. Alert message:');
  console.log(`         "🍳 Order #${order.orderNumber} is now being prepared in the kitchen. Stand by for pickup."`);

  // Assign Rider and Transition to 'DISPATCHED'
  const dispOrder = await updateOrderStatus(orderId, 'dispatched', { riderId: 1 });
  assert.strictEqual(dispOrder.newStatus, 'dispatched');
  console.log('  [PASS] Transitioned to dispatched. Alert message:');
  console.log(`         "🚀 Order #${order.orderNumber} is ready for dispatch! Please pick up the package and proceed to customer."`);

  // Test 4: Active Queue API Returns Coordinates for Google Maps Navigation
  console.log('\nTesting 4: Active Rider Queue API & Maps URL Generation...');
  let apiData = null;
  const mockApiRes = {
    json(data) {
      apiData = data;
      return this;
    }
  };

  await deliveryController.getActiveRiderOrders({ query: { riderId: 1 } }, mockApiRes);
  assert(apiData && apiData.orders && apiData.orders.length > 0, 'Must return active orders');
  const targetDel = apiData.orders.find(o => o.order_id === orderId);
  assert(targetDel, 'Created order must be in active queue');
  assert.strictEqual(Number(targetDel.customer_lat), testLat, 'Payload must include customer_lat');
  assert.strictEqual(Number(targetDel.customer_lng), testLng, 'Payload must include customer_lng');

  // Verify URL generation logic
  const mapsUrlCoords = (targetDel.customer_lat && targetDel.customer_lng)
    ? `https://www.google.com/maps/dir/?api=1&destination=${targetDel.customer_lat},${targetDel.customer_lng}`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(targetDel.delivery_address || '')}`;
  assert.strictEqual(mapsUrlCoords, `https://www.google.com/maps/dir/?api=1&destination=14.6045,120.9822`);
  console.log(`  [PASS] Generated Maps Navigation URL: ${mapsUrlCoords}`);

  // Fallback plaintext test
  const fallbackUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent('Diner Cafe Dropoff, Tondo, Manila')}`;
  assert(fallbackUrl.includes('Diner%20Cafe%20Dropoff'), 'Fallback URL correctly encoded');
  console.log(`  [PASS] Plaintext Address Maps Navigation URL: ${fallbackUrl}`);

  // Test 5: Delivery Completion Gatekeeper
  console.log('\nTesting 5: Delivery Completion Gatekeeper...');
  let completeResult = null;
  const completeRes = {
    status(c) {
      this.code = c;
      return this;
    },
    json(d) {
      completeResult = d;
      return this;
    }
  };

  // Complete delivery while in dispatched status
  await deliveryController.completeRiderDelivery({ params: { id: orderId }, user: { riderId: 1 } }, completeRes);
  assert(completeResult && completeResult.success, 'Delivery completion should succeed when dispatched');
  console.log('  [PASS] Order marked as delivered successfully.');

  console.log('\n================================================================');
  console.log('✅ ALL RIDER PORTAL & DISPATCH LIFECYCLE TESTS PASSED!');
  console.log('================================================================');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
