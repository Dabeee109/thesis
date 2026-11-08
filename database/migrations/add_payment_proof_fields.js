/**
 * Database Migration Script:
 * Adds payment_proof_image, payment_ref_number, and payment_status to orders table.
 */
const db = require('../db');

async function migrate() {
  console.log('[Migration] Starting add_payment_proof_fields migration...');

  // Try SQLite PRAGMA table_info first
  let isSqlite = false;
  try {
    const [cols] = await db.query('PRAGMA table_info(orders)');
    if (cols && cols.length > 0) {
      isSqlite = true;
      const names = cols.map(c => c.name);

      if (!names.includes('payment_proof_image')) {
        await db.query('ALTER TABLE orders ADD COLUMN payment_proof_image TEXT DEFAULT NULL');
        console.log('[Migration] SQLite: Added payment_proof_image column to orders');
      } else {
        console.log('[Migration] SQLite: payment_proof_image already exists');
      }

      if (!names.includes('payment_ref_number')) {
        await db.query('ALTER TABLE orders ADD COLUMN payment_ref_number TEXT DEFAULT NULL');
        console.log('[Migration] SQLite: Added payment_ref_number column to orders');
      } else {
        console.log('[Migration] SQLite: payment_ref_number already exists');
      }

      if (!names.includes('payment_status')) {
        await db.query("ALTER TABLE orders ADD COLUMN payment_status TEXT DEFAULT 'Pending'");
        console.log('[Migration] SQLite: Added payment_status column to orders');
      } else {
        console.log('[Migration] SQLite: payment_status already exists');
      }
    }
  } catch (err) {
    // Not SQLite, proceed to MySQL
  }

  if (!isSqlite) {
    // MySQL migration
    try {
      const [rows1] = await db.query(`
        SELECT COLUMN_NAME FROM information_schema.COLUMNS 
        WHERE TABLE_NAME = 'orders' AND COLUMN_NAME = 'payment_proof_image'
      `);
      if (!rows1 || !rows1.length) {
        await db.query('ALTER TABLE orders ADD COLUMN payment_proof_image VARCHAR(500) DEFAULT NULL');
        console.log('[Migration] MySQL: Added payment_proof_image column to orders');
      }

      const [rows2] = await db.query(`
        SELECT COLUMN_NAME FROM information_schema.COLUMNS 
        WHERE TABLE_NAME = 'orders' AND COLUMN_NAME = 'payment_ref_number'
      `);
      if (!rows2 || !rows2.length) {
        await db.query('ALTER TABLE orders ADD COLUMN payment_ref_number VARCHAR(100) DEFAULT NULL');
        console.log('[Migration] MySQL: Added payment_ref_number column to orders');
      }

      const [rows3] = await db.query(`
        SELECT COLUMN_NAME FROM information_schema.COLUMNS 
        WHERE TABLE_NAME = 'orders' AND COLUMN_NAME = 'payment_status'
      `);
      if (!rows3 || !rows3.length) {
        await db.query("ALTER TABLE orders ADD COLUMN payment_status ENUM('Pending', 'Pending Verification', 'Paid', 'Failed') DEFAULT 'Pending'");
        console.log('[Migration] MySQL: Added payment_status column to orders');
      }
    } catch (mySqlErr) {
      console.warn('[Migration] MySQL check warning:', mySqlErr.message);
    }
  }

  console.log('[Migration] Successfully completed payment proof fields migration.');
}

if (require.main === module) {
  migrate().then(() => {
    console.log('[Migration] Done.');
    process.exit(0);
  }).catch((err) => {
    console.error('[Migration Failed]', err);
    process.exit(1);
  });
}

module.exports = migrate;
