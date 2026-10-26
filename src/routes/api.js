const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const menuController = require('../controllers/menuController');
const orderController = require('../controllers/orderController');
const deliveryController = require('../controllers/deliveryController');
const inventoryController = require('../controllers/inventoryController');
const feedbackController = require('../controllers/feedbackController');
const reportController = require('../controllers/reportController');
const chatbotController = require('../controllers/chatbotController');
const deliveryQuoteController = require('../controllers/deliveryQuoteController');
const settingsController = require('../controllers/settingsController');
const rateLimit = require('express-rate-limit');

const quoteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    return res.status(429).json({
      success: false,
      code: 'RATE_LIMITED',
      message: 'Too many delivery quote requests. Please wait a moment before trying again.',
      details: {}
    });
  }
});

// 1. Authentication & Staff Account Management Routes (FR1)
router.post('/auth/login', authController.login);
router.post('/auth/register', authController.register);
router.get('/auth/me', authController.authMiddleware, authController.getProfile);
router.get('/auth/users', authController.authMiddleware, authController.requireAdmin, authController.getAllUsers);
router.post('/auth/users', authController.authMiddleware, authController.requireAdmin, authController.register);
router.put('/auth/users/:id', authController.authMiddleware, authController.requireAdmin, authController.updateUser);
router.put('/auth/users/:id/password', authController.authMiddleware, authController.requireAdmin, authController.updateUserPassword);
router.patch('/auth/users/:id/toggle-status', authController.authMiddleware, authController.requireAdmin, authController.toggleUserStatus);

// 2. Menu Management Routes (FR2, FR8)
router.get('/menu', menuController.getMenu);
router.post('/menu', authController.authMiddleware, menuController.createMenuItem);
router.put('/menu/:id', authController.authMiddleware, menuController.updateMenuItem);
router.patch('/menu/:id/toggle-availability', authController.authMiddleware, menuController.toggleAvailability);
router.delete('/menu/:id', authController.authMiddleware, menuController.deleteMenuItem);

// 3. Order Operations Routes (FR3, FR4, FR7)
router.get('/orders', authController.authMiddleware, orderController.getOrders);
router.get('/orders/summary/kpis', authController.authMiddleware, orderController.getSummaryKPIs);
router.get('/orders/:id', authController.authMiddleware, orderController.getOrder);
router.patch('/orders/:id/status', authController.authMiddleware, orderController.changeOrderStatus);
router.post('/orders/manual', authController.authMiddleware, orderController.createManualOrder);
router.post('/orders/:id/request-void', authController.authMiddleware, orderController.requestVoid);
router.post('/orders/:id/authorize-void', authController.authMiddleware, orderController.authorizeVoid);
router.post('/orders/:id/reject-void', authController.authMiddleware, orderController.rejectVoid);

// 4. Smart Delivery Management Routes (FR6)
router.get('/deliveries', authController.authMiddleware, deliveryController.getDeliveries);
router.get('/riders', authController.authMiddleware, deliveryController.getRiders);
router.post('/deliveries/compute-fare', deliveryController.computeFare);
router.post('/deliveries/assign-rider', authController.authMiddleware, deliveryController.assignRider);
router.patch('/deliveries/:id/override-fare', authController.authMiddleware, deliveryController.overrideFare);
router.post('/delivery/quote', quoteLimiter, deliveryQuoteController.getQuote);
router.get('/delivery/service-area', deliveryQuoteController.getServiceArea);

// 5. Inventory Management Routes (FR8)
router.get('/inventory', authController.authMiddleware, inventoryController.getInventory);
router.post('/inventory/restock', authController.authMiddleware, inventoryController.restock);
router.get('/inventory/logs', authController.authMiddleware, inventoryController.getInventoryLogs);

// 6. Feedback & Ratings Routes (FR11)
router.get('/feedback', authController.authMiddleware, feedbackController.getFeedback);
router.post('/feedback', feedbackController.submitFeedback);

// 7. Reports & Business Analytics Routes (FR10)
router.get('/reports/sales', authController.authMiddleware, reportController.getSalesReport);
router.get('/reports/delivery', authController.authMiddleware, reportController.getDeliveryReport);
router.get('/reports/export-csv', authController.authMiddleware, reportController.exportOrdersCSV);

// 8. Chatbot Logs & Interactive Simulator Routes (FR5, FR9)
router.get('/chatbot/logs', authController.authMiddleware, chatbotController.getChatbotLogs);
router.post('/chatbot/simulate', chatbotController.simulateMessage);
router.get('/chatbot/session', chatbotController.getSimulatorSession);
router.get('/chatbot/status', chatbotController.getStatus);
router.post('/chatbot/toggle', authController.authMiddleware, chatbotController.toggleStatus);

// 9. System Settings & Integration Routes
router.get('/settings/facebook', authController.authMiddleware, authController.requireAdmin, settingsController.getFacebookSettings);
router.put('/settings/facebook', authController.authMiddleware, authController.requireAdmin, settingsController.updateFacebookSettings);
router.post('/settings/facebook/test', authController.authMiddleware, authController.requireAdmin, settingsController.testFacebookToken);

module.exports = router;
