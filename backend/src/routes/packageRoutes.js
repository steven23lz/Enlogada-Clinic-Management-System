const express = require('express');
const packageController = require('../controllers/packageController');

const router = express.Router();

// Public, like the test catalogue it draws from — see packageController for why.
router.get('/', packageController.getAll);

module.exports = router;
