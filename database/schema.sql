-- ==============================================================================
-- Diner's Cafe Ordering & Delivery System - Centralized MySQL Database Schema
-- Target: MySQL 5.7+ / MariaDB 10.3+ / Modern LAMP Environment
-- ==============================================================================

CREATE DATABASE IF NOT EXISTS `diners_cafe_db` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
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
DROP TABLE IF EXISTS `ingredient_logs`;
DROP TABLE IF EXISTS `recipe_items`;
DROP TABLE IF EXISTS `ingredients`;
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
  `status` ENUM('pending', 'preparing', 'dispatched', 'delivered', 'cancelled', 'voided', 'PAID', 'FOR_CONFIRMATION', 'PENDING_ADMIN_QUOTE', 'cancellation_requested', 'CANCELLATION_REQUESTED') NOT NULL DEFAULT 'pending',
  `subtotal` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `delivery_fee` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `total_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `delivery_address` TEXT DEFAULT NULL,
  `customer_phone` VARCHAR(50) DEFAULT NULL,
  `payment_proof_image` VARCHAR(500) DEFAULT NULL,
  `payment_ref_number` VARCHAR(100) DEFAULT NULL,
  `payment_status` ENUM('Pending', 'Pending Verification', 'Paid', 'Failed') NOT NULL DEFAULT 'Pending',
  `distance_km` DECIMAL(4,2) DEFAULT 1.00,
  `landmark` VARCHAR(255) DEFAULT NULL,
  `dining_mode` VARCHAR(50) DEFAULT 'Delivery',
  `arriving_time` VARCHAR(100) DEFAULT NULL,
  `customer_notes` TEXT DEFAULT NULL,
  `note` TEXT DEFAULT NULL,
  `is_preorder` TINYINT(1) NOT NULL DEFAULT 0,
  `cancellation_reason` VARCHAR(255) DEFAULT NULL,
  `feedback_requested_at` DATETIME DEFAULT NULL COMMENT 'Timestamp when post-delivery feedback prompt was requested',
  `gcash_ref` VARCHAR(100) DEFAULT NULL COMMENT 'Verified GCash reference number',
  `receipt_url` TEXT DEFAULT NULL COMMENT 'Attached receipt image URL or path',
  `cancel_requested` TINYINT(1) DEFAULT 0 COMMENT 'Customer requested cancellation within 5-min grace period',
  `cancel_requested_at` DATETIME DEFAULT NULL COMMENT 'Timestamp when cancellation was requested',
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

-- 8B. Raw Ingredients Table (BOM / Recipe Inventory)
CREATE TABLE `ingredients` (
  `ingredient_id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(120) NOT NULL UNIQUE,
  `category` ENUM('Beverage Base & Syrups', 'Dairy & Toppings', 'Meat & Poultry', 'Bread, Dough & Pasta', 'Produce & Pantry', 'Packaging') NOT NULL DEFAULT 'Produce & Pantry',
  `unit` ENUM('g', 'ml', 'pcs') NOT NULL,
  `stock_quantity` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  `reorder_level` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  `cost_per_unit` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_ingredient_name` (`name`),
  INDEX `idx_ingredient_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8C. Menu Item Recipe / Bill of Materials Mapping Table
CREATE TABLE `recipe_items` (
  `recipe_id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `menu_id` INT UNSIGNED NOT NULL,
  `ingredient_id` INT UNSIGNED NOT NULL,
  `quantity_required` DECIMAL(10, 2) NOT NULL,
  UNIQUE KEY `uq_menu_ingredient` (`menu_id`, `ingredient_id`),
  FOREIGN KEY (`menu_id`) REFERENCES `menu_items`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients`(`ingredient_id`) ON DELETE CASCADE,
  INDEX `idx_recipe_menu_id` (`menu_id`),
  INDEX `idx_recipe_ingredient_id` (`ingredient_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8D. Ingredient Stock Audit Logs Table
CREATE TABLE `ingredient_logs` (
  `log_id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `ingredient_id` INT UNSIGNED NOT NULL,
  `change_amount` DECIMAL(10, 2) NOT NULL,
  `change_type` ENUM('order_deduction', 'restock', 'spoilage_waste', 'adjustment') NOT NULL,
  `reference_order_id` INT UNSIGNED NULL,
  `notes` VARCHAR(255) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients`(`ingredient_id`) ON DELETE CASCADE,
  FOREIGN KEY (`reference_order_id`) REFERENCES `orders`(`id`) ON DELETE SET NULL,
  INDEX `idx_ingredient_log_ing` (`ingredient_id`),
  INDEX `idx_ingredient_log_order` (`reference_order_id`),
  INDEX `idx_ingredient_log_type` (`change_type`)
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
  `payment_method` ENUM('cash', 'gcash', 'xendit') NOT NULL DEFAULT 'cash',
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
  `gcash_account_name` VARCHAR(255) NOT NULL DEFAULT 'Diner''s Cafe',
  `gcash_account_number` VARCHAR(20) NOT NULL DEFAULT '09XXXXXXXXX',
  `gcash_qr_image_url` VARCHAR(500) DEFAULT NULL,
  `store_name` VARCHAR(255) NOT NULL DEFAULT 'Diner''s Cafe - Main Branch',
  `store_address` TEXT NOT NULL,
  `store_latitude` DECIMAL(10,8) NOT NULL DEFAULT 14.57940000,
  `store_longitude` DECIMAL(11,8) NOT NULL DEFAULT 121.03590000,
  `max_delivery_radius_km` DECIMAL(4,2) NOT NULL DEFAULT 3.00,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `store_settings` (`id`, `gcash_account_name`, `gcash_account_number`, `gcash_qr_image_url`, `store_name`, `store_address`, `store_latitude`, `store_longitude`, `max_delivery_radius_km`)
VALUES (1, 'Diner''s Cafe - Tondo Branch', '09171234567', '/uploads/qr/gcash_qr_CHECKOUT.png', 'Diner''s Cafe Tondo', 'Diner''s Cafe, Tondo, Manila', 14.61436860, 120.96423340, 3.00)
ON DUPLICATE KEY UPDATE `id` = `id`;
