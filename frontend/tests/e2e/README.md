# E2E Smoke Tests

Initial automated QA baseline for the Enlogada Clinic Management System, using the `playwright` devDependency already in `frontend/package.json` (via its bundled `playwright/test` test-runner subpath — no extra package was added).

## What's covered

- `smoke.spec.js` — the app loads, the login page is reachable, client-side required-field validation works.
- `auth.spec.js` — an unauthenticated visitor never sees the authenticated dashboard shell; a seeded Client account can log in and reach `ClientDashboard`; logout returns to the public view.
- `api-authorization.spec.js` — hits the backend API directly (no browser): unauthenticated requests are rejected, a client can read their own patient data, a client **cannot** read another client's patient/visit data (regression test for the ownership/IDOR fixes made in this remediation pass), a client cannot reach an admin-only endpoint, and a SuperAdmin can. Test data (two throwaway client accounts + patient profiles) is created fresh on every run — no manual DB setup beyond the standard seed sequence below.

This intentionally does **not** attempt to cover all 18 modules — it's the minimum baseline the audit asked for, meant to catch regressions in auth/RBAC while real module work proceeds.

## Prerequisites

Both servers must already be running, and the database must be seeded, before running the suite:

```bash
# 1. Database (from backend/, once):
node src/scripts/migrateDb.js
node src/scripts/setupRbac.js
node src/scripts/seedUsers.js

# 2. Backend (from backend/, keep running):
npm run dev

# 3. Frontend (from frontend/, keep running):
npm run dev
```

The suite assumes the frontend is reachable at `http://localhost:5173` and the backend at `http://localhost:5000` (both are this project's pinned defaults — see `frontend/vite.config.js` and `backend/.env`). Override with the `E2E_BASE_URL` / `E2E_API_URL` environment variables if your setup differs.

If Playwright's Chromium browser isn't installed yet: `npx playwright install chromium`.

## Running

From `frontend/`:

```bash
npm test          # headless run, all specs
npm run test:ui    # interactive UI mode
```

## Known limitations

- No CI wiring yet — this is a local/manual baseline only.
- Browser-level tests only cover the Client role end-to-end; Staff/Admin dashboards are exercised at the API-authorization level (`api-authorization.spec.js`) but not yet browser-driven.
- `frontend/src/config/api.js` hardcodes the backend base URL rather than reading an env var, so pointing this suite at a non-default backend also requires editing that file (see the audit's P2 findings) — `E2E_API_URL` only affects the `api-authorization.spec.js` requests, not the app under test.
