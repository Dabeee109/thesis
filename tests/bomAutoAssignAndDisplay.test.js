const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runAutoAssignBOM } = require('../scripts/autoAssignBOM');
const menuController = require('../src/controllers/menuController');

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

describe('Automated Bill of Materials (BOM) Recipe Assignment & UI Display', () => {
  it('1. scripts/autoAssignBOM.js maps 100% of menu_items to raw ingredients and computes max_servings + 3-tier badges', async () => {
    const result = await runAutoAssignBOM({ silent: true });

    assert.equal(result.allMapped, true, 'Expected 100% of menu items to have BOM recipes assigned');
    assert.ok(result.totalMenuItems >= 91, `Expected at least 91 menu items, got ${result.totalMenuItems}`);
    assert.ok(result.totalIngredients >= 114, `Expected at least 114 raw ingredients, got ${result.totalIngredients}`);

    for (const row of result.summaryReport) {
      assert.ok(row.ingredient_count > 0, `Menu item "${row.menu_name}" has 0 ingredients`);
      assert.ok(row.max_servings > 0, `Menu item "${row.menu_name}" has 0 max_servings`);
      assert.ok(
        ['AVAILABLE', 'LOW ON STOCK', 'OUT OF STOCK'].includes(row.status_badge),
        `Invalid badge "${row.status_badge}" for "${row.menu_name}"`
      );
    }
  });

  it('2. GET /api/menu returns recipe_items, recipe_count, max_servings, and live 3-tier status for every menu item', async () => {
    const req = { query: {} };
    const res = createMockRes();
    await menuController.getMenu(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.allItems) && res.body.allItems.length >= 91);

    for (const item of res.body.allItems) {
      assert.equal(item.has_recipe, true, `Expected item "${item.name}" to have has_recipe = true`);
      assert.ok(item.recipe_count > 0, `Expected item "${item.name}" to have recipe_count > 0`);
      assert.ok(Array.isArray(item.recipe_items) && item.recipe_items.length > 0);
      assert.ok(item.max_servings > 0);
      assert.ok(['AVAILABLE', 'LOW_STOCK', 'OUT_OF_STOCK', 'HIDDEN'].includes(item.status));

      for (const r of item.recipe_items) {
        assert.ok(r.ingredient_name, 'Expected ingredient_name');
        assert.ok(Number(r.quantity_required) > 0, 'Expected quantity_required > 0');
        assert.ok(['g', 'ml', 'pcs'].includes(r.unit), `Unexpected unit ${r.unit}`);
      }
    }
  });

  it('3. Inventory & Recipes UI immediately displays all menu item BOM recipes upon opening the tab', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');
    const js = fs.readFileSync(path.join(__dirname, '../public/js/dashboard.js'), 'utf8');

    assert.ok(html.includes('id="bom-recipe-search-input"'));
    assert.ok(html.includes('id="bom-recipe-menu-select"'));
    assert.ok(html.includes('-- All Menu Items (Show All BOMs) --'));
    assert.ok(js.includes('function selectAndEditMenuRecipe'));
    assert.ok(js.includes('Mapped ('));
  });
});

