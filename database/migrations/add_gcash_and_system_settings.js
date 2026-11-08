/**
 * Database Migration Script:
 * Ensures store_settings table has all columns for GCash Payment Configuration
 * and Store Location & Dispatch Boundaries.
 */

const db = require('../db');

async function migrate() {
  console.log('[Migration] Starting add_gcash_and_system_settings migration...');

  let isSqlite = false;
  try {
    const [cols] = await db.query('PRAGMA table_info(store_settings)');
    if (cols && cols.length > 0) {
      isSqlite = true;
      const names = cols.map(c => c.name);

      if (!names.includes('gcash_account_name')) {
        await db.query("ALTER TABLE store_settings ADD COLUMN gcash_account_name TEXT DEFAULT \"Diner's Cafe\"");
        console.log('[Migration] SQLite: Added gcash_account_name column');
      }
      if (!names.includes('gcash_account_number')) {
        await db.query("ALTER TABLE store_settings ADD COLUMN gcash_account_number TEXT DEFAULT '09XXXXXXXXX'");
        console.log('[Migration] SQLite: Added gcash_account_number column');
      }
      if (!names.includes('gcash_qr_image_url')) {
        await db.query("ALTER TABLE store_settings ADD COLUMN gcash_qr_image_url TEXT DEFAULT NULL");
        console.log('[Migration] SQLite: Added gcash_qr_image_url column');
      }

      // Check row count and update default GCash values if null
      const [rows] = await db.query('SELECT * FROM store_settings WHERE id = 1');
      if (rows && rows.length > 0) {
        const row = rows[0];
        const gName = row.gcash_account_name || "Diner's Cafe";
        const gNum = row.gcash_account_number || "09XXXXXXXXX";
        const gQr = row.gcash_qr_image_url || "/uploads/qr/gcash_qr_CHECKOUT.png";
        await db.query(
          'UPDATE store_settings SET gcash_account_name = ?, gcash_account_number = ?, gcash_qr_image_url = ? WHERE id = 1',
          [gName, gNum, gQr]
        );
        console.log('[Migration] SQLite: Updated store_settings id=1 with GCash defaults.');
      } else {
        await db.query(`
          INSERT INTO store_settings (
            id, store_name, store_address, store_latitude, store_longitude, max_delivery_radius_km,
            gcash_account_name, gcash_account_number, gcash_qr_image_url
          ) VALUES (
            1, "Diner's Cafe - Main Branch", "123 Boni Ave, Mandaluyong City", 14.57940000, 121.03590000, 3.00,
            "Diner's Cafe", "09XXXXXXXXX", "/uploads/qr/gcash_qr_CHECKOUT.png"
          )
        `);
        console.log('[Migration] SQLite: Inserted initial row id=1.');
      }
    }
  } catch (err) {
    // MySQL fallback
  }

  if (!isSqlite) {
    try {
      const [cols] = await db.query(`
        SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_NAME = 'store_settings' AND COLUMN_NAME IN ('gcash_account_name', 'gcash_account_number', 'gcash_qr_image_url')
      `);
      const existingNames = (cols || []).map(c => c.COLUMN_NAME);

      if (!existingNames.includes('gcash_account_name')) {
        await db.query("ALTER TABLE store_settings ADD COLUMN gcash_account_name VARCHAR(255) DEFAULT 'Diner\\'s Cafe'");
        console.log('[Migration] MySQL: Added gcash_account_name column');
      }
      if (!existingNames.includes('gcash_account_number')) {
        await db.query("ALTER TABLE store_settings ADD COLUMN gcash_account_number VARCHAR(20) DEFAULT '09XXXXXXXXX'");
        console.log('[Migration] MySQL: Added gcash_account_number column');
      }
      if (!existingNames.includes('gcash_qr_image_url')) {
        await db.query("ALTER TABLE store_settings ADD COLUMN gcash_qr_image_url VARCHAR(500) DEFAULT NULL");
        console.log('[Migration] MySQL: Added gcash_qr_image_url column');
      }

      await db.query(`
        UPDATE store_settings 
        SET 
          gcash_account_name = COALESCE(gcash_account_name, 'Diner\\'s Cafe'),
          gcash_account_number = COALESCE(gcash_account_number, '09XXXXXXXXX'),
          gcash_qr_image_url = COALESCE(gcash_qr_image_url, '/uploads/qr/gcash_qr_CHECKOUT.png')
        WHERE id = 1
      `);
      console.log('[Migration] MySQL: Initialized GCash columns on row id=1.');
    } catch (mysqlErr) {
      console.error('[Migration Error] MySQL migration error:', mysqlErr.message);
      throw mysqlErr;
    }
  }

  console.log('[Migration] add_gcash_and_system_settings finished successfully.');
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

