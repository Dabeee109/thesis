/**
 * Database Migration Script:
 * Creates store_settings table and seeds default store branch & delivery location settings.
 */
const db = require('../db');

async function migrate() {
  console.log('[Migration] Starting create_store_settings migration...');

  // Try SQLite PRAGMA table_info first
  let isSqlite = false;
  try {
    const [test] = await db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='store_settings'");
    isSqlite = true;
    console.log('[Migration] Target is SQLite database.');

    await db.query(`
      CREATE TABLE IF NOT EXISTS store_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_name TEXT NOT NULL DEFAULT "Diner's Cafe - Main Branch",
        store_address TEXT NOT NULL DEFAULT "Diner's Cafe - Store Main Branch, Mandaluyong City",
        store_latitude REAL NOT NULL DEFAULT 14.6042,
        store_longitude REAL NOT NULL DEFAULT 120.9822,
        max_delivery_radius_km REAL NOT NULL DEFAULT 3.00,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('[Migration] SQLite: store_settings table verified.');

    const [rows] = await db.query('SELECT COUNT(*) as count FROM store_settings');
    const count = rows && rows[0] ? rows[0].count : 0;
    if (count === 0) {
      await db.query(`
        INSERT INTO store_settings (id, store_name, store_address, store_latitude, store_longitude, max_delivery_radius_km)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [1, "Diner's Cafe - Main Branch", "Diner's Cafe - Store Main Branch, Mandaluyong City", 14.6042, 120.9822, 3.00]);
      console.log('[Migration] SQLite: Seeded default store_settings row (id=1).');
    } else {
      console.log(`[Migration] SQLite: store_settings table already contains ${count} row(s).`);
    }
  } catch (err) {
    // If error indicates not SQLite, proceed to MySQL
  }

  if (!isSqlite) {
    try {
      console.log('[Migration] Target is MySQL database.');
      await db.query(`
        CREATE TABLE IF NOT EXISTS store_settings (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          store_name VARCHAR(255) NOT NULL DEFAULT 'Diner\\'s Cafe - Main Branch',
          store_address TEXT NOT NULL,
          store_latitude DECIMAL(10,8) NOT NULL DEFAULT 14.60420000,
          store_longitude DECIMAL(11,8) NOT NULL DEFAULT 120.98220000,
          max_delivery_radius_km DECIMAL(4,2) NOT NULL DEFAULT 3.00,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('[Migration] MySQL: store_settings table verified.');

      const [rows] = await db.query('SELECT COUNT(*) as count FROM store_settings');
      const count = rows && rows[0] ? rows[0].count : 0;
      if (count === 0) {
        await db.query(`
          INSERT INTO store_settings (id, store_name, store_address, store_latitude, store_longitude, max_delivery_radius_km)
          VALUES (1, 'Diner\\'s Cafe - Main Branch', 'Diner\\'s Cafe - Store Main Branch, Mandaluyong City', 14.6042, 120.9822, 3.00)
        `);
        console.log('[Migration] MySQL: Seeded default store_settings row (id=1).');
      } else {
        console.log(`[Migration] MySQL: store_settings table already contains ${count} row(s).`);
      }
    } catch (mysqlErr) {
      console.error('[Migration Error] MySQL migration failed:', mysqlErr.message);
      throw mysqlErr;
    }
  }

  console.log('[Migration] create_store_settings migration finished successfully.');
}

if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Migration Fatal]', err);
      process.exit(1);
    });
}

module.exports = migrate;
