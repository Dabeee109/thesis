const db = require('../database/db');
const { updateOrderStatus } = require('../src/services/orderService');

(async () => {
  try {
    const [orders] = await db.query("SELECT id, status, order_number FROM orders WHERE status = 'pending' LIMIT 1");
    if (!orders || orders.length === 0) {
      console.log('No pending order found. Listing first order:');
      const [anyOrder] = await db.query("SELECT id, status, order_number FROM orders LIMIT 1");
      console.log(anyOrder);
      return;
    }
    const o = orders[0];
    console.log('Testing update on order:', o);
    const updated = await updateOrderStatus(o.id, 'preparing');
    console.log('Successfully updated to preparing:', updated.order_number);
    // revert
    await updateOrderStatus(o.id, 'pending');
    console.log('Reverted to pending.');
  } catch (err) {
    console.error('Update order failed:', err);
  }
})();

