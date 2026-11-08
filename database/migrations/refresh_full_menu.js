/**
 * Comprehensive Menu Refresh Migration
 * Truncates legacy items and seeds verified 91 items across 8 categories
 * with numerical inventory tracking and 3-tier status badges.
 */

const db = require('../db');

const verifiedCategories = [
  { name: 'Drinks & Milktea', slug: 'drinks-milktea', display_order: 1 },
  { name: 'Burgers & Sandwiches', slug: 'burgers-sandwiches', display_order: 2 },
  { name: 'Starters & Fries', slug: 'starters-fries', display_order: 3 },
  { name: 'Pizza & Flat Bread', slug: 'pizza-flatbread', display_order: 4 },
  { name: 'Meals & Steaks', slug: 'meals-steaks', display_order: 5 },
  { name: 'Pasta & Platters', slug: 'pasta-platters', display_order: 6 },
  { name: 'Chicken Wings & Boneless', slug: 'chicken-wings-boneless', display_order: 7 },
  { name: 'Add-ons', slug: 'add-ons', display_order: 8 }
];

const verifiedMenuItems = [
  // PREMIUM DRINKS
  { category: 'Drinks & Milktea', name: 'Biscoff Cheesecake', description: 'Rich creamy cheesecake blend topped with crushed Lotus Biscoff', price: 169.00, stock: 30 },
  { category: 'Drinks & Milktea', name: 'Choco Java Chips', description: 'Decadent chocolate blend infused with premium java chips', price: 169.00, stock: 30 },
  { category: 'Drinks & Milktea', name: "Diner's Signature Drink", description: 'House-crafted specialty blend with signature flavor profile', price: 149.00, stock: 40 },
  { category: 'Drinks & Milktea', name: 'Oreo Blast', description: 'Creamy cookies and cream indulgence loaded with crushed Oreos', price: 149.00, stock: 35 },
  { category: 'Drinks & Milktea', name: 'Two Two', description: 'Dual-flavor specialty blend with layered sweetness', price: 149.00, stock: 25 },
  { category: 'Drinks & Milktea', name: 'Purple Alcapone', description: 'Ube-infused creamy beverage with white chocolate undertones', price: 149.00, stock: 25 },
  { category: 'Drinks & Milktea', name: 'Strawberries & Cream', description: 'Fresh strawberry puree layered over smooth velvety cream', price: 149.00, stock: 30 },
  { category: 'Drinks & Milktea', name: 'Blueberries & Cream', description: 'Luscious blueberry reduction with chilled creamy base', price: 149.00, stock: 30 },
  { category: 'Drinks & Milktea', name: 'Caramel Macchiato', description: 'Espresso marked with velvety milk and rich caramel drizzle', price: 149.00, stock: 40 },

  // MILK TEA (LARGE)
  { category: 'Drinks & Milktea', name: 'Dark Chocolate Milktea', description: 'Bold and bittersweet Dutch cocoa with premium brewed tea', price: 99.00, stock: 50 },
  { category: 'Drinks & Milktea', name: 'Okinawa Milktea', description: 'Roasted brown sugar milk tea with authentic rich finish', price: 99.00, stock: 50 },
  { category: 'Drinks & Milktea', name: 'Classic Milktea', description: 'Signature black tea infused with balanced creamy milk', price: 99.00, stock: 60 },
  { category: 'Drinks & Milktea', name: 'Roasted Wintermelon Milktea', description: 'Caramelized roasted wintermelon taste with silky finish', price: 99.00, stock: 50 },
  { category: 'Drinks & Milktea', name: 'Matcha Milktea', description: 'Authentic earthy Japanese green tea with fresh milk', price: 99.00, stock: 40 },
  { category: 'Drinks & Milktea', name: 'Taro Milktea', description: 'Creamy, sweet, and nutty purple taro infusion', price: 99.00, stock: 45 },
  { category: 'Drinks & Milktea', name: 'Oreo Milktea', description: 'Classic milk tea shaken with chunky Oreo biscuit crumbles', price: 99.00, stock: 40 },
  { category: 'Drinks & Milktea', name: 'Brown Sugar Milktea', description: 'Tiger tiger striped brown sugar syrup with rich milk tea', price: 99.00, stock: 45 },
  { category: 'Drinks & Milktea', name: "Diner's House Blend Milktea", description: 'Proprietary spiced tea blend formulated exclusively in-house', price: 99.00, stock: 50 },

  // YAKULT SERIES (LARGE)
  { category: 'Drinks & Milktea', name: 'Green Apple Yakult', description: 'Tangy probiotic Yakult base infused with crisp green apple', price: 109.00, stock: 35 },
  { category: 'Drinks & Milktea', name: 'Strawberry Yakult', description: 'Sweet strawberry compote combined with gut-friendly Yakult', price: 109.00, stock: 35 },
  { category: 'Drinks & Milktea', name: 'Lychee Yakult', description: 'Floral fragrant lychee blended with chilled refreshing Yakult', price: 109.00, stock: 35 },

  // FRUIT TEA (LARGE)
  { category: 'Drinks & Milktea', name: 'Green Apple Fruit Tea', description: 'Ice-shaken artisan jasmine green tea with green apple essence', price: 89.00, stock: 40 },
  { category: 'Drinks & Milktea', name: 'Strawberry Fruit Tea', description: 'Chilled botanical tea steeped with sweet strawberry syrup', price: 89.00, stock: 40 },
  { category: 'Drinks & Milktea', name: 'Lychee Fruit Tea', description: 'Refreshing cold brewed fruit tea sweetened with pure lychee', price: 89.00, stock: 40 },

  // ADD-ONS
  { category: 'Add-ons', name: 'Cream Cheese Wall', description: 'Savory sweet whipped cream cheese walling', price: 20.00, stock: 100 },
  { category: 'Add-ons', name: 'Tapioca Pearls', description: 'Chewy brown-sugar simmered black tapioca pearls', price: 20.00, stock: 100 },
  { category: 'Add-ons', name: 'Rainbow Crystals', description: 'Translucent chewy jelly crystal sinkers', price: 20.00, stock: 100 },
  { category: 'Add-ons', name: 'Coffee Jelly', description: 'Firm espresso jelly cubes for texture', price: 20.00, stock: 80 },
  { category: 'Add-ons', name: 'Crushed Oreo', description: 'Generous topping of dark Oreo cookie crumbles', price: 20.00, stock: 80 },

  // BURGERS & SANDWICHES
  { category: 'Burgers & Sandwiches', name: 'Classic Burger', description: 'Pure beef grilled patty with crisp lettuce, tomato, and special sauce', price: 139.00, stock: 30 },
  { category: 'Burgers & Sandwiches', name: 'Chicken Fillet Burger', description: 'Golden breaded fried chicken breast fillet with garlic mayo', price: 139.00, stock: 25 },
  { category: 'Burgers & Sandwiches', name: 'Bacon Burger', description: 'All-beef patty stacked with crispy smoked bacon strips and melted cheese', price: 159.00, stock: 25 },
  { category: 'Burgers & Sandwiches', name: "Diner's Double Down", description: 'Double-stacked beef patties, double melted cheese, and caramelized onions', price: 179.00, stock: 20 },
  { category: 'Burgers & Sandwiches', name: 'Premium Sandwich', description: 'Artisan toasted bread stacked with savory cold cuts, cheese, and greens', price: 199.00, stock: 20 },
  { category: 'Burgers & Sandwiches', name: 'Meaty Dog', description: 'Jumbo grilled frank topped with hearty minced meat chili and relish', price: 159.00, stock: 25 },
  { category: 'Burgers & Sandwiches', name: 'California Dog', description: 'Grilled frankfurter dressed with creamy slaw, bacon bits, and mustard', price: 159.00, stock: 20 },
  { category: 'Burgers & Sandwiches', name: 'Cheesy Dog', description: 'Savory frank smothered in warm cheddar cheese sauce and jalapeños', price: 159.00, stock: 25 },

  // STARTERS & FRIES
  { category: 'Starters & Fries', name: 'Quesadilla', description: 'Toasted flour tortilla packed with seasoned meats and melted cheese blend', price: 239.00, stock: 20 },
  { category: 'Starters & Fries', name: 'Nuggets (12 pcs)', description: 'Dozen crispy golden chicken nuggets served with choice of dipping sauce', price: 219.00, stock: 25 },
  { category: 'Starters & Fries', name: 'Nachos with Toppings (Regular)', description: 'Crisp corn tortilla chips loaded with salsa, cheese sauce, and ground beef', price: 109.00, stock: 30 },
  { category: 'Starters & Fries', name: 'Nachos with Toppings (Large)', description: 'Family-sized platter of loaded corn chips, jalapeños, beef, and dual cheese', price: 159.00, stock: 25 },
  { category: 'Starters & Fries', name: 'Cheese Stick Jalapeno', description: 'Breaded mozzarella rolls with spicy pickled jalapeño slices', price: 89.00, stock: 35 },
  { category: 'Starters & Fries', name: 'Pita Wrap', description: 'Mediterranean style soft flatbread rolled with savory filling and garlic dip', price: 89.00, stock: 30 },
  { category: 'Starters & Fries', name: 'Nuggets & Fries Combo', description: 'Crisp seasoned fries served alongside golden tender chicken nuggets', price: 199.00, stock: 25 },
  { category: 'Starters & Fries', name: 'Cheesy Bacon Fries', description: 'Fresh cut potato fries drizzled with cheddar sauce and crisp bacon bits', price: 159.00, stock: 30 },
  { category: 'Starters & Fries', name: 'Twisted Fries', description: 'Seasoned curly spiraled potato fries with crispy spiced coating', price: 119.00, stock: 35 },
  { category: 'Starters & Fries', name: 'Flavored Fries', description: 'Crisp french fries dusted with choice of Cheese, BBQ, or Sour Cream', price: 89.00, stock: 50 },

  // PIZZA & FLAT BREAD
  { category: 'Pizza & Flat Bread', name: 'Triple Cheese Pizza', description: 'Mozzarella, sharp cheddar, and parmesan over fresh marinara', price: 270.00, stock: 20 },
  { category: 'Pizza & Flat Bread', name: 'Hawaiian Pizza', description: 'Classic sweet pineapple chunks, sliced ham, and melted mozzarella', price: 310.00, stock: 25 },
  { category: 'Pizza & Flat Bread', name: 'Bacon & Mushroom Pizza', description: 'Smoked bacon crumbles and sautéed button mushrooms over garlic crust', price: 310.00, stock: 20 },
  { category: 'Pizza & Flat Bread', name: 'Hungarian Pizza', description: 'Spicy sliced Hungarian sausage rounds, bell peppers, and melted cheese', price: 310.00, stock: 20 },
  { category: 'Pizza & Flat Bread', name: 'Mediterranean Pizza', description: 'Sun-ripened tomatoes, olives, herbs, and feta mozzarella blend', price: 340.00, stock: 15 },
  { category: 'Pizza & Flat Bread', name: 'Pizza Bianca', description: 'White garlic cream sauce base topped with ricotta, mozzarella, and herbs', price: 350.00, stock: 15 },
  { category: 'Pizza & Flat Bread', name: "Diner's Pizza Supreme", description: 'Fully loaded with beef, pepperoni, sausage, peppers, onions, and mushrooms', price: 350.00, stock: 20 },
  { category: 'Pizza & Flat Bread', name: 'Cajun Shrimp Pizza', description: 'Plump shrimp tossed in spicy Cajun butter seasoning over crispy crust', price: 370.00, stock: 15 },
  { category: 'Pizza & Flat Bread', name: 'Garlic Shrimp Pizza', description: 'Sautéed garlic butter shrimp, roasted garlic cloves, and fresh herbs', price: 370.00, stock: 15 },
  { category: 'Pizza & Flat Bread', name: 'Ham & Bacon Flat Bread', description: 'Crispy thin flatbread layered with honey ham, bacon bits, and cheese', price: 179.00, stock: 25 },
  { category: 'Pizza & Flat Bread', name: 'Four Cheese Flat Bread', description: 'Artisan flatbread baked with four melted specialty cheeses', price: 179.00, stock: 25 },

  // STEAKS, RICE BOWLS & MEALS
  { category: 'Meals & Steaks', name: 'BBQ Ribs', description: 'Tender slow-cooked ribs glazed in smoky house barbecue sauce with rice', price: 269.00, stock: 15 },
  { category: 'Meals & Steaks', name: 'Quarter Chicken Meal', description: 'Oven-roasted marinated quarter chicken served with gravy and rice', price: 179.00, stock: 25 },
  { category: 'Meals & Steaks', name: 'Burger Steak (2 pcs)', description: 'Two savory grilled beef patties swimming in mushroom gravy with rice', price: 179.00, stock: 30 },
  { category: 'Meals & Steaks', name: 'Hungarian with Egg', description: 'Grilled spicy Hungarian sausage served with sunny-side-up egg and rice', price: 149.00, stock: 30 },
  { category: 'Meals & Steaks', name: 'Bacheelog', description: 'Bacon, cheesy sauce, garlic fried rice, and sunny egg bowl', price: 119.00, stock: 35 },
  { category: 'Meals & Steaks', name: 'Nuggetcheelog', description: 'Crispy chicken nuggets, cheese drizzle, garlic rice, and fried egg', price: 119.00, stock: 35 },
  { category: 'Meals & Steaks', name: 'Hotcheelog', description: 'Sliced frankfurter hotdog, cheddar sauce, sinangag, and egg', price: 119.00, stock: 35 },
  { category: 'Meals & Steaks', name: 'Spamcheelog', description: 'Seared luncheon meat, cheesy drizzle, garlic rice, and fried egg', price: 119.00, stock: 30 },
  { category: 'Meals & Steaks', name: 'Beef Doner Bowl', description: 'Spiced Mediterranean beef strips with garlic yogurt sauce over rice', price: 119.00, stock: 30 },
  { category: 'Meals & Steaks', name: 'Chicken Teriyaki Bowl', description: 'Pan-seared glazed chicken cubes garnished with sesame seeds over rice', price: 119.00, stock: 35 },
  { category: 'Meals & Steaks', name: 'Fully Loaded Choice of 3', description: 'Custom combo: Pick 3 (Tocino/Tapa/Hungarian/Hotdog/Bacon/Chicken/Spam) w/ rice & egg', price: 269.00, stock: 20 },
  { category: 'Meals & Steaks', name: 'Lunch Pack - Tocino', description: 'Sweet cured pork tocino, fried rice, egg, and fresh sides', price: 139.00, stock: 30 },
  { category: 'Meals & Steaks', name: 'Lunch Pack - Tapa', description: 'Savory marinated beef tapa, garlic sinangag, egg, and sides', price: 139.00, stock: 30 },
  { category: 'Meals & Steaks', name: 'Lunch Pack - Adobo', description: 'Classic tender pork and chicken adobo stewed in garlic soy vinegar', price: 139.00, stock: 30 },
  { category: 'Meals & Steaks', name: 'Lunch Pack - Mixed', description: 'Hearty chef sampler plate with mixed viands, egg, and fried rice', price: 139.00, stock: 30 },

  // PASTA & PLATTERS
  { category: 'Pasta & Platters', name: 'Lasagna', description: 'Layers of tender pasta sheets, rich bolognese meat sauce, and bechamel', price: 230.00, stock: 15 },
  { category: 'Pasta & Platters', name: 'Baked Macaroni', description: 'Elbow macaroni tossed in sweet-style meat sauce baked with cheese melt', price: 209.00, stock: 20 },
  { category: 'Pasta & Platters', name: 'Carbonara', description: 'Creamy pasta tossed with smoky bacon, parmesan cheese, and cracked pepper', price: 179.00, stock: 25 },
  { category: 'Pasta & Platters', name: 'Meaty Spaghetti', description: 'Sweet Filipino-style bolognese spaghetti topped with grated cheese', price: 179.00, stock: 30 },
  { category: 'Pasta & Platters', name: 'Platter A', description: 'Combination platter: Crispy Chicken, Pasta, Garlic Bread, and French Fries', price: 249.00, stock: 20 },
  { category: 'Pasta & Platters', name: 'Platter B', description: 'Combination platter: Grilled Hungarian Sausage, Pasta, Bread, and Fries', price: 249.00, stock: 20 },
  { category: 'Pasta & Platters', name: 'Platter C', description: 'Combination platter: Fried Chicken, Pasta, Bread, Fries, and Fresh Green Salad', price: 269.00, stock: 15 },
  { category: 'Pasta & Platters', name: 'Platter D', description: 'Combination platter: Chicken, Hungarian Sausage, Bread, Fries, and Green Salad', price: 269.00, stock: 15 },
  { category: 'Pasta & Platters', name: 'Platter E', description: 'Combination platter: Roasted Quarter Leg Chicken served with Pasta and Toast', price: 229.00, stock: 20 },

  // CHICKEN WINGS & BONELESS
  { category: 'Chicken Wings & Boneless', name: 'Buffalo Wings', description: 'Crispy fried chicken wings tossed in tangy spicy classic Buffalo glaze', price: 219.00, stock: 25 },
  { category: 'Chicken Wings & Boneless', name: 'Teriyaki Wings', description: 'Crispy wings coated in sweet savory Japanese teriyaki reduction', price: 219.00, stock: 25 },
  { category: 'Chicken Wings & Boneless', name: 'Garlic Parmesan Wings', description: 'Crisp chicken wings enveloped in roasted garlic butter and aged parmesan', price: 219.00, stock: 30 },
  { category: 'Chicken Wings & Boneless', name: 'Salt & Pepper Wings', description: 'Dry-rubbed crispy wings seasoned with cracked peppercorn and rock salt', price: 219.00, stock: 25 },
  { category: 'Chicken Wings & Boneless', name: 'Boneless Chicken Sisig', description: 'Chopped crispy boneless chicken tossed with onions, chili, and citrus dressing', price: 269.00, stock: 20 },
  { category: 'Chicken Wings & Boneless', name: 'Boneless Chicken Cheesy Meltdown', description: 'Tender boneless fried chicken fillets blanketed under molten cheese', price: 269.00, stock: 20 },
  { category: 'Chicken Wings & Boneless', name: 'Boneless Chicken Salted Egg', description: 'Crispy bite-sized fillets coated in rich aromatic salted egg yolk butter', price: 269.00, stock: 20 },
  { category: 'Chicken Wings & Boneless', name: 'Boneless Chicken Bburinkle', description: 'Korean-style crispy chicken dusted with sweet cheese and vegetable seasoning', price: 269.00, stock: 20 },
  { category: 'Chicken Wings & Boneless', name: "Chic'n Bowl (with Rice)", description: 'Crispy boneless chicken bites drizzled with sauce served over hot rice', price: 129.00, stock: 35 }
];

