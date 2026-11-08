/**
 * Migration: Create system_settings table, add operating hours & chatbot toggle,
 * and add is_preorder column to orders table.
 */

const db = require('../db');

async function runMigration() {
  console.log('[Migration] Starting add_system_settings_and_preorder migration...');

  // 1. Ensure system_settings table exists
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        id INTEGER PRIMARY KEY DEFAULT 1,
        chatbot_enabled BOOLEAN DEFAULT 1,
        store_open_time VARCHAR(20) DEFAULT '09:00:00',
        store_close_time VARCHAR(20) DEFAULT '21:00:00',
        store_timezone VARCHAR(50) DEFAULT 'Asia/Manila',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('[Migration] system_settings table verified.');
  } catch (err) {
    console.warn('[Migration] system_settings table create warning:', err.message);
  }

  // Seed default row if empty
  try {
    const [rows] = await db.query('SELECT COUNT(*) as count FROM system_settings');
    const count = rows && rows[0] ? (rows[0].count || rows[0]['COUNT(*)'] || 0) : 0;
    if (count === 0) {
      await db.query(`
        INSERT INTO system_settings (id, chatbot_enabled, store_open_time, store_close_time, store_timezone)
        VALUES (1, 1, '09:00:00', '21:00:00', 'Asia/Manila')
      `);
      console.log('[Migration] Seeded default system_settings row (id=1).');
    }
  } catch (seedErr) {
    console.warn('[Migration] system_settings seed check skipped:', seedErr.message);
  }

  // 2. Also ensure store_settings has these columns for full compatibility
  try { await db.query(`ALTER TABLE store_settings ADD COLUMN chatbot_enabled INTEGER DEFAULT 1;`); } catch (e) {}
  try { await db.query(`ALTER TABLE store_settings ADD COLUMN store_open_time TEXT DEFAULT '09:00:00';`); } catch (e) {}
  try { await db.query(`ALTER TABLE store_settings ADD COLUMN store_close_time TEXT DEFAULT '21:00:00';`); } catch (e) {}
  try { await db.query(`ALTER TABLE store_settings ADD COLUMN store_timezone TEXT DEFAULT 'Asia/Manila';`); } catch (e) {}

  // 3. Add is_preorder to orders table
  try {
    await db.query(`ALTER TABLE orders ADD COLUMN is_preorder INTEGER DEFAULT 0;`);
    console.log('[Migration] Added is_preorder column to orders table.');
  } catch (colErr) {
    // Column may already exist
  }

  console.log('[Migration] add_system_settings_and_preorder finished successfully.');
}

if (require.main === module) {
  setTimeout(async () => {
    try {
      await runMigration();
      process.exit(0);
    } catch (err) {
      console.error('[Migration Failed]', err);
      process.exit(1);
    }
  }, 200);
}

module.exports = { runMigration };

