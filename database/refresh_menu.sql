-- =============================================================================
-- Diner's Cafe: Fresh Full Menu Hard Reset & Seeding Migration
-- Compatible with MySQL (cPanel / VistaPanel / phpMyAdmin) and SQLite
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- 1. Ensure Table Structure & Add Missing Columns
CREATE TABLE IF NOT EXISTS `menu_items` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `category_id` INT NOT NULL DEFAULT 1,
    `category` VARCHAR(100) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `price` DECIMAL(10,2) NOT NULL,
    `stock_quantity` INT DEFAULT 50,
    `image_url` VARCHAR(500) NULL,
    `status` ENUM('AVAILABLE', 'OUT_OF_STOCK', 'HIDDEN') DEFAULT 'AVAILABLE',
    `is_available` BOOLEAN DEFAULT TRUE,
    `is_bestseller` BOOLEAN DEFAULT FALSE,
    `is_featured` BOOLEAN DEFAULT FALSE,
    `preparation_time_min` INT DEFAULT 15,
    `synonyms` TEXT NULL,
    `is_deleted` BOOLEAN DEFAULT FALSE,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 2. Clear Existing Records
DELETE FROM `inventory_logs`;
DELETE FROM `inventory`;
DELETE FROM `menu_items`;

SET FOREIGN_KEY_CHECKS = 1;

-- 3. Populate Fresh Verified Menu Items (91 Items Across 8 Board Categories)
INSERT INTO `menu_items` (`category`, `name`, `description`, `price`, `stock_quantity`, `status`, `is_available`) VALUES
-- PREMIUM DRINKS
('Drinks & Milktea', 'Biscoff Cheesecake', 'Rich creamy cheesecake blend topped with crushed Lotus Biscoff', 169.00, 30, 'AVAILABLE', 1),
('Drinks & Milktea', 'Choco Java Chips', 'Decadent chocolate blend infused with premium java chips', 169.00, 30, 'AVAILABLE', 1),
('Drinks & Milktea', "Diner's Signature Drink", 'House-crafted specialty blend with signature flavor profile', 149.00, 40, 'AVAILABLE', 1),
('Drinks & Milktea', 'Oreo Blast', 'Creamy cookies and cream indulgence loaded with crushed Oreos', 149.00, 35, 'AVAILABLE', 1),
('Drinks & Milktea', 'Two Two', 'Dual-flavor specialty blend with layered sweetness', 149.00, 25, 'AVAILABLE', 1),
('Drinks & Milktea', 'Purple Alcapone', 'Ube-infused creamy beverage with white chocolate undertones', 149.00, 25, 'AVAILABLE', 1),
('Drinks & Milktea', 'Strawberries & Cream', 'Fresh strawberry puree layered over smooth velvety cream', 149.00, 30, 'AVAILABLE', 1),
('Drinks & Milktea', 'Blueberries & Cream', 'Luscious blueberry reduction with chilled creamy base', 149.00, 30, 'AVAILABLE', 1),
('Drinks & Milktea', 'Caramel Macchiato', 'Espresso marked with velvety milk and rich caramel drizzle', 149.00, 40, 'AVAILABLE', 1),

-- MILK TEA (LARGE)
('Drinks & Milktea', 'Dark Chocolate Milktea', 'Bold and bittersweet Dutch cocoa with premium brewed tea', 99.00, 50, 'AVAILABLE', 1),
('Drinks & Milktea', 'Okinawa Milktea', 'Roasted brown sugar milk tea with authentic rich finish', 99.00, 50, 'AVAILABLE', 1),
('Drinks & Milktea', 'Classic Milktea', 'Signature black tea infused with balanced creamy milk', 99.00, 60, 'AVAILABLE', 1),
('Drinks & Milktea', 'Roasted Wintermelon Milktea', 'Caramelized roasted wintermelon taste with silky finish', 99.00, 50, 'AVAILABLE', 1),
('Drinks & Milktea', 'Matcha Milktea', 'Authentic earthy Japanese green tea with fresh milk', 99.00, 40, 'AVAILABLE', 1),
('Drinks & Milktea', 'Taro Milktea', 'Creamy, sweet, and nutty purple taro infusion', 99.00, 45, 'AVAILABLE', 1),
('Drinks & Milktea', 'Oreo Milktea', 'Classic milk tea shaken with chunky Oreo biscuit crumbles', 99.00, 40, 'AVAILABLE', 1),
('Drinks & Milktea', 'Brown Sugar Milktea', 'Tiger tiger striped brown sugar syrup with rich milk tea', 99.00, 45, 'AVAILABLE', 1),
('Drinks & Milktea', "Diner's House Blend Milktea", 'Proprietary spiced tea blend formulated exclusively in-house', 99.00, 50, 'AVAILABLE', 1),

