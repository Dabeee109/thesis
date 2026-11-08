-- ====================================================
-- Diner's Cafe Centralized MySQL Export
-- Compatible with phpMyAdmin (VistaPanel / cPanel)
-- ====================================================

-- ==============================================================================
-- Diner's Cafe Ordering & Delivery System - Centralized MySQL Database Schema
-- Target: MySQL 5.7+ / MariaDB 10.3+ / Modern LAMP Environment
-- ==============================================================================

USE `diners_cafe_db`;

-- Drop tables in reverse order of foreign key dependencies for clean migrations
DROP TABLE IF EXISTS `chatbot_logs`;
DROP TABLE IF EXISTS `notifications`;
DROP TABLE IF EXISTS `feedback`;
DROP TABLE IF EXISTS `deliveries`;
DROP TABLE IF EXISTS `delivery_personnel`;
DROP TABLE IF EXISTS `payments`;
DROP TABLE IF EXISTS `admin_gcash_transactions`;
DROP TABLE IF EXISTS `order_items`;
DROP TABLE IF EXISTS `orders`;
DROP TABLE IF EXISTS `inventory_logs`;
DROP TABLE IF EXISTS `inventory`;
DROP TABLE IF EXISTS `menu_items`;
DROP TABLE IF EXISTS `categories`;
DROP TABLE IF EXISTS `admins_staff`;
DROP TABLE IF EXISTS `customers`;

-- 1. Customers Table (Facebook Messenger PSID based)
CREATE TABLE `customers` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `psid` VARCHAR(128) NOT NULL UNIQUE COMMENT 'Facebook Page-Scoped User ID',
  `first_name` VARCHAR(100) DEFAULT NULL,
  `last_name` VARCHAR(100) DEFAULT NULL,
  `phone_number` VARCHAR(30) DEFAULT NULL,
  `delivery_address` TEXT DEFAULT NULL,
  `distance_km` DECIMAL(4,2) DEFAULT 1.00 COMMENT 'Delivery distance from cafe (0 to 3 km limit)',
  `conversation_state` VARCHAR(50) DEFAULT 'IDLE' COMMENT 'Active conversation stage',
  `cart_json` JSON DEFAULT NULL COMMENT 'Temporary active cart items in Messenger',
  `session_json` TEXT DEFAULT NULL COMMENT 'Extended conversational session state and details',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_psid` (`psid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Admins and Staff Table (Authentication & User Roles)
CREATE TABLE `admins_staff` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `full_name` VARCHAR(150) NOT NULL,
  `email` VARCHAR(150) NOT NULL UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `role` ENUM('admin', 'staff', 'rider') NOT NULL DEFAULT 'staff',
  `phone_number` VARCHAR(30) DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_email` (`email`),
  INDEX `idx_role` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Menu Categories Table
CREATE TABLE `categories` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(100) NOT NULL,
  `slug` VARCHAR(100) NOT NULL UNIQUE,
  `description` VARCHAR(255) DEFAULT NULL,
  `display_order` INT NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Menu Items Table
CREATE TABLE `menu_items` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `category_id` INT UNSIGNED NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `price` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `stock_quantity` INT NOT NULL DEFAULT 0,
  `image_url` VARCHAR(500) DEFAULT NULL,
  `is_available` TINYINT(1) NOT NULL DEFAULT 1,
  `is_bestseller` TINYINT(1) NOT NULL DEFAULT 0,
  `synonyms` VARCHAR(255) DEFAULT NULL COMMENT 'Comma-separated lookup synonyms and keywords',
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `preparation_time_min` INT NOT NULL DEFAULT 15,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE CASCADE,
  INDEX `idx_category_id` (`category_id`),
  INDEX `idx_is_available` (`is_available`),
  INDEX `idx_is_deleted` (`is_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Inventory Table (Item stock counts & threshold alerts)
CREATE TABLE `inventory` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `menu_item_id` INT UNSIGNED NOT NULL UNIQUE,
  `stock_quantity` INT NOT NULL DEFAULT 0,
  `low_stock_threshold` INT NOT NULL DEFAULT 10,
  `unit` VARCHAR(50) NOT NULL DEFAULT 'servings',
  `last_restocked_at` TIMESTAMP NULL DEFAULT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`menu_item_id`) REFERENCES `menu_items`(`id`) ON DELETE CASCADE,
  INDEX `idx_menu_item_id` (`menu_item_id`),
  INDEX `idx_stock_quantity` (`stock_quantity`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Inventory Logs Table (Audit trail of restocks and order deductions)
CREATE TABLE `inventory_logs` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `inventory_id` INT UNSIGNED NOT NULL,
  `change_amount` INT NOT NULL COMMENT 'Negative for order deductions, positive for restocks',
  `reason` ENUM('order_placed', 'order_cancelled', 'manual_restock', 'spoilage_adjustment', 'initial_seed') NOT NULL,
  `reference_id` VARCHAR(100) DEFAULT NULL COMMENT 'Order Number or Restock PO',
  `logged_by` VARCHAR(150) DEFAULT 'System',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`inventory_id`) REFERENCES `inventory`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Orders Table
