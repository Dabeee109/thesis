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
const promotionController = require('../controllers/promotionController');
const xenditController = require('../controllers/xenditController');
const webhookController = require('../controllers/webhookController');
const inventoryRoutes = require('./inventoryRoutes');
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
router.post('/auth/forgot-password/send-otp', authController.requestPasswordResetOtp);
router.post('/auth/forgot-password/reset', authController.resetPasswordWithOtp);
router.get('/auth/me', authController.authMiddleware, authController.getProfile);
router.get('/auth/users', authController.authMiddleware, authController.requireAdmin, authController.getAllUsers);
router.post('/auth/users', authController.authMiddleware, authController.requireAdmin, authController.register);
router.put('/auth/users/:id', authController.authMiddleware, authController.requireAdmin, authController.updateUser);
router.put('/auth/users/:id/password', authController.authMiddleware, authController.requireAdmin, authController.updateUserPassword);
router.patch('/auth/users/:id/toggle-status', authController.authMiddleware, authController.requireAdmin, authController.toggleUserStatus);

// 2. Menu Management Routes (FR2, FR8)
router.get('/menu', menuController.getMenu);
router.get('/admin/menu', menuController.getMenu);
router.post('/menu', authController.authMiddleware, menuController.createMenuItem);
router.post('/admin/menu', authController.authMiddleware, menuController.createMenuItem);
router.post('/menu/upload-image', authController.authMiddleware, menuController.uploadMenuImage);
router.put('/menu/:id', authController.authMiddleware, menuController.updateMenuItem);
router.put('/admin/menu/:id', authController.authMiddleware, menuController.updateMenuItem);
router.patch('/menu/:id/toggle-availability', authController.authMiddleware, menuController.toggleAvailability);
router.patch('/menu/:id/stock', authController.authMiddleware, menuController.updateMenuItemStock);
router.delete('/menu/:id', authController.authMiddleware, menuController.deleteMenuItem);
router.delete('/admin/menu/:id', authController.authMiddleware, menuController.deleteMenuItem);

// 3. Order Operations Routes (FR3, FR4, FR7)
router.get('/orders', authController.authMiddleware, orderController.getOrders);
router.get('/orders/summary/kpis', authController.authMiddleware, orderController.getSummaryKPIs);
router.get('/orders/:id', authController.authMiddleware, orderController.getOrder);
router.patch('/orders/:id/status', authController.authMiddleware, orderController.changeOrderStatus);
router.put('/orders/:id/status', authController.authMiddleware, orderController.changeOrderStatus);
router.post('/orders', authController.authMiddleware, orderController.createManualOrder);
router.post('/orders/manual', authController.authMiddleware, orderController.createManualOrder);
router.post('/orders/:id/cancel', authController.authMiddleware, orderController.cancelOrder);
router.post('/admin/orders/:id/cancel', authController.authMiddleware, orderController.cancelOrder);
router.post('/orders/:id/verify-payment', authController.authMiddleware, orderController.verifyPayment);
router.post('/orders/:id/invalid-payment', authController.authMiddleware, orderController.invalidPayment);
router.post('/orders/:id/reject-payment', authController.authMiddleware, orderController.rejectPayment);
router.post('/payment/xendit/webhook', xenditController.handleWebhook);
router.get('/payment/xendit/status', xenditController.getStatus);
router.post('/payment/gcash/sms-webhook', webhookController.gcashSmsWebhook);
router.post('/orders/:id/request-void', authController.authMiddleware, orderController.requestVoid);
router.post('/orders/:id/authorize-void', authController.authMiddleware, orderController.authorizeVoid);
router.post('/orders/:id/reject-void', authController.authMiddleware, orderController.rejectVoid);
router.post('/orders/:id/approve-cancellation', authController.authMiddleware, orderController.approveCancellation);
router.post('/orders/:id/decline-cancellation', authController.authMiddleware, orderController.declineCancellation);

// 4. Smart Delivery Management Routes (FR6)
router.get('/deliveries', authController.authMiddleware, deliveryController.getDeliveries);
router.get('/riders', authController.authMiddleware, deliveryController.getRiders);
router.get('/rider/active-orders', deliveryController.getActiveRiderOrders);
router.get('/rider/orders/active', deliveryController.getActiveRiderOrders);
router.post('/rider/orders/:id/complete', deliveryController.completeRiderDelivery);
router.get('/rider/history', deliveryController.getRiderHistory);
router.post('/deliveries/compute-fare', deliveryController.computeFare);
router.post('/delivery/calculate-fare', deliveryController.calculateFareFromAddress);
router.post('/deliveries/assign-rider', authController.authMiddleware, deliveryController.assignRider);
router.patch('/deliveries/:id/override-fare', authController.authMiddleware, deliveryController.overrideFare);
router.post('/delivery/quote', quoteLimiter, deliveryQuoteController.getQuote);
router.get('/delivery/service-area', deliveryQuoteController.getServiceArea);

