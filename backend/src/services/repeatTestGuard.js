const packageRepository = require('../repositories/packageRepository');
const visitRepository = require('../repositories/visitRepository');
const auditService = require('./auditService');
const { ConflictError } = require('../errors');
const { isStaffUser } = require('../constants/roles');
const { listNames } = require('../utils/packageOverlap');

/**
 * The same test twice on one day, for one patient. [1.157.0]
 *
 * A patient may hold more than one booking a day: fasting bloods in the morning and an ultrasound
 * later is the reason. But the same CBC in two slots was accepted, and each is paid separately, and a
 * receipt is final with no refund for a change of mind. So a double booking cost the patient for good.
 *
 * Refused outright online, where nobody is there to ask. At the desk a repeat can be genuine (a doctor
 * asks for a second reading), so the receptionist is asked, and saying yes is on the Activity Log.
 * Bookings made with a staff token are exempt: they are paid at the desk, by the same people.
 */

/** The tests a request would put on a visit: the ones named, and every package's components. */
const requestedTestIds = async (testIds = [], packageIds = []) => {
  const ids = new Set((testIds || []).map((id) => parseInt(id, 10)));
  const packages = (packageIds || []).map((id) => parseInt(id, 10)).filter(Number.isInteger);
  if (packages.length) {
    const rows = await packageRepository.findByIdsWithItems(packages);
    for (const r of rows) ids.add(r.test_id);
  }
  return [...ids].filter(Number.isInteger);
};

const uniqueNames = (rows) => [...new Set(rows.map((r) => r.test_name))];

/**
 * @returns {Promise<object[]>} the repeats a member of staff has just confirmed, for `logConfirmed`.
 * @throws {ConflictError} carrying `details.repeatTests`, which is how the Desk knows to ask.
 */
async function assertNoRepeat({
  patientId, patientName, day = null, testIds = [], packageIds = [], exceptVisitId = null,
  requestingUser, confirmed = false,
}) {
  const wanted = await requestedTestIds(testIds, packageIds);
  if (wanted.length === 0) return [];

  const repeats = await visitRepository.findTestsOnPatientsDay({ patientId, day, testIds: wanted, exceptVisitId });
  if (repeats.length === 0) return [];

  const staff = isStaffUser(requestingUser);
  if (staff && confirmed) return repeats;

  const names = listNames(uniqueNames(repeats));
  const error = new ConflictError(staff
    ? `${patientName} already has ${names} ${day ? 'on that day' : 'today'}. Is this a repeat the doctor asked for? If not, take it off so it is not charged twice.`
    : `${patientName} already has ${names} booked for that day. A test is paid for once and a receipt is final, so it cannot be booked twice on one day. Take it off this booking or choose another day. If your doctor asked for a repeat, the clinic's front desk can add it.`);
  error.details = {
    repeatTests: repeats.map((r) => ({
      testId: r.test_id, testName: r.test_name, visitId: r.visit_id,
      queueNumber: r.queue_number, scheduledTime: r.scheduled_time, paid: r.paid,
    })),
  };
  throw error;
}

/** Whoever said yes is named. Inside the caller's transaction, once the visit exists. */
async function logConfirmed(repeats, { visitId, requestingUser }) {
  if (!repeats || repeats.length === 0) return;
  await auditService.log({
    actorId: requestingUser?.userId,
    action: 'visit_test.repeat_confirmed',
    entityType: 'patient_visit',
    entityId: visitId,
    description: `Confirmed a same-day repeat of ${listNames(uniqueNames(repeats))}`,
  });
}

module.exports = { assertNoRepeat, logConfirmed };
