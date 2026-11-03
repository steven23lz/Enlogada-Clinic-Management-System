const logger = require('../config/logger');

/**
 * A job the server runs on its own, every `everyMs`. [1.148.0]
 *
 * The shape reminderScheduler.js and unpaidExpiryScheduler.js each wrote out by hand, for the three
 * jobs [1.148.0] added: a sweep never overlaps the one before it, never throws (server.js shuts
 * the process down on an unhandled rejection, and a backup or an email must not take the clinic's
 * server with it), and the first one runs shortly after boot rather than a whole interval later.
 *
 * @param {{name: string, enabled: boolean, offMessage: string, everyMs: number,
 *          firstAfterMs: number, run: () => Promise<void>, startMessage?: string}} job
 */
function periodic({ name, enabled, offMessage, everyMs, firstAfterMs, run, startMessage }) {
  let timer = null;
  let starter = null;
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      await run();
    } catch (err) {
      logger.error(`${name} failed: ${err.message}`);
    } finally {
      running = false;
    }
  }

  function start() {
    if (!enabled) {
      logger.info(offMessage);
      return;
    }
    if (timer) return;
    timer = setInterval(tick, everyMs);
    timer.unref();
    starter = setTimeout(tick, firstAfterMs);
    starter.unref();
    if (startMessage) logger.info(startMessage);
  }

  function stop() {
    clearInterval(timer);
    clearTimeout(starter);
    timer = null;
  }

  return { start, stop, tick };
}

module.exports = periodic;
