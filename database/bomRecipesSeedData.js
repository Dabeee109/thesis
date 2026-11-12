/**
 * Authoritative Bill of Materials (BOM) Ingredients & 91-Menu-Item Recipe Seed Data
 * Aligns 100% with `database/refresh_menu.sql` (all 91 Diner's Cafe menu items).
 */

const INGREDIENT_CATEGORIES = [
  'Beverage Base & Syrups',
  'Dairy & Toppings',
  'Meat & Poultry',
  'Bread, Dough & Pasta',
  'Produce & Pantry',
  'Packaging'
];

const INGREDIENT_UNITS = ['g', 'ml', 'pcs'];

/**
 * Raw ingredient master catalog: [name, category, unit]
 * Initial stock_quantity = 5000.00 ('g'/'ml') or 200.00 ('pcs')
 * Default reorder_level = 500.00 ('g'/'ml') or 20.00 ('pcs')
 */
const INGREDIENTS_CATALOG = [
  // Beverage Base & Syrups
  ['Black Tea Base', 'Beverage Base & Syrups', 'ml'],
  ['Oolong Tea Base', 'Beverage Base & Syrups', 'ml'],
  ['Jasmine Green Tea Base', 'Beverage Base & Syrups', 'ml'],
  ['Espresso Beans', 'Beverage Base & Syrups', 'g'],
  ['Matcha Powder', 'Beverage Base & Syrups', 'g'],
  ['Taro Powder', 'Beverage Base & Syrups', 'g'],
  ['Dark Chocolate Powder', 'Beverage Base & Syrups', 'g'],
  ['Vanilla Frappe Powder', 'Beverage Base & Syrups', 'g'],
  ['Sugar Syrup', 'Beverage Base & Syrups', 'ml'],
  ['Brown Sugar Syrup', 'Beverage Base & Syrups', 'ml'],
  ['Caramel Syrup', 'Beverage Base & Syrups', 'ml'],
  ['Vanilla Syrup', 'Beverage Base & Syrups', 'ml'],
  ['Okinawa Syrup', 'Beverage Base & Syrups', 'ml'],
  ['Wintermelon Syrup', 'Beverage Base & Syrups', 'ml'],
  ['Green Apple Syrup', 'Beverage Base & Syrups', 'ml'],
  ['Lychee Syrup', 'Beverage Base & Syrups', 'ml'],
  ['Strawberry Syrup', 'Beverage Base & Syrups', 'ml'],
  ['White Chocolate Sauce', 'Beverage Base & Syrups', 'ml'],
  ['Chocolate Drizzle', 'Beverage Base & Syrups', 'ml'],
  ['Blueberry Fruit Puree', 'Beverage Base & Syrups', 'g'],
  ['Strawberry Fruit Puree', 'Beverage Base & Syrups', 'g'],
  ['Yakult Bottle', 'Beverage Base & Syrups', 'pcs'],

  // Dairy & Toppings
  ['Fresh Milk', 'Dairy & Toppings', 'ml'],
  ['Non-Dairy Creamer', 'Dairy & Toppings', 'g'],
  ['Cream Cheese Foam', 'Dairy & Toppings', 'g'],
  ['Whipped Cream', 'Dairy & Toppings', 'g'],
  ['Tapioca Pearls', 'Dairy & Toppings', 'g'],
  ['Coffee Jelly', 'Dairy & Toppings', 'g'],
  ['Rainbow Crystals', 'Dairy & Toppings', 'g'],
  ['Chocolate Chips', 'Dairy & Toppings', 'g'],
  ['Crushed Oreo', 'Dairy & Toppings', 'g'],
  ['Biscoff Spread', 'Dairy & Toppings', 'g'],
  ['Crushed Biscoff Biscuit', 'Dairy & Toppings', 'g'],
  ['Sliced Almonds', 'Dairy & Toppings', 'g'],
  ['Cheddar Cheese Slice', 'Dairy & Toppings', 'pcs'],
  ['Grated Cheddar', 'Dairy & Toppings', 'g'],
  ['Liquid Cheese Sauce', 'Dairy & Toppings', 'ml'],
  ['Mozzarella Cheese', 'Dairy & Toppings', 'g'],
  ['Parmesan Cheese', 'Dairy & Toppings', 'g'],
  ['Feta Cheese', 'Dairy & Toppings', 'g'],
  ['Cheese Stick Filling', 'Dairy & Toppings', 'g'],
  ['Egg', 'Dairy & Toppings', 'pcs'],

  // Meat & Poultry
  ['Beef Patty', 'Meat & Poultry', 'g'],
  ['Bacon Strips', 'Meat & Poultry', 'g'],
  ['Jumbo Hotdog', 'Meat & Poultry', 'pcs'],
  ['Breaded Chicken Fillet', 'Meat & Poultry', 'g'],
  ['Ground Beef', 'Meat & Poultry', 'g'],
  ['Smoked Ham', 'Meat & Poultry', 'g'],
  ['Chicken Nuggets', 'Meat & Poultry', 'pcs'],
  ['Seasoned Beef Strips', 'Meat & Poultry', 'g'],
  ['Seasoned Chicken Strips', 'Meat & Poultry', 'g'],
  ['Peeled Shrimp', 'Meat & Poultry', 'g'],
  ['Pepperoni', 'Meat & Poultry', 'g'],
  ['Hungarian Sausage', 'Meat & Poultry', 'pcs'], // 1 pcs whole link (~90g)
  ['Pork Spare Ribs', 'Meat & Poultry', 'g'],
  ['Boneless Chicken', 'Meat & Poultry', 'g'],
  ['Pork Adobo Cut', 'Meat & Poultry', 'g'],
  ['Pork Tocino', 'Meat & Poultry', 'g'],
  ['Marinated Beef Tapa', 'Meat & Poultry', 'g'],
  ['Chicken Quarter Leg', 'Meat & Poultry', 'pcs'],
  ['Luncheon Meat', 'Meat & Poultry', 'g'],
  ['Chicken Wings', 'Meat & Poultry', 'pcs'],

  // Bread, Dough & Pasta
  ['Burger Bun', 'Bread, Dough & Pasta', 'pcs'],
  ['Hotdog Bun', 'Bread, Dough & Pasta', 'pcs'],
  ['Brioche Bread Slice', 'Bread, Dough & Pasta', 'pcs'],
  ['Pita Bread', 'Bread, Dough & Pasta', 'pcs'],
  ['Flour Tortilla', 'Bread, Dough & Pasta', 'pcs'],
  ['Lumpia Wrapper', 'Bread, Dough & Pasta', 'pcs'],
  ['Pizza Dough 10"', 'Bread, Dough & Pasta', 'pcs'],
  ['Flatbread Crust', 'Bread, Dough & Pasta', 'pcs'],
  ['Garlic Bread', 'Bread, Dough & Pasta', 'pcs'],
  ['Elbow Macaroni', 'Bread, Dough & Pasta', 'g'],
  ['Spaghetti Pasta', 'Bread, Dough & Pasta', 'g'],
  ['Lasagna Pasta Sheets', 'Bread, Dough & Pasta', 'pcs'],

  // Produce & Pantry
  ['Lettuce', 'Produce & Pantry', 'g'],
  ['Tomato', 'Produce & Pantry', 'g'],
  ['Onion', 'Produce & Pantry', 'g'],
  ['Jalapeno', 'Produce & Pantry', 'g'],
  ['Bell Pepper', 'Produce & Pantry', 'g'],
  ['Button Mushrooms', 'Produce & Pantry', 'g'],
  ['Black Olives', 'Produce & Pantry', 'g'],
  ['Pineapple Tidbits', 'Produce & Pantry', 'g'],
  ['Minced Garlic', 'Produce & Pantry', 'g'],
  ['Mixed Vegetables', 'Produce & Pantry', 'g'],
  ['Calamansi', 'Produce & Pantry', 'pcs'],
  ['French Fries', 'Produce & Pantry', 'g'],
  ['Twister Fries', 'Produce & Pantry', 'g'],
  ['Nacho Chips', 'Produce & Pantry', 'g'],
  ['Steamed Rice', 'Produce & Pantry', 'g'],
  ['Burger Sauce', 'Produce & Pantry', 'ml'],
  ['Mustard', 'Produce & Pantry', 'ml'],
  ['Mayonnaise', 'Produce & Pantry', 'ml'],
  ['Garlic Mayo Sauce', 'Produce & Pantry', 'ml'],
  ['Garlic Yogurt Sauce', 'Produce & Pantry', 'ml'],
  ['BBQ Sauce', 'Produce & Pantry', 'ml'],
  ['Salsa Dip', 'Produce & Pantry', 'ml'],
  ['Pizza Tomato Sauce', 'Produce & Pantry', 'ml'],
  ['White Bechamel Sauce', 'Produce & Pantry', 'ml'],
  ['Garlic Butter Base', 'Produce & Pantry', 'ml'],
  ['Mushroom Gravy Sauce', 'Produce & Pantry', 'ml'],
  ['Teriyaki Sauce', 'Produce & Pantry', 'ml'],
  ['Adobo Sauce', 'Produce & Pantry', 'ml'],
  ['Spiced Vinegar', 'Produce & Pantry', 'ml'],
  ['Buffalo Hot Sauce', 'Produce & Pantry', 'ml'],
  ['Cooking Oil', 'Produce & Pantry', 'ml'],
  ['Flavor Powder', 'Produce & Pantry', 'g'],
  ['Cajun Spice', 'Produce & Pantry', 'g'],
  ['Breader Flour', 'Produce & Pantry', 'g'],
  ['Salted Egg Powder', 'Produce & Pantry', 'g'],
  ['Sesame Seeds', 'Produce & Pantry', 'g'],

  // Packaging
  ['Cup/Lid/Straw Set', 'Packaging', 'pcs'],
  ['Takeout Box', 'Packaging', 'pcs'],
  ['Pizza Box', 'Packaging', 'pcs'],
  ['Meal Box', 'Packaging', 'pcs']
].map(([name, category, unit]) => ({
  name,
  category,
  unit,
  stock_quantity: unit === 'pcs' ? 200.00 : 5000.00,
  reorder_level: unit === 'pcs' ? 20.00 : 500.00
}));

