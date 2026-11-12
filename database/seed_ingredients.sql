-- ==============================================================================
-- Diner's Cafe: Bill of Materials (BOM) Raw Ingredients & 91 Menu Item Recipes
-- Target: MySQL 8.0 / TiDB Cloud
-- ==============================================================================
USE `diners_cafe_db`;

-- 1. Seed Raw Ingredients Catalog (5000 g/ml | 200 pcs)
INSERT INTO `ingredients` (`name`, `category`, `unit`, `stock_quantity`, `reorder_level`) VALUES
  ('Black Tea Base', 'Beverage Base & Syrups', 'ml', 5000.00, 500.00),
  ('Oolong Tea Base', 'Beverage Base & Syrups', 'ml', 5000.00, 500.00),
  ('Jasmine Green Tea Base', 'Beverage Base & Syrups', 'ml', 5000.00, 500.00),
  ('Espresso Beans', 'Beverage Base & Syrups', 'g', 5000.00, 500.00),
  ('Matcha Powder', 'Beverage Base & Syrups', 'g', 5000.00, 500.00),
  ('Taro Powder', 'Beverage Base & Syrups', 'g', 5000.00, 500.00),
  ('Dark Chocolate Powder', 'Beverage Base & Syrups', 'g', 5000.00, 500.00),
  ('Vanilla Frappe Powder', 'Beverage Base & Syrups', 'g', 5000.00, 500.00),
  ('Sugar Syrup', 'Beverage Base & Syrups', 'ml', 5000.00, 500.00),
  ('Brown Sugar Syrup', 'Beverage Base & Syrups', 'ml', 5000.00, 500.00),
  ('Caramel Syrup', 'Beverage Base & Syrups', 'ml', 5000.00, 500.00),
  ('Vanilla Syrup', 'Beverage Base & Syrups', 'ml', 5000.00, 500.00),
  ('Okinawa Syrup', 'Beverage Base & Syrups', 'ml', 5000.00, 500.00),
  ('Wintermelon Syrup', 'Beverage Base & Syrups', 'ml', 5000.00, 500.00),
  ('Green Apple Syrup', 'Beverage Base & Syrups', 'ml', 5000.00, 500.00),
  ('Lychee Syrup', 'Beverage Base & Syrups', 'ml', 5000.00, 500.00),
  ('Strawberry Syrup', 'Beverage Base & Syrups', 'ml', 5000.00, 500.00),
  ('White Chocolate Sauce', 'Beverage Base & Syrups', 'ml', 5000.00, 500.00),
  ('Chocolate Drizzle', 'Beverage Base & Syrups', 'ml', 5000.00, 500.00),
  ('Blueberry Fruit Puree', 'Beverage Base & Syrups', 'g', 5000.00, 500.00),
  ('Strawberry Fruit Puree', 'Beverage Base & Syrups', 'g', 5000.00, 500.00),
  ('Yakult Bottle', 'Beverage Base & Syrups', 'pcs', 200.00, 20.00),
  ('Fresh Milk', 'Dairy & Toppings', 'ml', 5000.00, 500.00),
  ('Non-Dairy Creamer', 'Dairy & Toppings', 'g', 5000.00, 500.00),
  ('Cream Cheese Foam', 'Dairy & Toppings', 'g', 5000.00, 500.00),
  ('Whipped Cream', 'Dairy & Toppings', 'g', 5000.00, 500.00),
  ('Tapioca Pearls', 'Dairy & Toppings', 'g', 5000.00, 500.00),
  ('Coffee Jelly', 'Dairy & Toppings', 'g', 5000.00, 500.00),
  ('Rainbow Crystals', 'Dairy & Toppings', 'g', 5000.00, 500.00),
  ('Chocolate Chips', 'Dairy & Toppings', 'g', 5000.00, 500.00),
  ('Crushed Oreo', 'Dairy & Toppings', 'g', 5000.00, 500.00),
  ('Biscoff Spread', 'Dairy & Toppings', 'g', 5000.00, 500.00),
  ('Crushed Biscoff Biscuit', 'Dairy & Toppings', 'g', 5000.00, 500.00),
  ('Sliced Almonds', 'Dairy & Toppings', 'g', 5000.00, 500.00),
  ('Cheddar Cheese Slice', 'Dairy & Toppings', 'pcs', 200.00, 20.00),
  ('Grated Cheddar', 'Dairy & Toppings', 'g', 5000.00, 500.00),
  ('Liquid Cheese Sauce', 'Dairy & Toppings', 'ml', 5000.00, 500.00),
  ('Mozzarella Cheese', 'Dairy & Toppings', 'g', 5000.00, 500.00),
  ('Parmesan Cheese', 'Dairy & Toppings', 'g', 5000.00, 500.00),
  ('Feta Cheese', 'Dairy & Toppings', 'g', 5000.00, 500.00),
  ('Cheese Stick Filling', 'Dairy & Toppings', 'g', 5000.00, 500.00),
  ('Egg', 'Dairy & Toppings', 'pcs', 200.00, 20.00),
  ('Beef Patty', 'Meat & Poultry', 'g', 5000.00, 500.00),
  ('Bacon Strips', 'Meat & Poultry', 'g', 5000.00, 500.00),
  ('Jumbo Hotdog', 'Meat & Poultry', 'pcs', 200.00, 20.00),
  ('Breaded Chicken Fillet', 'Meat & Poultry', 'g', 5000.00, 500.00),
  ('Ground Beef', 'Meat & Poultry', 'g', 5000.00, 500.00),
  ('Smoked Ham', 'Meat & Poultry', 'g', 5000.00, 500.00),
  ('Chicken Nuggets', 'Meat & Poultry', 'pcs', 200.00, 20.00),
  ('Seasoned Beef Strips', 'Meat & Poultry', 'g', 5000.00, 500.00),
  ('Seasoned Chicken Strips', 'Meat & Poultry', 'g', 5000.00, 500.00),
  ('Peeled Shrimp', 'Meat & Poultry', 'g', 5000.00, 500.00),
  ('Pepperoni', 'Meat & Poultry', 'g', 5000.00, 500.00),
  ('Hungarian Sausage', 'Meat & Poultry', 'pcs', 200.00, 20.00),
  ('Pork Spare Ribs', 'Meat & Poultry', 'g', 5000.00, 500.00),
  ('Boneless Chicken', 'Meat & Poultry', 'g', 5000.00, 500.00),
  ('Pork Adobo Cut', 'Meat & Poultry', 'g', 5000.00, 500.00),
  ('Pork Tocino', 'Meat & Poultry', 'g', 5000.00, 500.00),
  ('Marinated Beef Tapa', 'Meat & Poultry', 'g', 5000.00, 500.00),
  ('Chicken Quarter Leg', 'Meat & Poultry', 'pcs', 200.00, 20.00),
  ('Luncheon Meat', 'Meat & Poultry', 'g', 5000.00, 500.00),
  ('Chicken Wings', 'Meat & Poultry', 'pcs', 200.00, 20.00),
  ('Burger Bun', 'Bread, Dough & Pasta', 'pcs', 200.00, 20.00),
  ('Hotdog Bun', 'Bread, Dough & Pasta', 'pcs', 200.00, 20.00),
  ('Brioche Bread Slice', 'Bread, Dough & Pasta', 'pcs', 200.00, 20.00),
  ('Pita Bread', 'Bread, Dough & Pasta', 'pcs', 200.00, 20.00),
  ('Flour Tortilla', 'Bread, Dough & Pasta', 'pcs', 200.00, 20.00),
  ('Lumpia Wrapper', 'Bread, Dough & Pasta', 'pcs', 200.00, 20.00),
  ('Pizza Dough 10"', 'Bread, Dough & Pasta', 'pcs', 200.00, 20.00),
  ('Flatbread Crust', 'Bread, Dough & Pasta', 'pcs', 200.00, 20.00),
  ('Garlic Bread', 'Bread, Dough & Pasta', 'pcs', 200.00, 20.00),
  ('Elbow Macaroni', 'Bread, Dough & Pasta', 'g', 5000.00, 500.00),
  ('Spaghetti Pasta', 'Bread, Dough & Pasta', 'g', 5000.00, 500.00),
  ('Lasagna Pasta Sheets', 'Bread, Dough & Pasta', 'pcs', 200.00, 20.00),
  ('Lettuce', 'Produce & Pantry', 'g', 5000.00, 500.00),
  ('Tomato', 'Produce & Pantry', 'g', 5000.00, 500.00),
  ('Onion', 'Produce & Pantry', 'g', 5000.00, 500.00),
  ('Jalapeno', 'Produce & Pantry', 'g', 5000.00, 500.00),
  ('Bell Pepper', 'Produce & Pantry', 'g', 5000.00, 500.00),
  ('Button Mushrooms', 'Produce & Pantry', 'g', 5000.00, 500.00),
  ('Black Olives', 'Produce & Pantry', 'g', 5000.00, 500.00),
  ('Pineapple Tidbits', 'Produce & Pantry', 'g', 5000.00, 500.00),
  ('Minced Garlic', 'Produce & Pantry', 'g', 5000.00, 500.00),
  ('Mixed Vegetables', 'Produce & Pantry', 'g', 5000.00, 500.00),
  ('Calamansi', 'Produce & Pantry', 'pcs', 200.00, 20.00),
  ('French Fries', 'Produce & Pantry', 'g', 5000.00, 500.00),
  ('Twister Fries', 'Produce & Pantry', 'g', 5000.00, 500.00),
  ('Nacho Chips', 'Produce & Pantry', 'g', 5000.00, 500.00),
  ('Steamed Rice', 'Produce & Pantry', 'g', 5000.00, 500.00),
  ('Burger Sauce', 'Produce & Pantry', 'ml', 5000.00, 500.00),
  ('Mustard', 'Produce & Pantry', 'ml', 5000.00, 500.00),
  ('Mayonnaise', 'Produce & Pantry', 'ml', 5000.00, 500.00),
  ('Garlic Mayo Sauce', 'Produce & Pantry', 'ml', 5000.00, 500.00),
  ('Garlic Yogurt Sauce', 'Produce & Pantry', 'ml', 5000.00, 500.00),
  ('BBQ Sauce', 'Produce & Pantry', 'ml', 5000.00, 500.00),
  ('Salsa Dip', 'Produce & Pantry', 'ml', 5000.00, 500.00),
  ('Pizza Tomato Sauce', 'Produce & Pantry', 'ml', 5000.00, 500.00),
  ('White Bechamel Sauce', 'Produce & Pantry', 'ml', 5000.00, 500.00),
  ('Garlic Butter Base', 'Produce & Pantry', 'ml', 5000.00, 500.00),
  ('Mushroom Gravy Sauce', 'Produce & Pantry', 'ml', 5000.00, 500.00),
  ('Teriyaki Sauce', 'Produce & Pantry', 'ml', 5000.00, 500.00),
  ('Adobo Sauce', 'Produce & Pantry', 'ml', 5000.00, 500.00),
  ('Spiced Vinegar', 'Produce & Pantry', 'ml', 5000.00, 500.00),
  ('Buffalo Hot Sauce', 'Produce & Pantry', 'ml', 5000.00, 500.00),
  ('Cooking Oil', 'Produce & Pantry', 'ml', 5000.00, 500.00),
  ('Flavor Powder', 'Produce & Pantry', 'g', 5000.00, 500.00),
  ('Cajun Spice', 'Produce & Pantry', 'g', 5000.00, 500.00),
  ('Breader Flour', 'Produce & Pantry', 'g', 5000.00, 500.00),
  ('Salted Egg Powder', 'Produce & Pantry', 'g', 5000.00, 500.00),
  ('Sesame Seeds', 'Produce & Pantry', 'g', 5000.00, 500.00),
  ('Cup/Lid/Straw Set', 'Packaging', 'pcs', 200.00, 20.00),
  ('Takeout Box', 'Packaging', 'pcs', 200.00, 20.00),
  ('Pizza Box', 'Packaging', 'pcs', 200.00, 20.00),
  ('Meal Box', 'Packaging', 'pcs', 200.00, 20.00)
