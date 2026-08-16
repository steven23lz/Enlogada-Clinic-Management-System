const express = require('express');
const patientController = require('../controllers/patientController');
const { verifyToken, authorizeStaff, authorizeRoles, authorizePermissions } = require('../middlewares/auth');

const router = express.Router();

// Who may touch a patient record directly.
//
// READ covers the roles that need demographics to do their job at the desk: front office,
// billing, oversight, and a Client for their own profiles (ownership re-checked in the
// controller). Diagnostic staff are deliberately absent — they receive the demographics they
// need through the category-scoped worklist queries in resultRepository, which only ever return
// patients whose tests belong to their own department.
//
// WRITE additionally drops Cashier: billing has no reason to alter a patient's identity.
//
// Both routes previously carried verifyToken alone. The ownership check lives in the controller
// and reads `if (req.user.roles.includes('Client') && ...)`, so it is a no-op for every non-Client
// role — meaning any staff token, including the lowest-privilege diagnostic ones, could walk the
// integer id space with GET /api/patients/1,2,3… to dump the entire patient roster, and could PUT
// to rewrite another patient's name, birthdate and sex. Birthdate and sex are the fields
// diagnostic reference ranges key off, so that write is a clinical-safety issue, not just a
// privacy one. Note the inconsistency this sat next to: /search was already restricted.
const PATIENT_READ_ROLES = ['SuperAdmin', 'Admin', 'Receptionist', 'Cashier', 'Client'];
const PATIENT_WRITE_ROLES = ['SuperAdmin', 'Admin', 'Receptionist', 'Client'];

router.post('/', verifyToken, authorizeRoles(...PATIENT_WRITE_ROLES), authorizePermissions('patients:create'), patientController.addProfile);
router.get('/my-profiles', verifyToken, patientController.getMyProfiles);
router.get('/types', verifyToken, patientController.getTypes);
// Staff lookup of existing patient records by name — must be registered before /:id so
// Express doesn't match "search" itself as an :id param.
router.get('/search', verifyToken, authorizeStaff, authorizePermissions('patients:read'), patientController.search);
router.get('/:id', verifyToken, authorizeRoles(...PATIENT_READ_ROLES), authorizePermissions('patients:read'), patientController.getProfileById);
router.put('/:id', verifyToken, authorizeRoles(...PATIENT_WRITE_ROLES), authorizePermissions('patients:update'), patientController.updateProfile);

module.exports = router;
