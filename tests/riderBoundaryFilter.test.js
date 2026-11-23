const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, 'test_rider_filter.sqlite');
if (fs.existsSync(testDbPath)) {
  try { fs.unlinkSync(testDbPath); } catch (e) {}
}

process.env.DB_FORCE_SQLITE = '1';
process.env.SQLITE_PATH = testDbPath;
process.env.NODE_ENV = 'test';

const db = require('../database/db');
const { getActiveRiderOrders, getRiderHistory } = require('../src/controllers/deliveryController');

test('Rider Boundary Isolation: Exclude Over-3km and Third-Party Orders from Rider Dashboard', async (t) => {
  await db.initDatabase();

  // Create rider
  const [rRes] = await db.query(
    `INSERT INTO delivery_personnel (full_name, phone_number, vehicle_type, is_active)
     VALUES ('Marco Santos', '09170000001', 'motorcycle', 1)`
  );
  const riderId = rRes.insertId;

  // Create customer
  const [cRes] = await db.query(
    `INSERT INTO customers (psid, first_name, last_name, phone_number)
     VALUES ('PSID_RIDER_TEST', 'Test', 'Customer', '09171234567')`
  );
  const custId = cRes.insertId;

  // 1. In-house delivery order within 3km (2.1 km) -> SHOULD APPEAR
  const [inHouseOrder] = await db.query(
    `INSERT INTO orders (order_number, customer_id, order_type, status, total_amount, delivery_address, distance_km, customer_notes, created_at, updated_at)
     VALUES ('DNR-INHOUSE-001', ?, 'delivery', 'preparing', 250.00, 'Nearby Street', 2.1, 'Extra spoon', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [custId]
  );
  await db.query(
    `INSERT INTO deliveries (order_id, rider_id, distance_km, status, final_fare, created_at)
     VALUES (?, ?, 2.1, 'assigned', 49.00, CURRENT_TIMESTAMP)`,
    [inHouseOrder.insertId, riderId]
  );

  // 2. Over-3km Third-Party Grab/Lalamove order (6.6 km) -> MUST BE EXCLUDED
  const [over3kmOrder1] = await db.query(
    `INSERT INTO orders (order_number, customer_id, order_type, status, total_amount, delivery_address, distance_km, customer_notes, created_at, updated_at)
     VALUES ('DNR-OVER3KM-8796', ?, 'delivery', 'preparing', 500.00, 'Bohol Street, Sampaloc', 6.6, '[Over-3km Third-Party Grab/Lalamove Rider - Awaiting Admin Fee Quote]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [custId]
  );
  await db.query(
    `INSERT INTO deliveries (order_id, rider_id, distance_km, status, final_fare, created_at)
     VALUES (?, ?, 6.6, 'pending', 0.00, CURRENT_TIMESTAMP)`,
    [over3kmOrder1.insertId, riderId]
  );

  // 3. Far distance order (16.5 km) without note -> MUST BE EXCLUDED
  const [over3kmOrder2] = await db.query(
    `INSERT INTO orders (order_number, customer_id, order_type, status, total_amount, delivery_address, distance_km, customer_notes, created_at, updated_at)
     VALUES ('DNR-OVER3KM-4764', ?, 'delivery', 'preparing', 750.00, 'Pares, Palm Drive, QC', 16.5, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [custId]
  );
  await db.query(
    `INSERT INTO deliveries (order_id, rider_id, distance_km, status, final_fare, created_at)
     VALUES (?, ?, 16.5, 'pending', 0.00, CURRENT_TIMESTAMP)`,
    [over3kmOrder2.insertId, riderId]
  );

  // Mock res object
  let resJsonData = null;
  const mockRes = {
    json: (data) => {
      resJsonData = data;
      return mockRes;
    },
    status: () => mockRes
  };

  // Call getActiveRiderOrders
  await getActiveRiderOrders({ query: { riderId } }, mockRes);

  assert.ok(resJsonData.success);
  assert.strictEqual(resJsonData.orders.length, 1, 'Only in-house order <= 3km must appear in rider active queue');
  assert.strictEqual(resJsonData.orders[0].order_number, 'DNR-INHOUSE-001');

  // Verify over-3km orders are NOT in list
  const numbers = resJsonData.orders.map(o => o.order_number);
  assert.ok(!numbers.includes('DNR-OVER3KM-8796'), 'DNR-OVER3KM-8796 must be excluded');
  assert.ok(!numbers.includes('DNR-OVER3KM-4764'), 'DNR-OVER3KM-4764 must be excluded');
});
