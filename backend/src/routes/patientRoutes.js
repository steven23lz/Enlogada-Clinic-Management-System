const express = require('express');
const patientController = require('../controllers/patientController');
const { verifyToken, authorizeRoles } = require('../middlewares/auth');

const router = express.Router();

router.post('/', verifyToken, patientController.addProfile);
router.get('/my-profiles', verifyToken, patientController.getMyProfiles);
router.get('/types', verifyToken, patientController.getTypes);
// Staff lookup of existing patient records by name — must be registered before /:id so
// Express doesn't match "search" itself as an :id param.
router.get('/search', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Receptionist'), patientController.search);
router.get('/:id', verifyToken, patientController.getProfileById);
router.put('/:id', verifyToken, patientController.updateProfile);

module.exports = router;