// 5. Promotions & Events Management Routes (Replaces legacy Inventory UI)
router.get('/promotions/active', promotionController.getActivePromotions);
router.get('/promotions', promotionController.getPromotions);
router.get('/promotions/:id', promotionController.getPromotionById);
router.post('/promotions', authController.authMiddleware, promotionController.createPromotion);
router.put('/promotions/:id', authController.authMiddleware, promotionController.updatePromotion);
router.patch('/promotions/:id/toggle', authController.authMiddleware, promotionController.togglePromotionStatus);
router.delete('/promotions/:id', authController.authMiddleware, promotionController.deletePromotion);
router.post('/promotions/upload-poster', authController.authMiddleware, promotionController.uploadPromotionPoster);
router.get('/admin/promotions/recipients-count', authController.authMiddleware, promotionController.getBroadcastRecipientsCount);
router.post('/admin/promotions/:id/broadcast', authController.authMiddleware, promotionController.broadcastPromotion);
router.post('/promotions/:id/broadcast', authController.authMiddleware, promotionController.broadcastPromotion);

// Background Inventory & BOM Recipe Management Routes
router.get('/inventory', authController.authMiddleware, inventoryController.getInventory);
router.post('/inventory/restock', authController.authMiddleware, inventoryController.restock);
router.get('/inventory/logs', authController.authMiddleware, inventoryController.getInventoryLogs);
router.use('/inventory', inventoryRoutes);

// 6. Feedback & Ratings Routes (FR11)
router.get('/feedback', authController.authMiddleware, feedbackController.getFeedback);
router.post('/feedback', feedbackController.submitFeedback);

// 7. Reports & Business Analytics Routes (FR10)
router.get('/reports/sales', authController.authMiddleware, reportController.getSalesReport);
router.get('/analytics/reports', authController.authMiddleware, reportController.getSalesReport);
router.get('/reports/transactions-by-method', authController.authMiddleware, reportController.getTransactionsByMethod);
router.get('/analytics/transactions-by-method', authController.authMiddleware, reportController.getTransactionsByMethod);
router.get('/analytics/overview', authController.authMiddleware, orderController.getSummaryKPIs);
router.get('/reports/delivery', authController.authMiddleware, reportController.getDeliveryReport);
router.get('/reports/export-csv', authController.authMiddleware, reportController.exportOrdersCSV);

// 8. Chatbot Logs & Interactive Simulator Routes (FR5, FR9)
router.get('/chatbot/logs', authController.authMiddleware, chatbotController.getChatbotLogs);
router.post('/chatbot/simulate', chatbotController.simulateMessage);
router.get('/chatbot/session', chatbotController.getSimulatorSession);
router.get('/chatbot/status', chatbotController.getStatus);
router.post('/chatbot/toggle', authController.authMiddleware, chatbotController.toggleStatus);
router.post('/chatbot/fast-forward-inactivity', chatbotController.fastForwardInactivity);

// 9. System Settings & Integration Routes
router.get('/settings/facebook', authController.authMiddleware, authController.requireAdmin, settingsController.getFacebookSettings);
router.put('/settings/facebook', authController.authMiddleware, authController.requireAdmin, settingsController.updateFacebookSettings);
router.post('/settings/facebook/test', authController.authMiddleware, authController.requireAdmin, settingsController.testFacebookToken);

// Store Branch & Delivery Location & GCash Settings
router.get('/admin/settings/general', authController.authMiddleware, authController.requireAdmin, settingsController.getGeneralSettings);
router.get('/settings/general', authController.authMiddleware, authController.requireAdmin, settingsController.getGeneralSettings);
router.put('/admin/settings/gcash', authController.authMiddleware, authController.requireAdmin, settingsController.qrUpload.any(), settingsController.updateGcashSettings);
router.put('/settings/gcash', authController.authMiddleware, authController.requireAdmin, settingsController.qrUpload.any(), settingsController.updateGcashSettings);
router.get('/admin/settings/location', authController.authMiddleware, authController.requireAdmin, settingsController.getStoreLocationSettings);
router.put('/admin/settings/location', authController.authMiddleware, authController.requireAdmin, settingsController.updateStoreLocationSettings);
router.get('/settings/location', authController.authMiddleware, authController.requireAdmin, settingsController.getStoreLocationSettings);
router.put('/settings/location', authController.authMiddleware, authController.requireAdmin, settingsController.updateStoreLocationSettings);
router.get('/store/location/public', settingsController.getPublicStoreLocation);

// Store Operating Hours & Live Interactive Operational Status
router.get('/settings/operating-hours', settingsController.getOperatingHoursSettings);
router.get('/admin/settings/operating-hours', authController.authMiddleware, authController.requireAdmin, settingsController.getOperatingHoursSettings);
router.put('/settings/operating-hours', authController.authMiddleware, authController.requireAdmin, settingsController.updateOperatingHoursSettings);
router.put('/admin/settings/operating-hours', authController.authMiddleware, authController.requireAdmin, settingsController.updateOperatingHoursSettings);

router.get('/settings/store-status', settingsController.getStoreStatus);
router.get('/admin/settings/store-status', settingsController.getStoreStatus);
router.put('/settings/store-status', authController.authMiddleware, authController.requireAdmin, settingsController.updateStoreStatus);
router.put('/admin/settings/store-status', authController.authMiddleware, authController.requireAdmin, settingsController.updateStoreStatus);

// Delivery Fare Matrix Settings (Requirement 2)
router.get('/admin/fare-settings', authController.authMiddleware, settingsController.getFareSettings);
router.put('/admin/fare-settings', authController.authMiddleware, authController.requireAdmin, settingsController.updateFareSettings);
router.get('/settings/fare-matrix', settingsController.getFareSettings);

module.exports = router;
