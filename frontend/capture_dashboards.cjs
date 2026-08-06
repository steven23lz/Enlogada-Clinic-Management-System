const { chromium } = require('playwright');
const path = require('path');

const artifactDir = 'C:\\Users\\Steven\\.gemini\\antigravity-ide\\brain\\d6d191fb-ce74-40e4-a135-c8d3cf8c4666';

const users = [
  { name: 'client', email: 'client@enlogada.com', role: 'Client' },
  { name: 'receptionist', email: 'receptionist@enlogada.com', role: 'Receptionist' },
  { name: 'cashier', email: 'cashier@enlogada.com', role: 'Cashier' },
  { name: 'lab', email: 'lab@enlogada.com', role: 'Laboratory Staff' },
  { name: 'admin', email: 'admin@enlogada.com', role: 'SuperAdmin' }
];

async function captureAll() {
  console.log('Launching Playwright Chromium browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // 1. Capture Home Landing Page
  console.log('\nNavigating to http://localhost:5173...');
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(artifactDir, 'home_landing.png'), fullPage: true });
  console.log('Saved screenshot: home_landing.png');

  // 2. Loop through each role and capture dashboards
  for (const user of users) {
    console.log(`\nLogging in as ${user.role} (${user.email})...`);
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });

    // Click "Sign In" if on Home page
    const signInBtn = await page.$('button:has-text("Sign In"), a:has-text("Sign In")');
    if (signInBtn) {
      await signInBtn.click();
      await page.waitForTimeout(500);
    }

    // Wait for email input
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.fill('input[type="email"]', user.email);
    await page.fill('input[type="password"]', 'Password123!');
    await page.click('button[type="submit"]');

    // Wait for dashboard to render
    await page.waitForTimeout(2000);

    const screenshotPath = path.join(artifactDir, `${user.name}_dashboard.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Saved screenshot: ${screenshotPath}`);

    // If client, interact with Book Appointment modal
    if (user.name === 'client') {
      const bookBtn = await page.$('button:has-text("Book Appointment")');
      if (bookBtn) {
        await bookBtn.click();
        await page.waitForTimeout(800);
        const modalPath = path.join(artifactDir, `client_booking_modal.png`);
        await page.screenshot({ path: modalPath });
        console.log(`Saved booking modal screenshot: ${modalPath}`);
        // close modal
        const closeBtn = await page.$('button:has-text("Cancel")');
        if (closeBtn) await closeBtn.click();
      }
    }

    // Clear localStorage to log out cleanly
    await page.evaluate(() => localStorage.clear());
  }

  // 3. Capture Mobile Responsive View (375x812)
  console.log('\nCapturing Mobile Responsive View (375x812)...');
  const mobileContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  const mobileSignIn = await mobilePage.$('button:has-text("Sign In"), a:has-text("Sign In")');
  if (mobileSignIn) {
    await mobileSignIn.click();
    await mobilePage.waitForTimeout(500);
  }
  await mobilePage.waitForSelector('input[type="email"]', { timeout: 10000 });
  await mobilePage.fill('input[type="email"]', 'admin@enlogada.com');
  await mobilePage.fill('input[type="password"]', 'Password123!');
  await mobilePage.click('button[type="submit"]');
  await mobilePage.waitForTimeout(2000);

  const mobilePath = path.join(artifactDir, `mobile_responsive_dashboard.png`);
  await mobilePage.screenshot({ path: mobilePath, fullPage: true });
  console.log(`Saved mobile screenshot: ${mobilePath}`);

  await browser.close();
  console.log('\nAll role visual screenshots captured successfully!');
}

captureAll().catch(err => {
  console.error('Error during capture:', err);
  process.exit(1);
});
