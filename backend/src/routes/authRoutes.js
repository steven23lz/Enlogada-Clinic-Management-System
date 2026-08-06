const express = require('express');
const authController = require('../controllers/authController');
const { verifyToken } = require('../middlewares/auth');

const router = express.Router();

router.post('/register', authController.register);
router.post('/login', authController.login);
router.get('/me', verifyToken, authController.getProfile);

module.exports = router;
