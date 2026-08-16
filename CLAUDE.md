# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Enlogada Clinic Management System — an enterprise diagnostic healthcare platform for human diagnostic services only (Ultrasound, Laboratory, Digital X-Ray, 2D Echo, ECG). Veterinary/pet functionality was fully removed; do not reintroduce it.

Stack: React 19 (Vite, Tailwind CSS v4) frontend + Node.js/Express 5 backend + PostgreSQL.

## Commands

```bash
# Backend (port 5000)
cd backend
npm run dev              # nodemon, auto-restart
npm start                # plain node

# Frontend (port 5173)
cd frontend
npm run dev
npm run build
npm run lint              # oxlint
npm run preview

# Database setup (run from backend/)
node src/scripts/migrateDb.js     # (re)creates all tables from database/schema.sql — destructive, drops/recreates
node src/scripts/setupRbac.js     # seeds permissions/roles for RBAC
node src/scripts/seedUsers.js     # seeds one test user per role (password: Password123!)
node src/scripts/testRbacEndpoints.js  # manual RBAC endpoint smoke test
node src/scripts/verifyRbacWiring.js  # asserts every permission-gated route matches the seeded matrix

# Additive migrations for an EXISTING database (migrateDb.js is destructive and cannot be used on
# a live one). Each is safe to re-run; run them in order on any database created before [1.13.0].
node src/scripts/migrateIndexes.js           # [1.11.0] foreign-key and lookup indexes
node src/scripts/migrateResultAttribution.js # [1.12.0] recorded_by vs released_by
node src/scripts/migrateDataIntegrity.js     # [1.13.0] daily_counters + queue/receipt/payment uniqueness
node src/scripts/migrateDiscounts.js         # [1.14.0] Senior Citizen / PWD statutory discounts
node src/scripts/migrateResultVersioning.js  # [1.15.0] result amendment history + critical values
node src/scripts/migrateSessionRevocation.js # [1.16.0] password change ends older sessions
node src/scripts/migrateVatExemption.js      # [1.17.0] VAT-exempt senior/PWD discounts
node src/scripts/migrateQueryPerformance.js  # [1.18.0] indexes for date-ranged screens
node src/scripts/migrateLoginProtection.js   # [1.19.0] account lockout + PHI read auditing

# Clear accumulated E2E/fixture traffic, keeping reference data and seeded accounts.
# Dry-run by default; --confirm actually deletes. Refuses to run under NODE_ENV=production.
node src/scripts/resetDemoData.js             # report only
node src/scripts/resetDemoData.js --confirm   # apply

# Seed a realistic clinic dataset: ~18 visits today at every workflow stage (awaiting payment,
# senior/PWD discounts, on each modality worklist, a CRITICAL result, an AMENDED report, HMO
# pre-auth) plus 14 days of backdated history so the reporting screens have something to plot.
# Needs both servers running. Every "today" screen filters on the current date, so re-run before
# a demo — data seeded yesterday leaves the queues legitimately empty.
node src/scripts/seedDemoScenario.js

# Retention passes. Schedule both in any long-lived environment — notifications daily, audit
# monthly. audit_log now records PHI reads, so it grows with staff activity rather than with
# sensitive writes only.
node src/scripts/pruneNotifications.js --dry-run
node src/scripts/pruneNotifications.js
node src/scripts/pruneAuditLog.js --dry-run
node src/scripts/pruneAuditLog.js            # PHI reads 2y, everything else 7y
```

**Before a demo:** `resetDemoData.js --confirm` then `seedDemoScenario.js`.

The suite now cleans up after itself — `playwright.config.js` wires a global setup/teardown that stamps the run start and then deletes everything the run created (throwaway `@enlogada-e2e.test` accounts, plus any visit, payment, notification or audit row created inside the window). Row counts are identical before and after a run, so a seeded demo dataset survives testing. Set `E2E_SKIP_PURGE=1` to keep the data when debugging a failure. Cleanup never fails the run; if it errors it says so and leaves the data behind.

The E2E suite creates a throwaway client, patient, visit and payment on every run and never cleans up, so the dev database drifts a long way from anything a clinic would recognise — left alone it reaches thousands of visits and a billing queue hundreds deep. That skews demos, makes paginated/aggregate screens behave unlike production, and slowly breaks tests that walk a list to find their own record.

The worst of it is `notification_reads`, which is a **fan-out** table: `notifyRoles` writes one row per recipient per event, so its size is events × staff, not events. Because the suite also created staff and elevated accounts that were never cleaned up (137 Cashiers, 89 Admins, 45 SuperAdmins had accumulated), both factors grew at once and the table reached 255,540 rows across 4,309 events in five days — average fan-out 60, peak 181, with 99.4% never read by anyone. After a reset the same fan-out is 3. Production will not see the runaway staff count, but it has no retention either: 20 staff × 200 events/day is ~1.5M rows a year, growing forever. Schedule `pruneNotifications.js` (default: read 30d, unread 90d) in any environment that runs longer than a demo.

