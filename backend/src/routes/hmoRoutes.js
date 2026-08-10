const express = require('express');
const hmoController = require('../controllers/hmoController');
const { verifyToken, authorizeRoles } = require('../middlewares/auth');

const router = express.Router();

// Get list of HMO providers
router.get('/providers', verifyToken, hmoController.getProviders);

// List all HMO requests, optionally filtered by status — previously nothing let staff discover
// pending requests; approval was only reachable if you already knew a specific request ID.
router.get('/requests', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Receptionist', 'Cashier'), hmoController.getAllRequests);

// Create an HMO request (Receptionist logs the manual HMO verification)
router.post('/request', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Receptionist'), hmoController.createRequest);

// Approve an HMO request with an approval code
router.put('/request/:id/approve', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Receptionist'), hmoController.approveRequest);

// Get HMO request details including linked tests
router.get('/request/:id', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Receptionist', 'Cashier'), hmoController.getRequestDetails);

// Update individual test approval status within an HMO request
router.put('/request-test/:hmoRequestTestId', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Receptionist'), hmoController.updateTestApproval);

module.exports = router;
