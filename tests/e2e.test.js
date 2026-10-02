const test = require('node:test');
const assert = require('node:assert/strict');

const BASE_URL = 'http://localhost:3000';

test('Diner Cafe End-to-End API Integration Suite', async (t) => {
  let authToken = '';

  await t.test('1. Webhook Handshake (GET /webhook)', async () => {
    const res = await fetch(`${BASE_URL}/webhook?hub.mode=subscribe&hub.verify_token=diners_cafe_verify_token_2026&hub.challenge=CHALLENGE_ACCEPTED_123`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.equal(text, 'CHALLENGE_ACCEPTED_123');
  });

  await t.test('2. Staff / Admin Login (POST /api/auth/login)', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@dinerscafe.ph', password: 'password123' })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.token);
    assert.equal(data.user.role, 'admin');
    authToken = data.token;
  });

  await t.test('3. Menu Catalog (GET /api/menu)', async () => {
    const res = await fetch(`${BASE_URL}/api/menu`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.categories.length > 0);
    assert.ok(data.allItems.length >= 10);
  });

  await t.test('4. Smart Delivery Fare Calculation (POST /api/deliveries/compute-fare)', async () => {
    const res = await fetch(`${BASE_URL}/api/deliveries/compute-fare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        distanceKm: 2.2,
        vehicleType: 'motorcycle',
        weatherCondition: 'light_rain'
      })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.fare.finalFare, 115.00); // Verified by formula
  });

  await t.test('5. Conversational Order via Chatbot Simulator (POST /api/chatbot/simulate)', async () => {
    // 5a. Greet
    const greetRes = await fetch(`${BASE_URL}/api/chatbot/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ psid: 'TEST_PSID_E2E', payload: 'GET_STARTED' })
    });
    assert.equal(greetRes.status, 200);

    // 5b. Add Spanish Latte (Item 1)
    const addRes = await fetch(`${BASE_URL}/api/chatbot/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ psid: 'TEST_PSID_E2E', payload: 'ADD_ITEM_1' })
    });
    assert.equal(addRes.status, 200);

    // 5c. Set Qty 2
    const qtyRes = await fetch(`${BASE_URL}/api/chatbot/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ psid: 'TEST_PSID_E2E', payload: 'QTY_2' })
    });
    assert.equal(qtyRes.status, 200);

    // 5d. Choose Delivery
    const delivRes = await fetch(`${BASE_URL}/api/chatbot/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ psid: 'TEST_PSID_E2E', payload: 'CHECKOUT_DELIVERY' })
    });
    assert.equal(delivRes.status, 200);

    // 5e. Provide Address
    const addrRes = await fetch(`${BASE_URL}/api/chatbot/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ psid: 'TEST_PSID_E2E', text: '123 Test St., Near Library' })
    });
    assert.equal(addrRes.status, 200);

    // 5f. Choose Cash Payment
    const cashRes = await fetch(`${BASE_URL}/api/chatbot/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ psid: 'TEST_PSID_E2E', payload: 'PAY_CASH' })
    });
    assert.equal(cashRes.status, 200);
    const cashData = await cashRes.json();
    assert.equal(cashData.success, true);
    assert.ok(cashData.session.activeOrderNumber);
  });

  await t.test('6. Order Management & Advance Status (PATCH /api/orders/:id/status)', async () => {
    // Fetch orders
    const ordersRes = await fetch(`${BASE_URL}/api/orders`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const ordersData = await ordersRes.json();
    assert.ok(ordersData.orders.length > 0);
    const latestOrder = ordersData.orders[0];

    // Advance to preparing
    const prepRes = await fetch(`${BASE_URL}/api/orders/${latestOrder.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ status: 'preparing' })
    });
    assert.equal(prepRes.status, 200);

    // Advance to dispatched
    const dispRes = await fetch(`${BASE_URL}/api/orders/${latestOrder.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ status: 'dispatched', riderId: 1 })
    });
    assert.equal(dispRes.status, 200);

    // Advance to delivered (triggers FR11 feedback)
    const delivRes = await fetch(`${BASE_URL}/api/orders/${latestOrder.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ status: 'delivered' })
    });
    assert.equal(delivRes.status, 200);
  });

  await t.test('7. Post-Delivery Feedback (FR11)', async () => {
    const res = await fetch(`${BASE_URL}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: 1,
        rating: 5,
        comments: 'Amazing iced coffee and super quick delivery!'
      })
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.success, true);

    // Verify feedback is visible in dashboard endpoint
    const listRes = await fetch(`${BASE_URL}/api/feedback`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const listData = await listRes.json();
    assert.equal(listData.success, true);
    assert.ok(listData.feedback.length > 0);
    assert.ok(listData.metrics.averageRating >= 4.0);
  });

  await t.test('8. Inventory Restock & Audit (POST /api/inventory/restock)', async () => {
    const res = await fetch(`${BASE_URL}/api/inventory/restock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        inventoryId: 1,
        quantityToAdd: 25,
        notes: 'Weekly fresh coffee bean restock'
      })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
  });

  await t.test('9. Reports & Business Analytics (FR10)', async () => {
    const salesRes = await fetch(`${BASE_URL}/api/reports/sales`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    assert.equal(salesRes.status, 200);
    const salesData = await salesRes.json();
    assert.equal(salesData.success, true);
    assert.ok(salesData.summary.total_orders > 0);

    const delivRes = await fetch(`${BASE_URL}/api/reports/delivery`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    assert.equal(delivRes.status, 200);
    const delivData = await delivRes.json();
    assert.equal(delivData.success, true);
  });

  await t.test('10. AI Chatbot Status & Toggle Control (GET/POST /api/chatbot/toggle)', async () => {
    // 1. Initial status check
    const statusRes = await fetch(`${BASE_URL}/api/chatbot/status`);
    assert.equal(statusRes.status, 200);
    const statusData = await statusRes.json();
    assert.equal(statusData.success, true);
    assert.equal(statusData.isEnabled, true);

    // 2. Toggle chatbot OFF
    const offRes = await fetch(`${BASE_URL}/api/chatbot/toggle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ isEnabled: false })
    });
    assert.equal(offRes.status, 200);
    const offData = await offRes.json();
    assert.equal(offData.success, true);
    assert.equal(offData.isEnabled, false);

    // 3. Verify simulator message receives paused offline response
    const simRes = await fetch(`${BASE_URL}/api/chatbot/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ psid: 'TEST_PSID_OFFLINE_USER', text: 'Hello, can I order?' })
    });
    assert.equal(simRes.status, 200);

    // 4. Toggle chatbot back ON
    const onRes = await fetch(`${BASE_URL}/api/chatbot/toggle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ isEnabled: true })
    });
    assert.equal(onRes.status, 200);
    const onData = await onRes.json();
    assert.equal(onData.success, true);
    assert.equal(onData.isEnabled, true);
  });

  await t.test('11. Barista Void Request & Owner Authorization Workflow', async () => {
    // 1. Log in as Barista (staff)
    const staffLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'staff@dinerscafe.ph', password: 'password123' })
    });
    assert.equal(staffLoginRes.status, 200);
    const staffData = await staffLoginRes.json();
    const staffToken = staffData.token;
    assert.equal(staffData.user.role, 'staff');

    // 2. Create an order to void
    const orderRes = await fetch(`${BASE_URL}/api/orders/manual`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${staffToken}`
      },
      body: JSON.stringify({
        customerName: 'Test Void Customer',
        customerPhone: '+639170001111',
        orderType: 'pickup',
        paymentMethod: 'cash',
        items: [{ menuItemId: 1, quantity: 1 }]
      })
    });
    const orderData = await orderRes.json();
    if (orderRes.status !== 201) {
      console.error('Order creation failed:', orderData);
    }
    assert.equal(orderRes.status, 201);
    const orderId = orderData.order.orderId;

    // 3. Barista submits void request (requires Owner approval)
    const voidReqRes = await fetch(`${BASE_URL}/api/orders/${orderId}/request-void`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${staffToken}`
      },
      body: JSON.stringify({ reason: 'Customer accidentally ordered twice' })
    });
    assert.equal(voidReqRes.status, 200);
    const voidReqData = await voidReqRes.json();
    assert.equal(voidReqData.success, true);
    assert.equal(voidReqData.result.void_status, 'pending_approval');

    // 4. Verify order shows pending approval
    const getOrderRes = await fetch(`${BASE_URL}/api/orders/${orderId}`, {
      headers: { 'Authorization': `Bearer ${staffToken}` }
    });
    const getOrderData = await getOrderRes.json();
    assert.equal(getOrderData.order.void_status, 'pending_approval');

    // 5. Owner authorizes void request
    const authVoidRes = await fetch(`${BASE_URL}/api/orders/${orderId}/authorize-void`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}` // Admin token
      },
      body: JSON.stringify({ reason: 'Approved by Owner' })
    });
    assert.equal(authVoidRes.status, 200);
    const authVoidData = await authVoidRes.json();
    assert.equal(authVoidData.success, true);
    assert.equal(authVoidData.order.newStatus, 'cancelled');

    // 6. Verify final order status is cancelled
    const finalOrderRes = await fetch(`${BASE_URL}/api/orders/${orderId}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const finalOrderData = await finalOrderRes.json();
    assert.equal(finalOrderData.order.status, 'cancelled');
    assert.equal(finalOrderData.order.void_status, 'approved');
  });

  await t.test('12. Settings: Staff Account Management & Password Reset (FR1)', async () => {
    // 1. Fetch user accounts as Admin
    const usersRes = await fetch(`${BASE_URL}/api/auth/users`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    assert.equal(usersRes.status, 200);
    const usersData = await usersRes.json();
    assert.equal(usersData.success, true);
    assert.ok(usersData.users.length >= 2);

    const staffUser = usersData.users.find(u => u.email === 'staff@dinerscafe.ph');
    assert.ok(staffUser, 'Staff account staff@dinerscafe.ph should exist');

    // 2. Non-admin should be rejected (403)
    const staffLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'staff@dinerscafe.ph', password: 'password123' })
    });
    const staffLoginData = await staffLoginRes.json();
    const staffToken = staffLoginData.token;

    const unauthUsersRes = await fetch(`${BASE_URL}/api/auth/users`, {
      headers: { 'Authorization': `Bearer ${staffToken}` }
    });
    assert.equal(unauthUsersRes.status, 403);

    // 3. Password validation checks (min length 6)
    const shortPassRes = await fetch(`${BASE_URL}/api/auth/users/${staffUser.id}/password`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ newPassword: '123' })
    });
    assert.equal(shortPassRes.status, 400);

    // 4. Admin successfully resets staff password to 'baristaPass2026'
    const updatePassRes = await fetch(`${BASE_URL}/api/auth/users/${staffUser.id}/password`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        newPassword: 'baristaPass2026',
        confirmPassword: 'baristaPass2026'
      })
    });
    assert.equal(updatePassRes.status, 200);
    const updatePassData = await updatePassRes.json();
    assert.equal(updatePassData.success, true);

    // 5. Verify staff can now log in with the new password
    const newLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'staff@dinerscafe.ph', password: 'baristaPass2026' })
    });
    assert.equal(newLoginRes.status, 200);
    const newLoginData = await newLoginRes.json();
    assert.equal(newLoginData.success, true);
    assert.ok(newLoginData.token);

    // 6. Restore original password 'password123'
    await fetch(`${BASE_URL}/api/auth/users/${staffUser.id}/password`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        newPassword: 'password123',
        confirmPassword: 'password123'
      })
    });
  });
});
