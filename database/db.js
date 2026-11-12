const mysql = require('mysql2/promise');
const config = require('../src/config/config');
const fs = require('fs');
const path = require('path');

let pool = null;
let useFallback = false;
let sqliteDb = null;
let menuRefreshPromise = null;

// Helper to initialize SQLite fallback database if MySQL is unreachable
function initSqliteFallback() {
  try {
    const Database = require('better-sqlite3');
    const dbPath = process.env.SQLITE_PATH || path.join(__dirname, 'diners_cafe.sqlite');
    sqliteDb = new Database(dbPath);
    sqliteDb.pragma('journal_mode = WAL');
    sqliteDb.pragma('foreign_keys = ON');

    // Register CONCAT and CONVERT_TZ functions for cross-version SQLite compatibility
    try {
      sqliteDb.function('CONCAT', (...args) => args.filter(a => a !== null && a !== undefined).join(''));
      sqliteDb.function('CONVERT_TZ', (val, fromTz, toTz) => {
        if (!val) return null;
        const d = (typeof val === 'string' && val.toLowerCase() === 'now') ? new Date() : new Date(val);
        if (isNaN(d.getTime())) return val;
        // Asia/Manila is UTC+8
        const manilaTime = new Date(d.getTime() + 8 * 3600 * 1000);
        return manilaTime.toISOString().replace('T', ' ').substring(0, 19);
      });
    } catch (fnErr) {}

    // Create tables in SQLite
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        psid TEXT UNIQUE NOT NULL,
        first_name TEXT,
        last_name TEXT,
        phone_number TEXT,
        delivery_address TEXT,
        distance_km REAL DEFAULT 1.00,
        conversation_state TEXT DEFAULT 'IDLE',
        cart_json TEXT DEFAULT NULL,
        session_json TEXT DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS admins_staff (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT CHECK(role IN ('admin', 'staff', 'rider')) NOT NULL DEFAULT 'staff',
        phone_number TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        description TEXT,
        display_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS menu_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        price REAL NOT NULL DEFAULT 0.00,
        stock_quantity INTEGER NOT NULL DEFAULT 50,
        image_url TEXT,
        is_available INTEGER NOT NULL DEFAULT 1,
        is_bestseller INTEGER NOT NULL DEFAULT 0,
        synonyms TEXT DEFAULT NULL,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        preparation_time_min INTEGER NOT NULL DEFAULT 15,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        menu_item_id INTEGER UNIQUE NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
        stock_quantity INTEGER NOT NULL DEFAULT 50,
        low_stock_threshold INTEGER NOT NULL DEFAULT 10,
        unit TEXT NOT NULL DEFAULT 'servings',
        last_restocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS inventory_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        inventory_id INTEGER NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
        change_amount INTEGER NOT NULL,
        reason TEXT NOT NULL,
        reference_id TEXT,
        logged_by TEXT DEFAULT 'System',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_number TEXT UNIQUE NOT NULL,
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        order_type TEXT CHECK(order_type IN ('delivery', 'pickup')) NOT NULL DEFAULT 'delivery',
        status TEXT CHECK(status IN ('pending', 'preparing', 'dispatched', 'delivered', 'cancelled', 'PAID', 'FOR_CONFIRMATION', 'paid', 'for_confirmation')) NOT NULL DEFAULT 'pending',
        subtotal REAL NOT NULL DEFAULT 0.00,
        delivery_fee REAL NOT NULL DEFAULT 0.00,
        total_amount REAL NOT NULL DEFAULT 0.00,
        delivery_address TEXT,
        customer_phone TEXT DEFAULT NULL,
        payment_proof_image TEXT DEFAULT NULL,
        payment_ref_number TEXT DEFAULT NULL,
        payment_status TEXT DEFAULT 'Pending',
        distance_km REAL DEFAULT 1.00,
        customer_notes TEXT,
        cancellation_reason TEXT,
        feedback_requested_at DATETIME DEFAULT NULL,
        gcash_ref TEXT DEFAULT NULL,
        receipt_url TEXT DEFAULT NULL,
        void_status TEXT DEFAULT NULL,
        void_requested_by TEXT DEFAULT NULL,
        void_reason TEXT DEFAULT NULL,
        void_requested_at DATETIME DEFAULT NULL,
        customer_lat REAL DEFAULT NULL,
        customer_lng REAL DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS admin_gcash_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reference_number TEXT UNIQUE NOT NULL,
        amount REAL NOT NULL,
        status TEXT CHECK(status IN ('UNCLAIMED', 'MATCHED')) NOT NULL DEFAULT 'UNCLAIMED',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
        item_name TEXT NOT NULL,
        unit_price REAL NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        subtotal REAL NOT NULL,
        special_instructions TEXT
      );

      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER UNIQUE NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        payment_method TEXT CHECK(payment_method IN ('cash', 'gcash', 'xendit')) NOT NULL DEFAULT 'cash',
        amount_expected REAL NOT NULL,
        amount_paid REAL NOT NULL DEFAULT 0.00,
        reference_no TEXT,
        receipt_url TEXT DEFAULT NULL,
        status TEXT CHECK(status IN ('pending', 'verified', 'mismatch_flagged', 'completed')) NOT NULL DEFAULT 'pending',
        is_mismatch INTEGER NOT NULL DEFAULT 0,
        mismatch_notes TEXT,
        verified_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS delivery_personnel (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES admins_staff(id) ON DELETE SET NULL,
        full_name TEXT NOT NULL,
        phone_number TEXT NOT NULL,
        vehicle_type TEXT CHECK(vehicle_type IN ('motorcycle', 'bicycle')) NOT NULL DEFAULT 'motorcycle',
        vehicle_plate_no TEXT,
        status TEXT CHECK(status IN ('available', 'on_delivery', 'offline')) NOT NULL DEFAULT 'available',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER UNIQUE NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        rider_id INTEGER REFERENCES delivery_personnel(id) ON DELETE SET NULL,
        vehicle_type TEXT CHECK(vehicle_type IN ('motorcycle', 'bicycle')) NOT NULL DEFAULT 'motorcycle',
        distance_km REAL NOT NULL DEFAULT 1.00,
        weather_condition TEXT CHECK(weather_condition IN ('sunny', 'light_rain', 'heavy_rain', 'extreme_heat')) NOT NULL DEFAULT 'sunny',
        computed_fare REAL NOT NULL DEFAULT 49.00,
        final_fare REAL NOT NULL DEFAULT 49.00,
        is_fare_overridden INTEGER NOT NULL DEFAULT 0,
        override_reason TEXT,
        status TEXT CHECK(status IN ('pending', 'assigned', 'dispatched', 'delivered', 'failed', 'cancelled')) NOT NULL DEFAULT 'pending',
        estimated_time_min INTEGER NOT NULL DEFAULT 20,
        dispatched_at DATETIME,
        delivered_at DATETIME,
        customer_lat REAL DEFAULT NULL,
        customer_lng REAL DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER UNIQUE NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        rating INTEGER NOT NULL,
        comments TEXT,
        sentiment TEXT DEFAULT 'positive',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipient_psid TEXT NOT NULL,
        channel TEXT DEFAULT 'messenger',
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT DEFAULT 'sent',
        sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS chatbot_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
        psid TEXT NOT NULL,
        incoming_message TEXT,
        detected_intent TEXT,
        confidence REAL DEFAULT 1.000,
        bot_response TEXT,
        raw_payload TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS promotions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        promo_type TEXT NOT NULL DEFAULT 'Product Discount',
        banner_image_url TEXT DEFAULT NULL,
        perk_description TEXT NOT NULL,
        applicable_scope TEXT DEFAULT 'All Menu Items',
        start_date TEXT DEFAULT NULL,
        end_date TEXT DEFAULT NULL,
        description TEXT DEFAULT NULL,
        is_active INTEGER DEFAULT 1,
        broadcast_count INTEGER DEFAULT 0,
        last_broadcast_at DATETIME DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ingredients (
        ingredient_id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        unit TEXT NOT NULL,
        stock_quantity REAL NOT NULL DEFAULT 0.00,
        reorder_level REAL NOT NULL DEFAULT 0.00,
        cost_per_unit REAL NOT NULL DEFAULT 0.00,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS recipe_items (
        recipe_id INTEGER PRIMARY KEY AUTOINCREMENT,
        menu_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
        ingredient_id INTEGER NOT NULL REFERENCES ingredients(ingredient_id) ON DELETE CASCADE,
        quantity_required REAL NOT NULL,
        UNIQUE(menu_id, ingredient_id)
      );

      CREATE TABLE IF NOT EXISTS ingredient_logs (
        log_id INTEGER PRIMARY KEY AUTOINCREMENT,
        ingredient_id INTEGER NOT NULL REFERENCES ingredients(ingredient_id) ON DELETE CASCADE,
        change_amount REAL NOT NULL,
        change_type TEXT CHECK(change_type IN ('order_deduction', 'restock', 'spoilage_waste', 'adjustment')) NOT NULL,
        reference_order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS store_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gcash_account_name TEXT NOT NULL DEFAULT "Diner's Cafe",
        gcash_account_number TEXT NOT NULL DEFAULT "09XXXXXXXXX",
        gcash_qr_image_url TEXT DEFAULT NULL,
        store_name TEXT NOT NULL DEFAULT "Diner's Cafe - Main Branch",
        store_address TEXT NOT NULL DEFAULT "123 Boni Ave, Mandaluyong City",
        store_latitude REAL NOT NULL DEFAULT 14.5794,
        store_longitude REAL NOT NULL DEFAULT 121.0359,
        max_delivery_radius_km REAL NOT NULL DEFAULT 3.00,
        chatbot_enabled INTEGER DEFAULT 1,
        store_open_time TEXT DEFAULT '09:00:00',
        store_close_time TEXT DEFAULT '21:00:00',
        store_timezone TEXT DEFAULT 'Asia/Manila',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS system_settings (
        id INTEGER PRIMARY KEY DEFAULT 1,
        chatbot_enabled INTEGER DEFAULT 1,
        store_status TEXT DEFAULT 'OPEN',
        store_open_time TEXT DEFAULT '09:00:00',
        store_close_time TEXT DEFAULT '21:00:00',
        store_timezone TEXT DEFAULT 'Asia/Manila',
        is_manual_override INTEGER DEFAULT 0,
        override_at DATETIME DEFAULT NULL,
        override_by TEXT DEFAULT NULL,
        fare_base REAL DEFAULT 49.00,
        fare_per_05km REAL DEFAULT 12.00,
        fare_fuel_cost REAL DEFAULT 2.83,
        fare_maintenance REAL DEFAULT 7.50,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS delivery_fare_config (
        id INTEGER PRIMARY KEY,
        fare_base REAL DEFAULT 49.00,
        fare_per_05km REAL DEFAULT 12.00,
        fare_fuel_cost REAL DEFAULT 2.83,
        fare_maintenance REAL DEFAULT 7.50,
        updated_by TEXT DEFAULT 'Admin',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS store_status_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        previous_status TEXT,
        new_status TEXT,
        is_manual_override INTEGER DEFAULT 0,
        trigger_type TEXT,
        triggered_by TEXT DEFAULT 'System',
        details TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS order_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        order_number TEXT,
        action TEXT NOT NULL,
        actor_id INTEGER,
        actor_name TEXT,
        reason TEXT,
        details TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed default system_settings if empty
    try {
      const sysCount = sqliteDb.prepare(`SELECT COUNT(*) as count FROM system_settings`).get();
      if (sysCount && sysCount.count === 0) {
        sqliteDb.prepare(`
          INSERT INTO system_settings (id, chatbot_enabled, store_open_time, store_close_time, store_timezone)
          VALUES (1, 1, '09:00:00', '21:00:00', 'Asia/Manila')
        `).run();
      }
    } catch (e) {
      console.warn('[SQLite] system_settings seed check skipped:', e.message);
    }

    // Seed default store settings if empty
    try {
      const storeCount = sqliteDb.prepare(`SELECT COUNT(*) as count FROM store_settings`).get();
      if (storeCount && storeCount.count === 0) {
        sqliteDb.prepare(`
          INSERT INTO store_settings (id, gcash_account_name, gcash_account_number, gcash_qr_image_url, store_name, store_address, store_latitude, store_longitude, max_delivery_radius_km)
          VALUES (1, 'Diner''s Cafe - Tondo Branch', '09171234567', '/uploads/qr/gcash_qr_CHECKOUT.png', 'Diner''s Cafe Tondo', 'Diner''s Cafe, Tondo, Manila', 14.6143686, 120.9642334, 3.00)
        `).run();
      }
    } catch (e) {
      console.warn('[SQLite] store_settings seed check skipped:', e.message);
    }

    // Promotions deactivated per user request
    try {
      sqliteDb.exec(`UPDATE promotions SET is_active = 0;`);
    } catch (e) {
      // Ignore if table does not exist yet
    }

    // Migration: Add void request columns if not present
    try { sqliteDb.exec(`ALTER TABLE orders ADD COLUMN void_status TEXT DEFAULT NULL;`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE orders ADD COLUMN void_requested_by TEXT DEFAULT NULL;`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE orders ADD COLUMN void_reason TEXT DEFAULT NULL;`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE orders ADD COLUMN void_requested_at DATETIME DEFAULT NULL;`); } catch (e) { }

    // Conversation Flow v2 migrations
    try { sqliteDb.exec(`ALTER TABLE customers ADD COLUMN session_json TEXT DEFAULT NULL;`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE orders ADD COLUMN feedback_requested_at DATETIME DEFAULT NULL;`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE orders ADD COLUMN gcash_ref TEXT DEFAULT NULL;`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE orders ADD COLUMN receipt_url TEXT DEFAULT NULL;`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE menu_items ADD COLUMN synonyms TEXT DEFAULT NULL;`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE menu_items ADD COLUMN is_deleted INTEGER DEFAULT 0;`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE menu_items ADD COLUMN stock_quantity INTEGER NOT NULL DEFAULT 0;`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE orders ADD COLUMN customer_phone TEXT DEFAULT NULL;`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE orders ADD COLUMN payment_proof_image TEXT DEFAULT NULL;`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE orders ADD COLUMN payment_ref_number TEXT DEFAULT NULL;`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE orders ADD COLUMN payment_status TEXT DEFAULT 'Pending';`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE store_settings ADD COLUMN gcash_account_name TEXT DEFAULT "Diner's Cafe";`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE store_settings ADD COLUMN gcash_account_number TEXT DEFAULT "09XXXXXXXXX";`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE store_settings ADD COLUMN gcash_qr_image_url TEXT DEFAULT NULL;`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE orders ADD COLUMN customer_lat REAL DEFAULT NULL;`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE orders ADD COLUMN customer_lng REAL DEFAULT NULL;`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE deliveries ADD COLUMN customer_lat REAL DEFAULT NULL;`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE orders ADD COLUMN is_preorder INTEGER DEFAULT 0;`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE orders ADD COLUMN landmark TEXT DEFAULT NULL;`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE orders ADD COLUMN dining_mode TEXT DEFAULT 'Delivery';`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE orders ADD COLUMN arriving_time TEXT DEFAULT NULL;`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE orders ADD COLUMN note TEXT DEFAULT NULL;`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE payments ADD COLUMN receipt_url TEXT DEFAULT NULL;`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE system_settings ADD COLUMN chatbot_enabled INTEGER DEFAULT 1;`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE system_settings ADD COLUMN store_status TEXT DEFAULT 'OPEN';`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE system_settings ADD COLUMN store_open_time TEXT DEFAULT '09:00:00';`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE system_settings ADD COLUMN store_close_time TEXT DEFAULT '21:00:00';`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE system_settings ADD COLUMN store_timezone TEXT DEFAULT 'Asia/Manila';`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE system_settings ADD COLUMN is_manual_override INTEGER DEFAULT 0;`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE system_settings ADD COLUMN override_at DATETIME DEFAULT NULL;`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE system_settings ADD COLUMN override_by TEXT DEFAULT NULL;`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE system_settings ADD COLUMN fare_base REAL DEFAULT 49.00;`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE system_settings ADD COLUMN fare_per_05km REAL DEFAULT 12.00;`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE system_settings ADD COLUMN fare_fuel_cost REAL DEFAULT 2.83;`); } catch (e) { }
    try { sqliteDb.exec(`ALTER TABLE system_settings ADD COLUMN fare_maintenance REAL DEFAULT 7.50;`); } catch (e) { }

    try {
      sqliteDb.exec(`
        UPDATE system_settings
        SET fare_base = COALESCE(fare_base, 49.00),
            fare_per_05km = COALESCE(fare_per_05km, 12.00),
            fare_fuel_cost = COALESCE(fare_fuel_cost, 2.83),
            fare_maintenance = COALESCE(fare_maintenance, 7.50)
        WHERE id = 1;
      `);
    } catch (e) { }

    try {
      const fareCount = sqliteDb.prepare(`SELECT COUNT(*) as count FROM delivery_fare_config`).get();
      if (fareCount && fareCount.count === 0) {
        sqliteDb.prepare(`
          INSERT INTO delivery_fare_config (id, fare_base, fare_per_05km, fare_fuel_cost, fare_maintenance, updated_by)
          VALUES (1, 49.00, 12.00, 2.83, 7.50, 'Admin')
        `).run();
      }
    } catch (e) { }

    // Seed admin_gcash_transactions if empty
    try {
      const insertAdminGcash = sqliteDb.prepare(`
        INSERT OR IGNORE INTO admin_gcash_transactions (reference_number, amount, status)
        VALUES (?, ?, ?)
      `);
      insertAdminGcash.run('1009876543210', 145.00, 'UNCLAIMED');
      insertAdminGcash.run('9876543210123', 200.00, 'UNCLAIMED');
      insertAdminGcash.run('1122334455667', 100.00, 'UNCLAIMED');
      insertAdminGcash.run('9988776655443', 250.00, 'UNCLAIMED');
    } catch (seedErr) {
      // Ignore if error
    }

    // Migration: Update deliveries status check constraint to include 'cancelled'
    try {
      const tableSql = sqliteDb.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='deliveries'").get();
      if (tableSql && tableSql.sql && !tableSql.sql.includes("'cancelled'")) {
        sqliteDb.exec(`
          PRAGMA foreign_keys=off;
          CREATE TABLE deliveries_migration_temp (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER UNIQUE NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
            rider_id INTEGER REFERENCES delivery_personnel(id) ON DELETE SET NULL,
            vehicle_type TEXT CHECK(vehicle_type IN ('motorcycle', 'bicycle')) NOT NULL DEFAULT 'motorcycle',
            distance_km REAL NOT NULL DEFAULT 1.00,
            weather_condition TEXT CHECK(weather_condition IN ('sunny', 'light_rain', 'heavy_rain', 'extreme_heat')) NOT NULL DEFAULT 'sunny',
            computed_fare REAL NOT NULL DEFAULT 49.00,
            final_fare REAL NOT NULL DEFAULT 49.00,
            is_fare_overridden INTEGER NOT NULL DEFAULT 0,
            override_reason TEXT,
            status TEXT CHECK(status IN ('pending', 'assigned', 'dispatched', 'delivered', 'failed', 'cancelled')) NOT NULL DEFAULT 'pending',
            estimated_time_min INTEGER NOT NULL DEFAULT 20,
            dispatched_at DATETIME,
            delivered_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
          INSERT INTO deliveries_migration_temp SELECT * FROM deliveries;
          DROP TABLE deliveries;
          ALTER TABLE deliveries_migration_temp RENAME TO deliveries;
          PRAGMA foreign_keys=on;
        `);
        console.log('[Database] deliveries table check constraint updated with cancelled status.');
      }
    } catch (migErr) {
      console.warn('[Database] Deliveries table migration notice:', migErr.message);
    }

    // Migration: Update payments payment_method check constraint to include 'xendit'
    try {
      const paySql = sqliteDb.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='payments'").get();
      if (paySql && paySql.sql && !paySql.sql.includes("'xendit'")) {
        sqliteDb.exec(`
          PRAGMA foreign_keys=off;
          CREATE TABLE payments_migration_temp (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER UNIQUE NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
            payment_method TEXT CHECK(payment_method IN ('cash', 'gcash', 'xendit')) NOT NULL DEFAULT 'cash',
            amount_expected REAL NOT NULL,
            amount_paid REAL NOT NULL DEFAULT 0.00,
            reference_no TEXT,
            receipt_url TEXT DEFAULT NULL,
            status TEXT CHECK(status IN ('pending', 'verified', 'mismatch_flagged', 'completed')) NOT NULL DEFAULT 'pending',
            is_mismatch INTEGER NOT NULL DEFAULT 0,
            mismatch_notes TEXT,
            verified_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
          INSERT INTO payments_migration_temp (id, order_id, payment_method, amount_expected, amount_paid, reference_no, status, is_mismatch, mismatch_notes, verified_at, created_at, updated_at)
          SELECT id, order_id, payment_method, amount_expected, amount_paid, reference_no, status, is_mismatch, mismatch_notes, verified_at, created_at, updated_at FROM payments;
          DROP TABLE payments;
          ALTER TABLE payments_migration_temp RENAME TO payments;
          PRAGMA foreign_keys=on;
        `);
        console.log('[Database] payments table check constraint updated with xendit method.');
      }
    } catch (payMigErr) {
      console.warn('[Database] Payments table migration notice:', payMigErr.message);
    }

    // Populate synonyms for existing items if missing
    try {
      const updateSyn = sqliteDb.prepare('UPDATE menu_items SET synonyms = ? WHERE id = ? AND (synonyms IS NULL OR synonyms = "")');
      updateSyn.run('spanish latte, spanish, spanish coffee', 1);
      updateSyn.run('macchiato, caramel', 2);
      updateSyn.run('americano, iced americano', 3);
      updateSyn.run('matcha, matcha latte, kyoto matcha', 4);
      updateSyn.run('hibiscus, berry tea, iced tea', 5);
      updateSyn.run('tapa, beef tapa, tapsilog, rice bowl', 6);
      updateSyn.run('carbonara, pasta, truffle pasta', 7);
      updateSyn.run('croissant, almond croissant', 8);
      updateSyn.run('cookie, chocolate cookie, choco cookie', 9);
      updateSyn.run('panini, chicken panini, pesto panini', 10);
    } catch (synErr) {
      // Ignore if table/rows don't exist yet
    }

    // Check if seed data exists
    const userCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM admins_staff').get().count;
    if (userCount === 0) {
      seedSqliteData();
    }

    // Auto-refresh menu to verified 91 items if legacy or unpopulated
    try {
      const biscoffCheck = sqliteDb.prepare("SELECT COUNT(*) as count FROM menu_items WHERE name = 'Biscoff Cheesecake'").get();
      if ((!biscoffCheck || biscoffCheck.count === 0) && !menuRefreshPromise) {
        console.log('[Database] Populating verified fresh menu board items...');
        const { runMigration } = require('./migrations/refresh_full_menu');
        menuRefreshPromise = runMigration().catch(err => console.warn('[Database] Auto-refresh menu error:', err.message));
      }
    } catch (menuCheckErr) {
      console.warn('[Database] Menu verification check skipped:', menuCheckErr.message);
    }
    console.log('[Database] Fallback SQLite database connected and verified at', dbPath);
    return true;
  } catch (err) {
    console.error('[Database] SQLite fallback initialization error:', err.message);
    return false;
  }
}

function seedSqliteData() {
  const insertUser = sqliteDb.prepare(`
    INSERT INTO admins_staff (id, full_name, email, password_hash, role, phone_number, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('password123', 10);
  insertUser.run(1, 'Diner Admin', 'admin@dinerscafe.ph', hash, 'admin', '+63 917 111 2222', 1);
  insertUser.run(2, 'Maria Clara (Barista)', 'staff@dinerscafe.ph', hash, 'staff', '+63 917 333 4444', 1);
  insertUser.run(3, 'Marco Santos (Motorcycle Rider)', 'rider1@dinerscafe.ph', hash, 'rider', '+63 918 555 6666', 1);
  insertUser.run(4, 'Leo Reyes (Bicycle Eco-Rider)', 'rider2@dinerscafe.ph', hash, 'rider', '+63 918 777 8888', 1);

  const insertRider = sqliteDb.prepare(`
    INSERT INTO delivery_personnel (id, user_id, full_name, phone_number, vehicle_type, vehicle_plate_no, status, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertRider.run(1, 3, 'Marco Santos', '+63 918 555 6666', 'motorcycle', 'MC-7890-PH', 'available', 1);
  insertRider.run(2, 4, 'Leo Reyes', '+63 918 777 8888', 'bicycle', 'ECO-BIKE-02', 'available', 1);

  const insertCat = sqliteDb.prepare(`
    INSERT INTO categories (id, name, slug, description, display_order, is_active)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertCat.run(1, 'Espresso & Coffee', 'coffee', 'Artisanal single-origin espresso and handcrafted coffee brews', 1, 1);
  insertCat.run(2, 'Non-Coffee & Refreshers', 'non-coffee', 'Creamy matcha, artisanal teas, and iced fruit infusions', 2, 1);
  insertCat.run(3, 'All-Day Breakfast & Meals', 'meals', 'Hearty Filipino and Western comfort food, freshly cooked', 3, 1);
  insertCat.run(4, 'Artisanal Pastries & Desserts', 'pastries', 'Freshly baked croissants, cookies, and decadent cakes', 4, 1);
  insertCat.run(5, 'Sandwiches & Light Bites', 'snacks', 'Grilled sourdough panini, wraps, and savory cafe sides', 5, 1);

  const insertItem = sqliteDb.prepare(`
    INSERT INTO menu_items (id, category_id, name, description, price, image_url, is_available, is_bestseller, synonyms, preparation_time_min)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertItem.run(1, 1, 'Signature Spanish Latte', 'Double espresso shot with creamy condensed milk and velvety textured milk', 145.00, 'https://images.unsplash.com/photo-1541167760496-1628856ab772?w=500&auto=format&fit=crop&q=60', 1, 1, 'spanish latte, spanish, spanish coffee', 5);
  insertItem.run(2, 1, 'Caramel Macchiato', 'Freshly steamed milk with vanilla-flavored syrup, marked with espresso and caramel drizzle', 150.00, 'https://images.unsplash.com/photo-1485808191679-5f86510681a2?w=500&auto=format&fit=crop&q=60', 1, 1, 'macchiato, caramel', 5);
  insertItem.run(3, 1, 'Iced Americano', 'Bold rich espresso shots topped with cold water and ice for a crisp finish', 110.00, 'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?w=500&auto=format&fit=crop&q=60', 1, 0, 'americano, iced americano', 4);
  insertItem.run(4, 2, 'Kyoto Uji Matcha Latte', 'Ceremonial grade green tea whisked with creamy oat or dairy milk', 160.00, 'https://images.unsplash.com/photo-1536256263959-770b48d82b0a?w=500&auto=format&fit=crop&q=60', 1, 1, 'matcha, matcha latte, kyoto matcha', 6);
  insertItem.run(5, 2, 'Hibiscus Berry Iced Tea', 'Refreshing cold brewed botanical tea infused with wild berries and mint', 125.00, 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=500&auto=format&fit=crop&q=60', 1, 0, 'hibiscus, berry tea, iced tea', 4);
  insertItem.run(6, 3, 'Classic Beef Tapa Rice Bowl', 'Tender marinated beef sirloin slices, garlic fried rice, and sunny-side-up egg', 195.00, 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=500&auto=format&fit=crop&q=60', 1, 1, 'tapa, beef tapa, tapsilog, rice bowl', 15);
  insertItem.run(7, 3, 'Creamy Truffle Bacon Carbonara', 'Fettuccine pasta tossed in rich parmesan truffle cream with crispy bacon bits', 220.00, 'https://images.unsplash.com/photo-1612874742237-6526221588e3?w=500&auto=format&fit=crop&q=60', 1, 1, 'carbonara, pasta, truffle pasta', 15);
  insertItem.run(8, 4, 'Almond Butter Croissant', 'Flaky, buttery French croissant filled with rich almond cream and toasted flakes', 95.00, 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=500&auto=format&fit=crop&q=60', 1, 1, 'croissant, almond croissant', 3);
  insertItem.run(9, 4, 'Dark Chocolate Chunk Cookie', 'Chewy warm cookie loaded with 70% Belgian dark chocolate chunks and sea salt', 75.00, 'https://images.unsplash.com/photo-1499636136210-6f4ee915583e?w=500&auto=format&fit=crop&q=60', 1, 0, 'cookie, chocolate cookie, choco cookie', 2);
  insertItem.run(10, 5, 'Grilled Chicken Pesto Panini', 'Herb-roasted chicken breast, basil pesto, mozzarella on toasted artisan sourdough', 175.00, 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?w=500&auto=format&fit=crop&q=60', 1, 1, 'panini, chicken panini, pesto panini', 10);

  const insertInv = sqliteDb.prepare(`
    INSERT INTO inventory (id, menu_item_id, stock_quantity, low_stock_threshold, unit, last_restocked_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  insertInv.run(1, 1, 45, 10, 'cups');
  insertInv.run(2, 2, 38, 10, 'cups');
  insertInv.run(3, 3, 50, 10, 'cups');
  insertInv.run(4, 4, 30, 8, 'cups');
  insertInv.run(5, 5, 25, 8, 'cups');
  insertInv.run(6, 6, 20, 5, 'servings');
  insertInv.run(7, 7, 18, 5, 'servings');
  insertInv.run(8, 8, 14, 5, 'pieces');
  insertInv.run(9, 9, 22, 5, 'pieces');
  insertInv.run(10, 10, 16, 5, 'servings');

  const insertCust = sqliteDb.prepare(`
    INSERT INTO customers (id, psid, first_name, last_name, phone_number, delivery_address, distance_km, conversation_state)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertCust.run(1, 'PSID_SAMPLE_001', 'Juan', 'Dela Cruz', '0917-123-4567', 'Unit 402, Acacia Heights, Maple St.', 1.50, 'IDLE');
  insertCust.run(2, 'PSID_SAMPLE_002', 'Sofia', 'Reyes', '0918-234-5678', 'Bldg B, Sunshine Residences, 2nd Ave', 2.20, 'IDLE');
  insertCust.run(3, 'PSID_SAMPLE_003', 'Miguel', 'Tan', '0919-345-6789', '77 Oakwood Drive, Greenbelt', 0.80, 'IDLE');

  const insertOrder = sqliteDb.prepare(`
    INSERT INTO orders (id, order_number, customer_id, order_type, status, subtotal, delivery_fee, total_amount, delivery_address, distance_km, customer_notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-2 hours'))
  `);
  insertOrder.run(1, 'DNR-20260901-001', 1, 'delivery', 'delivered', 340.00, 75.00, 415.00, 'Unit 402, Acacia Heights, Maple St.', 1.50, 'Please knock gently.');
  insertOrder.run(2, 'DNR-20260901-002', 2, 'delivery', 'dispatched', 270.00, 60.00, 330.00, 'Bldg B, Sunshine Residences, 2nd Ave', 2.20, 'Leave at security lobby.');
  insertOrder.run(3, 'DNR-20260901-003', 3, 'delivery', 'preparing', 335.00, 50.00, 385.00, '77 Oakwood Drive, Greenbelt', 0.80, 'Less ice on latte please.');

  const insertOrderItem = sqliteDb.prepare(`
    INSERT INTO order_items (id, order_id, menu_item_id, item_name, unit_price, quantity, subtotal, special_instructions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertOrderItem.run(1, 1, 1, 'Signature Spanish Latte', 145.00, 1, 145.00, 'Less sweet');
  insertOrderItem.run(2, 1, 6, 'Classic Beef Tapa Rice Bowl', 195.00, 1, 195.00, 'Egg well done');
  insertOrderItem.run(3, 2, 4, 'Kyoto Uji Matcha Latte', 160.00, 1, 160.00, 'Oat milk');
  insertOrderItem.run(4, 2, 3, 'Iced Americano', 110.00, 1, 110.00, 'Extra shot');
  insertOrderItem.run(5, 3, 1, 'Signature Spanish Latte', 145.00, 1, 145.00, 'Regular sweetness');
  insertOrderItem.run(6, 3, 6, 'Classic Beef Tapa Rice Bowl', 195.00, 1, 195.00, 'Garlic rice');

  const insertPayment = sqliteDb.prepare(`
    INSERT INTO payments (id, order_id, payment_method, amount_expected, amount_paid, reference_no, status, is_mismatch, verified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  insertPayment.run(1, 1, 'gcash', 415.00, 415.00, 'GCASH-REF-987654321', 'completed', 0);
  insertPayment.run(2, 2, 'cash', 330.00, 330.00, null, 'pending', 0);
  insertPayment.run(3, 3, 'gcash', 385.00, 385.00, 'GCASH-REF-123456789', 'verified', 0);

  const insertDelivery = sqliteDb.prepare(`
    INSERT INTO deliveries (id, order_id, rider_id, vehicle_type, distance_km, weather_condition, computed_fare, final_fare, is_fare_overridden, status, estimated_time_min, dispatched_at, delivered_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-45 minutes'), datetime('now', '-20 minutes'))
  `);
  insertDelivery.run(1, 1, 1, 'motorcycle', 1.50, 'sunny', 73.83, 75.00, 0, 'delivered', 20);
  insertDelivery.run(2, 2, 2, 'bicycle', 2.20, 'sunny', 61.60, 60.00, 0, 'dispatched', 25);
  insertDelivery.run(3, 3, 1, 'motorcycle', 0.80, 'sunny', 49.00, 50.00, 0, 'assigned', 15);

  const insertFeedback = sqliteDb.prepare(`
    INSERT INTO feedback (id, order_id, customer_id, rating, comments, sentiment, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', '-15 minutes'))
  `);
  insertFeedback.run(1, 1, 1, 5, 'The Spanish Latte was super aromatic and the beef tapa arrived steaming hot! Fast delivery by Kuya Marco!', 'positive');

  console.log('[Database] SQLite seed data successfully inserted.');
}

let bomSeedPromise = null;

/**
 * Seed initial raw ingredients and sample recipes for 3 menu items idempotently
 * (Caramel Macchiato, Brown Sugar Milktea, Meaty Dog) after menu_items population.
 */
async function seedBomDefaults() {
  if (bomSeedPromise) return bomSeedPromise;
  bomSeedPromise = (async () => {
    try {
      const [ingCountRows] = await query(`SELECT COUNT(*) AS cnt FROM ingredients`);
      const ingCount = Number(ingCountRows?.[0]?.cnt || ingCountRows?.[0]?.['COUNT(*)'] || 0);
      if (ingCount === 0) {
        const defaultIngredients = [
          ['Espresso Beans', 'g', 5000.00, 500.00, 1.80],
          ['Full Cream Milk', 'ml', 10000.00, 1500.00, 0.12],
          ['Caramel Syrup', 'ml', 3000.00, 300.00, 0.45],
          ['16oz Cup', 'pcs', 500.00, 50.00, 3.50],
          ['Black Tea Concentrate', 'ml', 6000.00, 1000.00, 0.08],
          ['Brown Sugar Syrup', 'ml', 3000.00, 300.00, 0.38],
          ['Tapioca Pearls', 'g', 4000.00, 500.00, 0.18],
          ['Hotdog Bun', 'pcs', 200.00, 30.00, 10.00],
          ['Jumbo Sausage', 'pcs', 200.00, 30.00, 28.00],
          ['Beef Chili Sauce', 'g', 5000.00, 600.00, 0.35],
          ['Grated Cheese', 'g', 3000.00, 400.00, 0.55]
        ];
        for (const row of defaultIngredients) {
          await query(
            `INSERT INTO ingredients (name, unit, stock_quantity, reorder_level, cost_per_unit) VALUES (?, ?, ?, ?, ?)`,
            row
          ).catch(() => {});
        }
      }

      const [recipeCountRows] = await query(`SELECT COUNT(*) AS cnt FROM recipe_items`);
      const recipeCount = Number(recipeCountRows?.[0]?.cnt || recipeCountRows?.[0]?.['COUNT(*)'] || 0);
      if (recipeCount === 0) {
        const sampleRecipes = [
          {
            menuName: 'caramel macchiato',
            ingredients: [
              ['Espresso Beans', 18.00],
              ['Full Cream Milk', 200.00],
              ['Caramel Syrup', 30.00],
              ['16oz Cup', 1.00]
            ]
          },
          {
            menuName: 'brown sugar milktea',
            ingredients: [
              ['Black Tea Concentrate', 150.00],
              ['Full Cream Milk', 120.00],
              ['Brown Sugar Syrup', 35.00],
              ['Tapioca Pearls', 50.00],
              ['16oz Cup', 1.00]
            ]
          },
          {
            menuName: 'meaty dog',
            ingredients: [
              ['Hotdog Bun', 1.00],
              ['Jumbo Sausage', 1.00],
              ['Beef Chili Sauce', 60.00],
              ['Grated Cheese', 25.00]
            ]
          }
        ];

        for (const recipe of sampleRecipes) {
          const [mRows] = await query(`SELECT id FROM menu_items WHERE LOWER(name) = ? LIMIT 1`, [recipe.menuName]);
          if (!mRows || mRows.length === 0) continue;
          const menuId = mRows[0].id;

          for (const [ingName, qtyReq] of recipe.ingredients) {
            const [iRows] = await query(`SELECT ingredient_id FROM ingredients WHERE name = ? LIMIT 1`, [ingName]);
            if (!iRows || iRows.length === 0) continue;
            await query(
              `INSERT INTO recipe_items (menu_id, ingredient_id, quantity_required) VALUES (?, ?, ?)`,
              [menuId, iRows[0].ingredient_id, qtyReq]
            ).catch(() => {});
          }
        }
      }
    } catch (bomErr) {
      console.warn('[Database] BOM seed warning:', bomErr.message);
    }
  })();
  return bomSeedPromise;
}

// Initialize MySQL pool
async function initDatabase() {
  if (process.env.DB_FORCE_SQLITE === '1') {
    console.log('[Database] DB_FORCE_SQLITE is set. Using SQLite database...');
    useFallback = true;
    const ok = initSqliteFallback();
    if (menuRefreshPromise) {
      await menuRefreshPromise;
    }
    await seedBomDefaults();
    return ok;
  }

  try {
    const isCloudHost = config.db.host && (
      config.db.host.includes('tidbcloud.com') ||
      config.db.host.includes('aivencloud.com') ||
      config.db.host.includes('clever-cloud.com') ||
      process.env.DB_SSL === 'true' ||
      process.env.DB_SSL === '1'
    );

    const poolOptions = {
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 15000
    };

    if (isCloudHost) {
      poolOptions.ssl = { minVersion: 'TLSv1.2', rejectUnauthorized: true };
    }

    pool = mysql.createPool(poolOptions);

    const conn = await pool.getConnection();
    await conn.ping();

    // MySQL idempotent migrations
    try {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS system_settings (
          id INT PRIMARY KEY DEFAULT 1,
          chatbot_enabled TINYINT(1) DEFAULT 1,
          store_status VARCHAR(20) DEFAULT 'OPEN',
          store_open_time VARCHAR(20) DEFAULT '09:00:00',
          store_close_time VARCHAR(20) DEFAULT '21:00:00',
          store_timezone VARCHAR(50) DEFAULT 'Asia/Manila',
          is_manual_override TINYINT(1) DEFAULT 0,
          override_at DATETIME NULL,
          override_by VARCHAR(100) NULL,
          fare_base DECIMAL(10,2) DEFAULT 49.00,
          fare_per_05km DECIMAL(10,2) DEFAULT 12.00,
          fare_fuel_cost DECIMAL(10,2) DEFAULT 2.83,
          fare_maintenance DECIMAL(10,2) DEFAULT 7.50,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await conn.query(`
        INSERT INTO system_settings (id, chatbot_enabled, store_status, store_open_time, store_close_time, store_timezone)
        VALUES (1, 1, 'OPEN', '09:00:00', '21:00:00', 'Asia/Manila')
        ON DUPLICATE KEY UPDATE id = id;
      `).catch(() => {});

      const cols = [
        { table: 'customers', column: 'session_json', type: 'TEXT NULL' },
        { table: 'orders', column: 'feedback_requested_at', type: 'DATETIME NULL' },
        { table: 'orders', column: 'gcash_ref', type: 'VARCHAR(100) NULL' },
        { table: 'orders', column: 'receipt_url', type: 'TEXT NULL' },
        { table: 'menu_items', column: 'synonyms', type: 'VARCHAR(255) NULL' },
        { table: 'menu_items', column: 'is_deleted', type: 'TINYINT(1) NOT NULL DEFAULT 0' },
        { table: 'menu_items', column: 'stock_quantity', type: 'INT NOT NULL DEFAULT 0' },
        { table: 'orders', column: 'customer_phone', type: 'VARCHAR(50) NULL' },
        { table: 'orders', column: 'payment_proof_image', type: 'VARCHAR(500) NULL' },
        { table: 'orders', column: 'payment_ref_number', type: 'VARCHAR(100) NULL' },
        { table: 'orders', column: 'payment_status', type: "VARCHAR(50) DEFAULT 'Pending'" },
        { table: 'orders', column: 'customer_lat', type: 'DECIMAL(10, 7) NULL' },
        { table: 'orders', column: 'customer_lng', type: 'DECIMAL(10, 7) NULL' },
        { table: 'orders', column: 'void_status', type: 'VARCHAR(50) NULL' },
        { table: 'orders', column: 'void_requested_by', type: 'VARCHAR(100) NULL' },
        { table: 'orders', column: 'void_reason', type: 'TEXT NULL' },
        { table: 'orders', column: 'void_requested_at', type: 'DATETIME NULL' },
        { table: 'orders', column: 'landmark', type: 'VARCHAR(255) NULL' },
        { table: 'orders', column: 'dining_mode', type: "VARCHAR(50) DEFAULT 'Delivery'" },
        { table: 'orders', column: 'arriving_time', type: 'VARCHAR(100) NULL' },
        { table: 'orders', column: 'note', type: 'TEXT NULL' },
        { table: 'orders', column: 'is_preorder', type: 'TINYINT(1) NOT NULL DEFAULT 0' },
        { table: 'payments', column: 'receipt_url', type: 'TEXT NULL' },
        { table: 'deliveries', column: 'customer_lat', type: 'DECIMAL(10, 7) NULL' },
        { table: 'deliveries', column: 'customer_lng', type: 'DECIMAL(10, 7) NULL' },
        { table: 'system_settings', column: 'chatbot_enabled', type: 'TINYINT(1) DEFAULT 1' },
        { table: 'system_settings', column: 'store_status', type: "VARCHAR(20) DEFAULT 'OPEN'" },
        { table: 'system_settings', column: 'store_open_time', type: "VARCHAR(20) DEFAULT '09:00:00'" },
        { table: 'system_settings', column: 'store_close_time', type: "VARCHAR(20) DEFAULT '21:00:00'" },
        { table: 'system_settings', column: 'store_timezone', type: "VARCHAR(50) DEFAULT 'Asia/Manila'" },
        { table: 'system_settings', column: 'is_manual_override', type: 'TINYINT(1) DEFAULT 0' },
        { table: 'system_settings', column: 'override_at', type: 'DATETIME NULL' },
        { table: 'system_settings', column: 'override_by', type: 'VARCHAR(100) NULL' },
        { table: 'system_settings', column: 'fare_base', type: 'DECIMAL(10,2) DEFAULT 49.00' },
        { table: 'system_settings', column: 'fare_per_05km', type: 'DECIMAL(10,2) DEFAULT 12.00' },
        { table: 'system_settings', column: 'fare_fuel_cost', type: 'DECIMAL(10,2) DEFAULT 2.83' },
        { table: 'system_settings', column: 'fare_maintenance', type: 'DECIMAL(10,2) DEFAULT 7.50' }
      ];
      for (const c of cols) {
        try {
          const [rows] = await conn.query(
            `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
            [config.db.database, c.table, c.column]
          );
          if (!rows.length) {
            await conn.query(`ALTER TABLE ${c.table} ADD COLUMN ${c.column} ${c.type}`);
            console.log(`[Database] Added column ${c.column} to MySQL table ${c.table}`);
          }
        } catch (colErr) {
          console.warn(`[Database] Column migration notice (${c.table}.${c.column}):`, colErr.message);
        }
      }

      // Expand payments.payment_method ENUM to support 'xendit' in MySQL/TiDB
      try {
        await conn.query(
          `ALTER TABLE payments MODIFY COLUMN payment_method ENUM('cash', 'gcash', 'xendit') NOT NULL DEFAULT 'cash'`
        );
      } catch (payEnumErr) {
        console.warn('[Database] payments.payment_method ENUM update notice:', payEnumErr.message);
      }

      await conn.query(`
        CREATE TABLE IF NOT EXISTS admin_gcash_transactions (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          reference_number VARCHAR(100) NOT NULL UNIQUE,
          amount DECIMAL(10,2) NOT NULL,
          status ENUM('UNCLAIMED', 'MATCHED') NOT NULL DEFAULT 'UNCLAIMED',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_admin_gcash_ref (reference_number),
          INDEX idx_admin_gcash_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await conn.query(`
        CREATE TABLE IF NOT EXISTS store_status_audit (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          previous_status VARCHAR(20),
          new_status VARCHAR(20),
          is_manual_override TINYINT(1) DEFAULT 0,
          trigger_type VARCHAR(50),
          triggered_by VARCHAR(100) DEFAULT 'System',
          details TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await conn.query(`
        CREATE TABLE IF NOT EXISTS order_audit_logs (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          order_id INT UNSIGNED,
          order_number VARCHAR(50),
          action VARCHAR(50) NOT NULL,
          actor_id INT UNSIGNED,
          actor_name VARCHAR(100),
          reason VARCHAR(255),
          details TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_order_audit_order_id (order_id),
          INDEX idx_order_audit_action (action)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await conn.query(`
        CREATE TABLE IF NOT EXISTS delivery_fare_config (
          id INT PRIMARY KEY,
          fare_base DECIMAL(10,2) DEFAULT 49.00,
          fare_per_05km DECIMAL(10,2) DEFAULT 12.00,
          fare_fuel_cost DECIMAL(10,2) DEFAULT 2.83,
          fare_maintenance DECIMAL(10,2) DEFAULT 7.50,
          updated_by VARCHAR(100) DEFAULT 'Admin',
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await conn.query(`
        INSERT INTO delivery_fare_config (id, fare_base, fare_per_05km, fare_fuel_cost, fare_maintenance, updated_by)
        VALUES (1, 49.00, 12.00, 2.83, 7.50, 'Admin')
        ON DUPLICATE KEY UPDATE id=id;
      `).catch(() => {});

      await conn.query(`
        CREATE TABLE IF NOT EXISTS ingredients (
          ingredient_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(100) NOT NULL UNIQUE,
          unit VARCHAR(20) NOT NULL,
          stock_quantity DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
          reorder_level DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
          cost_per_unit DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_ingredient_name (name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await conn.query(`
        CREATE TABLE IF NOT EXISTS recipe_items (
          recipe_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          menu_id INT UNSIGNED NOT NULL,
          ingredient_id INT UNSIGNED NOT NULL,
          quantity_required DECIMAL(10, 2) NOT NULL,
          UNIQUE KEY uq_menu_ingredient (menu_id, ingredient_id),
          FOREIGN KEY (menu_id) REFERENCES menu_items(id) ON DELETE CASCADE,
          FOREIGN KEY (ingredient_id) REFERENCES ingredients(ingredient_id) ON DELETE CASCADE,
          INDEX idx_recipe_menu_id (menu_id),
          INDEX idx_recipe_ingredient_id (ingredient_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await conn.query(`
        CREATE TABLE IF NOT EXISTS ingredient_logs (
          log_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          ingredient_id INT UNSIGNED NOT NULL,
          change_amount DECIMAL(10, 2) NOT NULL,
          change_type ENUM('order_deduction', 'restock', 'spoilage_waste', 'adjustment') NOT NULL,
          reference_order_id INT UNSIGNED DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (ingredient_id) REFERENCES ingredients(ingredient_id) ON DELETE CASCADE,
          FOREIGN KEY (reference_order_id) REFERENCES orders(id) ON DELETE SET NULL,
          INDEX idx_ingredient_log_ing (ingredient_id),
          INDEX idx_ingredient_log_order (reference_order_id),
          INDEX idx_ingredient_log_type (change_type)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // 3. Seed default admin & staff accounts if table is empty
      try {
        const [uRows] = await conn.query(`SELECT COUNT(*) as count FROM admins_staff`);
        const uCount = uRows && uRows[0] ? (uRows[0].count || uRows[0]['COUNT(*)'] || 0) : 0;
        if (uCount === 0) {
          const bcrypt = require('bcryptjs');
          const hash = bcrypt.hashSync('password123', 10);
          await conn.query(`
            INSERT INTO admins_staff (id, full_name, email, password_hash, role, phone_number, is_active) VALUES
            (1, 'Diner Admin', 'admin@dinerscafe.ph', ?, 'admin', '+63 917 111 2222', 1),
            (2, 'Maria Clara (Barista)', 'staff@dinerscafe.ph', ?, 'staff', '+63 917 333 4444', 1),
            (3, 'Marco Santos (Motorcycle Rider)', 'rider1@dinerscafe.ph', ?, 'rider', '+63 918 555 6666', 1),
            (4, 'Leo Reyes (Bicycle Eco-Rider)', 'rider2@dinerscafe.ph', ?, 'rider', '+63 918 777 8888', 1)
            ON DUPLICATE KEY UPDATE id=id;
          `, [hash, hash, hash, hash]);

          await conn.query(`
            INSERT INTO delivery_personnel (id, user_id, full_name, phone_number, vehicle_type, vehicle_plate_no, status, is_active) VALUES
            (1, 3, 'Marco Santos', '+63 918 555 6666', 'motorcycle', 'MC-7890-PH', 'available', 1),
            (2, 4, 'Leo Reyes', '+63 918 777 8888', 'bicycle', 'ECO-BIKE-02', 'available', 1)
            ON DUPLICATE KEY UPDATE id=id;
          `).catch(() => {});
          console.log('[Database] Seeded initial MySQL admin, staff, and rider accounts.');
        }
      } catch (seedErr) {
        console.warn('[Database] User seed warning:', seedErr.message);
      }
    } catch (migErr) {
      console.warn('[Database] MySQL migration check warning:', migErr.message);
    }

    conn.release();
    console.log(`[Database] Successfully connected to MySQL at ${config.db.host}:${config.db.port}/${config.db.database}`);
    useFallback = false;
    await seedBomDefaults();
    return true;
  } catch (err) {
    console.warn(`[Database] MySQL unavailable (${err.message}). Activating SQLite local fallback engine...`);
    useFallback = true;
    const ok = initSqliteFallback();
    if (menuRefreshPromise) {
      await menuRefreshPromise;
    }
    await seedBomDefaults();
    return ok;
  }
}

// Unified Query Handler matching mysql2/promise `[rows, fields]` signature
async function query(sql, params = []) {
  if (!useFallback && pool) {
    try {
      return await pool.query(sql, params);
    } catch (mysqlErr) {
      console.error('[Database MySQL Error]', mysqlErr.message);
      throw mysqlErr;
    }
  }

  return executeSqliteQuery(sql, params);
}

function executeSqliteQuery(sql, params = []) {
  // SQLite Fallback execution
  if (!sqliteDb) {
    initSqliteFallback();
  }

  // Normalize MySQL SQL dialects to SQLite if needed
  const normalizedSql = sql
    .replace(/NOW\(\)/gi, "datetime('now')")
    .replace(/DATE_SUB\(NOW\(\),\s*INTERVAL\s+(\d+)\s+MINUTE\)/gi, "datetime('now', '-$1 minutes')")
    .replace(/IFNULL/gi, "COALESCE")
    .replace(/JSON_EXTRACT/gi, "json_extract")
    .replace(/\bFOR\s+UPDATE\b/gi, '');

  const trimmed = normalizedSql.trim();
  const isSelect = /^SELECT|^PRAGMA|^SHOW|^DESCRIBE/i.test(trimmed);

  try {
    if (isSelect) {
      const stmt = sqliteDb.prepare(normalizedSql);
      const rows = stmt.all(...params);
      return [rows, []];
    } else {
      const stmt = sqliteDb.prepare(normalizedSql);
      const result = stmt.run(...params);
      return [{
        insertId: Number(result.lastInsertRowid),
        affectedRows: result.changes,
        changedRows: result.changes
      }, []];
    }
  } catch (sqliteErr) {
    console.error('[Database SQLite Error]', sqliteErr.message, 'SQL:', normalizedSql);
    throw sqliteErr;
  }
}

let sqliteTxDepth = 0;

/**
 * Execute an atomic transaction across either MySQL 8.0 pool or SQLite fallback.
 * Passes a dbConnection (`{ query }`) to the callback and commits/rolls back automatically.
 */
async function withTransaction(callback) {
  if (!useFallback && pool) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await callback(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback().catch(() => {});
      throw err;
    } finally {
      conn.release();
    }
  }

  if (!sqliteDb) {
    initSqliteFallback();
  }

  const isOuter = sqliteTxDepth === 0;
  const savepointName = `sp_bom_${sqliteTxDepth}`;
  if (isOuter) {
    sqliteDb.exec('BEGIN IMMEDIATE');
  } else {
    sqliteDb.exec(`SAVEPOINT ${savepointName}`);
  }
  sqliteTxDepth += 1;

  const sqliteConn = {
    isSqlite: true,
    query: async (sql, params = []) => executeSqliteQuery(sql, params)
  };

  try {
    const result = await callback(sqliteConn);
    if (isOuter) {
      sqliteDb.exec('COMMIT');
    } else {
      sqliteDb.exec(`RELEASE SAVEPOINT ${savepointName}`);
    }
    return result;
  } catch (err) {
    try {
      if (isOuter) {
        sqliteDb.exec('ROLLBACK');
      } else {
        sqliteDb.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`);
      }
    } catch (_) {}
    throw err;
  } finally {
    sqliteTxDepth = Math.max(0, sqliteTxDepth - 1);
  }
}

module.exports = {
  initDatabase,
  query,
  withTransaction,
  getPool: () => pool,
  isUsingFallback: () => useFallback
};
