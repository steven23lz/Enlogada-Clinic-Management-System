const express = require('express');
const hmoController = require('../controllers/hmoController');
const { verifyToken, authorizeStaff, authorizeRoles, authorizePermissions } = require('../middlewares/auth');
const { uploadHmoCardMiddleware } = require('../config/upload');

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

// Create an HMO request — Reception logs the manual HMO verification at the desk, and a Client
// states their own coverage while booking online. Client was missing here since this line was
// written, so every online booking that selected an HMO provider failed with a 403 after its
// appointment had already been created. Ownership is enforced in hmoService: a Client may only
// file against tests belonging to their own patient profiles. Either way the request starts
// Pending — stating a claim is not granting it, and only Admin/SuperAdmin can approve.
//
// This is one of the routes that keeps an explicit role list rather than `authorizeStaff` [1.20.0]:
// it is reachable by a patient, and the staff/patient boundary is the one a permission tick must
// never be able to cross. The permission still decides which *staff* may file at the desk, so the
// matrix can delegate it; Client holds `hmo:request` for its own, ownership-scoped path.
router.post('/request', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Receptionist', 'Client'), authorizePermissions('hmo:request'), uploadHmoCardMiddleware, hmoController.createRequest);

// The card image behind a claim. Authenticated and ownership-checked in the service, streamed
// rather than served from a static path -- an HMO card carries a name, a member number and often
// a photo. Same treatment as diagnostic result files.
router.get('/request/:id/card', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Receptionist', 'Cashier', 'Client'), authorizePermissions('hmo:read'), hmoController.downloadCard);

// UI/UX Modernization Phase 12: approval is now Admin/SuperAdmin-only — Receptionist could
// previously approve their own request (the same role that creates it), which combined with
// createRequest's old auto-approve-on-code-presence behavior meant HMO coverage was effectively
// self-certified by front-desk staff with no independent check. Receptionist still creates
// requests (above) and can view them (below) — reviewing/approving now happens on Admin's
// existing Service Requests page (frontend/src/pages/admin/ServiceRequests.jsx), not a new one.
router.put('/request/:id/approve', verifyToken, authorizeStaff, authorizePermissions('hmo:approve'), hmoController.approveRequest);

// …and the other half of that decision. [1.28.0] `chk_hmo_status` has allowed 'Rejected' since
// [1.0.0] and no route could set it, so a claim the provider turned down could only be approved
// anyway or left Pending forever — at the top of a worklist that filters on Pending, being
// reopened by every coordinator who scanned it. Same permission as approving: saying no is the
// same authority as saying yes, and splitting them would let an account do one but not the other.
router.put('/request/:id/reject', verifyToken, authorizeStaff, authorizePermissions('hmo:approve'), hmoController.rejectRequest);

// Get HMO request details including linked tests
router.get('/request/:id', verifyToken, authorizeStaff, authorizePermissions('hmo:read'), hmoController.getRequestDetails);

// Update individual test approval status within an HMO request
router.put('/request-test/:hmoRequestTestId', verifyToken, authorizeStaff, authorizePermissions('hmo:approve'), hmoController.updateTestApproval);

module.exports = router;
