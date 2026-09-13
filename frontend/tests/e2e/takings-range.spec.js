// @ts-check
import { test, expect } from 'playwright/test';
import { signIn } from './helpers/auth.js';
import { dateStr, todayStr } from './helpers/dates.js';

/**
 * Takings answer for the dates the receipt list shows. [1.74.0]
 *
 * Transaction History has a date range, a receipt list, and under it two panels — Takings and
 * Sales by service — whose header reads "Settled payments in this range". They were fed a fixed
 * seven days of their own. On 13 Sep the list said 0 receipts for the day while Takings said
 * ₱17,200 from 25: two halves of one screen, about the same money, disagreeing with nothing on
 * screen to say why.
 *
 * Asserted on the request rather than on a peso figure. The figure depends on what the rest of the
 * suite happened to charge today, and the bug was never the arithmetic — it was which dates the
 * panels asked about.
 */

const isOperationsReport = (req) => req.url().includes('/api/reports/operations');
const paramsOf = (req) => Object.fromEntries(new URL(req.url()).searchParams);

test('Takings follow the receipt list’s dates, on opening and on Apply', async ({ page }) => {
  await signIn(page, 'cashier@enlogada.com');

  // Opening the screen: the list loads today, so the panels ask about today, not the last week.
  const opened = page.waitForRequest(isOperationsReport);
  await page.getByRole('button', { name: 'Transaction History', exact: true }).first().click();
  const today = todayStr();
  expect(paramsOf(await opened), 'Takings must cover the day the list shows').toMatchObject({
    startDate: today, endDate: today,
  });

  // A week chosen above the list, then Apply: the panels follow the list.
  const sixDaysAgo = new Date();
  sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);
  const weekStart = dateStr(sixDaysAgo);
  await page.getByLabel('History start date').fill(weekStart);

  const applied = page.waitForRequest(isOperationsReport);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  expect(paramsOf(await applied), 'Apply must move Takings with the list').toMatchObject({
    startDate: weekStart, endDate: today,
  });

  // And the panel shows figures for it, not an error or a skeleton that never ends.
  await expect(page.getByText('Settled payments in this range')).toBeVisible();
  await expect(page.getByText('Collected', { exact: true })).toBeVisible({ timeout: 20000 });
});
