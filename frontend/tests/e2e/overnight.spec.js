// @ts-check
import { test, expect } from 'playwright/test';
import { signInTo } from './helpers/auth.js';

/**
 * A screen left open overnight on the clinic's PC. [1.172.0]
 *
 * Transaction History read "today" once, when it opened, so the next morning it still showed
 * yesterday's receipts under a filter everyone reads as today. The browser's clock is set to 23:58,
 * the screen opened, and the clock moved past midnight: a date nobody chose follows the calendar; a
 * date somebody chose stays theirs.
 */

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

test('a history screen left open past midnight moves to the new day, unless someone picked the date', async ({ page }) => {
  const evening = new Date();
  evening.setHours(23, 58, 0, 0);
  const nextDay = new Date(evening);
  nextDay.setDate(nextDay.getDate() + 1);

  await page.clock.install({ time: evening });
  await signInTo(page, 'cashier@enlogada.com', 'Transaction History');
  const start = page.getByLabel('History start date');
  const end = page.getByLabel('History end date');
  await expect(start).toHaveValue(ymd(evening), { timeout: 20000 });

  await page.clock.fastForward('04:00');
  await expect(start, 'the default follows the calendar').toHaveValue(ymd(nextDay), { timeout: 15000 });
  await expect(end).toHaveValue(ymd(nextDay));

  // Chosen by hand: it stays.
  await end.fill(ymd(evening));
  await page.clock.fastForward('24:00:00');
  await expect(end, 'a chosen date stays put').toHaveValue(ymd(evening));
});
