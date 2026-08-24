const express = require('express');
const packageController = require('../controllers/packageController');
const { verifyToken, authorizeStaff, authorizePermissions } = require('../middlewares/auth');

const router = express.Router();

// Public, like the test catalogue it draws from — see packageController for why.
router.get('/', packageController.getAll);

// Declared BEFORE any '/:id' route would be, so 'manage' is never swallowed as an id.
router.get('/manage', verifyToken, authorizeStaff, authorizePermissions('tests:manage'), packageController.getAllForManagement);

// Managing packages is the same authority as managing the tests they are made of: a package IS a
// price, and `tests:manage` is already the permission that says who may set one. A separate
// permission would have to be granted alongside it every time, and the first time somebody forgot
// there would be an admin who could reprice a test but not the bundle containing it.
router.post('/', verifyToken, authorizeStaff, authorizePermissions('tests:manage'), packageController.create);
router.put('/:id', verifyToken, authorizeStaff, authorizePermissions('tests:manage'), packageController.update);
router.patch('/:id', verifyToken, authorizeStaff, authorizePermissions('tests:manage'), packageController.update);

module.exports = router;
