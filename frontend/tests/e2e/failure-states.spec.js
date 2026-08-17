// @ts-check
import { test, expect } from 'playwright/test';

// A failed request must never render as an empty one. [1.28.0]
//
// empty-state.jsx was written for exactly this and says so in its own docstring: "A receptionist
// looking at an empty queue cannot tell 'nobody is waiting' from 'the request failed and nobody
// told you', and those call for opposite responses." Six screens then shipped without wiring the
// error branch, so a 500 fell through to the empty one and the app made confident false
// statements about the clinic's own data:
//
//   Staff Accounts      "No staff accounts yet — add the first Receptionist"   (there are six)
//   Reports / Today     "Today's Revenue PHP 0.00, +0% vs yesterday"           (it took 8,344.28)
//   Cashier Monitoring  "Collections in range PHP 0.00"                        (same)
//   Services Catalog    "No diagnostic services found"                         (there are fifteen)
//   Public services     "No Active Services"                                   (to a stranger)
//
// The money ones are the reason this is a spec and not a style note. A manager reading
// "PHP 0.00" concludes the clinic took nothing today; they do not conclude the server is down.
//
// Driven by route interception so it needs no broken backend and touches no data.

const PASSWORD = 'Password123!';

/** Sign in, THEN break the API — otherwise the login itself fails and nothing is tested. */
async function signInThenBreakApi(page, email) {
  await page.goto('/');
  await page.getByRole('button', { name: /^sign in$/i }).first().click();
  await page.getByLabel(/email/i).first().fill(email);
  await page.getByLabel(/password/i).first().fill(PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).last().click();
  await page.waitForTimeout(2500);

  // Auth and the reference lookups stay up: killing those signs the user out, which would prove
  // nothing about how a screen reports its own failure.
  await page.route('**/api/**', (route) => {
    if (/\/api\/(auth|notifications|tests\/categories|patients\/types|discounts|clinic)/.test(route.request().url())) {
      return route.continue();
    }
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'error', message: 'Simulated server failure.' }),
    });
  });
}

const ADMIN_SCREENS = [
  { nav: 'Staff Accounts', mustNotSay: /no staff accounts yet/i },
  { nav: 'Cashier Monitoring', mustNotSay: /₱0\.00/ },
  { nav: 'Services Catalog', mustNotSay: /no diagnostic services|no hmo providers yet/i },
  { nav: 'Appointments', mustNotSay: /no appointments booked/i },
  { nav: 'Service Requests', mustNotSay: /no hmo requests logged/i },
];

for (const { nav, mustNotSay } of ADMIN_SCREENS) {
  test(`${nav} reports a server failure instead of rendering as empty`, async ({ page }) => {
    await signInThenBreakApi(page, 'admin@enlogada.com');

    await page.getByRole('button', { name: nav, exact: true }).first().click();
    await page.waitForTimeout(2200);

    const body = await page.evaluate(() => document.body.innerText);

    // It must SAY something went wrong…
    expect(body, `${nav} failed silently`).toMatch(/could not|unavailable|failed|try again/i);
    // …and must not make the empty-state claim, or state a figure it does not have.
    expect(body, `${nav} still renders its empty state over a 500`).not.toMatch(mustNotSay);
  });
}

test("the Reports snapshot refuses to state a revenue figure it could not load", async ({ page }) => {
  await signInThenBreakApi(page, 'admin@enlogada.com');
  await page.getByRole('button', { name: 'Reports', exact: true }).first().click();
  await page.waitForTimeout(2200);

  const body = await page.evaluate(() => document.body.innerText);
  expect(body).toMatch(/unavailable|could not/i);
  // The specific falsehood: a peso total and a comparison against yesterday, both invented from
  // state that initialises to zero.
  expect(body, 'a revenue figure was shown for data that never arrived').not.toMatch(/₱0\.00/);
  expect(body).not.toMatch(/vs yesterday/i);
});

test('the public services page does not tell a stranger the clinic offers nothing', async ({ page }) => {
  // No sign-in: this is the one page with no account behind it, so nobody internal ever sees it
  // fail, and it is the page a prospective patient judges the clinic by.
  await page.route('**/api/tests**', (route) => route.fulfill({
    status: 500, contentType: 'application/json',
    body: JSON.stringify({ status: 'error', message: 'Simulated server failure.' }),
  }));

  await page.goto('/');
  await page.getByRole('button', { name: 'Services', exact: true }).first().click();
  await page.waitForTimeout(2500);

  const body = await page.evaluate(() => document.body.innerText);
  expect(body).toMatch(/unavailable/i);
  expect(body, 'told a prospective patient there are no services').not.toMatch(/No Active Services/i);
  // And still offers a way through, because somebody who cannot read the price list can ring up.
  expect(body).toMatch(/call us on/i);
});
