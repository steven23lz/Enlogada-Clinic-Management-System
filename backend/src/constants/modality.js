/**
 * Single source of truth for the test_category <-> diagnostic-staff-role relationship.
 *
 * This mapping previously existed only as a private const inside resultService.js
 * (STAFF_CATEGORY_MAP). It is now needed in a second place — routing a released ticket's
 * notification to the correct modality department — so it lives here rather than being
 * duplicated, per the backend `constants/` layer in .agents/PROJECT_STRUCTURE.md.
 *
 * Ultrasound Staff covers '2D Echo' as well: a distinct test_categories row that
 * MODULE_SCOPE.md explicitly assigns to that role.
 */

// Role name -> the test_categories this role may act on.
const STAFF_ROLE_TO_CATEGORIES = {
  'Laboratory Staff': ['Laboratory'],
  'Xray Staff': ['Xray'],
  'Ultrasound Staff': ['Ultrasound', '2D Echo']
};

// test_categories.name -> the role that should be notified when a ticket in that category is
// released. 'ECG' is deliberately absent: it is a real seeded category with no dedicated staff
// role, so its tickets are overseen by Admin/SuperAdmin only. Returning undefined for it is
// correct behaviour, not a missing entry.
const CATEGORY_TO_STAFF_ROLE = {
  Laboratory: 'Laboratory Staff',
  Xray: 'Xray Staff',
  Ultrasound: 'Ultrasound Staff',
  '2D Echo': 'Ultrasound Staff'
};

// The categories a diagnostic worklist may legitimately be queried for.
const DIAGNOSTIC_CATEGORIES = ['Laboratory', 'Xray', 'Ultrasound', '2D Echo'];

/**
 * visit_tests.status values a modality staff member is allowed to set themselves.
 *
 * Deliberately excludes 'Processing': a ticket arrives at the modality already Processing,
 * put there by the receptionist/cashier release. Modality staff must not be able to pull an
 * un-released ticket into their own queue.
 */
const MODALITY_SETTABLE_TEST_STATUSES = ['Waiting for Release', 'Completed'];

/** Given a set of category names, the distinct staff roles that own them. */
function staffRolesForCategories(categoryNames = []) {
  const roles = new Set();
  for (const name of categoryNames) {
    const role = CATEGORY_TO_STAFF_ROLE[name];
    if (role) roles.add(role);
  }
  return [...roles];
}

module.exports = {
  STAFF_ROLE_TO_CATEGORIES,
  CATEGORY_TO_STAFF_ROLE,
  DIAGNOSTIC_CATEGORIES,
  MODALITY_SETTABLE_TEST_STATUSES,
  staffRolesForCategories
};