There **is** an automated end-to-end suite: `frontend/tests/e2e/` holds 10 Playwright specs (74 tests, ~25s) run with `npm test` (or `npm run test:ui`) from `frontend/`. It assumes **both dev servers are already running** and hits the real database — see `frontend/tests/e2e/README.md`. There are no unit tests; the backend has no test script.

The suite is a deliberately small demo-and-regression net, not exhaustive coverage: smoke, security boundaries (`api-authorization.spec.js` — Admin-vs-SuperAdmin separation of duties, combined-role access, and the cross-role PHI boundaries), ticket-release gating, payments, laboratory results, statutory discounts (`discounts.spec.js`), result amendment history and critical values (`result-versioning.spec.js`), password-change session revocation (`session-revocation.spec.js`), account lockout and PHI read auditing (`login-protection.spec.js`), and permission-matrix enforcement (`rbac-enforcement.spec.js`). It was cut down from ~200 tests once the module-by-module build-out finished; the rest asserted UI copy that legitimately keeps changing. Prefer adding a focused spec over reviving deleted ones from git history.

Run it before and after any non-trivial change and compare the pass/fail counts — the specs assert RBAC boundaries and some UI copy, so intentional changes to those will legitimately turn specs red and the spec must be updated alongside the code. A run takes ~25 seconds; it runs on a single worker because the specs share one database and seeded accounts (see the note in `playwright.config.js`).

Three notes learned the hard way. The dev rate limiter allows 20,000 requests per 15 minutes; running the suite many times back to back trips it, and the resulting 429s surface as scattered, unrelated-looking failures — restart the backend to reset the counter. (There is now a second, tighter limiter on the credential endpoints, but it only counts *failed* attempts and allows 2,000 outside production, so the suite does not touch it.) Editing a backend file mid-run has the same signature: nodemon restarts, in-flight requests are dropped, and several unrelated specs go red at once — re-run on a settled server before believing a failure. And navigation/role changes need `multirole@enlogada.com` (see `TEST_ACCOUNTS.md`) to exercise properly: a single-role account cannot reveal the class of bug where the sidebar offers a screen the router refuses to open.

Env files: `backend/.env` and `frontend/.env`, based on the respective `.env.example`. Backend needs `DATABASE_URL`, `JWT_SECRET`, SMTP settings (for result-release emails), and Google OAuth credentials. Frontend needs `VITE_GOOGLE_CLIENT_ID` and `VITE_API_BASE_URL` (the latter is inlined at **build** time, so it must be set before `npm run build` — setting it on the server afterwards has no effect). The backend refuses to start if `JWT_SECRET` is blank, shorter than 32 characters, or a known example value; generate one with `openssl rand -hex 32`.

## Architecture

### Backend layering (strict separation — see `.agents/PROJECT_STRUCTURE.md`)

`routes/` → `controllers/` → `services/` → `repositories/` → PostgreSQL (via `src/config/database.js`).

- **Routes**: endpoint definitions only, no logic.
- **Controllers**: parse/validate request, call one service, shape the response. No business logic.
- **Services**: all business logic lives here.
- **Repositories**: all SQL lives here — never write raw queries in controllers or services.

This layering is enforced convention in this codebase (checked by the "Project Architect" role described in `.agents/AGENTS.md`); keep new features consistent with it rather than mixing concerns into controllers.

### Auth & RBAC

- JWT-based auth (`backend/src/middlewares/auth.js`): `verifyToken` decodes the bearer token into `req.user` (contains `roles` and `permissions` arrays baked in at login).
- `authorizeRoles(...roles)` middleware gates routes by role name (e.g. `'Admin'`, `'Receptionist'`).
- `authorizePermissions(...perms)` gates by fine-grained permission strings (e.g. `billing:process`) and is **enforced on 46 routes**. **SuperAdmin bypasses; Admin does not** — that single difference is what separates the two roles, and what makes the Role-Permission Matrix screen real rather than advisory.
- The two gates are independent and both must pass. `authorizeRoles` is the structural boundary and is **not** editable from any screen (no permission tick can put a Client on a worklist); `authorizePermissions` is the delegable layer on top.
- **Adding a permission to a route?** Run `node src/scripts/verifyRbacWiring.js`. It cross-checks every gated route against the seeded matrix and fails if a role the route allows lacks the permission it requires — a mismatch otherwise surfaces as a 403 for a role the route was written to permit, in a flow nobody exercises until a real user hits it. It caught 8 such gaps when enforcement was first wired.
- Navigation reads the same permissions (`canSee` in `frontend/src/config/navigation.js`), so the sidebar cannot advertise a screen the API will refuse. `AuthContext` re-reads `/auth/me` every 60s and on tab focus, so a matrix change reaches a signed-in user without a re-login.
- Roles/permissions are DB-driven (`roles`, `permissions`, `user_roles` tables), seeded via `setupRbac.js`.
- Google OAuth: `POST /api/auth/google` verifies an ID token via `google-auth-library`, then logs in or auto-creates a Client user.
- Frontend session handling: `frontend/src/config/api.js` (Axios) fires a global `auth:unauthorized` window event on HTTP 401; `AuthContext.jsx` listens for it to clear user state without breaking SPA navigation — follow this pattern rather than throwing/catching 401s locally in components.