/**
 * Exact 91 menu-to-ingredient BOM recipes.
 * Note: Drinks & Milktea include Cup/Lid/Straw Set (1 pcs); Burgers/Starters/Flatbreads/Pasta/Platters/Wings include Takeout Box (1 pcs);
 * 10" Pizzas include Pizza Box (1 pcs); Meals & Steaks include Meal Box (1 pcs).
 */
const MENU_RECIPES = {
  // ================= DRINKS & MILKTEA (24) =================
  'Biscoff Cheesecake': [
    ['Fresh Milk', 180], ['Cream Cheese Foam', 40], ['Biscoff Spread', 25], ['Crushed Biscoff Biscuit', 15], ['Brown Sugar Syrup', 15], ['Cup/Lid/Straw Set', 1]
  ],
  'Blueberries & Cream': [
    ['Fresh Milk', 180], ['Blueberry Fruit Puree', 35], ['Cream Cheese Foam', 30], ['Sugar Syrup', 15], ['Cup/Lid/Straw Set', 1]
  ],
  'Brown Sugar Milktea': [
    ['Black Tea Base', 150], ['Fresh Milk', 100], ['Brown Sugar Syrup', 35], ['Tapioca Pearls', 40], ['Cup/Lid/Straw Set', 1]
  ],
  'Caramel Macchiato': [
    ['Espresso Beans', 18], ['Fresh Milk', 200], ['Caramel Syrup', 25], ['Vanilla Syrup', 10], ['Cup/Lid/Straw Set', 1]
  ],
  'Choco Java Chips': [
    ['Fresh Milk', 180], ['Dark Chocolate Powder', 30], ['Chocolate Chips', 20], ['Whipped Cream', 25], ['Chocolate Drizzle', 10], ['Cup/Lid/Straw Set', 1]
  ],
  'Classic Milktea': [
    ['Black Tea Base', 180], ['Non-Dairy Creamer', 30], ['Sugar Syrup', 25], ['Cup/Lid/Straw Set', 1]
  ],
  'Dark Chocolate Milktea': [
    ['Black Tea Base', 150], ['Fresh Milk', 80], ['Dark Chocolate Powder', 35], ['Sugar Syrup', 20], ['Cup/Lid/Straw Set', 1]
  ],
  "Diner's House Blend Milktea": [
    ['Oolong Tea Base', 180], ['Non-Dairy Creamer', 30], ['Brown Sugar Syrup', 20], ['Coffee Jelly', 30], ['Cup/Lid/Straw Set', 1]
  ],
  "Diner's Signature Drink": [
    ['Espresso Beans', 18], ['Fresh Milk', 180], ['White Chocolate Sauce', 25], ['Cream Cheese Foam', 30], ['Cup/Lid/Straw Set', 1]
  ],
  'Green Apple Fruit Tea': [
    ['Jasmine Green Tea Base', 200], ['Green Apple Syrup', 35], ['Sugar Syrup', 15], ['Cup/Lid/Straw Set', 1]
  ],
  'Green Apple Yakult': [
    ['Jasmine Green Tea Base', 150], ['Green Apple Syrup', 30], ['Yakult Bottle', 1], ['Sugar Syrup', 10], ['Cup/Lid/Straw Set', 1]
  ],
  'Lychee Fruit Tea': [
    ['Jasmine Green Tea Base', 200], ['Lychee Syrup', 35], ['Sugar Syrup', 15], ['Cup/Lid/Straw Set', 1]
  ],
  'Lychee Yakult': [
    ['Jasmine Green Tea Base', 150], ['Lychee Syrup', 30], ['Yakult Bottle', 1], ['Sugar Syrup', 10], ['Cup/Lid/Straw Set', 1]
  ],
  'Matcha Milktea': [
    ['Fresh Milk', 200], ['Matcha Powder', 12], ['Sugar Syrup', 25], ['Cup/Lid/Straw Set', 1]
  ],
  'Okinawa Milktea': [
    ['Black Tea Base', 170], ['Non-Dairy Creamer', 30], ['Okinawa Syrup', 30], ['Cup/Lid/Straw Set', 1]
  ],
  'Oreo Blast': [
    ['Fresh Milk', 180], ['Vanilla Frappe Powder', 30], ['Crushed Oreo', 30], ['Whipped Cream', 25], ['Cup/Lid/Straw Set', 1]
  ],
  'Oreo Milktea': [
    ['Black Tea Base', 160], ['Non-Dairy Creamer', 30], ['Sugar Syrup', 20], ['Crushed Oreo', 25], ['Cup/Lid/Straw Set', 1]
  ],
  'Purple Alcapone': [
    ['Fresh Milk', 180], ['Taro Powder', 30], ['White Chocolate Sauce', 20], ['Sliced Almonds', 10], ['Cup/Lid/Straw Set', 1]
  ],
  'Roasted Wintermelon Milktea': [
    ['Black Tea Base', 170], ['Non-Dairy Creamer', 30], ['Wintermelon Syrup', 35], ['Cup/Lid/Straw Set', 1]
  ],
  'Strawberries & Cream': [
    ['Fresh Milk', 180], ['Strawberry Fruit Puree', 35], ['Cream Cheese Foam', 30], ['Sugar Syrup', 15], ['Cup/Lid/Straw Set', 1]
  ],
  'Strawberry Fruit Tea': [
    ['Jasmine Green Tea Base', 200], ['Strawberry Syrup', 35], ['Sugar Syrup', 15], ['Cup/Lid/Straw Set', 1]
  ],
  'Strawberry Yakult': [
    ['Jasmine Green Tea Base', 150], ['Strawberry Syrup', 30], ['Yakult Bottle', 1], ['Sugar Syrup', 10], ['Cup/Lid/Straw Set', 1]
  ],
  'Taro Milktea': [
    ['Black Tea Base', 160], ['Non-Dairy Creamer', 25], ['Taro Powder', 30], ['Sugar Syrup', 20], ['Cup/Lid/Straw Set', 1]
  ],
  'Two Two': [
    ['Black Tea Base', 150], ['Fresh Milk', 80], ['Brown Sugar Syrup', 20], ['Tapioca Pearls', 25], ['Coffee Jelly', 25], ['Cup/Lid/Straw Set', 1]
  ],

  // ================= BURGERS & SANDWICHES (8) =================
  'Bacon Burger': [
    ['Burger Bun', 1], ['Beef Patty', 120], ['Bacon Strips', 30], ['Cheddar Cheese Slice', 1], ['Lettuce', 15], ['Tomato', 20], ['Burger Sauce', 20], ['Takeout Box', 1]
  ],
  'California Dog': [
    ['Hotdog Bun', 1], ['Jumbo Hotdog', 1], ['Tomato', 20], ['Onion', 15], ['Jalapeno', 10], ['Mustard', 10], ['Mayonnaise', 15], ['Takeout Box', 1]
  ],
  'Cheesy Dog': [
    ['Hotdog Bun', 1], ['Jumbo Hotdog', 1], ['Liquid Cheese Sauce', 35], ['Grated Cheddar', 15], ['Takeout Box', 1]
  ],
  'Chicken Fillet Burger': [
    ['Burger Bun', 1], ['Breaded Chicken Fillet', 130], ['Lettuce', 15], ['Mayonnaise', 20], ['Cooking Oil', 25], ['Takeout Box', 1]
  ],
  'Classic Burger': [
    ['Burger Bun', 1], ['Beef Patty', 120], ['Lettuce', 15], ['Tomato', 20], ['Onion', 10], ['Burger Sauce', 20], ['Takeout Box', 1]
  ],
  "Diner's Double Down": [
    ['Breaded Chicken Fillet', 260], ['Bacon Strips', 30], ['Cheddar Cheese Slice', 2], ['Garlic Mayo Sauce', 25], ['Cooking Oil', 35], ['Takeout Box', 1]
  ],
  'Meaty Dog': [
    ['Hotdog Bun', 1], ['Jumbo Hotdog', 1], ['Ground Beef', 50], ['Liquid Cheese Sauce', 25], ['Takeout Box', 1]
  ],
  'Premium Sandwich': [
    ['Brioche Bread Slice', 3], ['Smoked Ham', 40], ['Bacon Strips', 30], ['Egg', 1], ['Cheddar Cheese Slice', 1], ['Lettuce', 20], ['Tomato', 25], ['Mayonnaise', 20], ['Takeout Box', 1]
  ],

  // ================= STARTERS & FRIES (10) =================
  'Cheese Stick Jalapeno': [
    ['Lumpia Wrapper', 6], ['Cheese Stick Filling', 60], ['Jalapeno', 15], ['Garlic Mayo Sauce', 25], ['Cooking Oil', 30], ['Takeout Box', 1]
  ],
  'Cheesy Bacon Fries': [
    ['French Fries', 180], ['Liquid Cheese Sauce', 40], ['Bacon Strips', 25], ['Cooking Oil', 35], ['Takeout Box', 1]
  ],
  'Flavored Fries': [
    ['French Fries', 150], ['Flavor Powder', 12], ['Cooking Oil', 30], ['Takeout Box', 1]
  ],
  'Nachos with Toppings (Large)': [
    ['Nacho Chips', 160], ['Ground Beef', 80], ['Liquid Cheese Sauce', 50], ['Tomato', 30], ['Onion', 20], ['Jalapeno', 10], ['Takeout Box', 1]
  ],
  'Nachos with Toppings (Regular)': [
    ['Nacho Chips', 100], ['Ground Beef', 50], ['Liquid Cheese Sauce', 35], ['Tomato', 20], ['Onion', 15], ['Takeout Box', 1]
  ],
  'Nuggets (12 pcs)': [
    ['Chicken Nuggets', 12], ['BBQ Sauce', 30], ['Cooking Oil', 40], ['Takeout Box', 1]
  ],
  'Nuggets & Fries Combo': [
    ['Chicken Nuggets', 6], ['French Fries', 120], ['Liquid Cheese Sauce', 25], ['Cooking Oil', 35], ['Takeout Box', 1]
  ],
  'Pita Wrap': [
    ['Pita Bread', 1], ['Seasoned Beef Strips', 80], ['Lettuce', 20], ['Tomato', 20], ['Onion', 10], ['Garlic Yogurt Sauce', 25], ['Takeout Box', 1]
  ],
  'Quesadilla': [
    ['Flour Tortilla', 2], ['Seasoned Chicken Strips', 90], ['Mozzarella Cheese', 60], ['Bell Pepper', 20], ['Onion', 15], ['Salsa Dip', 30], ['Takeout Box', 1]
  ],
  'Twisted Fries': [
    ['Twister Fries', 160], ['Liquid Cheese Sauce', 25], ['Cooking Oil', 35], ['Takeout Box', 1]
  ],

  // ================= PIZZA & FLAT BREAD (11) =================
  'Bacon & Mushroom Pizza': [
    ['Pizza Dough 10"', 1], ['Pizza Tomato Sauce', 60], ['Mozzarella Cheese', 110], ['Bacon Strips', 50], ['Button Mushrooms', 40], ['Pizza Box', 1]
  ],
  'Cajun Shrimp Pizza': [
    ['Pizza Dough 10"', 1], ['Pizza Tomato Sauce', 60], ['Mozzarella Cheese', 110], ['Peeled Shrimp', 90], ['Cajun Spice', 8], ['Bell Pepper', 25], ['Pizza Box', 1]
  ],
  "Diner's Pizza Supreme": [
    ['Pizza Dough 10"', 1], ['Pizza Tomato Sauce', 60], ['Mozzarella Cheese', 120], ['Pepperoni', 30], ['Smoked Ham', 30], ['Ground Beef', 35], ['Button Mushrooms', 25], ['Bell Pepper', 20], ['Black Olives', 15], ['Pizza Box', 1]
  ],
  'Four Cheese Flat Bread': [
    ['Flatbread Crust', 1], ['White Bechamel Sauce', 40], ['Mozzarella Cheese', 60], ['Grated Cheddar', 30], ['Parmesan Cheese', 20], ['Cream Cheese Foam', 25], ['Takeout Box', 1]
  ],
  'Garlic Shrimp Pizza': [
    ['Pizza Dough 10"', 1], ['Garlic Butter Base', 35], ['Mozzarella Cheese', 110], ['Peeled Shrimp', 90], ['Minced Garlic', 15], ['Pizza Box', 1]
  ],
  'Ham & Bacon Flat Bread': [
    ['Flatbread Crust', 1], ['Pizza Tomato Sauce', 45], ['Mozzarella Cheese', 80], ['Smoked Ham', 40], ['Bacon Strips', 35], ['Takeout Box', 1]
  ],
  'Hawaiian Pizza': [
    ['Pizza Dough 10"', 1], ['Pizza Tomato Sauce', 60], ['Mozzarella Cheese', 110], ['Smoked Ham', 60], ['Pineapple Tidbits', 50], ['Pizza Box', 1]
  ],
  'Hungarian Pizza': [
    ['Pizza Dough 10"', 1], ['Pizza Tomato Sauce', 60], ['Mozzarella Cheese', 110], ['Hungarian Sausage', 1], ['Onion', 20], ['Bell Pepper', 20], ['Pizza Box', 1]
  ],
  'Mediterranean Pizza': [
    ['Pizza Dough 10"', 1], ['Pizza Tomato Sauce', 60], ['Mozzarella Cheese', 100], ['Feta Cheese', 35], ['Black Olives', 25], ['Tomato', 30], ['Onion', 20], ['Pizza Box', 1]
  ],
  'Pizza Bianca': [
    ['Pizza Dough 10"', 1], ['White Bechamel Sauce', 60], ['Mozzarella Cheese', 110], ['Cream Cheese Foam', 40], ['Minced Garlic', 10], ['Parmesan Cheese', 20], ['Pizza Box', 1]
  ],
  'Triple Cheese Pizza': [
    ['Pizza Dough 10"', 1], ['Pizza Tomato Sauce', 60], ['Mozzarella Cheese', 90], ['Grated Cheddar', 45], ['Parmesan Cheese', 25], ['Pizza Box', 1]
  ],

  // ================= MEALS & STEAKS (15) =================
  'Bacheelog': [
    ['Steamed Rice', 200], ['Bacon Strips', 50], ['Liquid Cheese Sauce', 30], ['Egg', 1], ['Cooking Oil', 15], ['Meal Box', 1]
  ],
  'BBQ Ribs': [
    ['Pork Spare Ribs', 250], ['BBQ Sauce', 50], ['Steamed Rice', 200], ['Mixed Vegetables', 40], ['Meal Box', 1]
  ],
  'Beef Doner Bowl': [
    ['Steamed Rice', 200], ['Seasoned Beef Strips', 110], ['Garlic Yogurt Sauce', 25], ['Lettuce', 25], ['Tomato', 20], ['Meal Box', 1]
  ],
  'Burger Steak (2 pcs)': [
    ['Beef Patty', 240], ['Mushroom Gravy Sauce', 60], ['Button Mushrooms', 20], ['Steamed Rice', 200], ['Meal Box', 1]
  ],
  'Chicken Teriyaki Bowl': [
    ['Steamed Rice', 200], ['Boneless Chicken', 120], ['Teriyaki Sauce', 35], ['Sesame Seeds', 3], ['Mixed Vegetables', 30], ['Meal Box', 1]
  ],
  'Fully Loaded Choice of 3': [
    ['Steamed Rice', 250], ['Boneless Chicken', 80], ['Bacon Strips', 40], ['Hungarian Sausage', 1], ['Mushroom Gravy Sauce', 40], ['Meal Box', 1]
  ],
  'Hotcheelog': [
    ['Steamed Rice', 200], ['Jumbo Hotdog', 1], ['Liquid Cheese Sauce', 30], ['Egg', 1], ['Cooking Oil', 15], ['Meal Box', 1]
  ],
  'Hungarian with Egg': [
    ['Steamed Rice', 200], ['Hungarian Sausage', 1], ['Egg', 1], ['Cooking Oil', 15], ['Meal Box', 1]
  ],
  'Lunch Pack - Adobo': [
    ['Steamed Rice', 200], ['Pork Adobo Cut', 140], ['Adobo Sauce', 40], ['Egg', 1], ['Meal Box', 1]
  ],
  'Lunch Pack - Mixed': [
    ['Steamed Rice', 200], ['Pork Adobo Cut', 70], ['Pork Tocino', 70], ['Mixed Vegetables', 20], ['Meal Box', 1]
  ],
  'Lunch Pack - Tapa': [
    ['Steamed Rice', 200], ['Marinated Beef Tapa', 120], ['Egg', 1], ['Spiced Vinegar', 15], ['Cooking Oil', 15], ['Meal Box', 1]
  ],
  'Lunch Pack - Tocino': [
    ['Steamed Rice', 200], ['Pork Tocino', 120], ['Egg', 1], ['Cooking Oil', 15], ['Meal Box', 1]
  ],
  'Nuggetcheelog': [
    ['Steamed Rice', 200], ['Chicken Nuggets', 5], ['Liquid Cheese Sauce', 30], ['Egg', 1], ['Cooking Oil', 25], ['Meal Box', 1]
  ],
  'Quarter Chicken Meal': [
    ['Chicken Quarter Leg', 1], ['Steamed Rice', 200], ['Mushroom Gravy Sauce', 45], ['Cooking Oil', 30], ['Meal Box', 1]
  ],
  'Spamcheelog': [
    ['Steamed Rice', 200], ['Luncheon Meat', 70], ['Liquid Cheese Sauce', 30], ['Egg', 1], ['Cooking Oil', 15], ['Meal Box', 1]
  ],

  // ================= PASTA & PLATTERS (9) =================
  'Baked Macaroni': [
    ['Elbow Macaroni', 120], ['Ground Beef', 100], ['White Bechamel Sauce', 50], ['Mozzarella Cheese', 40], ['Takeout Box', 1]
  ],
  'Carbonara': [
    ['Spaghetti Pasta', 130], ['White Bechamel Sauce', 90], ['Bacon Strips', 35], ['Parmesan Cheese', 20], ['Garlic Bread', 1], ['Takeout Box', 1]
  ],
  'Lasagna': [
    ['Lasagna Pasta Sheets', 3], ['Ground Beef', 120], ['White Bechamel Sauce', 60], ['Mozzarella Cheese', 50], ['Parmesan Cheese', 15], ['Takeout Box', 1]
  ],
  'Meaty Spaghetti': [
    ['Spaghetti Pasta', 130], ['Pizza Tomato Sauce', 110], ['Ground Beef', 50], ['Jumbo Hotdog', 0.5], ['Grated Cheddar', 20], ['Takeout Box', 1]
  ],
  'Platter A': [
    ['French Fries', 200], ['Chicken Nuggets', 8], ['Lumpia Wrapper', 6], ['Cheese Stick Filling', 60], ['Liquid Cheese Sauce', 50], ['Cooking Oil', 40], ['Takeout Box', 1]
  ],
  'Platter B': [
    ['Nacho Chips', 150], ['Twister Fries', 150], ['Ground Beef', 70], ['Liquid Cheese Sauce', 50], ['Cooking Oil', 35], ['Takeout Box', 1]
  ],
  'Platter C': [
    ['Chicken Wings', 6], ['French Fries', 200], ['Buffalo Hot Sauce', 50], ['Cooking Oil', 45], ['Takeout Box', 1]
  ],
  'Platter D': [
    ['Boneless Chicken', 200], ['Nacho Chips', 120], ['Lumpia Wrapper', 6], ['Cheese Stick Filling', 60], ['Liquid Cheese Sauce', 60], ['Cooking Oil', 45], ['Takeout Box', 1]
  ],
  'Platter E': [
    ['French Fries', 180], ['Chicken Nuggets', 6], ['Lumpia Wrapper', 4], ['Cheese Stick Filling', 40], ['Garlic Mayo Sauce', 40], ['Cooking Oil', 40], ['Takeout Box', 1]
  ],

  // ================= CHICKEN WINGS & BONELESS (9) =================
  'Boneless Chicken Bburinkle': [
    ['Boneless Chicken', 220], ['Breader Flour', 40], ['Flavor Powder', 20], ['Garlic Yogurt Sauce', 30], ['Cooking Oil', 45], ['Takeout Box', 1]
  ],
  'Boneless Chicken Cheesy Meltdown': [
    ['Boneless Chicken', 220], ['Breader Flour', 40], ['Liquid Cheese Sauce', 55], ['Cooking Oil', 45], ['Takeout Box', 1]
  ],
  'Boneless Chicken Salted Egg': [
    ['Boneless Chicken', 220], ['Breader Flour', 40], ['Salted Egg Powder', 45], ['Cooking Oil', 45], ['Takeout Box', 1]
  ],
  'Boneless Chicken Sisig': [
    ['Boneless Chicken', 220], ['Onion', 30], ['Mayonnaise', 35], ['Calamansi', 1], ['Cooking Oil', 40], ['Takeout Box', 1]
  ],
  'Buffalo Wings': [
    ['Chicken Wings', 6], ['Buffalo Hot Sauce', 45], ['Garlic Mayo Sauce', 25], ['Cooking Oil', 45], ['Takeout Box', 1]
  ],
  "Chic'n Bowl (with Rice)": [
    ['Steamed Rice', 200], ['Boneless Chicken', 120], ['Teriyaki Sauce', 30], ['Cooking Oil', 30], ['Takeout Box', 1]
  ],
  'Garlic Parmesan Wings': [
    ['Chicken Wings', 6], ['Garlic Butter Base', 35], ['Parmesan Cheese', 20], ['Cooking Oil', 45], ['Takeout Box', 1]
  ],
  'Salt & Pepper Wings': [
    ['Chicken Wings', 6], ['Flavor Powder', 10], ['Minced Garlic', 10], ['Cooking Oil', 45], ['Takeout Box', 1]
  ],
  'Teriyaki Wings': [
    ['Chicken Wings', 6], ['Teriyaki Sauce', 45], ['Sesame Seeds', 3], ['Cooking Oil', 45], ['Takeout Box', 1]
  ],

  // ================= ADD-ONS (5) =================
  'Coffee Jelly': [['Coffee Jelly', 50]],
  'Cream Cheese Wall': [['Cream Cheese Foam', 40]],
  'Crushed Oreo': [['Crushed Oreo', 25]],
  'Rainbow Crystals': [['Rainbow Crystals', 50]],
  'Tapioca Pearls': [['Tapioca Pearls', 50]]
};

module.exports = {
  INGREDIENT_CATEGORIES,
  INGREDIENT_UNITS,
  INGREDIENTS_CATALOG,
  MENU_RECIPES
};
