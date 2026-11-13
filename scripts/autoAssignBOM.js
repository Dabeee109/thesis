#!/usr/bin/env node
/**
 * Automated Bill of Materials (BOM) / Menu Item Recipe Assignment Script
 * Idempotently populates raw ingredients (`ingredients`) and links 100% of `menu_items`
 * in `recipe_items`, then prints a complete verification table with computed
 * `max_servings` and 3-tier status badges (`AVAILABLE`, `LOW ON STOCK`, `OUT OF STOCK`).
 */

require('dotenv').config();
const db = require('../database/db');
const {
  INGREDIENTS_CATALOG,
  resolveRecipeForMenuItem
} = require('../database/bomRecipesSeedData');
const { syncMenuAvailability } = require('../src/services/inventoryService');

function computeThreeTierBadge(maxServings, isAvailable = 1) {
  if (!isAvailable) return 'HIDDEN';
  if (maxServings <= 0) return 'OUT OF STOCK';
  if (maxServings < 15) return 'LOW ON STOCK';
  return 'AVAILABLE';
}

async function runAutoAssignBOM({ silent = false } = {}) {
  await db.initDatabase();

  // 1. Inspect existing raw ingredients & auto-create any missing raw ingredients
  const [existingIngRows] = await db.query(
    `SELECT ingredient_id, name, category, unit, stock_quantity, reorder_level FROM ingredients`
  );
  const existingIngMap = new Map(
    (existingIngRows || []).map(r => [String(r.name).trim().toLowerCase(), r])
  );

  let createdIngredientsCount = 0;
  for (const ing of INGREDIENTS_CATALOG) {
    const key = ing.name.trim().toLowerCase();
    const existing = existingIngMap.get(key);
    if (!existing) {
      await db.query(
        `INSERT INTO ingredients (name, category, unit, stock_quantity, reorder_level, cost_per_unit)
         VALUES (?, ?, ?, ?, ?, 0.00)`,
        [ing.name, ing.category, ing.unit, ing.stock_quantity, ing.reorder_level]
      );
      createdIngredientsCount++;
    } else if (!existing.category || existing.category === 'Produce & Pantry') {
      if (ing.category !== existing.category) {
        await db.query(
          `UPDATE ingredients SET category = ?, unit = ? WHERE ingredient_id = ?`,
          [ing.category, ing.unit, existing.ingredient_id]
        ).catch(() => {});
      }
    }
  }

  // Reload full ingredients catalog after insertions
  const [allIngRows] = await db.query(
    `SELECT ingredient_id, name, category, unit, stock_quantity, reorder_level FROM ingredients`
  );
  const ingByName = new Map(
    (allIngRows || []).map(r => [String(r.name).trim().toLowerCase(), r])
  );
  const ingById = new Map(
    (allIngRows || []).map(r => [Number(r.ingredient_id), r])
  );

  // 2. Read all active menu items across all categories
  const [menuRows] = await db.query(`
    SELECT
      m.id,
      m.name,
      m.category_id,
      COALESCE(c.name, 'Uncategorized') AS category_name,
      m.price,
      m.is_available
    FROM menu_items m
    LEFT JOIN categories c ON c.id = m.category_id
    WHERE COALESCE(m.is_deleted, 0) = 0
    ORDER BY COALESCE(c.display_order, 99) ASC, m.name ASC
  `);

  const [existingRecipeRows] = await db.query(
    `SELECT recipe_id, menu_id, ingredient_id, quantity_required FROM recipe_items`
  );
  const existingPairMap = new Map(
    (existingRecipeRows || []).map(r => [`${r.menu_id}:${r.ingredient_id}`, r])
  );

  let insertedLinksCount = 0;
  let updatedLinksCount = 0;

  // 3. Auto-link complete Bill of Materials for 100% of menu items
  for (const menu of (menuRows || [])) {
    const reqList = resolveRecipeForMenuItem(menu.name, menu.category_name);

    for (const [rawIngName, rawQty] of reqList) {
      const ingName = String(rawIngName).trim();
      const qtyReq = Number(rawQty);
      let ingRecord = ingByName.get(ingName.toLowerCase());

      if (!ingRecord) {
        const inferredUnit = /ml|syrup|milk|base|sauce|oil|vinegar/i.test(ingName)
          ? 'ml'
          : (/cup|box|bun|bread|dough|crust|wrapper|egg|bottle|hotdog|sausage|wings|nuggets|leg|calamansi/i.test(ingName) ? 'pcs' : 'g');
        const initStock = inferredUnit === 'pcs' ? 200.00 : 5000.00;
        const initReorder = inferredUnit === 'pcs' ? 20.00 : 500.00;

        const [ins] = await db.query(
          `INSERT INTO ingredients (name, category, unit, stock_quantity, reorder_level, cost_per_unit)
           VALUES (?, 'Produce & Pantry', ?, ?, ?, 0.00)`,
          [ingName, inferredUnit, initStock, initReorder]
        );
        ingRecord = {
          ingredient_id: ins.insertId,
          name: ingName,
          category: 'Produce & Pantry',
          unit: inferredUnit,
          stock_quantity: initStock,
          reorder_level: initReorder
        };
        ingByName.set(ingName.toLowerCase(), ingRecord);
        ingById.set(Number(ingRecord.ingredient_id), ingRecord);
        createdIngredientsCount++;
      }

      const pairKey = `${menu.id}:${ingRecord.ingredient_id}`;
      const existingLink = existingPairMap.get(pairKey);

      if (!existingLink) {
        await db.query(
          `INSERT INTO recipe_items (menu_id, ingredient_id, quantity_required)
           VALUES (?, ?, ?)`,
          [menu.id, ingRecord.ingredient_id, qtyReq]
        );
        existingPairMap.set(pairKey, {
          menu_id: menu.id,
          ingredient_id: ingRecord.ingredient_id,
          quantity_required: qtyReq
        });
        insertedLinksCount++;
      } else if (Number(existingLink.quantity_required) <= 0) {
        await db.query(
          `UPDATE recipe_items SET quantity_required = ? WHERE menu_id = ? AND ingredient_id = ?`,
          [qtyReq, menu.id, ingRecord.ingredient_id]
        );
        updatedLinksCount++;
      }
    }
  }

  // Synchronize menu_items.stock_quantity and availability with live BOM stock
  await syncMenuAvailability().catch(() => {});

  // 4. Query final BOM state for verification report
  const [finalRecipeRows] = await db.query(`
    SELECT
      r.menu_id,
      r.ingredient_id,
      r.quantity_required,
      i.name AS ingredient_name,
      i.unit,
      i.category AS ingredient_category,
      i.stock_quantity
    FROM recipe_items r
    JOIN ingredients i ON i.ingredient_id = r.ingredient_id
    ORDER BY r.menu_id ASC, i.name ASC
  `);

  const recipesByMenuId = new Map();
  for (const r of (finalRecipeRows || [])) {
    const mid = Number(r.menu_id);
    if (!recipesByMenuId.has(mid)) recipesByMenuId.set(mid, []);
    recipesByMenuId.get(mid).push(r);
  }

  const summaryReport = (menuRows || []).map(menu => {
    const reqs = recipesByMenuId.get(Number(menu.id)) || [];
    const servingsList = reqs.map(r => {
      const req = Number(r.quantity_required) || 0;
      const stock = Number(r.stock_quantity) || 0;
      return req > 0 ? Math.floor(stock / req) : 9999;
    });
    const maxServings = reqs.length > 0 ? Math.max(0, Math.min(...servingsList)) : 0;
    const badge = computeThreeTierBadge(maxServings, menu.is_available);
    const bomSummary = reqs
      .map(r => `${Number(r.quantity_required)} ${r.unit} ${r.ingredient_name}`)
      .join(', ');

    return {
      menu_id: menu.id,
      menu_name: menu.name,
      category: menu.category_name,
      ingredient_count: reqs.length,
      ingredients_breakdown: bomSummary,
      max_servings: maxServings,
      status_badge: badge
    };
  });

  if (!silent) {
    console.log('\n====================================================================================================');
    console.log(" DINER'S CAFE — AUTOMATED BILL OF MATERIALS (BOM) VERIFICATION SUMMARY");
    console.log('====================================================================================================');
    console.log(`Database Engine        : ${db.isUsingFallback() ? 'SQLite Local Engine' : 'TiDB Cloud / MySQL'}`);
    console.log(`Total Raw Ingredients  : ${ingById.size} (New Created: ${createdIngredientsCount})`);
    console.log(`Total Menu Items       : ${summaryReport.length} (100% Mapped: ${summaryReport.every(r => r.ingredient_count > 0) ? 'YES' : 'NO'})`);
    console.log(`Recipe Links Inserted  : ${insertedLinksCount} (Updated: ${updatedLinksCount})`);
    console.log('----------------------------------------------------------------------------------------------------');
    console.log(
      `${'ID'.padEnd(5)} | ${'Category'.padEnd(24)} | ${'Menu Item'.padEnd(32)} | ${'Servings'.padEnd(8)} | ${'Badge'.padEnd(14)} | Assigned BOM Ingredients`
    );
    console.log('----------------------------------------------------------------------------------------------------');
    for (const row of summaryReport) {
      console.log(
        `${String(row.menu_id).padEnd(5)} | ${String(row.category).slice(0, 24).padEnd(24)} | ${String(row.menu_name).slice(0, 32).padEnd(32)} | ${String(row.max_servings).padEnd(8)} | ${String(row.status_badge).padEnd(14)} | ${row.ingredients_breakdown}`
      );
    }
    console.log('====================================================================================================\n');
  }

  return {
    totalIngredients: ingById.size,
    createdIngredientsCount,
    totalMenuItems: summaryReport.length,
    insertedLinksCount,
    updatedLinksCount,
    allMapped: summaryReport.every(r => r.ingredient_count > 0),
    summaryReport
  };
}

if (require.main === module) {
  runAutoAssignBOM()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[autoAssignBOM] Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { runAutoAssignBOM };

