/**
 * Admin Inventory & Recipe Management (BOM) Routes
 * Mounted under `/api/inventory` via `src/routes/api.js`.
 */

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const inventoryController = require('../controllers/inventoryController');

// Raw Ingredients Management
router.get('/ingredients', authController.authMiddleware, inventoryController.getIngredients);
router.post('/ingredients', authController.authMiddleware, inventoryController.addIngredient);
router.put('/ingredients/:id', authController.authMiddleware, inventoryController.updateIngredient);
router.patch('/ingredients/:id', authController.authMiddleware, inventoryController.updateIngredient);
router.patch('/ingredients/:id/restock', authController.authMiddleware, inventoryController.restockRawIngredient);

// Menu Item BOM / Recipe Mapping
router.get('/recipes/:menuId', authController.authMiddleware, inventoryController.getRecipe);
router.post('/recipes', authController.authMiddleware, inventoryController.saveRecipe);

module.exports = router;

