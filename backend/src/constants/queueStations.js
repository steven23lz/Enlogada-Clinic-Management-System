/**
 * Where a patient can be called to. [1.149.0]
 *
 * Each station answers to the permission of the screen it is called from, so calling asks for
 * nothing a person at that screen does not already hold, and the "Who sees what" grid needs no new
 * row. A department also needs cover for that department (`assertStaffAllowedCategory`'s rule).
 *
 * The keys are stored in `queue_calls.station`, and its CHECK lists them: a new department goes in
 * both, as well as in frontend `lib/nowServing.js`.
 */
const FRONT_DESK = 'Front Desk';
const CASHIER = 'Cashier';

const STATIONS = Object.freeze([
  { key: FRONT_DESK, label: FRONT_DESK, permission: 'visits:create' },
  { key: CASHIER, label: CASHIER, permission: 'billing:process' },
  // In the sidebar's order, which is the screen's: its tiles never move.
  ...[['Laboratory', 'Laboratory'], ['Ultrasound', 'Ultrasound'], ['Xray', 'X-Ray']].map(([key, label]) => ({
    key,
    label,
    permission: 'results:write',
    department: true,
  })),
]);

const stationFor = (key) => STATIONS.find((s) => s.key === key) || null;

module.exports = { STATIONS, FRONT_DESK, CASHIER, stationFor };
