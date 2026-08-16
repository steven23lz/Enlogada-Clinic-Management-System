const express = require('express');
const hmoController = require('../controllers/hmoController');
const { verifyToken, authorizeStaff, authorizePermissions } = require('../middlewares/auth');

const router = express.Router();

// Get list of HMO providers
router.get('/providers', verifyToken, hmoController.getProviders);

// Feature Gap Plan Phase A: hmo_providers was entirely read-only — no screen could reflect a new
// partnership or a lapsed accreditation without direct DB access.
router.post('/providers', verifyToken, authorizeStaff, authorizePermissions('hmo:approve'), hmoController.createProvider);
router.put('/providers/:id', verifyToken, authorizeStaff, authorizePermissions('hmo:approve'), hmoController.updateProvider);

// List all HMO requests, optionally filtered by status — previously nothing let staff discover
// pending requests; approval was only reachable if you already knew a specific request ID.
router.get('/requests', verifyToken, authorizeStaff, authorizePermissions('hmo:read'), hmoController.getAllRequests);

// Create an HMO request (Receptionist logs the manual HMO verification)
router.post('/request', verifyToken, authorizeStaff, authorizePermissions('hmo:request'), hmoController.createRequest);

// UI/UX Modernization Phase 12: approval is now Admin/SuperAdmin-only — Receptionist could
// previously approve their own request (the same role that creates it), which combined with
// createRequest's old auto-approve-on-code-presence behavior meant HMO coverage was effectively
// self-certified by front-desk staff with no independent check. Receptionist still creates
// requests (above) and can view them (below) — reviewing/approving now happens on Admin's
// existing Service Requests page (frontend/src/pages/admin/ServiceRequests.jsx), not a new one.
router.put('/request/:id/approve', verifyToken, authorizeStaff, authorizePermissions('hmo:approve'), hmoController.approveRequest);

// Get HMO request details including linked tests
router.get('/request/:id', verifyToken, authorizeStaff, authorizePermissions('hmo:read'), hmoController.getRequestDetails);

// Update individual test approval status within an HMO request
router.put('/request-test/:hmoRequestTestId', verifyToken, authorizeStaff, authorizePermissions('hmo:approve'), hmoController.updateTestApproval);

module.exports = router;
