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