-- YAKULT SERIES (LARGE)
('Drinks & Milktea', 'Green Apple Yakult', 'Tangy probiotic Yakult base infused with crisp green apple', 109.00, 35, 'AVAILABLE', 1),
('Drinks & Milktea', 'Strawberry Yakult', 'Sweet strawberry compote combined with gut-friendly Yakult', 109.00, 35, 'AVAILABLE', 1),
('Drinks & Milktea', 'Lychee Yakult', 'Floral fragrant lychee blended with chilled refreshing Yakult', 109.00, 35, 'AVAILABLE', 1),

-- FRUIT TEA (LARGE)
('Drinks & Milktea', 'Green Apple Fruit Tea', 'Ice-shaken artisan jasmine green tea with green apple essence', 89.00, 40, 'AVAILABLE', 1),
('Drinks & Milktea', 'Strawberry Fruit Tea', 'Chilled botanical tea steeped with sweet strawberry syrup', 89.00, 40, 'AVAILABLE', 1),
('Drinks & Milktea', 'Lychee Fruit Tea', 'Refreshing cold brewed fruit tea sweetened with pure lychee', 89.00, 40, 'AVAILABLE', 1),

-- ADD-ONS
('Add-ons', 'Cream Cheese Wall', 'Savory sweet whipped cream cheese walling', 20.00, 100, 'AVAILABLE', 1),
('Add-ons', 'Tapioca Pearls', 'Chewy brown-sugar simmered black tapioca pearls', 20.00, 100, 'AVAILABLE', 1),
('Add-ons', 'Rainbow Crystals', 'Translucent chewy jelly crystal sinkers', 20.00, 100, 'AVAILABLE', 1),
('Add-ons', 'Coffee Jelly', 'Firm espresso jelly cubes for texture', 20.00, 80, 'AVAILABLE', 1),
('Add-ons', 'Crushed Oreo', 'Generous topping of dark Oreo cookie crumbles', 20.00, 80, 'AVAILABLE', 1),

-- BURGERS & SANDWICHES
('Burgers & Sandwiches', 'Classic Burger', 'Pure beef grilled patty with crisp lettuce, tomato, and special sauce', 139.00, 30, 'AVAILABLE', 1),
('Burgers & Sandwiches', 'Chicken Fillet Burger', 'Golden breaded fried chicken breast fillet with garlic mayo', 139.00, 25, 'AVAILABLE', 1),
('Burgers & Sandwiches', 'Bacon Burger', 'All-beef patty stacked with crispy smoked bacon strips and melted cheese', 159.00, 25, 'AVAILABLE', 1),
('Burgers & Sandwiches', "Diner's Double Down", 'Double-stacked beef patties, double melted cheese, and caramelized onions', 179.00, 20, 'AVAILABLE', 1),
('Burgers & Sandwiches', 'Premium Sandwich', 'Artisan toasted bread stacked with savory cold cuts, cheese, and greens', 199.00, 20, 'AVAILABLE', 1),
('Burgers & Sandwiches', 'Meaty Dog', 'Jumbo grilled frank topped with hearty minced meat chili and relish', 159.00, 25, 'AVAILABLE', 1),
('Burgers & Sandwiches', 'California Dog', 'Grilled frankfurter dressed with creamy slaw, bacon bits, and mustard', 159.00, 20, 'AVAILABLE', 1),
('Burgers & Sandwiches', 'Cheesy Dog', 'Savory frank smothered in warm cheddar cheese sauce and jalapeños', 159.00, 25, 'AVAILABLE', 1),

-- STARTERS & FRIES
('Starters & Fries', 'Quesadilla', 'Toasted flour tortilla packed with seasoned meats and melted cheese blend', 239.00, 20, 'AVAILABLE', 1),
('Starters & Fries', 'Nuggets (12 pcs)', 'Dozen crispy golden chicken nuggets served with choice of dipping sauce', 219.00, 25, 'AVAILABLE', 1),
('Starters & Fries', 'Nachos with Toppings (Regular)', 'Crisp corn tortilla chips loaded with salsa, cheese sauce, and ground beef', 109.00, 30, 'AVAILABLE', 1),
('Starters & Fries', 'Nachos with Toppings (Large)', 'Family-sized platter of loaded corn chips, jalapeños, beef, and dual cheese', 159.00, 25, 'AVAILABLE', 1),
('Starters & Fries', 'Cheese Stick Jalapeno', 'Breaded mozzarella rolls with spicy pickled jalapeño slices', 89.00, 35, 'AVAILABLE', 1),
('Starters & Fries', 'Pita Wrap', 'Mediterranean style soft flatbread rolled with savory filling and garlic dip', 89.00, 30, 'AVAILABLE', 1),
('Starters & Fries', 'Nuggets & Fries Combo', 'Crisp seasoned fries served alongside golden tender chicken nuggets', 199.00, 25, 'AVAILABLE', 1),
('Starters & Fries', 'Cheesy Bacon Fries', 'Fresh cut potato fries drizzled with cheddar sauce and crisp bacon bits', 159.00, 30, 'AVAILABLE', 1),
('Starters & Fries', 'Twisted Fries', 'Seasoned curly spiraled potato fries with crispy spiced coating', 119.00, 35, 'AVAILABLE', 1),
('Starters & Fries', 'Flavored Fries', 'Crisp french fries dusted with choice of Cheese, BBQ, or Sour Cream', 89.00, 50, 'AVAILABLE', 1),

