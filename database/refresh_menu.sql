-- =============================================================================
-- Diner's Cafe: Verified 91-Item Menu & Categories Seed for TiDB Cloud / MySQL
-- =============================================================================

USE `diners_cafe_db`;

SET FOREIGN_KEY_CHECKS = 0;

-- 1. Ensure Categories 1-8 Exist
INSERT INTO `categories` (`id`, `name`, `slug`, `display_order`, `is_active`) VALUES
(1, 'Drinks & Milktea', 'drinks-milktea', 1, 1),
(2, 'Burgers & Sandwiches', 'burgers-sandwiches', 2, 1),
(3, 'Starters & Fries', 'starters-fries', 3, 1),
(4, 'Pizza & Flat Bread', 'pizza-flatbread', 4, 1),
(5, 'Meals & Steaks', 'meals-steaks', 5, 1),
(6, 'Pasta & Platters', 'pasta-platters', 6, 1),
(7, 'Chicken Wings & Boneless', 'chicken-wings-boneless', 7, 1),
(8, 'Add-ons', 'add-ons', 8, 1)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `slug` = VALUES(`slug`), `display_order` = VALUES(`display_order`), `is_active` = 1;

-- 2. Ensure optional category column exists on menu_items
ALTER TABLE `menu_items` ADD COLUMN IF NOT EXISTS `category` VARCHAR(100) NULL AFTER `category_id`;

-- 3. Clear Existing Menu & Inventory Records for Fresh Hard Reset
DELETE FROM `inventory_logs`;
DELETE FROM `inventory`;
DELETE FROM `menu_items`;

-- Reset Auto Increment
ALTER TABLE `menu_items` AUTO_INCREMENT = 1;
ALTER TABLE `inventory` AUTO_INCREMENT = 1;

