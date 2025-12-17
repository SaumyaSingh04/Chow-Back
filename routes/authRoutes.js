const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken, verifyUser } = require('../middleware/auth');

// Public Routes
router.post('/register', authController.userRegister);
router.post('/login', authController.userLogin);

// Protected User Routes
router.get('/profile/:id', verifyToken, authController.userProfile);
router.put('/profile/:id', verifyToken, authController.updateUserProfile);

module.exports = router;