-- PIZZA & FLAT BREAD
('Pizza & Flat Bread', 'Triple Cheese Pizza', 'Mozzarella, sharp cheddar, and parmesan over fresh marinara', 270.00, 20, 'AVAILABLE', 1),
('Pizza & Flat Bread', 'Hawaiian Pizza', 'Classic sweet pineapple chunks, sliced ham, and melted mozzarella', 310.00, 25, 'AVAILABLE', 1),
('Pizza & Flat Bread', 'Bacon & Mushroom Pizza', 'Smoked bacon crumbles and sautéed button mushrooms over garlic crust', 310.00, 20, 'AVAILABLE', 1),
('Pizza & Flat Bread', 'Hungarian Pizza', 'Spicy sliced Hungarian sausage rounds, bell peppers, and melted cheese', 310.00, 20, 'AVAILABLE', 1),
('Pizza & Flat Bread', 'Mediterranean Pizza', 'Sun-ripened tomatoes, olives, herbs, and feta mozzarella blend', 340.00, 15, 'AVAILABLE', 1),
('Pizza & Flat Bread', 'Pizza Bianca', 'White garlic cream sauce base topped with ricotta, mozzarella, and herbs', 350.00, 15, 'AVAILABLE', 1),
('Pizza & Flat Bread', "Diner's Pizza Supreme", 'Fully loaded with beef, pepperoni, sausage, peppers, onions, and mushrooms', 350.00, 20, 'AVAILABLE', 1),
('Pizza & Flat Bread', 'Cajun Shrimp Pizza', 'Plump shrimp tossed in spicy Cajun butter seasoning over crispy crust', 370.00, 15, 'AVAILABLE', 1),
('Pizza & Flat Bread', 'Garlic Shrimp Pizza', 'Sautéed garlic butter shrimp, roasted garlic cloves, and fresh herbs', 370.00, 15, 'AVAILABLE', 1),
('Pizza & Flat Bread', 'Ham & Bacon Flat Bread', 'Crispy thin flatbread layered with honey ham, bacon bits, and cheese', 179.00, 25, 'AVAILABLE', 1),
('Pizza & Flat Bread', 'Four Cheese Flat Bread', 'Artisan flatbread baked with four melted specialty cheeses', 179.00, 25, 'AVAILABLE', 1),

-- STEAKS, RICE BOWLS & MEALS
('Meals & Steaks', 'BBQ Ribs', 'Tender slow-cooked ribs glazed in smoky house barbecue sauce with rice', 269.00, 15, 'AVAILABLE', 1),
('Meals & Steaks', 'Quarter Chicken Meal', 'Oven-roasted marinated quarter chicken served with gravy and rice', 179.00, 25, 'AVAILABLE', 1),
('Meals & Steaks', 'Burger Steak (2 pcs)', 'Two savory grilled beef patties swimming in mushroom gravy with rice', 179.00, 30, 'AVAILABLE', 1),
('Meals & Steaks', 'Hungarian with Egg', 'Grilled spicy Hungarian sausage served with sunny-side-up egg and rice', 149.00, 30, 'AVAILABLE', 1),
('Meals & Steaks', 'Bacheelog', 'Bacon, cheesy sauce, garlic fried rice, and sunny egg bowl', 119.00, 35, 'AVAILABLE', 1),
('Meals & Steaks', 'Nuggetcheelog', 'Crispy chicken nuggets, cheese drizzle, garlic rice, and fried egg', 119.00, 35, 'AVAILABLE', 1),
('Meals & Steaks', 'Hotcheelog', 'Sliced frankfurter hotdog, cheddar sauce, sinangag, and egg', 119.00, 35, 'AVAILABLE', 1),
('Meals & Steaks', 'Spamcheelog', 'Seared luncheon meat, cheesy drizzle, garlic rice, and fried egg', 119.00, 30, 'AVAILABLE', 1),
('Meals & Steaks', 'Beef Doner Bowl', 'Spiced Mediterranean beef strips with garlic yogurt sauce over rice', 119.00, 30, 'AVAILABLE', 1),
('Meals & Steaks', 'Chicken Teriyaki Bowl', 'Pan-seared glazed chicken cubes garnished with sesame seeds over rice', 119.00, 35, 'AVAILABLE', 1),
('Meals & Steaks', 'Fully Loaded Choice of 3', 'Custom combo: Pick 3 (Tocino/Tapa/Hungarian/Hotdog/Bacon/Chicken/Spam) w/ rice & egg', 269.00, 20, 'AVAILABLE', 1),
('Meals & Steaks', 'Lunch Pack - Tocino', 'Sweet cured pork tocino, fried rice, egg, and fresh sides', 139.00, 30, 'AVAILABLE', 1),
('Meals & Steaks', 'Lunch Pack - Tapa', 'Savory marinated beef tapa, garlic sinangag, egg, and sides', 139.00, 30, 'AVAILABLE', 1),
('Meals & Steaks', 'Lunch Pack - Adobo', 'Classic tender pork and chicken adobo stewed in garlic soy vinegar', 139.00, 30, 'AVAILABLE', 1),
('Meals & Steaks', 'Lunch Pack - Mixed', 'Hearty chef sampler plate with mixed viands, egg, and fried rice', 139.00, 30, 'AVAILABLE', 1),

