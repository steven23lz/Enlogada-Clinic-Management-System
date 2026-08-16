// @ts-check
import { defineConfig, devices } from 'playwright/test';

const FRONTEND_URL = process.env.E2E_BASE_URL || 'http://localhost:5173';
const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';

export default defineConfig({
  testDir: './tests/e2e',
  // The suite used to leave every client, patient, visit and payment it created behind. Setup
  // stamps the run's start time; teardown deletes what the run made. See globalTeardown.js.
  globalSetup: './tests/e2e/globalSetup.js',
  globalTeardown: './tests/e2e/globalTeardown.js',
  fullyParallel: false,
  // One worker, deliberately.
  //
  // `fullyParallel: false` only serialises tests *within* a file — separate files still run
  // concurrently across workers, and this suite shares one database and one set of seeded
  // accounts. Specs mutate that shared state: rbac-enforcement.spec.js temporarily revokes a
  // permission from the seeded Cashier, session-revocation.spec.js changes a password,
  // discounts.spec.js settles payments. Run in parallel, those changes are visible to whichever
  // other file happens to be mid-flight, which surfaces as unrelated specs failing at random —
  // the same misleading signature as the rate limiter and a mid-run nodemon restart.
  //
  // The whole suite takes about 14 seconds serially. That is a cheap price for a result that
  // means what it says.
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 30000,
  use: {
    baseURL: FRONTEND_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Assumes both dev servers are already running (see frontend/tests/e2e/README.md).
  // Not using Playwright's `webServer` auto-start here because the backend requires a live
  // PostgreSQL connection that this config has no safe way to verify beforehand.
  metadata: {
    frontendUrl: FRONTEND_URL,
    backendUrl: BACKEND_URL,
  },
});
