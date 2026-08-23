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

/** Open the size menu and pick one. The control is an icon button with a popover, not three
 *  visible buttons — a utility toggle should be quiet until somebody goes looking for it. It
 *  lives on the staff consoles and the patient portal; the public pages deliberately have none. */
const setSize = async (page, label) => {
  const control = page.getByTestId('text-scale').first();
  await control.getByRole('button', { name: /^Text size:/ }).click();
  await page.getByRole('menuitemradio', { name: `${label} text size` }).click();
};

/** Set the stored preference the way a returning visitor would arrive with it. */
const arriveWith = async (page, id) => {
  await page.addInitScript((v) => {
    try { localStorage.setItem('enlogada:text-scale', v); } catch { /* private window */ }
  }, id);
};

test.describe('Text size preference', () => {
  test('a public visitor gets the comfortable size, and no control to fiddle with', async ({ page }) => {
    await page.goto('/');

    // Large is the default. The control was removed from the public header — a utility toggle has
    // no business competing with the navigation on a marketing page — but the reason it existed
    // still applies to the people reading those pages, and they are the least likely to go looking
    // for a setting. So they get the comfortable size without having to ask for it.
    const m = await measure(page);
    expect(m.root).toBe(18);
    expect(m.applied).toBe('large');

    await expect(page.getByTestId('text-scale')).toHaveCount(0);

    // Same on the other public pages, including the one every patient passes through.
    await page.getByRole('button', { name: 'Services', exact: true }).first().click();
    await expect(page.getByTestId('text-scale')).toHaveCount(0);
    expect((await measure(page)).root).toBe(18);
  });

  test('a stored preference is honoured on arrival, before the first paint', async ({ page }) => {
    await arriveWith(page, 'larger');
    await page.goto('/');

    // Applied from main.jsx before React mounts, so the page never paints at the default size and
    // then jump — which would happen on every load, to exactly the people who chose a larger size
    // because reading is hard.
    const m = await measure(page);
    expect(m.root).toBe(20);
    expect(m.applied).toBe('larger');

    await page.reload();
    expect((await measure(page)).root).toBe(20);
  });

  test('the type hierarchy survives being scaled up', async ({ page }) => {
    for (const [label, id] of [['Normal', 'normal'], ['Large', 'large'], ['Larger', 'larger']]) {
      // Driven through the stored preference rather than the widget: what is under test here is
      // the CSS ramp, and it has to hold on the public pages too, where there is no widget.
      await arriveWith(page, id);
      await page.goto('/');
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
  });

  // The token has to survive `cn()`, not just exist in the stylesheet.
  //
  // tailwind-merge resolves conflicting classes by parsing the class NAME against its own model of
  // Tailwind, and it knows nothing about this project's @theme block. It read `text-micro` as a
  // text COLOUR, found `text-slate-500` later in the same cn() call, and dropped the size
  // entirely — so the cashier's metric labels rendered at 16px inherited instead of the 10px they
  // ask for, and every card's label was louder than the figure it labels.
  //
  // Nothing catches this by reading the source: the class is right there in the JSX. It is only
  // visible in the computed style of the rendered element, which is what this measures.
  test('a type token survives cn() and reaches the DOM at its real size', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /sign in/i }).first().click();
    await page.fill('input[type="email"]', 'cashier@enlogada.com');
    await page.fill('input[type="password"]', PASSWORD);
    await page.locator('button[type="submit"]').click();

    const label = page.getByText('Collected Today', { exact: true }).first();
    await expect(label).toBeVisible({ timeout: 15000 });

    const sizes = await label.evaluate((el) => {
      const card = el.closest('div, button');
      const value = card?.parentElement?.querySelector('[class*="text-stat"]');
      return {
        root: parseFloat(getComputedStyle(document.documentElement).fontSize),
        label: parseFloat(getComputedStyle(el).fontSize),
        value: value ? parseFloat(getComputedStyle(value).fontSize) : null,
      };
    });

    // text-micro is 0.625rem — expressed against the root rather than as a fixed pixel count, so
    // this keeps testing the token and not the current default scale. A label equal to the root
    // means the class was stripped and the element is inheriting the body size, which is the bug.
    expect(sizes.label, 'metric label is not rendering at its token size')
      .toBeCloseTo(0.625 * sizes.root, 1);
    expect(sizes.label, 'metric label is inheriting, so the size class never arrived')
      .toBeLessThan(sizes.root);
    // And the relationship the card exists to state: the figure dominates its label.
    expect(sizes.value).not.toBeNull();
    expect(sizes.value).toBeGreaterThan(sizes.label * 2);
  });

  test('staff get the same control on their own console', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /sign in/i }).first().click();
    await page.fill('input[type="email"]', 'receptionist@enlogada.com');
    await page.fill('input[type="password"]', PASSWORD);
    await page.locator('button[type="submit"]').click();

    const control = page.getByTestId('text-scale');
    await expect(control).toBeVisible({ timeout: 15000 });

    // Let the console's own data land first. The header still shifts ~12px in the 250ms after it
    // first paints, as the async bits of the top bar arrive, and opening a right-anchored popover
    // inside that window means clicking at a moving target. A person would not be that fast.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
    await page.waitForLoadState('networkidle');

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
