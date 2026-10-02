/**
 * Reports & Analytics Controller (FR10)
 * Generates sales summaries, payment method breakdowns, delivery statistics, and CSV exports.
 */

const db = require('../../database/db');

/**
 * Sales Performance Report (Daily, Weekly, Monthly, All-time)
 */
async function getSalesReport(req, res) {
  try {
    const { period = 'monthly' } = req.query;

    // 1. Overall Revenue & Order Aggregates
    const [overall] = await db.query(`
      SELECT 
        COUNT(*) AS total_orders,
        COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total_amount ELSE 0 END), 0) AS gross_sales,
        COALESCE(SUM(CASE WHEN status != 'cancelled' THEN subtotal ELSE 0 END), 0) AS item_sales,
        COALESCE(SUM(CASE WHEN status != 'cancelled' THEN delivery_fee ELSE 0 END), 0) AS delivery_sales,
        COALESCE(AVG(CASE WHEN status != 'cancelled' THEN total_amount ELSE NULL END), 0) AS average_order_value
      FROM orders
    `);

    // 2. Revenue Breakdown by Payment Method (Cash vs GCash)
    const [paymentBreakdown] = await db.query(`
      SELECT 
        p.payment_method,
        COUNT(o.id) AS transaction_count,
        COALESCE(SUM(o.total_amount), 0) AS total_revenue,
        COALESCE(SUM(CASE WHEN p.is_mismatch = 1 THEN 1 ELSE 0 END), 0) AS mismatch_count
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE o.status != 'cancelled'
      GROUP BY p.payment_method
    `);

    // 3. Top Selling Menu Items
    const [topItems] = await db.query(`
      SELECT 
        oi.menu_item_id,
        oi.item_name,
        c.name AS category_name,
        SUM(oi.quantity) AS total_units_sold,
        SUM(oi.subtotal) AS total_revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN menu_items m ON oi.menu_item_id = m.id
      JOIN categories c ON m.category_id = c.id
      WHERE o.status != 'cancelled'
      GROUP BY oi.menu_item_id, oi.item_name, c.name
      ORDER BY total_units_sold DESC
      LIMIT 10
    `);

    // 4. Sales by Order Type (Delivery vs Pickup)
    const [orderTypeBreakdown] = await db.query(`
      SELECT 
        order_type,
        COUNT(*) AS order_count,
        COALESCE(SUM(total_amount), 0) AS total_revenue
      FROM orders
      WHERE status != 'cancelled'
      GROUP BY order_type
    `);

    return res.json({
      success: true,
      period,
      summary: overall[0],
      paymentBreakdown,
      topItems,
      orderTypeBreakdown
    });
  } catch (err) {
    console.error('[Sales Report Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to generate sales report.' });
  }
}

/**
 * Smart Delivery Performance Report
 */
async function getDeliveryReport(req, res) {
  try {
    // 1. Delivery Vehicle Stats (Motorcycle vs Bicycle)
    const [vehicleStats] = await db.query(`
      SELECT 
        d.vehicle_type,
        COUNT(*) AS total_trips,
        COALESCE(AVG(d.distance_km), 0) AS avg_distance_km,
        COALESCE(SUM(d.final_fare), 0) AS total_fare_revenue,
        COALESCE(AVG(d.final_fare), 0) AS avg_fare
      FROM deliveries d
      JOIN orders o ON d.order_id = o.id
      WHERE o.status != 'cancelled'
      GROUP BY d.vehicle_type
    `);

    // 2. Rider Performance Breakdown
    const [riderStats] = await db.query(`
      SELECT 
        dp.id AS rider_id,
        dp.full_name AS rider_name,
        dp.vehicle_type,
        COUNT(d.id) AS completed_trips,
        COALESCE(SUM(d.final_fare), 0) AS total_fare_collected
      FROM delivery_personnel dp
      LEFT JOIN deliveries d ON dp.id = d.rider_id AND d.status = 'delivered'
      GROUP BY dp.id, dp.full_name, dp.vehicle_type
    `);

    // 3. Weather Condition Impact on Deliveries
    const [weatherStats] = await db.query(`
      SELECT 
        weather_condition,
        COUNT(*) AS count,
        COALESCE(AVG(final_fare), 0) AS avg_fare
      FROM deliveries
      GROUP BY weather_condition
    `);

    return res.json({
      success: true,
      vehicleStats,
      riderStats,
      weatherStats
    });
  } catch (err) {
    console.error('[Delivery Report Error]', err);
    return res.status(500).json({ success: false, message: 'Failed to generate delivery report.' });
  }
}

/**
 * Export Orders and Transactions to CSV Format
 */
async function exportOrdersCSV(req, res) {
  try {
    const [orders] = await db.query(`
      SELECT 
        o.order_number,
        o.created_at,
        CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, '')) AS customer_name,
        c.phone_number,
        o.order_type,
        o.status AS order_status,
        o.subtotal,
        o.delivery_fee,
        o.total_amount,
        p.payment_method,
        p.status AS payment_status,
        p.amount_paid,
        p.reference_no,
        p.is_mismatch,
        d.vehicle_type,
        d.distance_km,
        d.final_fare
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      LEFT JOIN payments p ON o.id = p.order_id
      LEFT JOIN deliveries d ON o.id = d.order_id
      ORDER BY o.created_at DESC
    `);

    const headers = [
      'Order Number',
      'Date & Time',
      'Customer Name',
      'Phone Number',
      'Order Type',
      'Order Status',
      'Subtotal (PHP)',
      'Delivery Fee (PHP)',
      'Total Amount (PHP)',
      'Payment Method',
      'Payment Status',
      'Amount Paid',
      'Reference No',
      'Payment Mismatch',
      'Delivery Vehicle',
      'Distance (km)',
      'Delivery Fare (PHP)'
    ];

    let csvContent = headers.join(',') + '\n';

    orders.forEach(row => {
      const line = [
        `"${row.order_number}"`,
        `"${row.created_at}"`,
        `"${(row.customer_name || '').replace(/"/g, '""')}"`,
        `"${row.phone_number || ''}"`,
        `"${row.order_type}"`,
        `"${row.order_status}"`,
        parseFloat(row.subtotal).toFixed(2),
        parseFloat(row.delivery_fee).toFixed(2),
        parseFloat(row.total_amount).toFixed(2),
        `"${row.payment_method || 'cash'}"`,
        `"${row.payment_status || 'pending'}"`,
        parseFloat(row.amount_paid || 0).toFixed(2),
        `"${row.reference_no || ''}"`,
        row.is_mismatch ? 'YES' : 'NO',
        `"${row.vehicle_type || 'N/A'}"`,
        row.distance_km || '0.00',
        parseFloat(row.final_fare || 0).toFixed(2)
      ];
      csvContent += line.join(',') + '\n';
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="diners_cafe_orders_report_${Date.now()}.csv"`);
    return res.send(csvContent);
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to generate CSV export.' });
  }
}

module.exports = {
  getSalesReport,
  getDeliveryReport,
  exportOrdersCSV
};