CREATE TABLE `orders` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `order_number` VARCHAR(50) NOT NULL UNIQUE COMMENT 'e.g. DNR-20260901-001',
  `customer_id` INT UNSIGNED NOT NULL,
  `order_type` ENUM('delivery', 'pickup') NOT NULL DEFAULT 'delivery',
  `status` ENUM('pending', 'preparing', 'dispatched', 'delivered', 'cancelled', 'PAID') NOT NULL DEFAULT 'pending',
  `subtotal` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `delivery_fee` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `total_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `delivery_address` TEXT DEFAULT NULL,
  `customer_phone` VARCHAR(50) DEFAULT NULL,
  `payment_proof_image` VARCHAR(500) DEFAULT NULL,
  `payment_ref_number` VARCHAR(100) DEFAULT NULL,
  `payment_status` ENUM('Pending', 'Pending Verification', 'Paid', 'Failed') NOT NULL DEFAULT 'Pending',
  `distance_km` DECIMAL(4,2) DEFAULT 1.00,
  `customer_notes` TEXT DEFAULT NULL,
  `cancellation_reason` VARCHAR(255) DEFAULT NULL,
  `feedback_requested_at` DATETIME DEFAULT NULL COMMENT 'Timestamp when post-delivery feedback prompt was requested',
  `gcash_ref` VARCHAR(100) DEFAULT NULL COMMENT 'Verified GCash reference number',
  `receipt_url` TEXT DEFAULT NULL COMMENT 'Attached receipt image URL or path',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT,
  INDEX `idx_order_number` (`order_number`),
  INDEX `idx_customer_id` (`customer_id`),
  INDEX `idx_status` (`status`),
  INDEX `idx_gcash_ref` (`gcash_ref`),
  INDEX `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Order Items Table (Line items per order)
CREATE TABLE `order_items` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `order_id` INT UNSIGNED NOT NULL,
  `menu_item_id` INT UNSIGNED NOT NULL,
  `item_name` VARCHAR(150) NOT NULL,
  `unit_price` DECIMAL(10,2) NOT NULL,
  `quantity` INT NOT NULL DEFAULT 1,
  `subtotal` DECIMAL(10,2) NOT NULL,
  `special_instructions` VARCHAR(255) DEFAULT NULL,
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`menu_item_id`) REFERENCES `menu_items`(`id`) ON DELETE RESTRICT,
  INDEX `idx_order_id` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. Admin GCash Transactions Table (Official Admin Transaction Records for Anti-Scam)
CREATE TABLE `admin_gcash_transactions` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `reference_number` VARCHAR(100) NOT NULL UNIQUE,
  `amount` DECIMAL(10,2) NOT NULL,
  `status` ENUM('UNCLAIMED', 'MATCHED') NOT NULL DEFAULT 'UNCLAIMED',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_admin_gcash_ref` (`reference_number`),
  INDEX `idx_admin_gcash_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. Payments Table (Cash vs GCash with validation & mismatch flags)
CREATE TABLE `payments` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `order_id` INT UNSIGNED NOT NULL UNIQUE,
  `payment_method` ENUM('cash', 'gcash') NOT NULL DEFAULT 'cash',
  `amount_expected` DECIMAL(10,2) NOT NULL,
  `amount_paid` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `reference_no` VARCHAR(100) DEFAULT NULL,
  `status` ENUM('pending', 'verified', 'mismatch_flagged', 'completed') NOT NULL DEFAULT 'pending',
  `is_mismatch` TINYINT(1) NOT NULL DEFAULT 0,
  `mismatch_notes` VARCHAR(255) DEFAULT NULL,
  `verified_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE,
  INDEX `idx_payment_status` (`status`),
  INDEX `idx_is_mismatch` (`is_mismatch`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. Delivery Personnel Table (Internal cafe riders)
CREATE TABLE `delivery_personnel` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT UNSIGNED DEFAULT NULL COMMENT 'Optional link to admins_staff for login',
  `full_name` VARCHAR(150) NOT NULL,
  `phone_number` VARCHAR(30) NOT NULL,
  `vehicle_type` ENUM('motorcycle', 'bicycle') NOT NULL DEFAULT 'motorcycle',
  `vehicle_plate_no` VARCHAR(50) DEFAULT NULL,
  `status` ENUM('available', 'on_delivery', 'offline') NOT NULL DEFAULT 'available',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `admins_staff`(`id`) ON DELETE SET NULL,
  INDEX `idx_rider_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. Deliveries Table (Smart Delivery Management & Fare Tracking)
