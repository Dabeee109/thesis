/**
 * Migration: Add stock_quantity numerical column to menu_items with DEFAULT 50
 */

const db = require('../db');

async function up() {
  console.log('[Migration] Ensuring stock_quantity column exists in menu_items...');

  // SQLite Column Check
  try {
    const [cols] = await db.query('PRAGMA table_info(menu_items)');
    const hasCol = cols && cols.some(c => c.name === 'stock_quantity');
    if (!hasCol) {
      await db.query('ALTER TABLE menu_items ADD COLUMN stock_quantity INT DEFAULT 50');
      console.log('[Migration] Added stock_quantity INT DEFAULT 50 to menu_items (SQLite).');
    } else {
      console.log('[Migration] stock_quantity already exists in menu_items (SQLite).');
    }
  } catch (sqliteErr) {
    // If running on MySQL
    try {
      await db.query('ALTER TABLE menu_items ADD COLUMN stock_quantity INT NOT NULL DEFAULT 50');
      console.log('[Migration] Added stock_quantity INT NOT NULL DEFAULT 50 to menu_items (MySQL).');
    } catch (mysqlErr) {
      if ((mysqlErr.message || '').includes('Duplicate column') || (mysqlErr.message || '').includes('already exists')) {
        console.log('[Migration] stock_quantity already exists in menu_items (MySQL).');
      } else {
        console.warn('[Migration Notice]', mysqlErr.message);
      }
    }
  }
}

if (require.main === module) {
  up()
    .then(() => {
      console.log('[Migration] Completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Migration Failed]', err);
      process.exit(1);
    });
}

module.exports = { up };
