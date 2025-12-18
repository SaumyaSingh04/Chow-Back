const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { verifyToken } = require('../middleware/auth');

// Admin access middleware
const verifyAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

router.get('/stats', verifyToken, verifyAdmin, dashboardController.getDashboardStats);
router.get('/failed-orders', verifyToken, verifyAdmin, dashboardController.getFailedOrders);

module.exports = router;