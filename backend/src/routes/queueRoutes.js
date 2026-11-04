const express = require('express');
const queueController = require('../controllers/queueController');
const { verifyToken, authorizeStaff } = require('../middlewares/auth');

const router = express.Router();

// PUBLIC: the waiting-room screen. [1.149.0] A TV needs no account, and this returns a ticket
// number, a station and a time for each call: no name, no visit id, no test. The privacy control is
// the SELECT in queueCallRepository.findTodays and the copy in utils/nowServing.js.
router.get('/now-serving', queueController.nowServing);

// Which permission a call needs depends on the station it is to, so the service decides.
router.post('/calls', verifyToken, authorizeStaff, queueController.call);

module.exports = router;
