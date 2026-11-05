const db = require('../config/database');

/** Settings the clinic changes itself, with no developer and no restart. [1.162.0] */
class ClinicSettingRepository {
  async get(key) {
    const { rows } = await db.query('SELECT value FROM clinic_settings WHERE key = $1', [key]);
    return rows[0]?.value ?? null;
  }

  async set(key, value, updatedBy) {
    await db.query(
      `INSERT INTO clinic_settings (key, value, updated_by) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
      [key, value, updatedBy]
    );
  }
}

module.exports = new ClinicSettingRepository();