async function runMigration() {
  console.log('[Migration] Starting Menu Hard Reset and Full Population...');

  // Ensure columns exist on menu_items
  try {
    await db.query(`ALTER TABLE menu_items ADD COLUMN category VARCHAR(100) DEFAULT NULL`);
  } catch (e) {}
  try {
    await db.query(`ALTER TABLE menu_items ADD COLUMN status VARCHAR(50) DEFAULT 'AVAILABLE'`);
  } catch (e) {}
  try {
    await db.query(`ALTER TABLE menu_items ADD COLUMN is_featured BOOLEAN DEFAULT 0`);
  } catch (e) {}
  try {
    await db.query(`ALTER TABLE menu_items ADD COLUMN stock_quantity INT DEFAULT 50`);
  } catch (e) {}

  // 1. Seed or Upsert Categories
  console.log('[Migration] Upserting 8 board categories...');
  const categoryMap = new Map();

  for (const cat of verifiedCategories) {
    const [existing] = await db.query(`SELECT id FROM categories WHERE name = ? OR slug = ?`, [cat.name, cat.slug]);
    let catId;
    if (existing && existing.length > 0) {
      catId = existing[0].id;
      await db.query(`UPDATE categories SET name = ?, slug = ?, display_order = ?, is_active = 1 WHERE id = ?`, [
        cat.name,
        cat.slug,
        cat.display_order,
        catId
      ]);
    } else {
      const [insertRes] = await db.query(
        `INSERT INTO categories (name, slug, display_order, is_active) VALUES (?, ?, ?, 1)`,
        [cat.name, cat.slug, cat.display_order]
      );
      catId = insertRes.insertId || insertRes.lastInsertRowid;
    }
    categoryMap.set(cat.name, catId);
  }

  // Deactivate any categories outside these 8
  const activeSlugs = verifiedCategories.map(c => `'${c.slug}'`).join(',');
  await db.query(`UPDATE categories SET is_active = 0 WHERE slug NOT IN (${activeSlugs})`).catch(() => {});

  // 2. Hard Reset: Clear legacy menu_items & inventory
  console.log('[Migration] Truncating/clearing legacy menu_items and inventory...');
  try {
    // Disable FK check during reset
    await db.query(`PRAGMA foreign_keys = OFF;`).catch(() => {});
    await db.query(`SET FOREIGN_KEY_CHECKS = 0;`).catch(() => {});

    await db.query(`DELETE FROM inventory_logs`);
    await db.query(`DELETE FROM inventory`);
    await db.query(`DELETE FROM menu_items`);

    await db.query(`PRAGMA foreign_keys = ON;`).catch(() => {});
    await db.query(`SET FOREIGN_KEY_CHECKS = 1;`).catch(() => {});
  } catch (clearErr) {
    console.error('[Migration Error during reset]', clearErr);
  }

  // 3. Populate fresh menu items and inventory
  console.log(`[Migration] Inserting ${verifiedMenuItems.length} verified menu items...`);
  let insertedCount = 0;

  for (const item of verifiedMenuItems) {
    const categoryId = categoryMap.get(item.category) || 1;
    const [res] = await db.query(
      `INSERT INTO menu_items (
        category_id, category, name, description, price, stock_quantity, status, is_available, is_bestseller, preparation_time_min, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'AVAILABLE', 1, 0, 15, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [categoryId, item.category, item.name, item.description, item.price, item.stock]
    );

    const menuItemId = res.insertId || res.lastInsertRowid;

    // Insert corresponding inventory row
    if (menuItemId) {
      await db.query(
        `INSERT INTO inventory (menu_item_id, stock_quantity, low_stock_threshold, unit, updated_at)
         VALUES (?, ?, 10, 'servings', CURRENT_TIMESTAMP)`,
        [menuItemId, item.stock]
      ).catch(() => {});
    }

    insertedCount++;
  }

  console.log(`[Migration] SUCCESS! Inserted ${insertedCount} menu items across ${categoryMap.size} categories.`);
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
  }, 300);
}

module.exports = { runMigration, verifiedCategories, verifiedMenuItems };