ON DUPLICATE KEY UPDATE `category` = VALUES(`category`), `unit` = VALUES(`unit`), `reorder_level` = VALUES(`reorder_level`);

-- 2. Populate recipe_items dynamically without hardcoded IDs

-- Recipe: Biscoff Cheesecake
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 180.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Fresh Milk' WHERE m.`name` = 'Biscoff Cheesecake' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 40.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cream Cheese Foam' WHERE m.`name` = 'Biscoff Cheesecake' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 25.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Biscoff Spread' WHERE m.`name` = 'Biscoff Cheesecake' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 15.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Crushed Biscoff Biscuit' WHERE m.`name` = 'Biscoff Cheesecake' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 15.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Brown Sugar Syrup' WHERE m.`name` = 'Biscoff Cheesecake' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cup/Lid/Straw Set' WHERE m.`name` = 'Biscoff Cheesecake' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Blueberries & Cream
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 180.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Fresh Milk' WHERE m.`name` = 'Blueberries & Cream' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 35.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Blueberry Fruit Puree' WHERE m.`name` = 'Blueberries & Cream' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cream Cheese Foam' WHERE m.`name` = 'Blueberries & Cream' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 15.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Sugar Syrup' WHERE m.`name` = 'Blueberries & Cream' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cup/Lid/Straw Set' WHERE m.`name` = 'Blueberries & Cream' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Brown Sugar Milktea
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 150.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Black Tea Base' WHERE m.`name` = 'Brown Sugar Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 100.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Fresh Milk' WHERE m.`name` = 'Brown Sugar Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 35.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Brown Sugar Syrup' WHERE m.`name` = 'Brown Sugar Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 40.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Tapioca Pearls' WHERE m.`name` = 'Brown Sugar Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cup/Lid/Straw Set' WHERE m.`name` = 'Brown Sugar Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Caramel Macchiato
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 18.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Espresso Beans' WHERE m.`name` = 'Caramel Macchiato' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 200.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Fresh Milk' WHERE m.`name` = 'Caramel Macchiato' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 25.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Caramel Syrup' WHERE m.`name` = 'Caramel Macchiato' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 10.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Vanilla Syrup' WHERE m.`name` = 'Caramel Macchiato' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cup/Lid/Straw Set' WHERE m.`name` = 'Caramel Macchiato' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Choco Java Chips
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 180.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Fresh Milk' WHERE m.`name` = 'Choco Java Chips' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Dark Chocolate Powder' WHERE m.`name` = 'Choco Java Chips' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Chocolate Chips' WHERE m.`name` = 'Choco Java Chips' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 25.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Whipped Cream' WHERE m.`name` = 'Choco Java Chips' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 10.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Chocolate Drizzle' WHERE m.`name` = 'Choco Java Chips' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cup/Lid/Straw Set' WHERE m.`name` = 'Choco Java Chips' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Classic Milktea
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 180.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Black Tea Base' WHERE m.`name` = 'Classic Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Non-Dairy Creamer' WHERE m.`name` = 'Classic Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 25.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Sugar Syrup' WHERE m.`name` = 'Classic Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cup/Lid/Straw Set' WHERE m.`name` = 'Classic Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Dark Chocolate Milktea
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 150.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Black Tea Base' WHERE m.`name` = 'Dark Chocolate Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 80.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Fresh Milk' WHERE m.`name` = 'Dark Chocolate Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 35.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Dark Chocolate Powder' WHERE m.`name` = 'Dark Chocolate Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Sugar Syrup' WHERE m.`name` = 'Dark Chocolate Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cup/Lid/Straw Set' WHERE m.`name` = 'Dark Chocolate Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Diner's House Blend Milktea
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 180.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Oolong Tea Base' WHERE m.`name` = 'Diner''s House Blend Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Non-Dairy Creamer' WHERE m.`name` = 'Diner''s House Blend Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Brown Sugar Syrup' WHERE m.`name` = 'Diner''s House Blend Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Coffee Jelly' WHERE m.`name` = 'Diner''s House Blend Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cup/Lid/Straw Set' WHERE m.`name` = 'Diner''s House Blend Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Diner's Signature Drink
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 18.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Espresso Beans' WHERE m.`name` = 'Diner''s Signature Drink' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 180.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Fresh Milk' WHERE m.`name` = 'Diner''s Signature Drink' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 25.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'White Chocolate Sauce' WHERE m.`name` = 'Diner''s Signature Drink' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cream Cheese Foam' WHERE m.`name` = 'Diner''s Signature Drink' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cup/Lid/Straw Set' WHERE m.`name` = 'Diner''s Signature Drink' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Green Apple Fruit Tea
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 200.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Jasmine Green Tea Base' WHERE m.`name` = 'Green Apple Fruit Tea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 35.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Green Apple Syrup' WHERE m.`name` = 'Green Apple Fruit Tea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 15.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Sugar Syrup' WHERE m.`name` = 'Green Apple Fruit Tea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cup/Lid/Straw Set' WHERE m.`name` = 'Green Apple Fruit Tea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Green Apple Yakult
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 150.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Jasmine Green Tea Base' WHERE m.`name` = 'Green Apple Yakult' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Green Apple Syrup' WHERE m.`name` = 'Green Apple Yakult' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Yakult Bottle' WHERE m.`name` = 'Green Apple Yakult' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 10.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Sugar Syrup' WHERE m.`name` = 'Green Apple Yakult' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cup/Lid/Straw Set' WHERE m.`name` = 'Green Apple Yakult' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Lychee Fruit Tea
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 200.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Jasmine Green Tea Base' WHERE m.`name` = 'Lychee Fruit Tea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 35.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Lychee Syrup' WHERE m.`name` = 'Lychee Fruit Tea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 15.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Sugar Syrup' WHERE m.`name` = 'Lychee Fruit Tea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cup/Lid/Straw Set' WHERE m.`name` = 'Lychee Fruit Tea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Lychee Yakult
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 150.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Jasmine Green Tea Base' WHERE m.`name` = 'Lychee Yakult' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Lychee Syrup' WHERE m.`name` = 'Lychee Yakult' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Yakult Bottle' WHERE m.`name` = 'Lychee Yakult' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 10.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Sugar Syrup' WHERE m.`name` = 'Lychee Yakult' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cup/Lid/Straw Set' WHERE m.`name` = 'Lychee Yakult' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Matcha Milktea
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 200.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Fresh Milk' WHERE m.`name` = 'Matcha Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 12.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Matcha Powder' WHERE m.`name` = 'Matcha Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 25.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Sugar Syrup' WHERE m.`name` = 'Matcha Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cup/Lid/Straw Set' WHERE m.`name` = 'Matcha Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Okinawa Milktea
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 170.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Black Tea Base' WHERE m.`name` = 'Okinawa Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Non-Dairy Creamer' WHERE m.`name` = 'Okinawa Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Okinawa Syrup' WHERE m.`name` = 'Okinawa Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cup/Lid/Straw Set' WHERE m.`name` = 'Okinawa Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Oreo Blast
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 180.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Fresh Milk' WHERE m.`name` = 'Oreo Blast' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Vanilla Frappe Powder' WHERE m.`name` = 'Oreo Blast' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Crushed Oreo' WHERE m.`name` = 'Oreo Blast' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 25.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Whipped Cream' WHERE m.`name` = 'Oreo Blast' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cup/Lid/Straw Set' WHERE m.`name` = 'Oreo Blast' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Oreo Milktea
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 160.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Black Tea Base' WHERE m.`name` = 'Oreo Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Non-Dairy Creamer' WHERE m.`name` = 'Oreo Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Sugar Syrup' WHERE m.`name` = 'Oreo Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 25.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Crushed Oreo' WHERE m.`name` = 'Oreo Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cup/Lid/Straw Set' WHERE m.`name` = 'Oreo Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Purple Alcapone
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 180.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Fresh Milk' WHERE m.`name` = 'Purple Alcapone' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Taro Powder' WHERE m.`name` = 'Purple Alcapone' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'White Chocolate Sauce' WHERE m.`name` = 'Purple Alcapone' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 10.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Sliced Almonds' WHERE m.`name` = 'Purple Alcapone' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cup/Lid/Straw Set' WHERE m.`name` = 'Purple Alcapone' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Roasted Wintermelon Milktea
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 170.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Black Tea Base' WHERE m.`name` = 'Roasted Wintermelon Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Non-Dairy Creamer' WHERE m.`name` = 'Roasted Wintermelon Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 35.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Wintermelon Syrup' WHERE m.`name` = 'Roasted Wintermelon Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cup/Lid/Straw Set' WHERE m.`name` = 'Roasted Wintermelon Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Strawberries & Cream
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 180.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Fresh Milk' WHERE m.`name` = 'Strawberries & Cream' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 35.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Strawberry Fruit Puree' WHERE m.`name` = 'Strawberries & Cream' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cream Cheese Foam' WHERE m.`name` = 'Strawberries & Cream' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 15.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Sugar Syrup' WHERE m.`name` = 'Strawberries & Cream' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cup/Lid/Straw Set' WHERE m.`name` = 'Strawberries & Cream' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Strawberry Fruit Tea
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 200.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Jasmine Green Tea Base' WHERE m.`name` = 'Strawberry Fruit Tea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 35.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Strawberry Syrup' WHERE m.`name` = 'Strawberry Fruit Tea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 15.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Sugar Syrup' WHERE m.`name` = 'Strawberry Fruit Tea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cup/Lid/Straw Set' WHERE m.`name` = 'Strawberry Fruit Tea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Strawberry Yakult
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 150.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Jasmine Green Tea Base' WHERE m.`name` = 'Strawberry Yakult' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Strawberry Syrup' WHERE m.`name` = 'Strawberry Yakult' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Yakult Bottle' WHERE m.`name` = 'Strawberry Yakult' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 10.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Sugar Syrup' WHERE m.`name` = 'Strawberry Yakult' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cup/Lid/Straw Set' WHERE m.`name` = 'Strawberry Yakult' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Taro Milktea
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 160.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Black Tea Base' WHERE m.`name` = 'Taro Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 25.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Non-Dairy Creamer' WHERE m.`name` = 'Taro Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Taro Powder' WHERE m.`name` = 'Taro Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Sugar Syrup' WHERE m.`name` = 'Taro Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cup/Lid/Straw Set' WHERE m.`name` = 'Taro Milktea' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Two Two
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 150.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Black Tea Base' WHERE m.`name` = 'Two Two' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 80.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Fresh Milk' WHERE m.`name` = 'Two Two' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Brown Sugar Syrup' WHERE m.`name` = 'Two Two' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 25.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Tapioca Pearls' WHERE m.`name` = 'Two Two' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 25.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Coffee Jelly' WHERE m.`name` = 'Two Two' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cup/Lid/Straw Set' WHERE m.`name` = 'Two Two' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Bacon Burger
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Burger Bun' WHERE m.`name` = 'Bacon Burger' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 120.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Beef Patty' WHERE m.`name` = 'Bacon Burger' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Bacon Strips' WHERE m.`name` = 'Bacon Burger' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cheddar Cheese Slice' WHERE m.`name` = 'Bacon Burger' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 15.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Lettuce' WHERE m.`name` = 'Bacon Burger' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Tomato' WHERE m.`name` = 'Bacon Burger' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Burger Sauce' WHERE m.`name` = 'Bacon Burger' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Bacon Burger' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: California Dog
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Hotdog Bun' WHERE m.`name` = 'California Dog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Jumbo Hotdog' WHERE m.`name` = 'California Dog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Tomato' WHERE m.`name` = 'California Dog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 15.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Onion' WHERE m.`name` = 'California Dog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 10.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Jalapeno' WHERE m.`name` = 'California Dog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 10.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Mustard' WHERE m.`name` = 'California Dog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 15.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Mayonnaise' WHERE m.`name` = 'California Dog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'California Dog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Cheesy Dog
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Hotdog Bun' WHERE m.`name` = 'Cheesy Dog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Jumbo Hotdog' WHERE m.`name` = 'Cheesy Dog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 35.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Liquid Cheese Sauce' WHERE m.`name` = 'Cheesy Dog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 15.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Grated Cheddar' WHERE m.`name` = 'Cheesy Dog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Cheesy Dog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Chicken Fillet Burger
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Burger Bun' WHERE m.`name` = 'Chicken Fillet Burger' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 130.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Breaded Chicken Fillet' WHERE m.`name` = 'Chicken Fillet Burger' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 15.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Lettuce' WHERE m.`name` = 'Chicken Fillet Burger' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Mayonnaise' WHERE m.`name` = 'Chicken Fillet Burger' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 25.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cooking Oil' WHERE m.`name` = 'Chicken Fillet Burger' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Chicken Fillet Burger' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Classic Burger
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Burger Bun' WHERE m.`name` = 'Classic Burger' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 120.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Beef Patty' WHERE m.`name` = 'Classic Burger' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 15.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Lettuce' WHERE m.`name` = 'Classic Burger' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Tomato' WHERE m.`name` = 'Classic Burger' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 10.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Onion' WHERE m.`name` = 'Classic Burger' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Burger Sauce' WHERE m.`name` = 'Classic Burger' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Classic Burger' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Diner's Double Down
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 260.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Breaded Chicken Fillet' WHERE m.`name` = 'Diner''s Double Down' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Bacon Strips' WHERE m.`name` = 'Diner''s Double Down' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 2.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cheddar Cheese Slice' WHERE m.`name` = 'Diner''s Double Down' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 25.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Garlic Mayo Sauce' WHERE m.`name` = 'Diner''s Double Down' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 35.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cooking Oil' WHERE m.`name` = 'Diner''s Double Down' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Diner''s Double Down' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Meaty Dog
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Hotdog Bun' WHERE m.`name` = 'Meaty Dog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Jumbo Hotdog' WHERE m.`name` = 'Meaty Dog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 50.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Ground Beef' WHERE m.`name` = 'Meaty Dog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 25.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Liquid Cheese Sauce' WHERE m.`name` = 'Meaty Dog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Meaty Dog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Premium Sandwich
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 3.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Brioche Bread Slice' WHERE m.`name` = 'Premium Sandwich' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 40.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Smoked Ham' WHERE m.`name` = 'Premium Sandwich' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Bacon Strips' WHERE m.`name` = 'Premium Sandwich' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Egg' WHERE m.`name` = 'Premium Sandwich' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cheddar Cheese Slice' WHERE m.`name` = 'Premium Sandwich' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Lettuce' WHERE m.`name` = 'Premium Sandwich' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 25.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Tomato' WHERE m.`name` = 'Premium Sandwich' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Mayonnaise' WHERE m.`name` = 'Premium Sandwich' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Premium Sandwich' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Cheese Stick Jalapeno
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 6.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Lumpia Wrapper' WHERE m.`name` = 'Cheese Stick Jalapeno' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 60.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cheese Stick Filling' WHERE m.`name` = 'Cheese Stick Jalapeno' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 15.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Jalapeno' WHERE m.`name` = 'Cheese Stick Jalapeno' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 25.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Garlic Mayo Sauce' WHERE m.`name` = 'Cheese Stick Jalapeno' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cooking Oil' WHERE m.`name` = 'Cheese Stick Jalapeno' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Cheese Stick Jalapeno' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Cheesy Bacon Fries
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 180.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'French Fries' WHERE m.`name` = 'Cheesy Bacon Fries' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 40.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Liquid Cheese Sauce' WHERE m.`name` = 'Cheesy Bacon Fries' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 25.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Bacon Strips' WHERE m.`name` = 'Cheesy Bacon Fries' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 35.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cooking Oil' WHERE m.`name` = 'Cheesy Bacon Fries' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Cheesy Bacon Fries' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Flavored Fries
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 150.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'French Fries' WHERE m.`name` = 'Flavored Fries' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 12.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Flavor Powder' WHERE m.`name` = 'Flavored Fries' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cooking Oil' WHERE m.`name` = 'Flavored Fries' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Flavored Fries' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Nachos with Toppings (Large)
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 160.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Nacho Chips' WHERE m.`name` = 'Nachos with Toppings (Large)' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 80.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Ground Beef' WHERE m.`name` = 'Nachos with Toppings (Large)' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 50.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Liquid Cheese Sauce' WHERE m.`name` = 'Nachos with Toppings (Large)' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Tomato' WHERE m.`name` = 'Nachos with Toppings (Large)' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Onion' WHERE m.`name` = 'Nachos with Toppings (Large)' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 10.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Jalapeno' WHERE m.`name` = 'Nachos with Toppings (Large)' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Nachos with Toppings (Large)' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Nachos with Toppings (Regular)
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 100.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Nacho Chips' WHERE m.`name` = 'Nachos with Toppings (Regular)' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 50.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Ground Beef' WHERE m.`name` = 'Nachos with Toppings (Regular)' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 35.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Liquid Cheese Sauce' WHERE m.`name` = 'Nachos with Toppings (Regular)' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Tomato' WHERE m.`name` = 'Nachos with Toppings (Regular)' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 15.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Onion' WHERE m.`name` = 'Nachos with Toppings (Regular)' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Nachos with Toppings (Regular)' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Nuggets (12 pcs)
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 12.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Chicken Nuggets' WHERE m.`name` = 'Nuggets (12 pcs)' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'BBQ Sauce' WHERE m.`name` = 'Nuggets (12 pcs)' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 40.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cooking Oil' WHERE m.`name` = 'Nuggets (12 pcs)' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Nuggets (12 pcs)' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Nuggets & Fries Combo
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 6.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Chicken Nuggets' WHERE m.`name` = 'Nuggets & Fries Combo' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 120.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'French Fries' WHERE m.`name` = 'Nuggets & Fries Combo' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 25.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Liquid Cheese Sauce' WHERE m.`name` = 'Nuggets & Fries Combo' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 35.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cooking Oil' WHERE m.`name` = 'Nuggets & Fries Combo' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Nuggets & Fries Combo' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Pita Wrap
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pita Bread' WHERE m.`name` = 'Pita Wrap' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 80.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Seasoned Beef Strips' WHERE m.`name` = 'Pita Wrap' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Lettuce' WHERE m.`name` = 'Pita Wrap' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Tomato' WHERE m.`name` = 'Pita Wrap' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 10.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Onion' WHERE m.`name` = 'Pita Wrap' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 25.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Garlic Yogurt Sauce' WHERE m.`name` = 'Pita Wrap' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Pita Wrap' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Quesadilla
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 2.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Flour Tortilla' WHERE m.`name` = 'Quesadilla' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 90.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Seasoned Chicken Strips' WHERE m.`name` = 'Quesadilla' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 60.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Mozzarella Cheese' WHERE m.`name` = 'Quesadilla' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Bell Pepper' WHERE m.`name` = 'Quesadilla' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 15.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Onion' WHERE m.`name` = 'Quesadilla' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Salsa Dip' WHERE m.`name` = 'Quesadilla' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Quesadilla' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Twisted Fries
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 160.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Twister Fries' WHERE m.`name` = 'Twisted Fries' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 25.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Liquid Cheese Sauce' WHERE m.`name` = 'Twisted Fries' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 35.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cooking Oil' WHERE m.`name` = 'Twisted Fries' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Twisted Fries' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Bacon & Mushroom Pizza
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pizza Dough 10"' WHERE m.`name` = 'Bacon & Mushroom Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 60.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pizza Tomato Sauce' WHERE m.`name` = 'Bacon & Mushroom Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 110.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Mozzarella Cheese' WHERE m.`name` = 'Bacon & Mushroom Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 50.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Bacon Strips' WHERE m.`name` = 'Bacon & Mushroom Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 40.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Button Mushrooms' WHERE m.`name` = 'Bacon & Mushroom Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pizza Box' WHERE m.`name` = 'Bacon & Mushroom Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Cajun Shrimp Pizza
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pizza Dough 10"' WHERE m.`name` = 'Cajun Shrimp Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 60.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pizza Tomato Sauce' WHERE m.`name` = 'Cajun Shrimp Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 110.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Mozzarella Cheese' WHERE m.`name` = 'Cajun Shrimp Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 90.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Peeled Shrimp' WHERE m.`name` = 'Cajun Shrimp Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 8.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cajun Spice' WHERE m.`name` = 'Cajun Shrimp Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 25.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Bell Pepper' WHERE m.`name` = 'Cajun Shrimp Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pizza Box' WHERE m.`name` = 'Cajun Shrimp Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Diner's Pizza Supreme
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pizza Dough 10"' WHERE m.`name` = 'Diner''s Pizza Supreme' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 60.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pizza Tomato Sauce' WHERE m.`name` = 'Diner''s Pizza Supreme' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 120.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Mozzarella Cheese' WHERE m.`name` = 'Diner''s Pizza Supreme' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pepperoni' WHERE m.`name` = 'Diner''s Pizza Supreme' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Smoked Ham' WHERE m.`name` = 'Diner''s Pizza Supreme' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 35.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Ground Beef' WHERE m.`name` = 'Diner''s Pizza Supreme' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 25.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Button Mushrooms' WHERE m.`name` = 'Diner''s Pizza Supreme' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Bell Pepper' WHERE m.`name` = 'Diner''s Pizza Supreme' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 15.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Black Olives' WHERE m.`name` = 'Diner''s Pizza Supreme' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pizza Box' WHERE m.`name` = 'Diner''s Pizza Supreme' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Four Cheese Flat Bread
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Flatbread Crust' WHERE m.`name` = 'Four Cheese Flat Bread' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 40.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'White Bechamel Sauce' WHERE m.`name` = 'Four Cheese Flat Bread' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 60.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Mozzarella Cheese' WHERE m.`name` = 'Four Cheese Flat Bread' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Grated Cheddar' WHERE m.`name` = 'Four Cheese Flat Bread' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Parmesan Cheese' WHERE m.`name` = 'Four Cheese Flat Bread' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 25.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cream Cheese Foam' WHERE m.`name` = 'Four Cheese Flat Bread' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Four Cheese Flat Bread' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Garlic Shrimp Pizza
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pizza Dough 10"' WHERE m.`name` = 'Garlic Shrimp Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 35.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Garlic Butter Base' WHERE m.`name` = 'Garlic Shrimp Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 110.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Mozzarella Cheese' WHERE m.`name` = 'Garlic Shrimp Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 90.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Peeled Shrimp' WHERE m.`name` = 'Garlic Shrimp Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 15.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Minced Garlic' WHERE m.`name` = 'Garlic Shrimp Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pizza Box' WHERE m.`name` = 'Garlic Shrimp Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Ham & Bacon Flat Bread
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Flatbread Crust' WHERE m.`name` = 'Ham & Bacon Flat Bread' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 45.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pizza Tomato Sauce' WHERE m.`name` = 'Ham & Bacon Flat Bread' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 80.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Mozzarella Cheese' WHERE m.`name` = 'Ham & Bacon Flat Bread' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 40.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Smoked Ham' WHERE m.`name` = 'Ham & Bacon Flat Bread' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 35.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Bacon Strips' WHERE m.`name` = 'Ham & Bacon Flat Bread' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Ham & Bacon Flat Bread' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Hawaiian Pizza
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pizza Dough 10"' WHERE m.`name` = 'Hawaiian Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 60.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pizza Tomato Sauce' WHERE m.`name` = 'Hawaiian Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 110.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Mozzarella Cheese' WHERE m.`name` = 'Hawaiian Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 60.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Smoked Ham' WHERE m.`name` = 'Hawaiian Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 50.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pineapple Tidbits' WHERE m.`name` = 'Hawaiian Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pizza Box' WHERE m.`name` = 'Hawaiian Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Hungarian Pizza
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pizza Dough 10"' WHERE m.`name` = 'Hungarian Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 60.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pizza Tomato Sauce' WHERE m.`name` = 'Hungarian Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 110.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Mozzarella Cheese' WHERE m.`name` = 'Hungarian Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Hungarian Sausage' WHERE m.`name` = 'Hungarian Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Onion' WHERE m.`name` = 'Hungarian Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Bell Pepper' WHERE m.`name` = 'Hungarian Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pizza Box' WHERE m.`name` = 'Hungarian Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Mediterranean Pizza
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pizza Dough 10"' WHERE m.`name` = 'Mediterranean Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 60.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pizza Tomato Sauce' WHERE m.`name` = 'Mediterranean Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 100.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Mozzarella Cheese' WHERE m.`name` = 'Mediterranean Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 35.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Feta Cheese' WHERE m.`name` = 'Mediterranean Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 25.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Black Olives' WHERE m.`name` = 'Mediterranean Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Tomato' WHERE m.`name` = 'Mediterranean Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Onion' WHERE m.`name` = 'Mediterranean Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pizza Box' WHERE m.`name` = 'Mediterranean Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Pizza Bianca
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pizza Dough 10"' WHERE m.`name` = 'Pizza Bianca' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 60.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'White Bechamel Sauce' WHERE m.`name` = 'Pizza Bianca' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 110.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Mozzarella Cheese' WHERE m.`name` = 'Pizza Bianca' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 40.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cream Cheese Foam' WHERE m.`name` = 'Pizza Bianca' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 10.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Minced Garlic' WHERE m.`name` = 'Pizza Bianca' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Parmesan Cheese' WHERE m.`name` = 'Pizza Bianca' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pizza Box' WHERE m.`name` = 'Pizza Bianca' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Triple Cheese Pizza
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pizza Dough 10"' WHERE m.`name` = 'Triple Cheese Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 60.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pizza Tomato Sauce' WHERE m.`name` = 'Triple Cheese Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 90.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Mozzarella Cheese' WHERE m.`name` = 'Triple Cheese Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 45.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Grated Cheddar' WHERE m.`name` = 'Triple Cheese Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 25.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Parmesan Cheese' WHERE m.`name` = 'Triple Cheese Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pizza Box' WHERE m.`name` = 'Triple Cheese Pizza' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Bacheelog
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 200.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Steamed Rice' WHERE m.`name` = 'Bacheelog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 50.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Bacon Strips' WHERE m.`name` = 'Bacheelog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Liquid Cheese Sauce' WHERE m.`name` = 'Bacheelog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Egg' WHERE m.`name` = 'Bacheelog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 15.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cooking Oil' WHERE m.`name` = 'Bacheelog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Meal Box' WHERE m.`name` = 'Bacheelog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: BBQ Ribs
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 250.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pork Spare Ribs' WHERE m.`name` = 'BBQ Ribs' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 50.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'BBQ Sauce' WHERE m.`name` = 'BBQ Ribs' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 200.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Steamed Rice' WHERE m.`name` = 'BBQ Ribs' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 40.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Mixed Vegetables' WHERE m.`name` = 'BBQ Ribs' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Meal Box' WHERE m.`name` = 'BBQ Ribs' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Beef Doner Bowl
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 200.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Steamed Rice' WHERE m.`name` = 'Beef Doner Bowl' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 110.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Seasoned Beef Strips' WHERE m.`name` = 'Beef Doner Bowl' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 25.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Garlic Yogurt Sauce' WHERE m.`name` = 'Beef Doner Bowl' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 25.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Lettuce' WHERE m.`name` = 'Beef Doner Bowl' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Tomato' WHERE m.`name` = 'Beef Doner Bowl' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Meal Box' WHERE m.`name` = 'Beef Doner Bowl' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Burger Steak (2 pcs)
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 240.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Beef Patty' WHERE m.`name` = 'Burger Steak (2 pcs)' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 60.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Mushroom Gravy Sauce' WHERE m.`name` = 'Burger Steak (2 pcs)' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Button Mushrooms' WHERE m.`name` = 'Burger Steak (2 pcs)' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 200.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Steamed Rice' WHERE m.`name` = 'Burger Steak (2 pcs)' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Meal Box' WHERE m.`name` = 'Burger Steak (2 pcs)' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Chicken Teriyaki Bowl
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 200.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Steamed Rice' WHERE m.`name` = 'Chicken Teriyaki Bowl' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 120.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Boneless Chicken' WHERE m.`name` = 'Chicken Teriyaki Bowl' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 35.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Teriyaki Sauce' WHERE m.`name` = 'Chicken Teriyaki Bowl' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 3.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Sesame Seeds' WHERE m.`name` = 'Chicken Teriyaki Bowl' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Mixed Vegetables' WHERE m.`name` = 'Chicken Teriyaki Bowl' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Meal Box' WHERE m.`name` = 'Chicken Teriyaki Bowl' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Fully Loaded Choice of 3
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 250.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Steamed Rice' WHERE m.`name` = 'Fully Loaded Choice of 3' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 80.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Boneless Chicken' WHERE m.`name` = 'Fully Loaded Choice of 3' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 40.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Bacon Strips' WHERE m.`name` = 'Fully Loaded Choice of 3' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Hungarian Sausage' WHERE m.`name` = 'Fully Loaded Choice of 3' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 40.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Mushroom Gravy Sauce' WHERE m.`name` = 'Fully Loaded Choice of 3' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Meal Box' WHERE m.`name` = 'Fully Loaded Choice of 3' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Hotcheelog
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 200.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Steamed Rice' WHERE m.`name` = 'Hotcheelog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Jumbo Hotdog' WHERE m.`name` = 'Hotcheelog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Liquid Cheese Sauce' WHERE m.`name` = 'Hotcheelog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Egg' WHERE m.`name` = 'Hotcheelog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 15.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cooking Oil' WHERE m.`name` = 'Hotcheelog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Meal Box' WHERE m.`name` = 'Hotcheelog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Hungarian with Egg
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 200.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Steamed Rice' WHERE m.`name` = 'Hungarian with Egg' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Hungarian Sausage' WHERE m.`name` = 'Hungarian with Egg' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Egg' WHERE m.`name` = 'Hungarian with Egg' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 15.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cooking Oil' WHERE m.`name` = 'Hungarian with Egg' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Meal Box' WHERE m.`name` = 'Hungarian with Egg' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Lunch Pack - Adobo
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 200.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Steamed Rice' WHERE m.`name` = 'Lunch Pack - Adobo' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 140.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pork Adobo Cut' WHERE m.`name` = 'Lunch Pack - Adobo' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 40.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Adobo Sauce' WHERE m.`name` = 'Lunch Pack - Adobo' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Egg' WHERE m.`name` = 'Lunch Pack - Adobo' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Meal Box' WHERE m.`name` = 'Lunch Pack - Adobo' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Lunch Pack - Mixed
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 200.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Steamed Rice' WHERE m.`name` = 'Lunch Pack - Mixed' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 70.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pork Adobo Cut' WHERE m.`name` = 'Lunch Pack - Mixed' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 70.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pork Tocino' WHERE m.`name` = 'Lunch Pack - Mixed' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Mixed Vegetables' WHERE m.`name` = 'Lunch Pack - Mixed' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Meal Box' WHERE m.`name` = 'Lunch Pack - Mixed' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Lunch Pack - Tapa
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 200.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Steamed Rice' WHERE m.`name` = 'Lunch Pack - Tapa' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 120.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Marinated Beef Tapa' WHERE m.`name` = 'Lunch Pack - Tapa' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Egg' WHERE m.`name` = 'Lunch Pack - Tapa' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 15.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Spiced Vinegar' WHERE m.`name` = 'Lunch Pack - Tapa' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 15.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cooking Oil' WHERE m.`name` = 'Lunch Pack - Tapa' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Meal Box' WHERE m.`name` = 'Lunch Pack - Tapa' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Lunch Pack - Tocino
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 200.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Steamed Rice' WHERE m.`name` = 'Lunch Pack - Tocino' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 120.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pork Tocino' WHERE m.`name` = 'Lunch Pack - Tocino' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Egg' WHERE m.`name` = 'Lunch Pack - Tocino' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 15.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cooking Oil' WHERE m.`name` = 'Lunch Pack - Tocino' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Meal Box' WHERE m.`name` = 'Lunch Pack - Tocino' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Nuggetcheelog
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 200.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Steamed Rice' WHERE m.`name` = 'Nuggetcheelog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 5.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Chicken Nuggets' WHERE m.`name` = 'Nuggetcheelog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Liquid Cheese Sauce' WHERE m.`name` = 'Nuggetcheelog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Egg' WHERE m.`name` = 'Nuggetcheelog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 25.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cooking Oil' WHERE m.`name` = 'Nuggetcheelog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Meal Box' WHERE m.`name` = 'Nuggetcheelog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Quarter Chicken Meal
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Chicken Quarter Leg' WHERE m.`name` = 'Quarter Chicken Meal' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 200.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Steamed Rice' WHERE m.`name` = 'Quarter Chicken Meal' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 45.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Mushroom Gravy Sauce' WHERE m.`name` = 'Quarter Chicken Meal' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cooking Oil' WHERE m.`name` = 'Quarter Chicken Meal' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Meal Box' WHERE m.`name` = 'Quarter Chicken Meal' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Spamcheelog
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 200.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Steamed Rice' WHERE m.`name` = 'Spamcheelog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 70.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Luncheon Meat' WHERE m.`name` = 'Spamcheelog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Liquid Cheese Sauce' WHERE m.`name` = 'Spamcheelog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Egg' WHERE m.`name` = 'Spamcheelog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 15.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cooking Oil' WHERE m.`name` = 'Spamcheelog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Meal Box' WHERE m.`name` = 'Spamcheelog' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Baked Macaroni
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 120.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Elbow Macaroni' WHERE m.`name` = 'Baked Macaroni' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 100.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Ground Beef' WHERE m.`name` = 'Baked Macaroni' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 50.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'White Bechamel Sauce' WHERE m.`name` = 'Baked Macaroni' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 40.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Mozzarella Cheese' WHERE m.`name` = 'Baked Macaroni' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Baked Macaroni' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Carbonara
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 130.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Spaghetti Pasta' WHERE m.`name` = 'Carbonara' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 90.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'White Bechamel Sauce' WHERE m.`name` = 'Carbonara' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 35.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Bacon Strips' WHERE m.`name` = 'Carbonara' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Parmesan Cheese' WHERE m.`name` = 'Carbonara' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Garlic Bread' WHERE m.`name` = 'Carbonara' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Carbonara' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Lasagna
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 3.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Lasagna Pasta Sheets' WHERE m.`name` = 'Lasagna' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 120.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Ground Beef' WHERE m.`name` = 'Lasagna' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 60.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'White Bechamel Sauce' WHERE m.`name` = 'Lasagna' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 50.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Mozzarella Cheese' WHERE m.`name` = 'Lasagna' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 15.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Parmesan Cheese' WHERE m.`name` = 'Lasagna' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Lasagna' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Meaty Spaghetti
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 130.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Spaghetti Pasta' WHERE m.`name` = 'Meaty Spaghetti' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 110.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Pizza Tomato Sauce' WHERE m.`name` = 'Meaty Spaghetti' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 50.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Ground Beef' WHERE m.`name` = 'Meaty Spaghetti' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 0.50 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Jumbo Hotdog' WHERE m.`name` = 'Meaty Spaghetti' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Grated Cheddar' WHERE m.`name` = 'Meaty Spaghetti' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Meaty Spaghetti' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Platter A
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 200.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'French Fries' WHERE m.`name` = 'Platter A' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 8.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Chicken Nuggets' WHERE m.`name` = 'Platter A' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 6.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Lumpia Wrapper' WHERE m.`name` = 'Platter A' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 60.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cheese Stick Filling' WHERE m.`name` = 'Platter A' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 50.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Liquid Cheese Sauce' WHERE m.`name` = 'Platter A' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 40.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cooking Oil' WHERE m.`name` = 'Platter A' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Platter A' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Platter B
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 150.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Nacho Chips' WHERE m.`name` = 'Platter B' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 150.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Twister Fries' WHERE m.`name` = 'Platter B' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 70.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Ground Beef' WHERE m.`name` = 'Platter B' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 50.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Liquid Cheese Sauce' WHERE m.`name` = 'Platter B' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 35.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cooking Oil' WHERE m.`name` = 'Platter B' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Platter B' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Platter C
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 6.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Chicken Wings' WHERE m.`name` = 'Platter C' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 200.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'French Fries' WHERE m.`name` = 'Platter C' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 50.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Buffalo Hot Sauce' WHERE m.`name` = 'Platter C' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 45.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cooking Oil' WHERE m.`name` = 'Platter C' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Platter C' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Platter D
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 200.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Boneless Chicken' WHERE m.`name` = 'Platter D' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 120.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Nacho Chips' WHERE m.`name` = 'Platter D' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 6.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Lumpia Wrapper' WHERE m.`name` = 'Platter D' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 60.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cheese Stick Filling' WHERE m.`name` = 'Platter D' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 60.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Liquid Cheese Sauce' WHERE m.`name` = 'Platter D' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 45.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cooking Oil' WHERE m.`name` = 'Platter D' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Platter D' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Platter E
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 180.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'French Fries' WHERE m.`name` = 'Platter E' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 6.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Chicken Nuggets' WHERE m.`name` = 'Platter E' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 4.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Lumpia Wrapper' WHERE m.`name` = 'Platter E' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 40.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cheese Stick Filling' WHERE m.`name` = 'Platter E' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 40.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Garlic Mayo Sauce' WHERE m.`name` = 'Platter E' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 40.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cooking Oil' WHERE m.`name` = 'Platter E' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Platter E' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Boneless Chicken Bburinkle
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 220.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Boneless Chicken' WHERE m.`name` = 'Boneless Chicken Bburinkle' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 40.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Breader Flour' WHERE m.`name` = 'Boneless Chicken Bburinkle' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Flavor Powder' WHERE m.`name` = 'Boneless Chicken Bburinkle' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Garlic Yogurt Sauce' WHERE m.`name` = 'Boneless Chicken Bburinkle' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 45.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cooking Oil' WHERE m.`name` = 'Boneless Chicken Bburinkle' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Boneless Chicken Bburinkle' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Boneless Chicken Cheesy Meltdown
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 220.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Boneless Chicken' WHERE m.`name` = 'Boneless Chicken Cheesy Meltdown' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 40.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Breader Flour' WHERE m.`name` = 'Boneless Chicken Cheesy Meltdown' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 55.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Liquid Cheese Sauce' WHERE m.`name` = 'Boneless Chicken Cheesy Meltdown' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 45.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cooking Oil' WHERE m.`name` = 'Boneless Chicken Cheesy Meltdown' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Boneless Chicken Cheesy Meltdown' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Boneless Chicken Salted Egg
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 220.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Boneless Chicken' WHERE m.`name` = 'Boneless Chicken Salted Egg' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 40.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Breader Flour' WHERE m.`name` = 'Boneless Chicken Salted Egg' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 45.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Salted Egg Powder' WHERE m.`name` = 'Boneless Chicken Salted Egg' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 45.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cooking Oil' WHERE m.`name` = 'Boneless Chicken Salted Egg' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Boneless Chicken Salted Egg' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Boneless Chicken Sisig
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 220.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Boneless Chicken' WHERE m.`name` = 'Boneless Chicken Sisig' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Onion' WHERE m.`name` = 'Boneless Chicken Sisig' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 35.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Mayonnaise' WHERE m.`name` = 'Boneless Chicken Sisig' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Calamansi' WHERE m.`name` = 'Boneless Chicken Sisig' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 40.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cooking Oil' WHERE m.`name` = 'Boneless Chicken Sisig' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Boneless Chicken Sisig' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Buffalo Wings
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 6.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Chicken Wings' WHERE m.`name` = 'Buffalo Wings' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 45.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Buffalo Hot Sauce' WHERE m.`name` = 'Buffalo Wings' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 25.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Garlic Mayo Sauce' WHERE m.`name` = 'Buffalo Wings' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 45.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cooking Oil' WHERE m.`name` = 'Buffalo Wings' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Buffalo Wings' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Chic'n Bowl (with Rice)
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 200.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Steamed Rice' WHERE m.`name` = 'Chic''n Bowl (with Rice)' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 120.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Boneless Chicken' WHERE m.`name` = 'Chic''n Bowl (with Rice)' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Teriyaki Sauce' WHERE m.`name` = 'Chic''n Bowl (with Rice)' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 30.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cooking Oil' WHERE m.`name` = 'Chic''n Bowl (with Rice)' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Chic''n Bowl (with Rice)' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Garlic Parmesan Wings
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 6.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Chicken Wings' WHERE m.`name` = 'Garlic Parmesan Wings' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 35.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Garlic Butter Base' WHERE m.`name` = 'Garlic Parmesan Wings' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 20.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Parmesan Cheese' WHERE m.`name` = 'Garlic Parmesan Wings' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 45.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cooking Oil' WHERE m.`name` = 'Garlic Parmesan Wings' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Garlic Parmesan Wings' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Salt & Pepper Wings
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 6.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Chicken Wings' WHERE m.`name` = 'Salt & Pepper Wings' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 10.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Flavor Powder' WHERE m.`name` = 'Salt & Pepper Wings' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 10.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Minced Garlic' WHERE m.`name` = 'Salt & Pepper Wings' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 45.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cooking Oil' WHERE m.`name` = 'Salt & Pepper Wings' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Salt & Pepper Wings' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Teriyaki Wings
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 6.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Chicken Wings' WHERE m.`name` = 'Teriyaki Wings' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 45.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Teriyaki Sauce' WHERE m.`name` = 'Teriyaki Wings' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 3.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Sesame Seeds' WHERE m.`name` = 'Teriyaki Wings' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 45.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cooking Oil' WHERE m.`name` = 'Teriyaki Wings' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 1.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Takeout Box' WHERE m.`name` = 'Teriyaki Wings' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Coffee Jelly
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 50.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Coffee Jelly' WHERE m.`name` = 'Coffee Jelly' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Cream Cheese Wall
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 40.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Cream Cheese Foam' WHERE m.`name` = 'Cream Cheese Wall' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Crushed Oreo
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 25.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Crushed Oreo' WHERE m.`name` = 'Crushed Oreo' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Rainbow Crystals
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 50.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Rainbow Crystals' WHERE m.`name` = 'Rainbow Crystals' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);

-- Recipe: Tapioca Pearls
INSERT INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`) SELECT m.`id`, i.`ingredient_id`, 50.00 FROM `menu_items` m JOIN `ingredients` i ON i.`name` = 'Tapioca Pearls' WHERE m.`name` = 'Tapioca Pearls' ON DUPLICATE KEY UPDATE `quantity_required` = VALUES(`quantity_required`);
