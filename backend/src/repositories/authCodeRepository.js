const db = require('../config/database');

/**
 * The emailed 6-digit codes: pending sign-ups and password resets. [1.73.0]
 *
 * Every expiry is computed in SQL and every comparison made against CURRENT_TIMESTAMP. The reset
 * links this replaced computed `expires_at` in Node and compared it in SQL, which is right only
 * while the two agree about the time zone.
 *
 * Two writes carry the security of the whole feature and are single statements on purpose:
 * `claimAttempt` spends a guess BEFORE the code is compared, so two requests racing cannot both
 * get a free try; and `consume` succeeds for exactly one caller, so one code cannot finish a sign-up
 * or change a password twice. The link flow looked its token up and marked it used in two
 * separate statements, and two requests with the same link could both succeed.
 */
class AuthCodeRepository {
  async create({
    purpose,
    email,
    userId = null,
    ticketHash,
    codeHash,
    firstName = null,
    lastName = null,
    contactNumber = null,
    passwordHash = null,
    ttlMinutes,
  }) {
    const { rows } = await db.query(
      `INSERT INTO auth_codes
         (purpose, email, user_id, ticket_hash, code_hash,
          first_name, last_name, contact_number, password_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
               CURRENT_TIMESTAMP + ($10 || ' minutes')::interval)
       RETURNING id, expires_at`,
      [purpose, email, userId, ticketHash, codeHash, firstName, lastName, contactNumber, passwordHash, String(ttlMinutes)]
    );
    return rows[0];
  }

  /** How many codes this address was sent for this purpose recently, across every ticket. */
  async countIssuedSince(purpose, email, minutes) {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n
         FROM auth_codes
        WHERE purpose = $1
          AND email = $2
          AND created_at > CURRENT_TIMESTAMP - ($3 || ' minutes')::interval`,
      [purpose, email, String(minutes)]
    );
    return rows[0].n;
  }

  /** The row, plus whether it has expired and how many seconds remain before it may be resent. */
  async findByTicketHash(ticketHash, cooldownSeconds) {
    const { rows } = await db.query(
      `SELECT *,
              expires_at <= CURRENT_TIMESTAMP AS expired,
              GREATEST(0, CEIL(EXTRACT(EPOCH FROM
                (last_sent_at + ($2 || ' seconds')::interval - CURRENT_TIMESTAMP))))::int AS resend_wait
         FROM auth_codes
        WHERE ticket_hash = $1`,
      [ticketHash, String(cooldownSeconds)]
    );
    return rows[0] || null;
  }

  /**
   * Spends one guess on a live code and returns the row with the guess counted, or null when there
   * is no guess left to spend (used, expired, out of tries, or no such ticket).
   */
  async claimAttempt(ticketHash, purpose, maxAttempts) {
    const { rows } = await db.query(
      `UPDATE auth_codes
          SET attempts = attempts + 1
        WHERE ticket_hash = $1
          AND purpose = $2
          AND consumed_at IS NULL
          AND expires_at > CURRENT_TIMESTAMP
          AND attempts < $3
      RETURNING *`,
      [ticketHash, purpose, maxAttempts]
    );
    return rows[0] || null;
  }

  /** True for exactly one caller. */
  async consume(id) {
    const { rowCount } = await db.query(
      'UPDATE auth_codes SET consumed_at = CURRENT_TIMESTAMP WHERE id = $1 AND consumed_at IS NULL',
      [id]
    );
    return rowCount === 1;
  }

  async consumeOpenForEmail(purpose, email) {
    await db.query(
      `UPDATE auth_codes SET consumed_at = CURRENT_TIMESTAMP
        WHERE purpose = $1 AND email = $2 AND consumed_at IS NULL`,
      [purpose, email]
    );
  }

  async consumeOpenForUser(purpose, userId) {
    await db.query(
      `UPDATE auth_codes SET consumed_at = CURRENT_TIMESTAMP
        WHERE purpose = $1 AND user_id = $2 AND consumed_at IS NULL`,
      [purpose, userId]
    );
  }

  /**
   * A fresh code on the same ticket: new hash, tries reset, expiry restarted. Refuses — returns
   * null — inside the cooldown, past the send limit, or once the ticket is used.
   */
  async reissue(id, codeHash, { ttlMinutes, cooldownSeconds, maxSends }) {
    const { rows } = await db.query(
      `UPDATE auth_codes
          SET code_hash = $2,
              attempts = 0,
              sends = sends + 1,
              last_sent_at = CURRENT_TIMESTAMP,
              expires_at = CURRENT_TIMESTAMP + ($3 || ' minutes')::interval
        WHERE id = $1
          AND consumed_at IS NULL
          AND sends < $5
          AND last_sent_at <= CURRENT_TIMESTAMP - ($4 || ' seconds')::interval
      RETURNING id, sends`,
      [id, codeHash, String(ttlMinutes), String(cooldownSeconds), maxSends]
    );
    return rows[0] || null;
  }

  async deleteById(id) {
    await db.query('DELETE FROM auth_codes WHERE id = $1', [id]);
  }

  /**
   * Rows older than a day are no use to anyone: every code is dead after ten minutes and the
   * per-address limit looks back one hour. Run on each new sign-up rather than on a schedule, so a
   * deployment with no cron still stays small.
   */
  async pruneOlderThan(hours) {
    await db.query(
      `DELETE FROM auth_codes WHERE created_at < CURRENT_TIMESTAMP - ($1 || ' hours')::interval`,
      [String(hours)]
    );
  }
}

module.exports = new AuthCodeRepository();
