const express = require('express');
const hmoController = require('../controllers/hmoController');
const { verifyToken, authorizeRoles } = require('../middlewares/auth');

const router = express.Router();

// Get list of HMO providers
router.get('/providers', verifyToken, hmoController.getProviders);

// Feature Gap Plan Phase A: hmo_providers was entirely read-only — no screen could reflect a new
// partnership or a lapsed accreditation without direct DB access.
router.post('/providers', verifyToken, authorizeRoles('SuperAdmin', 'Admin'), hmoController.createProvider);
router.put('/providers/:id', verifyToken, authorizeRoles('SuperAdmin', 'Admin'), hmoController.updateProvider);

// List all HMO requests, optionally filtered by status — previously nothing let staff discover
// pending requests; approval was only reachable if you already knew a specific request ID.
router.get('/requests', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Receptionist', 'Cashier'), hmoController.getAllRequests);

// Create an HMO request — Reception logs the manual HMO verification at the desk, and a Client
// states their own coverage while booking online. Client was missing here since this line was
// written, so every online booking that selected an HMO provider failed with a 403 after its
// appointment had already been created. Ownership is enforced in hmoService: a Client may only
// file against tests belonging to their own patient profiles. Either way the request starts
// Pending — stating a claim is not granting it, and only Admin/SuperAdmin can approve.
router.post('/request', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Receptionist', 'Client'), hmoController.createRequest);

// UI/UX Modernization Phase 12: approval is now Admin/SuperAdmin-only — Receptionist could
// previously approve their own request (the same role that creates it), which combined with
// createRequest's old auto-approve-on-code-presence behavior meant HMO coverage was effectively
// self-certified by front-desk staff with no independent check. Receptionist still creates
// requests (above) and can view them (below) — reviewing/approving now happens on Admin's
// existing Service Requests page (frontend/src/pages/admin/ServiceRequests.jsx), not a new one.
router.put('/request/:id/approve', verifyToken, authorizeRoles('SuperAdmin', 'Admin'), hmoController.approveRequest);

// Get HMO request details including linked tests
router.get('/request/:id', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Receptionist', 'Cashier'), hmoController.getRequestDetails);

// Update individual test approval status within an HMO request
router.put('/request-test/:hmoRequestTestId', verifyToken, authorizeRoles('SuperAdmin', 'Admin'), hmoController.updateTestApproval);

module.exports = router;
