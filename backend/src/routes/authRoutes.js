const express = require('express');
const authController = require('../controllers/authController');
const { verifyToken } = require('../middlewares/auth');
const { uploadAvatarMiddleware } = require('../config/upload');

const router = express.Router();

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.post('/google', authController.googleLogin);
router.get('/me', verifyToken, authController.getProfile);
router.put('/me', verifyToken, authController.updateProfile);
router.put('/change-password', verifyToken, authController.changePassword);
router.post('/me/avatar', verifyToken, uploadAvatarMiddleware, authController.uploadAvatar);
router.delete('/me/avatar', verifyToken, authController.deleteAvatar);
router.get('/me/avatar', verifyToken, authController.getAvatarFile);

module.exports = router;
