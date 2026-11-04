const db = require('../config/database');
const { ISSUED_RECEIPT_CLAUSE } = require('../constants/moneyRange');
const { CASH_METHOD, BANK_METHOD, EWALLET_METHODS } = require('../constants/paymentMethods');

const COUNT_COLUMNS = `c.id, c.business_date, c.change_fund, c.expected_cash, c.expected_gcash, c.expected_bank,
  c.receipts, c.counted_cash, c.difference, c.pieces, c.note, c.counted_at, c.is_current,
  NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS counted_by_name`;

const sqlList = (values) => values.map((v) => `'${v}'`).join(', ');

/** One row per day from a window of payments: the same receipts, on the same rule, as the cash book. */
const TAKINGS_BY_DAY = `
  SELECT pay.paid_at::date AS day,
         COUNT(*)::int AS receipts,
         COALESCE(SUM(pay.amount) FILTER (WHERE pay.payment_method = '${CASH_METHOD}'), 0)::numeric(12,2) AS cash,
         COALESCE(SUM(pay.amount) FILTER (WHERE pay.payment_method IN (${sqlList(EWALLET_METHODS)})), 0)::numeric(12,2) AS gcash,
         COALESCE(SUM(pay.amount) FILTER (WHERE pay.payment_method = '${BANK_METHOD}'), 0)::numeric(12,2) AS bank
    FROM payments pay
   WHERE ${ISSUED_RECEIPT_CLAUSE}
     AND pay.paid_at >= $1::date AND pay.paid_at < ($2::date + 1)
   GROUP BY 1`;

class CashCountRepository {
  /** Every count of one day, newest first: the current one, and any it replaced. */
  async findVersions(date) {
    const { rows } = await db.query(
      `SELECT ${COUNT_COLUMNS}
         FROM cash_counts c
         LEFT JOIN users u ON u.id = c.counted_by
        WHERE c.business_date = $1::date
        ORDER BY c.counted_at DESC, c.id DESC`,
      [date]
    );
    return rows;
  }

  /** The change fund on the latest count: what the drawer most likely starts with again. */
  async findLastChangeFund() {
    const { rows } = await db.query(
      `SELECT change_fund FROM cash_counts WHERE is_current ORDER BY business_date DESC LIMIT 1`
    );
    return rows[0]?.change_fund ?? null;
  }

  async supersede(id) {
    await db.query('UPDATE cash_counts SET is_current = FALSE WHERE id = $1', [id]);
  }

  async create({ date, changeFund, expected, counted, pieces, note, countedBy }) {
    const { rows } = await db.query(
      `INSERT INTO cash_counts
         (business_date, change_fund, expected_cash, expected_gcash, expected_bank, receipts, counted_cash, pieces, note, counted_by)
       VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
       RETURNING id`,
      [date, changeFund, expected.cash, expected.gcash, expected.bank, expected.receipts, counted, JSON.stringify(pieces), note, countedBy]
    );
    return rows[0].id;
  }

  /**
   * Each day in the range that took money or was counted, newest first, with its current count.
   * `taken_after` is what the till has now beyond what the count was measured against: a payment
   * taken after the drawer was counted. `before_counting`: the day is earlier than the first count
   * this clinic ever made (or none has been made), so nobody failed to count it. Paged, because a
   * list that grows with the clinic pages at the server; the money totals are `findDaysSummary`,
   * never the rows on a page.
   */
  async findDays({ startDate, endDate, limit, offset }) {
    const { rows } = await db.query(
      `WITH takings AS (${TAKINGS_BY_DAY}),
            days AS (
              SELECT day FROM takings
              UNION
              SELECT business_date FROM cash_counts WHERE is_current AND business_date >= $1::date AND business_date <= $2::date
            )
       SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
              COALESCE(t.receipts, 0) AS receipts_now,
              COALESCE(t.cash, 0)::numeric(12,2) AS cash_now,
              COALESCE(t.gcash, 0)::numeric(12,2) AS gcash_now,
              COALESCE(t.bank, 0)::numeric(12,2) AS bank_now,
              (COALESCE(t.cash, 0) - c.expected_cash)::numeric(12,2) AS taken_after,
              COALESCE(d.day < (SELECT MIN(f.business_date) FROM cash_counts f), TRUE) AS before_counting,
              ${COUNT_COLUMNS},
              (SELECT COUNT(*)::int - 1 FROM cash_counts v WHERE v.business_date = d.day) AS recounts
         FROM days d
         LEFT JOIN takings t ON t.day = d.day
         LEFT JOIN cash_counts c ON c.business_date = d.day AND c.is_current
         LEFT JOIN users u ON u.id = c.counted_by
        ORDER BY d.day DESC
        LIMIT $3 OFFSET $4`,
      [startDate, endDate, limit, offset]
    );
    return rows;
  }

  async findDaysSummary({ startDate, endDate }) {
    const { rows } = await db.query(
      `WITH takings AS (${TAKINGS_BY_DAY}),
            counted AS (
              SELECT business_date AS day, difference FROM cash_counts
               WHERE is_current AND business_date >= $1::date AND business_date <= $2::date
            ),
            days AS (SELECT day FROM takings UNION SELECT day FROM counted)
       SELECT (SELECT COUNT(*)::int FROM days) AS days,
              (SELECT COUNT(*)::int FROM counted) AS counted,
              (SELECT COUNT(*)::int FROM days d
                WHERE d.day < CURRENT_DATE
                  AND d.day >= (SELECT MIN(f.business_date) FROM cash_counts f)
                  AND NOT EXISTS (SELECT 1 FROM counted c WHERE c.day = d.day)) AS not_counted,
              (SELECT COALESCE(SUM(-difference) FILTER (WHERE difference < 0), 0)::numeric(12,2) FROM counted) AS short,
              (SELECT COALESCE(SUM(difference) FILTER (WHERE difference > 0), 0)::numeric(12,2) FROM counted) AS over`,
      [startDate, endDate]
    );
    return rows[0];
  }

  /**
   * Earlier days that took cash and were never counted, newest first. Only days the drawer can
   * still answer for: a count asks for a day within `days` of today. And only since counting began:
   * with no count yet the MIN is NULL and this finds nothing, so the clinic's first week is not a
   * list of counts nobody could have made.
   */
  async findUncountedDays(days) {
    const { rows } = await db.query(
      `SELECT DISTINCT to_char(pay.paid_at::date, 'YYYY-MM-DD') AS day
         FROM payments pay
        WHERE ${ISSUED_RECEIPT_CLAUSE}
          AND pay.payment_method = '${CASH_METHOD}'
          AND pay.paid_at >= CURRENT_DATE - $1::int AND pay.paid_at < CURRENT_DATE
          AND pay.paid_at >= (SELECT MIN(f.business_date) FROM cash_counts f)
          AND NOT EXISTS (SELECT 1 FROM cash_counts c WHERE c.is_current AND c.business_date = pay.paid_at::date)
        ORDER BY 1 DESC`,
      [days]
    );
    return rows.map((r) => r.day);
  }

  async hasCurrent(date) {
    const { rows } = await db.query(
      'SELECT 1 FROM cash_counts WHERE is_current AND business_date = $1::date',
      [date]
    );
    return rows.length > 0;
  }
}

module.exports = new CashCountRepository();
