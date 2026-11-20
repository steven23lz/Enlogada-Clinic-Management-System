/**
 * Every screen at every width. [1.173.0] `npm run check:widths`, with both dev servers running and the
 * seeded accounts in place.
 *
 * Opens the public pages, every patient portal tab and dialog, and every sidebar screen of each seeded
 * staff role, then resizes through 320, 360, 390, 414, 768 and 1024 px in light and dark, and lists
 * anything that makes the page scroll sideways or is clipped by its container. A dialog clips rather
 * than scrolls, so the page-level check in mobile-patient.spec.js cannot see a button cut in half
 * inside one: "Keep current time" was. "scrolls (intended)" marks a container meant to scroll sideways.
 * Takes about ten minutes; not part of `npm test`. `WIDTHS=393 FONT=130` checks one width at a larger
 * text size, as a phone's own font-size setting makes it.
 */
import pw from 'playwright';
const { chromium } = pw;
const BASE = process.env.CHECK_URL || 'http://localhost:5173';
const WIDTHS = (process.env.WIDTHS || '320,360,390,414,768,1024').split(',').map(Number);
const findings = new Map();

const measure = (page) => page.evaluate(() => {
  const out = [];
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) {
    const wide = [...document.body.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.right > de.clientWidth + 1; })
      .filter((e) => !e.closest('[aria-hidden="true"]')).slice(-3).map((e) => `${e.tagName.toLowerCase()}${e.dataset.testid ? `[${e.dataset.testid}]` : ''} "${(e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 30)}"`);
    out.push(`PAGE scrolls sideways (${de.scrollWidth}>${de.clientWidth}): ${wide.join(' | ')}`);
  }
  for (const el of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (!['hidden', 'auto', 'scroll', 'clip'].includes(cs.overflowX)) continue;
    if (el.clientWidth === 0 || el.scrollWidth <= el.clientWidth + 2) continue;
    if (el.closest('[aria-hidden="true"], .sr-only')) continue;
    // A container meant to scroll sideways, with a visible scrollbar, is a choice; note it apart.
    const intended = /overflow-x-auto|overflow-x-scroll/.test(el.className);
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 8) continue;
    const kids = [...el.querySelectorAll('*')].filter((k) => { const kr = k.getBoundingClientRect(); return kr.width && (kr.right > r.right + 2 || kr.left < r.left - 2) && (k.innerText || '').trim(); });
    const what = kids.slice(-2).map((k) => `"${k.innerText.trim().slice(0, 30)}"`).join(' | ');
    if (!what) continue;
    out.push(`${intended ? 'scrolls (intended)' : 'CLIPPED'} in ${el.tagName.toLowerCase()}${el.dataset.testid ? `[${el.dataset.testid}]` : el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''} (${el.scrollWidth}>${el.clientWidth}): ${what}`);
  }
  return out;
});

async function sweepHere(page, label) {
  try {
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(250);
    for (const f of await measure(page)) {
      const key = `${label} :: ${f.replace(/\(\d+>\d+\)/, '')}`;
      if (!findings.has(key)) findings.set(key, new Set());
      findings.get(key).add(w);
    }
  }
  } catch (e) { console.error('SKIPPED', label, e.message.split(String.fromCharCode(10))[0]); }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(200);
}

async function signIn(page, email) {
  await page.goto(BASE);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(BASE);
  await page.getByText('Sign In', { exact: true }).first().click();
  await page.waitForTimeout(1500);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', 'Password123!');
  await page.locator('button[type="submit"]').last().click();
  await page.waitForFunction(() => localStorage.getItem('token'), null, { timeout: 30000 }).catch(async (e) => { await page.screenshot({ path: `test-results/widths-signin-fail-${email}.png` }); throw e; });
  await page.waitForTimeout(2500);
}

const b = await chromium.launch();
for (const scheme of ['light', 'dark']) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme });
  // FONT=130: the phone's own font-size setting, which Android Chrome applies to the whole page.
  if (process.env.FONT && process.env.FONT !== '100') {
    await ctx.addInitScript((pct) => {
      const put = () => { const st = document.createElement('style'); st.textContent = `html{font-size:${pct}% !important}`; document.head.appendChild(st); };
      if (document.head) put(); else document.addEventListener('DOMContentLoaded', put);
    }, process.env.FONT);
  }
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  // Public pages.
  for (const q of ['', '?legal=privacy', '?legal=terms']) {
    await page.goto(`${BASE}/${q}`); await page.waitForTimeout(1500);
    await sweepHere(page, `${scheme} public ${q || 'home'}`);
  }
  for (const name of ['Services', 'About']) {
    await page.goto(BASE); await page.waitForTimeout(800);
    await page.getByRole('button', { name, exact: true }).first().click().catch(() => {});
    await page.waitForTimeout(1200);
    await sweepHere(page, `${scheme} public ${name}`);
  }
  for (const name of ['Sign In', 'Create Account']) {
    await page.goto(BASE); await page.waitForTimeout(800);
    await page.getByText(name, { exact: true }).first().click().catch(() => {});
    await page.waitForTimeout(1500);
    await sweepHere(page, `${scheme} public ${name}`);
  }
  // Patient portal.
  await signIn(page, 'client@enlogada.com');
  for (const tab of ['Home', 'Visits', 'Results', 'Payments', 'Profile']) {
    await page.getByRole('tab', { name: tab, exact: true }).first().click().catch(() => {});
    await page.waitForTimeout(1500);
    await sweepHere(page, `${scheme} portal ${tab}`);
  }
  await page.getByRole('tab', { name: 'Home', exact: true }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Book a visit' }).first().click().catch(() => {});
  await page.waitForTimeout(1500);
  await sweepHere(page, `${scheme} portal booking dialog`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  await page.getByRole('tab', { name: 'Profile', exact: true }).first().click();
  await page.getByRole('button', { name: 'Add a profile' }).click().catch(() => {});
  await page.waitForTimeout(800);
  await sweepHere(page, `${scheme} portal add profile`);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Account menu' }).click().catch(() => {});
  await page.waitForTimeout(500);
  await sweepHere(page, `${scheme} portal account menu`);
  await page.keyboard.press('Escape');
  // Staff, every screen in each sidebar.
  for (const email of ['multirole@enlogada.com', 'lab@enlogada.com', 'ultrasound@enlogada.com', 'xray@enlogada.com', 'clinicadmin@enlogada.com', 'admin@enlogada.com']) {
    await signIn(page, email);
    const ids = await page.locator('[data-nav-id]').evaluateAll((els) => [...new Set(els.map((e) => e.dataset.navId))]);
    for (const id of ids) {
      await page.locator(`[data-nav-id="${id}"]`).first().click().catch(() => {});
      await page.waitForTimeout(1800);
      await sweepHere(page, `${scheme} ${email.split('@')[0]} ${id}`);
    }
  }
  await ctx.close();
}
await b.close();
const lines = [...findings].map(([k, ws]) => `${k}  @ ${[...ws].join(',')}`).sort();
console.log(lines.join('\n') || 'nothing found');
console.log(`\n${lines.length} findings`);
