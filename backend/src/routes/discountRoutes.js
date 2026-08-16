const express = require('express');
const discountController = require('../controllers/discountController');
const { verifyToken, authorizeStaff, authorizeRoles, authorizePermissions } = require("../middlewares/auth");

const router = express.Router();

// Who may grant a discount.
//
// Cashier and Receptionist both need it: the front desk sees the OSCA/PWD ID at registration, and
// the cashier is the one who checks it against the person standing there. Admin/SuperAdmin are
// included for oversight and corrections.
//
// Note the deliberate asymmetry with payment capture, which stays Cashier/SuperAdmin only
// (paymentRoutes.js): granting a discount and taking the money are separable, and keeping the
// reviewer out of the transaction is the same separation-of-duties reasoning applied elsewhere.
const DISCOUNT_GRANT_ROLES = ['SuperAdmin', 'Admin', 'Cashier', 'Receptionist'];

router.get('/', verifyToken, discountController.getCatalogue);

// The statutory register — the separate record BIR expects for mandated discounts. Registered
// before /:visitId-style routes so 'register' is never matched as a parameter.
router.get(
  '/register',
  verifyToken,
  authorizeStaff,
  authorizePermissions('reports:view'),
  discountController.getStatutoryRegister
);

router.post(
  '/visit/:visitId',
  verifyToken,
  authorizeRoles(...DISCOUNT_GRANT_ROLES),
  discountController.applyToVisit
);
router.delete(
  '/visit/:visitId',
  verifyToken,
  authorizeRoles(...DISCOUNT_GRANT_ROLES),
  discountController.clearFromVisit
);

module.exports = router;
