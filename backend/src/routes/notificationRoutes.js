const express = require('express');
const notificationController = require('../controllers/notificationController');
const { verifyToken } = require('../middlewares/auth');

const router = express.Router();

// Self-scoped via the JWT only, like /payments/my-payments and /patients/my-profiles — no role
// restriction needed since every query is already filtered to req.user.userId.
router.get('/', verifyToken, notificationController.getMine);
router.patch('/:id/read', verifyToken, notificationController.markRead);
router.patch('/read-all', verifyToken, notificationController.markAllRead);

module.exports = router;
