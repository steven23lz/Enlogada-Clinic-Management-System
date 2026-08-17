const express = require('express');
const clinicController = require('../controllers/clinicController');

const router = express.Router();

// The clinic's own identity — name, address, contact, and the statutory identifiers printed on a
// receipt. Public and unauthenticated: every one of these already appears on the public site and
// on any receipt handed across the counter, and the login page needs the address before anybody
// has signed in. See clinicController for why this moved off the frontend's build-time env.
router.get('/', clinicController.getIdentity);

module.exports = router;
