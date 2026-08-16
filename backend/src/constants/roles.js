/**
 * The staff/patient boundary, in one place.
 *
 * `authorizeStaff` [1.20.0] decides it for routes, but it is also a *business* rule in a couple of
 * services — most visibly `hmoService.resolveCardEvidence`, where staff filing an HMO claim at the
 * desk are exempt from photographing a card they are physically holding. Two definitions of "is
 * this a member of staff" is one more than this system can afford: they drift, and the drift shows
 * up as one screen letting someone through and another refusing them.
 *
 * Deliberately "holds any role that is not Client" rather than an allow-list of staff role names.
 * An allow-list has to be found and edited every time a role is added — an ECG Staff role would
 * silently be treated as a patient by whichever list nobody remembered — and it gets the
 * combined-role account wrong: a receptionist who is also a patient of the clinic holds Client,
 * and is still staff.
 */
const CLIENT_ROLE = 'Client';

/** True when the account holds any role other than Client. */
const isStaffUser = (user) => (user?.roles || []).some((role) => role !== CLIENT_ROLE);

module.exports = { CLIENT_ROLE, isStaffUser };
