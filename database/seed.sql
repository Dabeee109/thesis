-- ==============================================================================
-- Diner's Cafe Ordering & Delivery System - Initial Seed Data
-- ==============================================================================

USE `diners_cafe_db`;

-- 1. Admins & Staff Accounts (Password for all default accounts is: password123)
-- BCrypt hash for 'password123': $2a$10$7Z8/fAomF0lIgej1i/j94OGgWjXzN6Z0aU34Q1zZg3a.gE.v7hX0e
INSERT INTO `admins_staff` (`id`, `full_name`, `email`, `password_hash`, `role`, `phone_number`, `is_active`) VALUES
(1, 'Diner Admin', 'admin@dinerscafe.ph', '$2a$10$7Z8/fAomF0lIgej1i/j94OGgWjXzN6Z0aU34Q1zZg3a.gE.v7hX0e', 'admin', '+63 917 111 2222', 1),
(2, 'Maria Clara (Barista)', 'staff@dinerscafe.ph', '$2a$10$7Z8/fAomF0lIgej1i/j94OGgWjXzN6Z0aU34Q1zZg3a.gE.v7hX0e', 'staff', '+63 917 333 4444', 1),
(3, 'Marco Santos (Motorcycle Rider)', 'rider1@dinerscafe.ph', '$2a$10$7Z8/fAomF0lIgej1i/j94OGgWjXzN6Z0aU34Q1zZg3a.gE.v7hX0e', 'rider', '+63 918 555 6666', 1),
(4, 'Leo Reyes (Bicycle Eco-Rider)', 'rider2@dinerscafe.ph', '$2a$10$7Z8/fAomF0lIgej1i/j94OGgWjXzN6Z0aU34Q1zZg3a.gE.v7hX0e', 'rider', '+63 918 777 8888', 1);

-- 2. Delivery Personnel Table
INSERT INTO `delivery_personnel` (`id`, `user_id`, `full_name`, `phone_number`, `vehicle_type`, `vehicle_plate_no`, `status`, `is_active`) VALUES
(1, 3, 'Marco Santos', '+63 918 555 6666', 'motorcycle', 'MC-7890-PH', 'available', 1),
(2, 4, 'Leo Reyes', '+63 918 777 8888', 'bicycle', 'ECO-BIKE-02', 'available', 1);

-- 3. Categories
INSERT INTO `categories` (`id`, `name`, `slug`, `description`, `display_order`, `is_active`) VALUES
(1, 'Espresso & Coffee', 'coffee', 'Artisanal single-origin espresso and handcrafted coffee brews', 1, 1),
(2, 'Non-Coffee & Refreshers', 'non-coffee', 'Creamy matcha, artisanal teas, and iced fruit infusions', 2, 1),
(3, 'All-Day Breakfast & Meals', 'meals', 'Hearty Filipino and Western comfort food, freshly cooked', 3, 1),
(4, 'Artisanal Pastries & Desserts', 'pastries', 'Freshly baked croissants, cookies, and decadent cakes', 4, 1),
(5, 'Sandwiches & Light Bites', 'snacks', 'Grilled sourdough panini, wraps, and savory cafe sides', 5, 1);