-- 4. Insert Verified 91 Menu Items
INSERT INTO `menu_items` (`category_id`, `category`, `name`, `description`, `price`, `stock_quantity`, `is_available`, `image_url`) VALUES
(1, 'Drinks & Milktea', 'Biscoff Cheesecake', 'Rich creamy cheesecake blend topped with crushed Lotus Biscoff', 169.00, 30, 1, '/uploads/Drinks%20and%20milktea/Biscoff%20Cheesecake%20drinks.webp'),
(1, 'Drinks & Milktea', 'Choco Java Chips', 'Decadent chocolate blend infused with premium java chips', 169.00, 30, 1, '/uploads/Drinks%20and%20milktea/Choco%20Java%20Chips.webp'),
(1, 'Drinks & Milktea', 'Diner''s Signature Drink', 'House-crafted specialty blend with signature flavor profile', 149.00, 40, 1, '/uploads/Drinks%20and%20milktea/Diner''s%20Signature%20Drink.webp'),
(1, 'Drinks & Milktea', 'Oreo Blast', 'Creamy cookies and cream indulgence loaded with crushed Oreos', 149.00, 35, 1, '/uploads/Drinks%20and%20milktea/Oreo%20Blast.webp'),
(1, 'Drinks & Milktea', 'Two Two', 'Dual-flavor specialty blend with layered sweetness', 149.00, 25, 1, '/uploads/Drinks%20and%20milktea/Two%20Two.webp'),
(1, 'Drinks & Milktea', 'Purple Alcapone', 'Ube-infused creamy beverage with white chocolate undertones', 149.00, 25, 1, '/uploads/Drinks%20and%20milktea/Purple%20Alcapone.jpg'),
(1, 'Drinks & Milktea', 'Strawberries & Cream', 'Fresh strawberry puree layered over smooth velvety cream', 149.00, 30, 1, '/uploads/Drinks%20and%20milktea/Strawberries%20%26%20Cream.webp'),
(1, 'Drinks & Milktea', 'Blueberries & Cream', 'Luscious blueberry reduction with chilled creamy base', 149.00, 30, 1, '/uploads/Drinks%20and%20milktea/Blueberries%20%26%20Cream%20drinks.webp'),
(1, 'Drinks & Milktea', 'Caramel Macchiato', 'Espresso marked with velvety milk and rich caramel drizzle', 149.00, 40, 1, '/uploads/Drinks%20and%20milktea/Caramel%20Macchiato.webp'),
(1, 'Drinks & Milktea', 'Dark Chocolate Milktea', 'Bold and bittersweet Dutch cocoa with premium brewed tea', 99.00, 50, 1, '/uploads/Drinks%20and%20milktea/Dark%20Chocolate%20Milktea.webp'),
(1, 'Drinks & Milktea', 'Okinawa Milktea', 'Roasted brown sugar milk tea with authentic rich finish', 99.00, 50, 1, '/uploads/Drinks%20and%20milktea/Okinawa%20Milktea.webp'),
(1, 'Drinks & Milktea', 'Classic Milktea', 'Signature black tea infused with balanced creamy milk', 99.00, 60, 1, '/uploads/Drinks%20and%20milktea/Classic%20Milktea.webp'),
(1, 'Drinks & Milktea', 'Roasted Wintermelon Milktea', 'Caramelized roasted wintermelon taste with silky finish', 99.00, 50, 1, '/uploads/Drinks%20and%20milktea/Roasted%20Wintermelon%20Milktea.webp'),
(1, 'Drinks & Milktea', 'Matcha Milktea', 'Authentic earthy Japanese green tea with fresh milk', 99.00, 40, 1, '/uploads/Drinks%20and%20milktea/Matcha%20Milktea.webp'),
(1, 'Drinks & Milktea', 'Taro Milktea', 'Creamy, sweet, and nutty purple taro infusion', 99.00, 45, 1, '/uploads/Drinks%20and%20milktea/Taro%20Milktea.webp'),
(1, 'Drinks & Milktea', 'Oreo Milktea', 'Classic milk tea shaken with chunky Oreo biscuit crumbles', 99.00, 40, 1, '/uploads/Drinks%20and%20milktea/Oreo%20Milktea.webp'),
(1, 'Drinks & Milktea', 'Brown Sugar Milktea', 'Tiger tiger striped brown sugar syrup with rich milk tea', 99.00, 45, 1, '/uploads/Drinks%20and%20milktea/Brown%20Sugar%20Milktea.webp'),
(1, 'Drinks & Milktea', 'Diner''s House Blend Milktea', 'Proprietary spiced tea blend formulated exclusively in-house', 99.00, 50, 1, '/uploads/Drinks%20and%20milktea/Diner''s%20House%20Blend%20Milktea.webp'),
(1, 'Drinks & Milktea', 'Green Apple Yakult', 'Tangy probiotic Yakult base infused with crisp green apple', 109.00, 35, 1, '/uploads/Drinks%20and%20milktea/Green%20Apple%20Yakult.webp'),
(1, 'Drinks & Milktea', 'Strawberry Yakult', 'Sweet strawberry compote combined with gut-friendly Yakult', 109.00, 35, 1, '/uploads/Drinks%20and%20milktea/Strawberry%20Yakult.webp'),
(1, 'Drinks & Milktea', 'Lychee Yakult', 'Floral fragrant lychee blended with chilled refreshing Yakult', 109.00, 35, 1, '/uploads/Drinks%20and%20milktea/Lychee%20Yakult.webp'),
(1, 'Drinks & Milktea', 'Green Apple Fruit Tea', 'Ice-shaken artisan jasmine green tea with green apple essence', 89.00, 40, 1, '/uploads/Drinks%20and%20milktea/Green%20Apple%20Fruit%20Tea.webp'),
(1, 'Drinks & Milktea', 'Strawberry Fruit Tea', 'Chilled botanical tea steeped with sweet strawberry syrup', 89.00, 40, 1, '/uploads/Drinks%20and%20milktea/Strawberry%20Fruit%20Tea.webp'),
(1, 'Drinks & Milktea', 'Lychee Fruit Tea', 'Refreshing cold brewed fruit tea sweetened with pure lychee', 89.00, 40, 1, '/uploads/Drinks%20and%20milktea/Lychee%20Fruit%20Tea.webp'),
(8, 'Add-ons', 'Cream Cheese Wall', 'Savory sweet whipped cream cheese walling', 20.00, 100, 1, '/uploads/Add-ons/Cream%20Cheese%20Wall.webp'),
(8, 'Add-ons', 'Tapioca Pearls', 'Chewy brown-sugar simmered black tapioca pearls', 20.00, 100, 1, '/uploads/Add-ons/Tapioca%20Pearls.webp'),
(8, 'Add-ons', 'Rainbow Crystals', 'Translucent chewy jelly crystal sinkers', 20.00, 100, 1, '/uploads/Add-ons/Rainbow%20Crystals.webp'),
(8, 'Add-ons', 'Coffee Jelly', 'Firm espresso jelly cubes for texture', 20.00, 80, 1, '/uploads/Add-ons/Coffee%20Jelly.webp'),
(8, 'Add-ons', 'Crushed Oreo', 'Generous topping of dark Oreo cookie crumbles', 20.00, 80, 1, '/uploads/Add-ons/Crushed%20Oreo.webp'),
(2, 'Burgers & Sandwiches', 'Classic Burger', 'Pure beef grilled patty with crisp lettuce, tomato, and special sauce', 139.00, 30, 1, '/uploads/Burgers%20and%20sandwich/Classic%20Burger.webp'),
(2, 'Burgers & Sandwiches', 'Chicken Fillet Burger', 'Golden breaded fried chicken breast fillet with garlic mayo', 139.00, 25, 1, '/uploads/Burgers%20and%20sandwich/Chicken%20Fillet%20Burger.webp'),
(2, 'Burgers & Sandwiches', 'Bacon Burger', 'All-beef patty stacked with crispy smoked bacon strips and melted cheese', 159.00, 25, 1, '/uploads/Burgers%20and%20sandwich/Bacon%20Burger.webp'),
(2, 'Burgers & Sandwiches', 'Diner''s Double Down', 'Double-stacked beef patties, double melted cheese, and caramelized onions', 179.00, 20, 1, '/uploads/Burgers%20and%20sandwich/Diner''s%20Double%20Down.webp'),
(2, 'Burgers & Sandwiches', 'Premium Sandwich', 'Artisan toasted bread stacked with savory cold cuts, cheese, and greens', 199.00, 20, 1, '/uploads/Burgers%20and%20sandwich/Premium%20Sandwich.webp'),
(2, 'Burgers & Sandwiches', 'Meaty Dog', 'Jumbo grilled frank topped with hearty minced meat chili and relish', 159.00, 25, 1, '/uploads/Burgers%20and%20sandwich/Meaty%20Dog.webp'),
(2, 'Burgers & Sandwiches', 'California Dog', 'Grilled frankfurter dressed with creamy slaw, bacon bits, and mustard', 159.00, 20, 1, '/uploads/Burgers%20and%20sandwich/California%20Dog.webp'),
(2, 'Burgers & Sandwiches', 'Cheesy Dog', 'Savory frank smothered in warm cheddar cheese sauce and jalapeños', 159.00, 25, 1, '/uploads/Burgers%20and%20sandwich/Cheesy%20Dog.webp'),
(3, 'Starters & Fries', 'Quesadilla', 'Toasted flour tortilla packed with seasoned meats and melted cheese blend', 239.00, 20, 1, '/uploads/Starters%20and%20fries/Quesadilla.webp'),
(3, 'Starters & Fries', 'Nuggets (12 pcs)', 'Dozen crispy golden chicken nuggets served with choice of dipping sauce', 219.00, 25, 1, '/uploads/Starters%20and%20fries/Nuggets%20(12%20pcs).webp'),
(3, 'Starters & Fries', 'Nachos with Toppings (Regular)', 'Crisp corn tortilla chips loaded with salsa, cheese sauce, and ground beef', 109.00, 30, 1, '/uploads/Starters%20and%20fries/Nachos%20with%20Toppings%20(Regular).webp'),
(3, 'Starters & Fries', 'Nachos with Toppings (Large)', 'Family-sized platter of loaded corn chips, jalapeños, beef, and dual cheese', 159.00, 25, 1, '/uploads/Starters%20and%20fries/Nachos%20with%20Toppings%20(Large).webp'),
(3, 'Starters & Fries', 'Cheese Stick Jalapeno', 'Breaded mozzarella rolls with spicy pickled jalapeño slices', 89.00, 35, 1, '/uploads/Starters%20and%20fries/Cheese%20Stick%20Jalapeno.webp'),
(3, 'Starters & Fries', 'Pita Wrap', 'Mediterranean style soft flatbread rolled with savory filling and garlic dip', 89.00, 30, 1, '/uploads/Starters%20and%20fries/Pita%20Wrap.webp'),
(3, 'Starters & Fries', 'Nuggets & Fries Combo', 'Crisp seasoned fries served alongside golden tender chicken nuggets', 199.00, 25, 1, '/uploads/Starters%20and%20fries/Nuggets%20%26%20Fries%20Combo.webp'),
(3, 'Starters & Fries', 'Cheesy Bacon Fries', 'Fresh cut potato fries drizzled with cheddar sauce and crisp bacon bits', 159.00, 30, 1, '/uploads/Starters%20and%20fries/Cheesy%20Bacon%20Fries.webp'),
(3, 'Starters & Fries', 'Twisted Fries', 'Seasoned curly spiraled potato fries with crispy spiced coating', 119.00, 35, 1, '/uploads/Starters%20and%20fries/Twisted%20Fries.webp'),
(3, 'Starters & Fries', 'Flavored Fries', 'Crisp french fries dusted with choice of Cheese, BBQ, or Sour Cream', 89.00, 50, 1, '/uploads/Starters%20and%20fries/Flavored%20Fries.webp'),
(4, 'Pizza & Flat Bread', 'Triple Cheese Pizza', 'Mozzarella, sharp cheddar, and parmesan over fresh marinara', 270.00, 20, 1, '/uploads/Pizza%20and%20flatbread/Triple%20Cheese%20Pizza.webp'),
(4, 'Pizza & Flat Bread', 'Hawaiian Pizza', 'Classic sweet pineapple chunks, sliced ham, and melted mozzarella', 310.00, 25, 1, '/uploads/Pizza%20and%20flatbread/Hawaiian%20Pizza.webp'),
(4, 'Pizza & Flat Bread', 'Bacon & Mushroom Pizza', 'Smoked bacon crumbles and sautéed button mushrooms over garlic crust', 310.00, 20, 1, '/uploads/Pizza%20and%20flatbread/Bacon%20%26%20Mushroom%20Pizza.webp'),
(4, 'Pizza & Flat Bread', 'Hungarian Pizza', 'Spicy sliced Hungarian sausage rounds, bell peppers, and melted cheese', 310.00, 20, 1, '/uploads/Pizza%20and%20flatbread/Hungarian%20Pizza.webp'),
(4, 'Pizza & Flat Bread', 'Mediterranean Pizza', 'Sun-ripened tomatoes, olives, herbs, and feta mozzarella blend', 340.00, 15, 1, '/uploads/Pizza%20and%20flatbread/Mediterranean%20Pizza.webp'),
(4, 'Pizza & Flat Bread', 'Pizza Bianca', 'White garlic cream sauce base topped with ricotta, mozzarella, and herbs', 350.00, 15, 1, '/uploads/Pizza%20and%20flatbread/Pizza%20Bianca.webp'),
(4, 'Pizza & Flat Bread', 'Diner''s Pizza Supreme', 'Fully loaded with beef, pepperoni, sausage, peppers, onions, and mushrooms', 350.00, 20, 1, '/uploads/Pizza%20and%20flatbread/Diner''s%20Pizza%20Supreme.webp'),
(4, 'Pizza & Flat Bread', 'Cajun Shrimp Pizza', 'Plump shrimp tossed in spicy Cajun butter seasoning over crispy crust', 370.00, 15, 1, '/uploads/Pizza%20and%20flatbread/Cajun%20Shrimp%20Pizza.webp'),
(4, 'Pizza & Flat Bread', 'Garlic Shrimp Pizza', 'Sautéed garlic butter shrimp, roasted garlic cloves, and fresh herbs', 370.00, 15, 1, '/uploads/Pizza%20and%20flatbread/Garlic%20Shrimp%20Pizza.webp'),
(4, 'Pizza & Flat Bread', 'Ham & Bacon Flat Bread', 'Crispy thin flatbread layered with honey ham, bacon bits, and cheese', 179.00, 25, 1, '/uploads/Pizza%20and%20flatbread/Ham%20%26%20Bacon%20Flat%20Bread.webp'),
(4, 'Pizza & Flat Bread', 'Four Cheese Flat Bread', 'Artisan flatbread baked with four melted specialty cheeses', 179.00, 25, 1, '/uploads/Pizza%20and%20flatbread/Four%20Cheese%20Flat%20Bread.webp'),
(5, 'Meals & Steaks', 'BBQ Ribs', 'Tender slow-cooked ribs glazed in smoky house barbecue sauce with rice', 269.00, 15, 1, '/uploads/Meals%20and%20steak/BBQ%20Ribs.webp'),
(5, 'Meals & Steaks', 'Quarter Chicken Meal', 'Oven-roasted marinated quarter chicken served with gravy and rice', 179.00, 25, 1, '/uploads/Meals%20and%20steak/Quarter%20Chicken%20Meal.webp'),
(5, 'Meals & Steaks', 'Burger Steak (2 pcs)', 'Two savory grilled beef patties swimming in mushroom gravy with rice', 179.00, 30, 1, '/uploads/Meals%20and%20steak/Burger%20Steak%20(2%20pcs).webp'),
(5, 'Meals & Steaks', 'Hungarian with Egg', 'Grilled spicy Hungarian sausage served with sunny-side-up egg and rice', 149.00, 30, 1, '/uploads/Meals%20and%20steak/Hungarian%20with%20Egg.webp'),
(5, 'Meals & Steaks', 'Bacheelog', 'Bacon, cheesy sauce, garlic fried rice, and sunny egg bowl', 119.00, 35, 1, '/uploads/Meals%20and%20steak/Bacsilog.webp'),
(5, 'Meals & Steaks', 'Nuggetcheelog', 'Crispy chicken nuggets, cheese drizzle, garlic rice, and fried egg', 119.00, 35, 1, '/uploads/Meals%20and%20steak/Nuggetsilog.webp'),
(5, 'Meals & Steaks', 'Hotcheelog', 'Sliced frankfurter hotdog, cheddar sauce, sinangag, and egg', 119.00, 35, 1, '/uploads/Meals%20and%20steak/Hotsilog.webp'),
(5, 'Meals & Steaks', 'Spamcheelog', 'Seared luncheon meat, cheesy drizzle, garlic rice, and fried egg', 119.00, 30, 1, '/uploads/Meals%20and%20steak/Spamsilog.webp'),
(5, 'Meals & Steaks', 'Beef Doner Bowl', 'Spiced Mediterranean beef strips with garlic yogurt sauce over rice', 119.00, 30, 1, '/uploads/Meals%20and%20steak/Beef%20Doner%20Bowl.webp'),
(5, 'Meals & Steaks', 'Chicken Teriyaki Bowl', 'Pan-seared glazed chicken cubes garnished with sesame seeds over rice', 119.00, 35, 1, '/uploads/Meals%20and%20steak/Chicken%20Teriyaki%20Bowl.webp'),
(5, 'Meals & Steaks', 'Fully Loaded Choice of 3', 'Custom combo: Pick 3 (Tocino/Tapa/Hungarian/Hotdog/Bacon/Chicken/Spam) w/ rice & egg', 269.00, 20, 1, '/uploads/Meals%20and%20steak/Fully%20Loaded%20Choice%20of%203.webp'),
(5, 'Meals & Steaks', 'Lunch Pack - Tocino', 'Sweet cured pork tocino, fried rice, egg, and fresh sides', 139.00, 30, 1, '/uploads/Meals%20and%20steak/Lunch%20Pack%20-%20Tocino.webp'),
(5, 'Meals & Steaks', 'Lunch Pack - Tapa', 'Savory marinated beef tapa, garlic sinangag, egg, and sides', 139.00, 30, 1, '/uploads/Meals%20and%20steak/Lunch%20Pack%20-%20Tapa.webp'),
(5, 'Meals & Steaks', 'Lunch Pack - Adobo', 'Classic tender pork and chicken adobo stewed in garlic soy vinegar', 139.00, 30, 1, '/uploads/Meals%20and%20steak/Lunch%20Pack%20-%20Adobo.webp'),
(5, 'Meals & Steaks', 'Lunch Pack - Mixed', 'Hearty chef sampler plate with mixed viands, egg, and fried rice', 139.00, 30, 1, '/uploads/Meals%20and%20steak/Lunch%20Pack%20-%20Mixed.webp'),
(6, 'Pasta & Platters', 'Lasagna', 'Layers of tender pasta sheets, rich bolognese meat sauce, and bechamel', 230.00, 15, 1, '/uploads/pasta%20and%20platter/Lasagna.webp'),
(6, 'Pasta & Platters', 'Baked Macaroni', 'Elbow macaroni tossed in sweet-style meat sauce baked with cheese melt', 209.00, 20, 1, '/uploads/pasta%20and%20platter/Baked%20Macaroni.webp'),
(6, 'Pasta & Platters', 'Carbonara', 'Creamy pasta tossed with smoky bacon, parmesan cheese, and cracked pepper', 179.00, 25, 1, '/uploads/pasta%20and%20platter/Carbonara.webp'),
(6, 'Pasta & Platters', 'Meaty Spaghetti', 'Sweet Filipino-style bolognese spaghetti topped with grated cheese', 179.00, 30, 1, '/uploads/pasta%20and%20platter/Meaty%20Spaghetti.webp'),
(6, 'Pasta & Platters', 'Platter A', 'Combination platter: Crispy Chicken, Pasta, Garlic Bread, and French Fries', 249.00, 20, 1, '/uploads/pasta%20and%20platter/Platter%20A.webp'),
(6, 'Pasta & Platters', 'Platter B', 'Combination platter: Grilled Hungarian Sausage, Pasta, Bread, and Fries', 249.00, 20, 1, '/uploads/pasta%20and%20platter/Platter%20B.webp'),
(6, 'Pasta & Platters', 'Platter C', 'Combination platter: Fried Chicken, Pasta, Bread, Fries, and Fresh Green Salad', 269.00, 15, 1, '/uploads/pasta%20and%20platter/Platter%20C.webp'),
(6, 'Pasta & Platters', 'Platter D', 'Combination platter: Chicken, Hungarian Sausage, Bread, Fries, and Green Salad', 269.00, 15, 1, '/uploads/pasta%20and%20platter/Platter%20D.webp'),
(6, 'Pasta & Platters', 'Platter E', 'Combination platter: Roasted Quarter Leg Chicken served with Pasta and Toast', 229.00, 20, 1, '/uploads/pasta%20and%20platter/Platter%20E.webp'),
(7, 'Chicken Wings & Boneless', 'Buffalo Wings', 'Crispy fried chicken wings tossed in tangy spicy classic Buffalo glaze', 219.00, 25, 1, '/uploads/Chicken%20wings%20and%20boneless/Buffalo%20Wings.webp'),
(7, 'Chicken Wings & Boneless', 'Teriyaki Wings', 'Crispy wings coated in sweet savory Japanese teriyaki reduction', 219.00, 25, 1, '/uploads/Chicken%20wings%20and%20boneless/Teriyaki%20Wings.webp'),
(7, 'Chicken Wings & Boneless', 'Garlic Parmesan Wings', 'Crisp chicken wings enveloped in roasted garlic butter and aged parmesan', 219.00, 30, 1, '/uploads/Chicken%20wings%20and%20boneless/Garlic%20Parmesan%20Wings.webp'),
(7, 'Chicken Wings & Boneless', 'Salt & Pepper Wings', 'Dry-rubbed crispy wings seasoned with cracked peppercorn and rock salt', 219.00, 25, 1, '/uploads/Chicken%20wings%20and%20boneless/Salt%20%26%20Pepper%20Wings.webp'),
(7, 'Chicken Wings & Boneless', 'Boneless Chicken Sisig', 'Chopped crispy boneless chicken tossed with onions, chili, and citrus dressing', 269.00, 20, 1, '/uploads/Chicken%20wings%20and%20boneless/Boneless%20Chicken%20Sisig.webp'),
(7, 'Chicken Wings & Boneless', 'Boneless Chicken Cheesy Meltdown', 'Tender boneless fried chicken fillets blanketed under molten cheese', 269.00, 20, 1, '/uploads/Chicken%20wings%20and%20boneless/Boneless%20Chicken%20Cheesy%20Meltdown.webp'),
(7, 'Chicken Wings & Boneless', 'Boneless Chicken Salted Egg', 'Crispy bite-sized fillets coated in rich aromatic salted egg yolk butter', 269.00, 20, 1, '/uploads/Chicken%20wings%20and%20boneless/Boneless%20Chicken%20Salted%20Egg.webp'),
(7, 'Chicken Wings & Boneless', 'Boneless Chicken Bburinkle', 'Korean-style crispy chicken dusted with sweet cheese and vegetable seasoning', 269.00, 20, 1, '/uploads/Chicken%20wings%20and%20boneless/Boneless%20Chicken%20Bburinkle.webp'),
(7, 'Chicken Wings & Boneless', 'Chic''n Bowl (with Rice)', 'Crispy boneless chicken bites drizzled with sauce served over hot rice', 129.00, 35, 1, '/uploads/Chicken%20wings%20and%20boneless/Chic''n%20Bowl%20(with%20Rice).webp');

-- 5. Seed Inventory Tracking for All 91 Menu Items
INSERT INTO `inventory` (`menu_item_id`, `stock_quantity`, `low_stock_threshold`, `unit`)
SELECT `id`, `stock_quantity`, 10, 'servings' FROM `menu_items`
ON DUPLICATE KEY UPDATE `stock_quantity` = VALUES(`stock_quantity`);

SET FOREIGN_KEY_CHECKS = 1;