CREATE TABLE `deliveries` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `order_id` INT UNSIGNED NOT NULL UNIQUE,
  `rider_id` INT UNSIGNED DEFAULT NULL,
  `vehicle_type` ENUM('motorcycle', 'bicycle') NOT NULL DEFAULT 'motorcycle',
  `distance_km` DECIMAL(4,2) NOT NULL DEFAULT 1.00,
  `weather_condition` ENUM('sunny', 'light_rain', 'heavy_rain', 'extreme_heat') NOT NULL DEFAULT 'sunny',
  `computed_fare` DECIMAL(10,2) NOT NULL DEFAULT 49.00,
  `final_fare` DECIMAL(10,2) NOT NULL DEFAULT 49.00,
  `is_fare_overridden` TINYINT(1) NOT NULL DEFAULT 0,
  `override_reason` VARCHAR(255) DEFAULT NULL,
  `status` ENUM('pending', 'assigned', 'dispatched', 'delivered', 'failed', 'cancelled') NOT NULL DEFAULT 'pending',
  `estimated_time_min` INT NOT NULL DEFAULT 20,
  `dispatched_at` TIMESTAMP NULL DEFAULT NULL,
  `delivered_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`rider_id`) REFERENCES `delivery_personnel`(`id`) ON DELETE SET NULL,
  INDEX `idx_delivery_status` (`status`),
  INDEX `idx_rider_id` (`rider_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 12. Feedback Table (FR11 - Post-delivery customer ratings and reviews)