-- 4. Menu Items
INSERT INTO `menu_items` (`id`, `category_id`, `name`, `description`, `price`, `image_url`, `is_available`, `is_bestseller`, `preparation_time_min`) VALUES
(1, 1, 'Signature Spanish Latte', 'Double espresso shot with creamy condensed milk and velvety textured milk', 145.00, 'https://images.unsplash.com/photo-1541167760496-1628856ab772?w=500&auto=format&fit=crop&q=60', 1, 1, 5),
(2, 1, 'Caramel Macchiato', 'Freshly steamed milk with vanilla-flavored syrup, marked with espresso and caramel drizzle', 150.00, 'https://images.unsplash.com/photo-1485808191679-5f86510681a2?w=500&auto=format&fit=crop&q=60', 1, 1, 5),
(3, 1, 'Iced Americano', 'Bold rich espresso shots topped with cold water and ice for a crisp finish', 110.00, 'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?w=500&auto=format&fit=crop&q=60', 1, 0, 4),
(4, 2, 'Kyoto Uji Matcha Latte', 'Ceremonial grade green tea whisked with creamy oat or dairy milk', 160.00, 'https://images.unsplash.com/photo-1536256263959-770b48d82b0a?w=500&auto=format&fit=crop&q=60', 1, 1, 6),
(5, 2, 'Hibiscus Berry Iced Tea', 'Refreshing cold brewed botanical tea infused with wild berries and mint', 125.00, 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=500&auto=format&fit=crop&q=60', 1, 0, 4),
(6, 3, 'Classic Beef Tapa Rice Bowl', 'Tender marinated beef sirloin slices, garlic fried rice, and sunny-side-up egg', 195.00, 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=500&auto=format&fit=crop&q=60', 1, 1, 15),
(7, 3, 'Creamy Truffle Bacon Carbonara', 'Fettuccine pasta tossed in rich parmesan truffle cream with crispy bacon bits', 220.00, 'https://images.unsplash.com/photo-1612874742237-6526221588e3?w=500&auto=format&fit=crop&q=60', 1, 1, 15),
(8, 4, 'Almond Butter Croissant', 'Flaky, buttery French croissant filled with rich almond cream and toasted flakes', 95.00, 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=500&auto=format&fit=crop&q=60', 1, 1, 3),
(9, 4, 'Dark Chocolate Chunk Cookie', 'Chewy warm cookie loaded with 70% Belgian dark chocolate chunks and sea salt', 75.00, 'https://images.unsplash.com/photo-1499636136210-6f4ee915583e?w=500&auto=format&fit=crop&q=60', 1, 0, 2),
(10, 5, 'Grilled Chicken Pesto Panini', 'Herb-roasted chicken breast, basil pesto, mozzarella on toasted artisan sourdough', 175.00, 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?w=500&auto=format&fit=crop&q=60', 1, 1, 10);

-- 5. Inventory (Stock levels)
INSERT INTO `inventory` (`id`, `menu_item_id`, `stock_quantity`, `low_stock_threshold`, `unit`, `last_restocked_at`) VALUES
(1, 1, 45, 10, 'cups', NOW()),
(2, 2, 38, 10, 'cups', NOW()),
(3, 3, 50, 10, 'cups', NOW()),
(4, 4, 30, 8, 'cups', NOW()),
(5, 5, 25, 8, 'cups', NOW()),
(6, 6, 20, 5, 'servings', NOW()),
(7, 7, 18, 5, 'servings', NOW()),
(8, 8, 14, 5, 'pieces', NOW()),
(9, 9, 22, 5, 'pieces', NOW()),
(10, 10, 16, 5, 'servings', NOW());

-- 6. Sample Customers
INSERT INTO `customers` (`id`, `psid`, `first_name`, `last_name`, `phone_number`, `delivery_address`, `distance_km`, `conversation_state`) VALUES
(1, 'PSID_SAMPLE_001', 'Juan', 'Dela Cruz', '0917-123-4567', 'Unit 402, Acacia Heights, Maple St.', 1.50, 'IDLE'),
(2, 'PSID_SAMPLE_002', 'Sofia', 'Reyes', '0918-234-5678', 'Bldg B, Sunshine Residences, 2nd Ave', 2.20, 'IDLE'),
(3, 'PSID_SAMPLE_003', 'Miguel', 'Tan', '0919-345-6789', '77 Oakwood Drive, Greenbelt', 0.80, 'IDLE');

-- 7. Sample Historical Orders
INSERT INTO `orders` (`id`, `order_number`, `customer_id`, `order_type`, `status`, `subtotal`, `delivery_fee`, `total_amount`, `delivery_address`, `distance_km`, `customer_notes`) VALUES
(1, 'DNR-20260901-001', 1, 'delivery', 'delivered', 340.00, 75.00, 415.00, 'Unit 402, Acacia Heights, Maple St.', 1.50, 'Please knock gently.'),
(2, 'DNR-20260901-002', 2, 'delivery', 'dispatched', 270.00, 60.00, 330.00, 'Bldg B, Sunshine Residences, 2nd Ave', 2.20, 'Leave at security lobby.'),
(3, 'DNR-20260901-003', 3, 'delivery', 'preparing', 335.00, 50.00, 385.00, '77 Oakwood Drive, Greenbelt', 0.80, 'Less ice on latte please.');

-- 8. Order Items
INSERT INTO `order_items` (`id`, `order_id`, `menu_item_id`, `item_name`, `unit_price`, `quantity`, `subtotal`, `special_instructions`) VALUES
(1, 1, 1, 'Signature Spanish Latte', 145.00, 1, 145.00, 'Less sweet'),
(2, 1, 6, 'Classic Beef Tapa Rice Bowl', 195.00, 1, 195.00, 'Egg well done'),
(3, 2, 4, 'Kyoto Uji Matcha Latte', 160.00, 1, 160.00, 'Oat milk'),
(4, 2, 3, 'Iced Americano', 110.00, 1, 110.00, 'Extra shot'),
(5, 3, 1, 'Signature Spanish Latte', 145.00, 1, 145.00, 'Regular sweetness'),
(6, 3, 6, 'Classic Beef Tapa Rice Bowl', 195.00, 1, 195.00, 'Garlic rice');

-- 9. Payments
INSERT INTO `payments` (`id`, `order_id`, `payment_method`, `amount_expected`, `amount_paid`, `reference_no`, `status`, `is_mismatch`, `verified_at`) VALUES
(1, 1, 'gcash', 415.00, 415.00, 'GCASH-REF-987654321', 'completed', 0, NOW()),
(2, 2, 'cash', 330.00, 330.00, NULL, 'pending', 0, NULL),
(3, 3, 'gcash', 385.00, 385.00, 'GCASH-REF-123456789', 'verified', 0, NOW());

-- 10. Deliveries
INSERT INTO `deliveries` (`id`, `order_id`, `rider_id`, `vehicle_type`, `distance_km`, `weather_condition`, `computed_fare`, `final_fare`, `is_fare_overridden`, `status`, `estimated_time_min`, `dispatched_at`, `delivered_at`) VALUES
(1, 1, 1, 'motorcycle', 1.50, 'sunny', 73.83, 75.00, 0, 'delivered', 20, DATE_SUB(NOW(), INTERVAL 45 MINUTE), DATE_SUB(NOW(), INTERVAL 20 MINUTE)),
(2, 2, 2, 'bicycle', 2.20, 'sunny', 61.60, 60.00, 0, 'dispatched', 25, DATE_SUB(NOW(), INTERVAL 10 MINUTE), NULL),
(3, 3, 1, 'motorcycle', 0.80, 'sunny', 49.00, 50.00, 0, 'assigned', 15, NULL, NULL);

-- 11. Feedback (FR11)
INSERT INTO `feedback` (`id`, `order_id`, `customer_id`, `rating`, `comments`, `sentiment`, `created_at`) VALUES
(1, 1, 1, 5, 'The Spanish Latte was super aromatic and the beef tapa arrived steaming hot! Fast delivery by Kuya Marco!', 'positive', DATE_SUB(NOW(), INTERVAL 15 MINUTE));
