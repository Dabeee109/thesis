const fs = require('fs');
const path = require('path');

const uploadsDir = path.join(__dirname, '../public/uploads');
const subdirs = fs.readdirSync(uploadsDir).filter(f => {
  const full = path.join(uploadsDir, f);
  return fs.statSync(full).isDirectory();
});

const fileMap = {};
subdirs.forEach(sub => {
  if (sub === 'payments' || sub === 'promotions') return;
  const files = fs.readdirSync(path.join(uploadsDir, sub));
  files.forEach(f => {
    const raw = path.parse(f).name.toLowerCase().replace(/\s+/g, ' ').trim();
    const webPath = '/uploads/' + encodeURIComponent(sub) + '/' + encodeURIComponent(f);
    fileMap[raw] = webPath;
  });
});

const aliases = {
  'bacheelog': 'bacsilog',
  'nuggetcheelog': 'nuggetsilog',
  'hotcheelog': 'hotsilog',
  'spamcheelog': 'spamsilog',
  'biscoff cheesecake': 'biscoff cheesecake drinks',
  'blueberries & cream': 'blueberries & cream drinks'
};

const migrationPath = path.join(__dirname, '../database/migrations/refresh_full_menu.js');
let migrationCode = fs.readFileSync(migrationPath, 'utf8');

const { verifiedCategories, verifiedMenuItems } = require(migrationPath);

const updatedMenuItems = verifiedMenuItems.map(item => {
  const normName = item.name.toLowerCase().replace(/\s+/g, ' ').trim();
  const alias = aliases[normName] || normName;
  const imgPath = fileMap[normName] || fileMap[alias] || item.image_url || null;
  return {
    ...item,
    image_url: imgPath
  };
});

// Update refresh_full_menu.js array in place
const updatedArrayString = 'const verifiedMenuItems = ' + JSON.stringify(updatedMenuItems, null, 2) + ';\n';
migrationCode = migrationCode.replace(/const verifiedMenuItems = \[[\s\S]*?\n\];/, updatedArrayString.trim());
fs.writeFileSync(migrationPath, migrationCode, 'utf8');
console.log('Successfully updated refresh_full_menu.js with 91 local image paths!');

// Now regenerate database/refresh_menu.sql
const catMap = {};
verifiedCategories.forEach((c, idx) => {
  catMap[c.name] = idx + 1;
});

function esc(str) {
  if (str === null || str === undefined) return 'NULL';
  return "'" + String(str).replace(/'/g, "''") + "'";
}

let sql = `-- =============================================================================
-- Diner's Cafe: Verified 91-Item Menu & Categories Seed for TiDB Cloud / MySQL
-- =============================================================================

USE \`diners_cafe_db\`;

SET FOREIGN_KEY_CHECKS = 0;

-- 1. Ensure Categories 1-8 Exist
INSERT INTO \`categories\` (\`id\`, \`name\`, \`slug\`, \`display_order\`, \`is_active\`) VALUES
`;

const catRows = verifiedCategories.map(c => 
  `(${c.display_order}, ${esc(c.name)}, ${esc(c.slug)}, ${c.display_order}, 1)`
).join(',\n');

sql += catRows + `
ON DUPLICATE KEY UPDATE \`name\` = VALUES(\`name\`), \`slug\` = VALUES(\`slug\`), \`display_order\` = VALUES(\`display_order\`), \`is_active\` = 1;

-- 2. Ensure optional category column exists on menu_items
ALTER TABLE \`menu_items\` ADD COLUMN IF NOT EXISTS \`category\` VARCHAR(100) NULL AFTER \`category_id\`;

-- 3. Clear Existing Menu & Inventory Records for Fresh Hard Reset
DELETE FROM \`inventory_logs\`;
DELETE FROM \`inventory\`;
DELETE FROM \`menu_items\`;

-- Reset Auto Increment
ALTER TABLE \`menu_items\` AUTO_INCREMENT = 1;
ALTER TABLE \`inventory\` AUTO_INCREMENT = 1;

-- 4. Insert Verified 91 Menu Items
INSERT INTO \`menu_items\` (\`category_id\`, \`category\`, \`name\`, \`description\`, \`price\`, \`stock_quantity\`, \`is_available\`, \`image_url\`) VALUES
`;

const itemRows = updatedMenuItems.map(item => {
  const catId = catMap[item.category] || 1;
  const img = item.image_url ? esc(item.image_url) : 'NULL';
  return `(${catId}, ${esc(item.category)}, ${esc(item.name)}, ${esc(item.description)}, ${item.price.toFixed(2)}, ${item.stock}, 1, ${img})`;
}).join(',\n');

sql += itemRows + `;

-- 5. Seed Inventory Tracking for All 91 Menu Items
INSERT INTO \`inventory\` (\`menu_item_id\`, \`stock_quantity\`, \`low_stock_threshold\`, \`unit\`)
SELECT \`id\`, \`stock_quantity\`, 10, 'servings' FROM \`menu_items\`
ON DUPLICATE KEY UPDATE \`stock_quantity\` = VALUES(\`stock_quantity\`);

SET FOREIGN_KEY_CHECKS = 1;
`;

fs.writeFileSync(path.join(__dirname, '../database/refresh_menu.sql'), sql, 'utf8');
console.log('Successfully regenerated database/refresh_menu.sql!');