-- PASTA & PLATTERS
('Pasta & Platters', 'Lasagna', 'Layers of tender pasta sheets, rich bolognese meat sauce, and bechamel', 230.00, 15, 'AVAILABLE', 1),
('Pasta & Platters', 'Baked Macaroni', 'Elbow macaroni tossed in sweet-style meat sauce baked with cheese melt', 209.00, 20, 'AVAILABLE', 1),
('Pasta & Platters', 'Carbonara', 'Creamy pasta tossed with smoky bacon, parmesan cheese, and cracked pepper', 179.00, 25, 'AVAILABLE', 1),
('Pasta & Platters', 'Meaty Spaghetti', 'Sweet Filipino-style bolognese spaghetti topped with grated cheese', 179.00, 30, 'AVAILABLE', 1),
('Pasta & Platters', 'Platter A', 'Combination platter: Crispy Chicken, Pasta, Garlic Bread, and French Fries', 249.00, 20, 'AVAILABLE', 1),
('Pasta & Platters', 'Platter B', 'Combination platter: Grilled Hungarian Sausage, Pasta, Bread, and Fries', 249.00, 20, 'AVAILABLE', 1),
('Pasta & Platters', 'Platter C', 'Combination platter: Fried Chicken, Pasta, Bread, Fries, and Fresh Green Salad', 269.00, 15, 'AVAILABLE', 1),
('Pasta & Platters', 'Platter D', 'Combination platter: Chicken, Hungarian Sausage, Bread, Fries, and Green Salad', 269.00, 15, 'AVAILABLE', 1),
('Pasta & Platters', 'Platter E', 'Combination platter: Roasted Quarter Leg Chicken served with Pasta and Toast', 229.00, 20, 'AVAILABLE', 1),

-- CHICKEN WINGS & BONELESS
('Chicken Wings & Boneless', 'Buffalo Wings', 'Crispy fried chicken wings tossed in tangy spicy classic Buffalo glaze', 219.00, 25, 'AVAILABLE', 1),
('Chicken Wings & Boneless', 'Teriyaki Wings', 'Crispy wings coated in sweet savory Japanese teriyaki reduction', 219.00, 25, 'AVAILABLE', 1),
('Chicken Wings & Boneless', 'Garlic Parmesan Wings', 'Crisp chicken wings enveloped in roasted garlic butter and aged parmesan', 219.00, 30, 'AVAILABLE', 1),
('Chicken Wings & Boneless', 'Salt & Pepper Wings', 'Dry-rubbed crispy wings seasoned with cracked peppercorn and rock salt', 219.00, 25, 'AVAILABLE', 1),
('Chicken Wings & Boneless', 'Boneless Chicken Sisig', 'Chopped crispy boneless chicken tossed with onions, chili, and citrus dressing', 269.00, 20, 'AVAILABLE', 1),
('Chicken Wings & Boneless', 'Boneless Chicken Cheesy Meltdown', 'Tender boneless fried chicken fillets blanketed under molten cheese', 269.00, 20, 'AVAILABLE', 1),
('Chicken Wings & Boneless', 'Boneless Chicken Salted Egg', 'Crispy bite-sized fillets coated in rich aromatic salted egg yolk butter', 269.00, 20, 'AVAILABLE', 1),
('Chicken Wings & Boneless', 'Boneless Chicken Bburinkle', 'Korean-style crispy chicken dusted with sweet cheese and vegetable seasoning', 269.00, 20, 'AVAILABLE', 1),
('Chicken Wings & Boneless', "Chic'n Bowl (with Rice)", 'Crispy boneless chicken bites drizzled with sauce served over hot rice', 129.00, 35, 'AVAILABLE', 1);

