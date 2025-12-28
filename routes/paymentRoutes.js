const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

router.post('/create-order', paymentController.createOrder);
router.post('/verify', paymentController.verifyPayment);
router.post('/failure', paymentController.handlePaymentFailure);
router.post('/webhook', express.raw({ type: 'application/json' }), paymentController.razorpayWebhook);
router.post('/confirm', paymentController.confirmPayment);
router.post('/fix-inconsistent', paymentController.fixInconsistentOrders);
router.post('/clean-failed', paymentController.cleanFailedOrders);

module.exports = router;