CREATE TABLE `feedback` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `order_id` INT UNSIGNED NOT NULL UNIQUE,
  `customer_id` INT UNSIGNED NOT NULL,
  `rating` TINYINT UNSIGNED NOT NULL COMMENT '1 to 5 stars',
  `comments` TEXT DEFAULT NULL,
  `sentiment` ENUM('positive', 'neutral', 'negative') DEFAULT 'positive',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE CASCADE,
  INDEX `idx_rating` (`rating`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 13. Notifications Table (Outbound automated alerts)
CREATE TABLE `notifications` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `recipient_psid` VARCHAR(128) NOT NULL,
  `channel` ENUM('messenger', 'system', 'sms') NOT NULL DEFAULT 'messenger',
  `type` VARCHAR(50) NOT NULL COMMENT 'order_confirmation, preparing, dispatched, delivered, feedback_request',
  `title` VARCHAR(150) NOT NULL,
  `message` TEXT NOT NULL,
  `status` ENUM('pending', 'sent', 'failed') NOT NULL DEFAULT 'sent',
  `sent_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_recipient_psid` (`recipient_psid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 14. Chatbot Logs Table (Audit trail of conversational AI interactions)
CREATE TABLE `chatbot_logs` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `customer_id` INT UNSIGNED DEFAULT NULL,
  `psid` VARCHAR(128) NOT NULL,
  `incoming_message` TEXT DEFAULT NULL,
  `detected_intent` VARCHAR(100) DEFAULT NULL,
  `confidence` DECIMAL(4,3) DEFAULT 1.000,
  `bot_response` TEXT DEFAULT NULL,
  `raw_payload` JSON DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL,
  INDEX `idx_chat_psid` (`psid`),
  INDEX `idx_detected_intent` (`detected_intent`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 15. Promotions & Events Table (Campaign perks, cafe events & mass Messenger broadcasts)
CREATE TABLE IF NOT EXISTS `promotions` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `title` VARCHAR(255) NOT NULL,
  `promo_type` ENUM('Product Discount', 'Bundle / BOGO', 'Cafe Event') NOT NULL DEFAULT 'Product Discount',
  `banner_image_url` VARCHAR(500) DEFAULT NULL,
  `perk_description` VARCHAR(255) NOT NULL,
  `applicable_scope` VARCHAR(255) DEFAULT 'All Menu Items',
  `start_date` DATE DEFAULT NULL,
  `end_date` DATE DEFAULT NULL,
  `description` TEXT DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `broadcast_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `last_broadcast_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_promo_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 16. Store Settings Table (Branch profile, GPS coordinates & dispatch boundaries)
CREATE TABLE IF NOT EXISTS `store_settings` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `gcash_account_name` VARCHAR(255) NOT NULL DEFAULT 'Diner\\'s Cafe',
  `gcash_account_number` VARCHAR(20) NOT NULL DEFAULT '09XXXXXXXXX',
  `gcash_qr_image_url` VARCHAR(500) DEFAULT NULL,
  `store_name` VARCHAR(255) NOT NULL DEFAULT 'Diner\\'s Cafe - Main Branch',
  `store_address` TEXT NOT NULL,
  `store_latitude` DECIMAL(10,8) NOT NULL DEFAULT 14.57940000,
  `store_longitude` DECIMAL(11,8) NOT NULL DEFAULT 121.03590000,
  `max_delivery_radius_km` DECIMAL(4,2) NOT NULL DEFAULT 3.00,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `store_settings` (`id`, `gcash_account_name`, `gcash_account_number`, `gcash_qr_image_url`, `store_name`, `store_address`, `store_latitude`, `store_longitude`, `max_delivery_radius_km`)
VALUES (1, 'Diner\\'s Cafe - Tondo Branch', '09171234567', '/uploads/qr/gcash_qr_CHECKOUT.png', 'Diner\\'s Cafe Tondo', 'Diner\\'s Cafe, Tondo, Manila', 14.61436860, 120.96423340, 3.00)
ON DUPLICATE KEY UPDATE `id` = `id`;


-- ====================================================
-- SEED DATA
-- ====================================================

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
INSERT INTO `menu_items` (`id`, `category_id`, `name`, `description`, `price`, `image_url`, `is_available`, `is_bestseller`, `synonyms`, `preparation_time_min`) VALUES
(1, 1, 'Signature Spanish Latte', 'Double espresso shot with creamy condensed milk and velvety textured milk', 145.00, 'https://images.unsplash.com/photo-1541167760496-1628856ab772?w=500&auto=format&fit=crop&q=60', 1, 1, 'spanish latte, spanish, spanish coffee', 5),
(2, 1, 'Caramel Macchiato', 'Freshly steamed milk with vanilla-flavored syrup, marked with espresso and caramel drizzle', 150.00, 'https://images.unsplash.com/photo-1485808191679-5f86510681a2?w=500&auto=format&fit=crop&q=60', 1, 1, 'macchiato, caramel', 5),
(3, 1, 'Iced Americano', 'Bold rich espresso shots topped with cold water and ice for a crisp finish', 110.00, 'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?w=500&auto=format&fit=crop&q=60', 1, 0, 'americano, iced americano', 4),
(4, 2, 'Kyoto Uji Matcha Latte', 'Ceremonial grade green tea whisked with creamy oat or dairy milk', 160.00, 'https://images.unsplash.com/photo-1536256263959-770b48d82b0a?w=500&auto=format&fit=crop&q=60', 1, 1, 'matcha, matcha latte, kyoto matcha', 6),
(5, 2, 'Hibiscus Berry Iced Tea', 'Refreshing cold brewed botanical tea infused with wild berries and mint', 125.00, 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=500&auto=format&fit=crop&q=60', 1, 0, 'hibiscus, berry tea, iced tea', 4),
(6, 3, 'Classic Beef Tapa Rice Bowl', 'Tender marinated beef sirloin slices, garlic fried rice, and sunny-side-up egg', 195.00, 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=500&auto=format&fit=crop&q=60', 1, 1, 'tapa, beef tapa, tapsilog, rice bowl', 15),
(7, 3, 'Creamy Truffle Bacon Carbonara', 'Fettuccine pasta tossed in rich parmesan truffle cream with crispy bacon bits', 220.00, 'https://images.unsplash.com/photo-1612874742237-6526221588e3?w=500&auto=format&fit=crop&q=60', 1, 1, 'carbonara, pasta, truffle pasta', 15),
(8, 4, 'Almond Butter Croissant', 'Flaky, buttery French croissant filled with rich almond cream and toasted flakes', 95.00, 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=500&auto=format&fit=crop&q=60', 1, 1, 'croissant, almond croissant', 3),
(9, 4, 'Dark Chocolate Chunk Cookie', 'Chewy warm cookie loaded with 70% Belgian dark chocolate chunks and sea salt', 75.00, 'https://images.unsplash.com/photo-1499636136210-6f4ee915583e?w=500&auto=format&fit=crop&q=60', 1, 0, 'cookie, chocolate cookie, choco cookie', 2),
(10, 5, 'Grilled Chicken Pesto Panini', 'Herb-roasted chicken breast, basil pesto, mozzarella on toasted artisan sourdough', 175.00, 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?w=500&auto=format&fit=crop&q=60', 1, 1, 'panini, chicken panini, pesto panini', 10);

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