### Frontend routing model

There is no router library — `frontend/src/App.jsx` does manual, role-based conditional rendering based on `user.roles` from `AuthContext` plus local `currentTab`/`activeNav` state. When adding a new page/dashboard, wire it into the role-branching logic in `App.jsx` rather than introducing a routing library.

Role → primary console mapping:
- SuperAdmin/Admin → `AdminDashboard` (plus `ServicesCatalog` for the services-catalog nav item)
- Receptionist → `ReceptionistDashboard`
- Cashier → `CashierDashboard`
- Laboratory/Xray/Ultrasound Staff → shared `DiagnosticDashboard`, filtered by category
- Client → `ClientDashboard`

Public (unauthenticated) pages: `Home`, `ServicesPage` (dynamically fetches active tests from `GET /api/tests`, so admin price/service edits appear live), `Login`, `Register`.

### Database

Schema lives in `database/schema.sql` (source of truth, applied wholesale by `migrateDb.js`); human-readable change log in `database/migrations.md`.

**Transactions:** `db.withTransaction(fn)` in `src/config/database.js` makes every query issued underneath it — at any call depth, through any repository — run on one connection and commit as a unit. It uses `AsyncLocalStorage`, so repositories need no `client` argument and cannot accidentally write outside the transaction. Nested calls join the transaction already in progress. **Never call `db.pool.connect()` directly**: a self-managed client inside a `withTransaction` opens a second, independent transaction that commits on its own, and with a bounded pool it deadlocks once every connection is held by a transaction waiting for another connection. Any service method performing 2+ writes that must succeed together belongs in `withTransaction`; keep bcrypt hashing and outbound email/HTTP *outside* it so a pooled connection is not held during slow work.

**PHI reads are audited; keep the scope narrow.** `auditService.logPhiRead` records reads of an *identified patient's* records (demographics, result history, report file). Do not add it to searches, worklists or queues — staff refresh those constantly, and the entries that matter would drown in traffic that is just people doing their job. That is the fan-out mistake that took `notification_reads` to 255,540 rows.

**`test_results` is versioned — always filter on `is_current`.** A test carries one row per version of its report (an amendment supersedes rather than overwrites; see [1.15.0]). A `LEFT JOIN test_results` without `AND tr.is_current` repeats the parent row once per amendment and shows superseded findings beside live ones, and an `UPDATE … WHERE visit_test_id = $1` without it rewrites the history. `findVersionHistoryByVisitTestId` is the only intentional reader of superseded rows.

**Never filter on `column::date`.** A B-tree index cannot serve a predicate on an expression, so `WHERE created_at::date = CURRENT_DATE` silently forces a sequential scan no matter what is indexed — `idx_patient_visits_created` existed for a year and was never used. Write half-open ranges on the raw column instead: `col >= $1::date AND col < ($2::date + 1)`. Measured at 219k rows: 50.7ms seq scan vs 0.84ms index scan. Casting in `SELECT`/`GROUP BY` is fine; only the filter matters.

**Statutory discounts are VAT-exempt, and the order matters.** The clinic is VAT-registered, so a Senior Citizen / PWD sale has the 12% VAT stripped **first** and the 20% applied to the VAT-exempt base (RA 9994 / RA 10754). A flat 20% off the shelf price overcharges the patient — 800.00 instead of 714.29 on a 1,000.00 service. `tests.price` is stored VAT-inclusive, so VAT is extracted rather than added. Only `is_statutory` discounts get this; a promo rate is an ordinary discount. See `discountService.computeBreakdown`.

**Dates: never use `toISOString()` for "today".** It returns the **UTC** date, which in Philippine time (UTC+8) is *yesterday* between midnight and 08:00 — silently, with no error. Postgres `CURRENT_DATE` is the server's local date, so the two disagree every morning. Frontend code uses `frontend/src/lib/date.js` (`todayStr` / `daysAgoStr`, built from local getters); backend code derives date strings **in SQL** rather than in JavaScript. This bug shipped twice: in four dashboard `todayStr` helpers, and in the receipt-number generator.

