const db = require('../config/database');
// Shared with the two capacity checks in appointmentService/appointmentRepository, so the grid
// and the booking cannot disagree about whether a slot is free. [1.35.0]
const { OCCUPIES_SLOT } = require('../constants/slotHold');

class ScheduleRepository {
  async findOperatingHoursForDay(dayOfWeek, client = db) {
    const queryText = `
      SELECT * FROM clinic_operating_hours WHERE day_of_week = $1
    `;
    const result = await client.query(queryText, [dayOfWeek]);
    return result.rows[0];
  }

  async countBookingsByTimeForDate(date, client = db) {
    const queryText = `
      SELECT scheduled_time, COUNT(*)::int AS cnt
      FROM appointments
      WHERE scheduled_date = $1 AND ${OCCUPIES_SLOT()}
      GROUP BY scheduled_time
    `;
    const result = await client.query(queryText, [date]);
    return result.rows;
  }
}

module.exports = new ScheduleRepository();
