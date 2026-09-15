// @ts-check
import { test, expect } from 'playwright/test';
import { expectHeaderSpreadsOnScroll } from './helpers/header.js';

/**
 * The public site, held to what a visitor needs from it. [1.72.0]
 *
 * Home, Services, About, Privacy and Terms were rebuilt on the reference design. These pin the
 * properties that design has to keep, none of which any other spec looked at:
 *
 *   ONE HEADING, NO SIDEWAYS SCROLL   every page, at phone width — the class of bug that once put
 *                                     131px of overflow on a 375px phone (see PageShell)
 *   ONE SOURCE FOR THE CLINIC         About showed its own typed-in address after the real one was
 *                                     corrected everywhere else; now it must match the footer
 *   MOVING CONTENT IS PAUSABLE        and never moves at all for a reduced-motion visitor
 *   THE KEYBOARD WORKS                an FAQ answer opens with Enter
 *   NOTHING THE CLINIC DOES NOT DO    ECG and 2D Echo are not offered, so the price list never says so
 */

const HEADINGS = {
  Home: /diagnostic partner/i,
  Services: /our services/i,
  'About Us': /about enlogada/i,
  'Privacy Policy': /privacy policy/i,
  'Terms of Service': /terms of service/i,
};

/** Opens a public page the way a visitor would: header links, or the footer for the legal pages. */
async function open(page, name) {
  await page.goto('/');
  if (name !== 'Home') {
    if (name === 'Privacy Policy' || name === 'Terms of Service') {
      await page.locator('footer').getByRole('button', { name }).click();
    } else {
      const burger = page.getByRole('button', { name: 'Open menu' });
      if (await burger.isVisible()) {
        await burger.click();
        await page.getByTestId('public-menu').getByRole('button', { name, exact: true }).click();
      } else {
        await page.getByRole('button', { name, exact: true }).first().click();
      }
    }
  }
  await expect(page.getByRole('heading', { level: 1, name: HEADINGS[name] })).toBeVisible();
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const name of Object.keys(HEADINGS)) {
    test(`${name}: one page heading, and nothing scrolls sideways`, async ({ page }) => {
      await open(page, name);
      await expect(page.locator('h1')).toHaveCount(1);
      await page.waitForTimeout(800); // reveals and web fonts settle before measuring
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, `${name} scrolls sideways on a phone`).toBeLessThanOrEqual(0);
    });
  }
});

test('About states the same address as the rest of the site, not a copy of its own', async ({ page }) => {
  await open(page, 'About Us');
  const address = (await page.getByTestId('about-address').textContent())?.trim();
  expect(address, 'About shows an address').toBeTruthy();
  await expect(page.locator('footer')).toContainText(/** @type {string} */ (address));
});

test('the header floats at the top of a page and spreads into a full-width bar once it scrolls', async ({ page }) => {
  await open(page, 'Home');
  await expectHeaderSpreadsOnScroll(page);
});

test('the moving hero can be paused', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Pause background animation' }).click();
  await expect(page.getByRole('button', { name: 'Play background animation' })).toHaveAttribute('aria-pressed', 'true');
});

test("the clinic's own photographs load, and each card says what it shows", async ({ page }) => {
  // [1.84.0] The hero's slides and the About cards stood in for photos until the clinic sent
  // some. A photo that fails to load leaves a dark hero with no picture and a blank card, and no
  // other check in the suite would notice.
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: HEADINGS.Home })).toBeVisible();
  const loaded = (imgs) => imgs.filter((img) => img.complete && img.naturalWidth > 0).length;

  const heroPhotos = page.locator('section[aria-labelledby="hero-heading"] img');
  await expect(heroPhotos).toHaveCount(3);
  await expect.poll(() => heroPhotos.evaluateAll(loaded), { timeout: 15000 }).toBe(3);

  const homeCard = page.locator('section[aria-labelledby="about-heading"] figure img');
  await homeCard.scrollIntoViewIfNeeded();
  await expect(homeCard).toHaveAttribute('alt', /fetal monitor/i);
  await expect.poll(() => homeCard.evaluateAll(loaded), { timeout: 15000 }).toBe(1);

  await open(page, 'About Us');
  const aboutCard = page.locator('section[aria-labelledby="story-heading"] figure img');
  await aboutCard.scrollIntoViewIfNeeded();
  await expect(aboutCard).toHaveAttribute('alt', /lobby/i);
  await expect.poll(() => aboutCard.evaluateAll(loaded), { timeout: 15000 }).toBe(1);
});

test.describe('with reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('the hero does not move, so there is nothing to pause', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: /background animation/i })).toHaveCount(0);
  });
});

test('an FAQ answer opens from the keyboard', async ({ page }) => {
  await page.goto('/');
  const question = page.getByRole('button', { name: 'Do I need an appointment, or can I walk in?' });
  await question.focus();
  await page.keyboard.press('Enter');
  await expect(question).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText(/walk-ins are welcome/i)).toBeVisible();
});

test('Contact Us shows how to reach the clinic', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Contact Us' }).click();
  // exact: the FAQ has a region named "How do I contact the clinic?" too.
  const card = page.getByRole('region', { name: 'Contact the clinic', exact: true });
  await expect(card).toBeVisible();
  await expect(card.locator('a[href^="tel:"]')).toBeVisible();
  await expect(card.locator('a[href^="mailto:"]')).toBeVisible();
});

test('a legal page lists its sections, and each entry lands on its section', async ({ page }) => {
  await open(page, 'Privacy Policy');
  const contents = page.getByRole('navigation', { name: 'On this page' });
  await contents.getByRole('button', { name: 'Your Rights' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Your Rights' })).toBeInViewport();
});

test('the footer FAQ link works from any page, landing on Home’s FAQ', async ({ page }) => {
  await open(page, 'About Us');
  await page.locator('footer').getByRole('button', { name: 'FAQ' }).click();
  await expect(page.getByRole('heading', { name: 'Frequently asked questions' })).toBeInViewport({ timeout: 10000 });
});

test('the price list never advertises a service the clinic does not offer', async ({ page }) => {
  await open(page, 'Services');
  const search = page.getByPlaceholder(/search a test/i);
  await expect(search).toBeVisible({ timeout: 15000 });
  expect(await search.getAttribute('placeholder')).not.toMatch(/ECG|echo/i);
  await expect(page.locator('section[aria-labelledby="cat-ECG"]')).toHaveCount(0);
});
