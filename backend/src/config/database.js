const { AsyncLocalStorage } = require('node:async_hooks');
const { Pool } = require('pg');
const env = require('./environment');
const logger = require('./logger');

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,

  // Sizing and timeouts. Without these the pool is unbounded in wait time and a single
  // pathological query pins a connection until the process restarts.
  //
  // max: Postgres' own default max_connections is 100 and is shared with psql sessions, the
  // migration scripts and any second app instance, so 10 per instance leaves headroom.
  // connectionTimeoutMillis: fail a request that cannot get a connection rather than letting it
  // hang forever behind a leak — a fast 500 is diagnosable, a hung request is not.
  // statement_timeout: a server-side ceiling on any single query. This is the backstop that keeps
  // one missing index or one accidental cross join from taking the whole clinic offline.
  max: Number(process.env.PGPOOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || 15_000),
});

// A connection can die between checkout and use (network blip, Postgres restart, idle reaper on a
// managed host). Without a handler, 'error' on an idle client is an unhandled event and takes the
// whole process down — a database hiccup becomes an outage.
pool.on('error', (err) => {
  logger.error(`Idle database client error: ${err.message}`);
});

// Test connection on startup
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    logger.error('Database connection failed:', err);
  } else {
    logger.info('Database connected successfully at ' + res.rows[0].now);
  }
});

/**
 * Carries the current transaction's client across await boundaries.
 *
 * Why this rather than threading a `client` argument through every repository method: there are
 * 100+ call sites across 14 repositories, and a signature change on each is a large diff whose
 * failure mode is silent — miss one and that write quietly commits outside the transaction, which
 * is exactly the bug the transaction was added to prevent. With the store, `query` below resolves
 * the right connection on its own and repositories stay unchanged, so a write cannot escape a
 * transaction by omission.
 */
const transactionStore = new AsyncLocalStorage();

/**
 * Runs `fn` inside a database transaction. Every query issued underneath it — at any call depth,
 * through any repository, across any await — runs on the same connection and commits or rolls
 * back as a unit.
 *
 *   await db.withTransaction(async () => {
 *     const visit = await visitRepository.create(...);
 *     await visitRepository.addTests(visit.id, tests);   // same transaction, automatically
 *   });
 *
 * Nested calls join the transaction already in progress instead of opening a second one, so a
 * service that wraps its own work stays correct when called from another service that does too.
 * The outermost call owns the COMMIT.
 */
const withTransaction = async (fn) => {
  const existing = transactionStore.getStore();
  if (existing) return fn(existing);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await transactionStore.run(client, () => fn(client));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // Report but never mask the original failure — the ROLLBACK error is a symptom, the
      // error that caused it is the diagnosis.
      logger.error(`Transaction rollback failed: ${rollbackErr.message}`);
    }
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  query: (text, params) => {
    logger.debug(`Executing query: ${text}`);
    // Inside withTransaction this resolves to the transaction's client; outside it, the pool.
    return (transactionStore.getStore() || pool).query(text, params);
  },
  withTransaction,
  /** True when the caller is already running inside a transaction. */
  inTransaction: () => Boolean(transactionStore.getStore()),
  pool,
};
