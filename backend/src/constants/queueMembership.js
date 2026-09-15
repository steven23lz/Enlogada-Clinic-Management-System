/**
 * Who is in today's queue. [1.92.0]
 *
 * A visit joins the queue when the patient is at the clinic: a walk-in the moment the desk
 * registers it, a booking the moment the desk checks it in (appointmentService.updateStatus, which
 * also stamps the visit with that moment and gives it today's next ticket). Until then a booking
 * is a reservation, not a place in line.
 *
 * Before [1.92.0] a booking joined the queue on the day it was MADE. Next week's bookings sat in
 * today's queue and at the till as "waiting", and a booking made last week never reached the queue
 * on the day it was for, so a patient who had booked ahead and came in unpaid could not be found at
 * the till.
 *
 * One definition for every reader of the queue (the Desk and the till, the public count, and the
 * patient's own "people ahead of you"), because two copies of this rule would drift apart. Each
 * helper takes the alias the calling query gives patient_visits.
 */

// A booking counts once it is checked in. A walk-in has no appointment row, so it always counts.
const checkedInIfBooked = (visit) => `NOT EXISTS (
  SELECT 1 FROM appointments qa
   WHERE qa.patient_visit_id = ${visit}.id AND qa.status NOT IN ('Confirmed', 'Completed'))`;

// A half-open range on the raw column, never created_at::date, so the index can serve it.
const inTodaysQueue = (visit) => `${visit}.created_at >= CURRENT_DATE
  AND ${visit}.created_at < (CURRENT_DATE + 1)
  AND ${visit}.status IN ('Pending', 'Processing')
  AND ${checkedInIfBooked(visit)}`;

module.exports = { checkedInIfBooked, inTodaysQueue };
