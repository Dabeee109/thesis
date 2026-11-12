-- ============================================================================
-- Migration: Inventory & Recipe Management Subsystem (Bill of Materials / BOM)
-- Target Dialect: MySQL 8.0 / TiDB Cloud
-- Note: References existing `menu_items(id)` and `orders(id)` primary keys.
-- ============================================================================

-- 1. Raw Ingredients Table
CREATE TABLE IF NOT EXISTS `ingredients` (
  `ingredient_id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(100) NOT NULL UNIQUE,
  `unit` VARCHAR(20) NOT NULL COMMENT 'e.g., g, ml, pcs',
  `stock_quantity` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  `reorder_level` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  `cost_per_unit` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_ingredient_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Recipe Items Table (Maps sellable menu items to required raw ingredients)
CREATE TABLE IF NOT EXISTS `recipe_items` (
  `recipe_id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `menu_id` INT UNSIGNED NOT NULL,
  `ingredient_id` INT UNSIGNED NOT NULL,
  `quantity_required` DECIMAL(10, 2) NOT NULL COMMENT 'Amount consumed per 1 order of this menu item',
  UNIQUE KEY `uq_menu_ingredient` (`menu_id`, `ingredient_id`),
  FOREIGN KEY (`menu_id`) REFERENCES `menu_items`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients`(`ingredient_id`) ON DELETE CASCADE,
  INDEX `idx_recipe_menu_id` (`menu_id`),
  INDEX `idx_recipe_ingredient_id` (`ingredient_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Ingredient Audit Logs Table
CREATE TABLE IF NOT EXISTS `ingredient_logs` (
  `log_id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `ingredient_id` INT UNSIGNED NOT NULL,
  `change_amount` DECIMAL(10, 2) NOT NULL COMMENT 'Negative for deductions, positive for restocks',
  `change_type` ENUM('order_deduction', 'restock', 'spoilage_waste', 'adjustment') NOT NULL,
  `reference_order_id` INT UNSIGNED DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients`(`ingredient_id`) ON DELETE CASCADE,
  FOREIGN KEY (`reference_order_id`) REFERENCES `orders`(`id`) ON DELETE SET NULL,
  INDEX `idx_ingredient_log_ing` (`ingredient_id`),
  INDEX `idx_ingredient_log_order` (`reference_order_id`),
  INDEX `idx_ingredient_log_type` (`change_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Seed Data: Sample Raw Ingredients & Recipes for 3 Menu Items
--   1. Caramel Macchiato (Coffee)
--   2. Brown Sugar Milktea (Milktea)
--   3. Meaty Dog (Food)
-- ============================================================================

INSERT INTO `ingredients` (`name`, `unit`, `stock_quantity`, `reorder_level`, `cost_per_unit`)
VALUES
  ('Espresso Beans', 'g', 5000.00, 500.00, 1.80),
  ('Full Cream Milk', 'ml', 10000.00, 1500.00, 0.12),
  ('Caramel Syrup', 'ml', 3000.00, 300.00, 0.45),
  ('16oz Cup', 'pcs', 500.00, 50.00, 3.50),
  ('Black Tea Concentrate', 'ml', 6000.00, 1000.00, 0.08),
  ('Brown Sugar Syrup', 'ml', 3000.00, 300.00, 0.38),
  ('Tapioca Pearls', 'g', 4000.00, 500.00, 0.18),
  ('Hotdog Bun', 'pcs', 200.00, 30.00, 10.00),
  ('Jumbo Sausage', 'pcs', 200.00, 30.00, 28.00),
  ('Beef Chili Sauce', 'g', 5000.00, 600.00, 0.35),
  ('Grated Cheese', 'g', 3000.00, 400.00, 0.55)
ON DUPLICATE KEY UPDATE `unit` = VALUES(`unit`);

-- Recipe 1: Caramel Macchiato (18g Espresso Beans, 200ml Full Cream Milk, 30ml Caramel Syrup, 1pcs 16oz Cup)
INSERT IGNORE INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`)
SELECT m.id, i.ingredient_id, req.qty
FROM `menu_items` m
JOIN (
  SELECT 'Espresso Beans' AS ing_name, 18.00 AS qty UNION ALL
  SELECT 'Full Cream Milk', 200.00 UNION ALL
  SELECT 'Caramel Syrup', 30.00 UNION ALL
  SELECT '16oz Cup', 1.00
) req
JOIN `ingredients` i ON i.name = req.ing_name
WHERE LOWER(m.name) = 'caramel macchiato';

-- Recipe 2: Brown Sugar Milktea (150ml Black Tea Concentrate, 120ml Full Cream Milk, 35ml Brown Sugar Syrup, 50g Tapioca Pearls, 1pcs 16oz Cup)
INSERT IGNORE INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`)
SELECT m.id, i.ingredient_id, req.qty
FROM `menu_items` m
JOIN (
  SELECT 'Black Tea Concentrate' AS ing_name, 150.00 AS qty UNION ALL
  SELECT 'Full Cream Milk', 120.00 UNION ALL
  SELECT 'Brown Sugar Syrup', 35.00 UNION ALL
  SELECT 'Tapioca Pearls', 50.00 UNION ALL
  SELECT '16oz Cup', 1.00
) req
JOIN `ingredients` i ON i.name = req.ing_name
WHERE LOWER(m.name) = 'brown sugar milktea';

-- Recipe 3: Meaty Dog (1pcs Hotdog Bun, 1pcs Jumbo Sausage, 60g Beef Chili Sauce, 25g Grated Cheese)
INSERT IGNORE INTO `recipe_items` (`menu_id`, `ingredient_id`, `quantity_required`)
SELECT m.id, i.ingredient_id, req.qty
FROM `menu_items` m
JOIN (
  SELECT 'Hotdog Bun' AS ing_name, 1.00 AS qty UNION ALL
  SELECT 'Jumbo Sausage', 1.00 UNION ALL
  SELECT 'Beef Chili Sauce', 60.00 UNION ALL
  SELECT 'Grated Cheese', 25.00
) req
JOIN `ingredients` i ON i.name = req.ing_name
WHERE LOWER(m.name) = 'meaty dog';

