const express = require('express');
const patientController = require('../controllers/patientController');
const { verifyToken } = require('../middlewares/auth');

const router = express.Router();

router.post('/', verifyToken, patientController.addProfile);
router.get('/my-profiles', verifyToken, patientController.getMyProfiles);
router.get('/types', verifyToken, patientController.getTypes);
router.get('/:id', verifyToken, patientController.getProfileById);
router.put('/:id', verifyToken, patientController.updateProfile);

module.exports = router;