**Numbers that must be unique** (queue tickets, receipt numbers) come from `daily_counters` via `INSERT … ON CONFLICT DO UPDATE … RETURNING`, never from `SELECT COUNT(*) + 1`. Counting rows is not a sequence: it races under concurrency, and it rewinds when a row is cancelled or refunded, reissuing a number already handed to a patient. Unique indexes back all three invariants. Core flow through the tables:

`users` → `patients` (1:1 via `user_id`) → `patient_visits` (a clinic visit/queue entry) → `visit_tests` (tests attached to a visit, priced via `price_at_time`) → `test_results` (findings/file per visit_test, released by staff) and `payments` (billed against a visit). `appointments` link to a `patient_visit`. `hmo_requests` link a visit to an `hmo_providers` approval flow. `tests` belong to a `test_categories` row (Laboratory/Xray/Ultrasound/2D Echo/ECG) and have an `is_active` flag that controls public visibility.

### UI conventions

**Everything visual is decided once, in `frontend/src/index.css`.** The brand is unchanged —
`#769046` green, dark slate chrome, 'Outfit' — but it is now reached through tokens rather than
arbitrary values. Four rules make the difference, and breaking any of them is what the consoles
looked like before:

- **One neutral ramp.** Tailwind's `gray-*` is remapped onto `slate-*` in `@theme`, so the two
  ramps the app mixed (`border-gray-100` beside `text-slate-900`, warm against cool) are now the
  same colour temperature. Use either; they resolve identically. Hairlines are `border-[#e6ebf1]`
  (the `line` token) — `gray-100` as a *border* is nearly invisible against white.
- **The brand green comes from the `brand-*` ramp**, not from `bg-[#769046]/10`. Arbitrary
  opacity variants are how five different pale greens ended up on one screen.
- **Shadow means "this floats."** Static panels are separated by a hairline border and a tinted
  canvas, never by a shadow. `shadow-raised` is a hover lift, `shadow-float` is a dropdown,
  `shadow-overlay` is a dialog. There is no fourth.
- **Radius encodes size**: `md` (8px) for a badge, `lg` (10px) for a control, `xl` (14px) for a
  panel, `2xl` (18px) for a dialog or hero.

Layout primitives, all in `frontend/src/components/ui/`. Reach for these before writing a `<div>`
with a border on it — each exists because the markup it replaces had been copy-pasted 15–40 times
and the copies had drifted apart:

| | what it is |
|---|---|
| `page-header.jsx` | opens every screen — eyebrow, title, one-sentence description, actions. `variant="hero"` is the dark treatment, for the two landing screens only |
| `panel.jsx` | the section container (`Panel` / `PanelHeader` / `PanelBody` / `PanelFooter`). `<PanelBody flush>` for a table or divided list |
| `toolbar.jsx` | the filter row above a worklist. `attached` joins it to the panel below; also exports `SegmentedFilter` and `ToolbarField` |
| `empty-state.jsx` | what a screen shows when there is nothing. `tone="error"` looks *deliberately* unlike empty — a failed request and a quiet morning must never be confusable |
| `.field-label` / `.alert` | two component classes in `index.css`, for the form label and the inline alert. Leaf elements, so a class is the right unit |

- `SidebarLayout.jsx` is the shared shell for staff/admin consoles. Its nav column scrolls
  independently and its department groups collapse (remembered in `localStorage`, but the group
  holding the current screen always opens). The top bar is a **breadcrumb**, not a second page
  title — the screen's own `PageHeader` carries the heading, so don't add a title to both.
- `DashboardLayout.jsx` / `PublicHeader.jsx` / `PublicFooter.jsx` are the public-page equivalents.
- **Don't couple a test to a class name.** `payment.spec.js` used to scope itself with
  `ancestor::div[contains(@class,"rounded-2xl")]`, so changing a corner radius failed a payment
  assertion. Add a `data-testid` instead.

## Repo conventions

- Files: PascalCase for React components, camelCase for JS utilities/backend files, snake_case for DB identifiers.
- Keep files focused; split when they exceed roughly 300–500 lines.
- `.agents/AGENTS.md` and `.agents/PROJECT_STRUCTURE.md` define an internal "AI team" convention (Architect/Backend/Frontend/Database/Business-Analyst roles) used to keep contributions consistent — the layering and naming rules above are drawn from it.
- A version-control skill (`.agents/skills/version_control_agent/`) exists for timestamped checkpoint commits/rollback via PowerShell scripts; this explains the "Checkpoint (yyyymmdd-HHMMSS)" style commit messages seen in git history. Don't assume this workflow applies unless the user invokes it.
