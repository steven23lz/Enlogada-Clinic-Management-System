// @ts-check
import { test, expect } from 'playwright/test';

// The reader-chosen text size. [1.38.0]
//
// The setting itself is easy to eyeball and easy to keep working. The thing that needs a spec is
// the invariant underneath it, because it fails SILENTLY and looks fine in every screenshot taken
// at the default size.
//
// Every size in the app is a `rem`, so raising the root size scales all of it in proportion. The
// moment somebody writes `text-[13px]` instead of `text-note`, that one element stops scaling
// while everything around it keeps going — and because 13px sits between `text-fine` (12px) and
// `text-sm` (14px), the hierarchy does not merely stretch, it INVERTS: at 125% the "smaller" fine
// text renders at 15px and the note beside it is still 13px. There were 85 such pixel sizes in
// the app before this feature; the tokens replaced all of them and this spec is what notices the
// 86th.

const PASSWORD = 'Password123!';

/** Root size plus a representative sample of the type ramp, as the browser actually renders it. */
const measure = (page) =>
  page.evaluate(() => {
    const px = (cls) => {
      const el = document.querySelector('.' + cls);
      return el ? parseFloat(getComputedStyle(el).fontSize) : null;
    };
    return {
      root: parseFloat(getComputedStyle(document.documentElement).fontSize),
      applied: document.documentElement.dataset.textScale,
      fine: px('text-fine'),   // 12px — the smallest ramp step in common use
      note: px('text-note'),   // 13px — was `text-[13px]` in 46 places
      sm: px('text-sm'),       // 14px — Tailwind's own
    };
  });

const setSize = (page, label) =>
  page.getByTestId('text-scale').getByRole('button', { name: `${label} text size` }).click();

test.describe('Text size preference', () => {
  test('a patient can enlarge the interface before signing in, and it sticks', async ({ page }) => {
    await page.goto('/');

    const normal = await measure(page);
    expect(normal.root).toBe(16);
    expect(normal.applied).toBe('normal');

    await setSize(page, 'Larger');
    const larger = await measure(page);
    expect(larger.root).toBe(20);
    expect(larger.applied).toBe('larger');

    // Chosen once, not once per page. A preference that resets on navigation is not a preference.
    await page.reload();
    expect((await measure(page)).root).toBe(20);

    await setSize(page, 'Normal');
    expect((await measure(page)).root).toBe(16);
  });

  test('the type hierarchy survives being scaled up', async ({ page }) => {
    await page.goto('/');

    for (const label of ['Normal', 'Large', 'Larger']) {
      await setSize(page, label);
      const m = await measure(page);

      // Every step must be present on the page for the comparison to mean anything — a null here
      // is the spec measuring nothing and reporting success, which is the failure it exists to
      // prevent.
      expect(m.fine, `text-fine missing at ${label}`).not.toBeNull();
      expect(m.note, `text-note missing at ${label}`).not.toBeNull();
      expect(m.sm, `text-sm missing at ${label}`).not.toBeNull();

      // The whole point: fine < note < sm at EVERY size. A pixel-pinned `note` passes at Normal
      // and fails here the moment the root moves.
      expect(m.fine, `fine !< note at ${label}`).toBeLessThan(m.note);
      expect(m.note, `note !< sm at ${label}`).toBeLessThan(m.sm);

      // And they scale together, not just in order.
      expect(m.note).toBeCloseTo((13 / 16) * m.root, 1);
    }

    await setSize(page, 'Normal');
  });

  test('staff get the same control on their own console', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /sign in/i }).first().click();
    await page.fill('input[type="email"]', 'receptionist@enlogada.com');
    await page.fill('input[type="password"]', PASSWORD);
    await page.locator('button[type="submit"]').click();

    const control = page.getByTestId('text-scale');
    await expect(control).toBeVisible({ timeout: 15000 });

    await setSize(page, 'Larger');
    expect((await measure(page)).root).toBe(20);

    // The console must not start scrolling sideways because somebody needs bigger text. Wide
    // tables scroll inside their own container; the PAGE must not.
    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
    }));
    expect(overflow.doc).toBeLessThanOrEqual(overflow.win);

    await setSize(page, 'Normal');
  });
});
