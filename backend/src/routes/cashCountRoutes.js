const express = require('express');
const cashCountController = require('../controllers/cashCountController');
const { verifyToken, authorizeStaff, authorizePermissions } = require('../middlewares/auth');

const router = express.Router();

// [1.150.0] Reading a count is reading the money, so billing:read: an Admin sees every day and does
// not count. Counting the drawer is what whoever takes the money does, so billing:process.
router.get('/status', verifyToken, authorizeStaff, authorizePermissions('billing:read'), cashCountController.status);
router.get('/day', verifyToken, authorizeStaff, authorizePermissions('billing:read'), cashCountController.day);
router.get('/', verifyToken, authorizeStaff, authorizePermissions('billing:read'), cashCountController.list);
router.post('/', verifyToken, authorizeStaff, authorizePermissions('billing:process'), cashCountController.save);

module.exports = router;
