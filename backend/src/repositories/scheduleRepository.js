const db = require('../config/database');

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
      WHERE scheduled_date = $1 AND status <> 'Cancelled'
      GROUP BY scheduled_time
    `;
    const result = await client.query(queryText, [date]);
    return result.rows;
  }
}

module.exports = new ScheduleRepository();
