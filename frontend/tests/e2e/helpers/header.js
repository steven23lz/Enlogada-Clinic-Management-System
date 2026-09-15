// @ts-check
import { expect } from 'playwright/test';

/**
 * Every header floats at the top of a page and spreads into a full-width bar once it scrolls.
 * [1.88.0] [1.91.0] The public site and the patient portal each draw their own header, and both
 * mark the bar with data-testid="header-bar", so one check holds them to the same behaviour.
 */
async function measureBar(page) {
  return page.getByTestId('header-bar').evaluate((el) => {
    const box = el.getBoundingClientRect();
    // The page's width is the root element's box, not clientWidth: html keeps a stable scrollbar
    // gutter, so the page and a fixed bar both end at the scrollbar (1270px on a 1280px viewport).
    return { top: box.top, left: box.left, width: box.width, page: document.documentElement.getBoundingClientRect().width };
  });
}

/** Asserts the header floats at the top, spreads once scrolled, and floats again back at the top. */
export async function expectHeaderSpreadsOnScroll(page, scrollTo = 900) {
  const atTop = await measureBar(page);
  expect(atTop.top, 'at the top of the page the header floats below the top edge').toBeGreaterThan(0);
  expect(atTop.width, 'and inside the page’s sides').toBeLessThan(atTop.page - 1);

  await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), scrollTo);
  await expect
    .poll(async () => {
      const bar = await measureBar(page);
      return bar.top === 0 && Math.abs(bar.left) <= 1 && Math.abs(bar.width - bar.page) <= 1;
    }, { message: 'once the page scrolls the header meets the top edge and both sides', timeout: 5000 })
    .toBe(true);

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect
    .poll(async () => (await measureBar(page)).top > 0, { message: 'back at the top it floats again', timeout: 5000 })
    .toBe(true);
}
