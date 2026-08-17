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
# a live one). Each is safe to re-run; run them in order on any database created before [1.28.0].
node src/scripts/migrateIndexes.js           # [1.11.0] foreign-key and lookup indexes
node src/scripts/migrateResultAttribution.js # [1.12.0] recorded_by vs released_by
node src/scripts/migrateDataIntegrity.js     # [1.13.0] daily_counters + queue/receipt/payment uniqueness
node src/scripts/migrateDiscounts.js         # [1.14.0] Senior Citizen / PWD statutory discounts
node src/scripts/migrateResultVersioning.js  # [1.15.0] result amendment history + critical values
node src/scripts/migrateSessionRevocation.js # [1.16.0] password change ends older sessions
node src/scripts/migrateVatExemption.js      # [1.17.0] VAT-exempt senior/PWD discounts
node src/scripts/migrateQueryPerformance.js  # [1.18.0] indexes for date-ranged screens
node src/scripts/migrateLoginProtection.js   # [1.19.0] account lockout + PHI read auditing
node src/scripts/migrateAccountScopedRbac.js # [1.20.0] per-account permissions + department assignment
node src/scripts/migrateHmoCard.js           # [1.22.0] HMO card evidence columns (--rollback reverses it)
node src/scripts/migrateReferringPhysician.js # [1.23.0] referring physician on a visit (--rollback reverses it)
node src/scripts/migrateTestPreparation.js    # [1.24.0] patient preparation per test (--rollback reverses it)
node src/scripts/migrateAppointmentReminders.js # [1.25.0] day-before reminder tracking (--rollback reverses it)
node src/scripts/migrateHmoDecisionTrail.js    # [1.27.0] why an HMO refused a test, and who recorded it (--rollback reverses it)
node src/scripts/migrateHmoClaimDecision.js    # [1.28.0] turning a whole claim down, + member number (--rollback reverses it)

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

# Day-before appointment reminders. Schedule DAILY, in the evening. Dry-run by default.
#
# The clinic has counted 'No Show' since [1.0.0] with no tool against it; this is the standard
# one. It also carries the preparation instructions, which is where they matter most — "nothing
# to eat after 10pm tonight" is actionable the evening before and forgotten at booking time.
#
# Safe to re-run: each appointment is stamped once handled, so a second run finds nothing. That
# is what makes it safe to schedule.
node src/scripts/sendAppointmentReminders.js              # report only
node src/scripts/sendAppointmentReminders.js --confirm    # actually send

# Retention pass for HMO card images (insurance documents, not medical records). Dry-run by
# default; --confirm applies. The window is a constant in the script, overridable per run.
node src/scripts/pruneHmoCards.js
node src/scripts/pruneHmoCards.js --days=180
node src/scripts/pruneHmoCards.js --confirm
```

**Before a demo:** `resetDemoData.js --confirm` then `seedDemoScenario.js`.

The suite now cleans up after itself — `playwright.config.js` wires a global setup/teardown that stamps the run start and then deletes everything the run created (throwaway `@enlogada-e2e.test` accounts, plus any visit, payment, notification or audit row created inside the window). Row counts are identical before and after a run, so a seeded demo dataset survives testing. Set `E2E_SKIP_PURGE=1` to keep the data when debugging a failure. Cleanup never fails the run; if it errors it says so and leaves the data behind.

The E2E suite creates a throwaway client, patient, visit and payment on every run and never cleans up, so the dev database drifts a long way from anything a clinic would recognise — left alone it reaches thousands of visits and a billing queue hundreds deep. That skews demos, makes paginated/aggregate screens behave unlike production, and slowly breaks tests that walk a list to find their own record.

The worst of it is `notification_reads`, which is a **fan-out** table: `notifyRoles` writes one row per recipient per event, so its size is events × staff, not events. Because the suite also created staff and elevated accounts that were never cleaned up (137 Cashiers, 89 Admins, 45 SuperAdmins had accumulated), both factors grew at once and the table reached 255,540 rows across 4,309 events in five days — average fan-out 60, peak 181, with 99.4% never read by anyone. After a reset the same fan-out is 3. Production will not see the runaway staff count, but it has no retention either: 20 staff × 200 events/day is ~1.5M rows a year, growing forever. Schedule `pruneNotifications.js` (default: read 30d, unread 90d) in any environment that runs longer than a demo.

There **is** an automated end-to-end suite: `frontend/tests/e2e/` holds 26 Playwright specs (151 tests, ~105s) run with `npm test` (or `npm run test:ui`) from `frontend/`. It assumes **both dev servers are already running** and hits the real database — see `frontend/tests/e2e/README.md`. There are no unit tests; the backend has no test script.

The suite is a deliberately small demo-and-regression net, not exhaustive coverage: smoke, security boundaries (`api-authorization.spec.js` — Admin-vs-SuperAdmin separation of duties, combined-role access, and the cross-role PHI boundaries), ticket-release gating, payments, laboratory results, statutory discounts (`discounts.spec.js`), result amendment history and critical values (`result-versioning.spec.js`), password-change session revocation (`session-revocation.spec.js`), account lockout and PHI read auditing (`login-protection.spec.js`), permission-matrix enforcement (`rbac-enforcement.spec.js`), department-scoped patient records (`department-scoping.spec.js`), the per-department operations report (`operations-report.spec.js`), atomic online booking with its HMO card evidence rule (`booking-atomicity.spec.js`), the two dialogs that feature added (`hmo-card-review.spec.js` — because a card that uploads correctly and then renders as a broken image on the approval screen is a working feature failing at its job), moving a booking rather than cancelling it (`appointment-reschedule.spec.js`, plus `reschedule-ui.spec.js` for the dialog), when a visit must name the doctor who requested the test (`referring-physician.spec.js`), correcting a patient record (`patient-edit.spec.js` / `patient-edit-ui.spec.js`), what the patient is told about their own booking (`booking-communication.spec.js`), that the ETag revalidation cache never hides a change (`revalidation.spec.js`), that each role can see what it needs on the screen where it acts (`workflow-context.spec.js`), registering a walk-in in one pass (`walkin-registration.spec.js`), the patient journey at phone width (`mobile-patient.spec.js`), what an HMO decision has to record before it counts as one (`hmo-decision-trail.spec.js` — a refusal that names no reason leaves the cashier explaining a charge nobody wrote down), and the three-step claim workflow itself (`hmo-claim-handoff.spec.js` — reception raises it, an Admin decides it, and the cashier has to be TOLD). It was cut down from ~200 tests once the module-by-module build-out finished; the rest asserted UI copy that legitimately keeps changing. Prefer adding a focused spec over reviving deleted ones from git history.

**A booking spec must claim its own slot.** `POST /appointments` returns the *existing* booking with 200 when the same patient re-submits the same date and time, so two tests that both take "the first available slot" silently share one visit — and `avail.slots.find(s => s.available)` will not stop them, because a dev database whose cap has been lifted (`cleanE2eData.js --apply --unlimited-slots`, which exists because 18 slots a day cannot absorb repeated runs) reports every slot as available however many bookings it holds. `booking-atomicity.spec.js` and `ticket-release-gating.spec.js` each keep a `claimed` set for this. Symptom when you get it wrong: a create test receives 200 instead of 201, or a test finds a visit some earlier test already checked in.

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
- `authorizePermissions(...perms)` gates by fine-grained permission strings (e.g. `billing:process`) and is **enforced on 53 routes**. **SuperAdmin bypasses; Admin does not** — that single difference is what separates the two roles.
- **`authorizeStaff` replaced the hardcoded role lists on 45 routes [1.20.0].** It asks only "is this a member of staff"; the permission decides the rest. Before this, `POST /payments` named `('SuperAdmin', 'Cashier')` and every result route named the three modality roles, so granting a cashier permission to Laboratory Staff saved, reported success and changed nothing — the matrix could not actually delegate, which is worse than having no matrix. Routes whose role list includes `Client` keep it: that is the one boundary a tick must never cross. Those routes pair the list with a permission anyway, and `verifyRbacWiring.js` then insists every named role holds it — which is why the Client role grants `hmo:request` and `hmo:read` (both ownership-scoped in `hmoService`) rather than the card and claim routes going ungated.
- **"Is this staff?" has exactly one definition: `isStaffUser` in `src/constants/roles.js`** — holds any role that is not `Client`. `authorizeStaff` uses it, and so do the two places that need the same question answered as a *business* rule (whether an HMO claim needs a card photo, in `hmoService.resolveCardEvidence` and `appointmentController.create`). A local `['SuperAdmin','Admin','Receptionist','Cashier']` list is the wrong shape twice over: it has to be found and edited whenever a role is added, and it disagrees with the matrix the moment a permission like `hmo:request` is delegated to a role the list does not mention.
- **Three axes, resolved server-side in `userRepository` so no caller can disagree with another:**
  - `roles` — staff or patient. Structural, not editable from any screen.
  - `permissions` — the role template **plus** that account's own grants, **minus** its revokes (`user_permissions`). Revoke is applied last as a set difference, so a conflict resolves to *less* access.
  - `departments` — the modalities implied by the account's roles **plus** `user_departments`. `null` means unrestricted (Admin/SuperAdmin) and is deliberately distinct from `[]`, "none"; collapsing the two is how an access check ends up inverted. Enforced in the service layer — see `resultService.assertStaffAllowedCategory`.
- Per-account exceptions are edited on **Access Control** (SuperAdmin → By Person) and are **audited**. Role edits are not: a role change is visible in the matrix everyone reads, while an exception applies to one person and is easy to forget.
- **Adding a permission to a route, or a nav item?** Run `node src/scripts/verifyRbacWiring.js`. Four checks: the permission exists; at least one staff role holds it (otherwise only SuperAdmin can reach the route); for routes that keep an explicit role list, every named role holds it; and every `permission:` in `frontend/src/config/navigation.js` is one the API actually enforces. That last check is what now guarantees the sidebar and the API agree — they used to agree by sharing a hardcoded role list, and no longer do.
- Navigation gates on the same three axes (`canSee` in `frontend/src/config/navigation.js`: `staffOnly`, `permission`, `department`), so the sidebar cannot advertise a screen the API will refuse. `AuthContext` re-reads `/auth/me` every 60s and on tab focus, so a change reaches a signed-in user without a re-login.
- Roles/permissions are DB-driven (`roles`, `permissions`, `user_roles`, `user_permissions`, `user_departments`), seeded via `setupRbac.js`.
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

**Transactions:** `db.withTransaction(fn)` in `src/config/database.js` makes every query issued underneath it — at any call depth, through any repository — run on one connection and commit as a unit. It uses `AsyncLocalStorage`, so repositories need no `client` argument and cannot accidentally write outside the transaction. Nested calls join the transaction already in progress. **Never call `db.pool.connect()` directly**: a self-managed client inside a `withTransaction` opens a second, independent transaction that commits on its own, and with a bounded pool it deadlocks once every connection is held by a transaction waiting for another connection. Any service method performing 2+ writes that must succeed together belongs in `withTransaction`; keep bcrypt hashing and outbound email/HTTP *outside* it so a pooled connection is not held during slow work. No code under `src/services` or `src/repositories` manages its own client any more — the only `pool.connect()` calls left are inside `withTransaction` itself and in one-shot migration scripts, which run alone.

**`createAppointment` is the shape to copy for "commit, then do the after-work".** It writes the visit, the appointment, the tests and any HMO claim in one `withTransaction`, and everything that must only happen *after* a successful commit — the staff notification, discarding an unused card upload — sits after the `try`, not inside it. The version this replaced tracked a `committed` boolean so its own `catch` would know whether the COMMIT had already run; a post-commit throw would otherwise have issued ROLLBACK on a committed transaction and reported a real booking as failed. Structuring it this way removes the flag rather than maintaining it.

**An uploaded file is never named from what the client sent, and never served statically.** All three upload paths (`src/config/upload.js`) build the stored filename from random hex plus an extension mapped from the *validated* mime type, and re-check containment with `assertInside`. The extension used to come from `file.originalname`, which combined with a `%2F`-encoded route param let a request choose both the directory and the suffix — and multer writes before the controller's authorization check runs, so the 403 arrives after the file is on disk. Result files, avatars and HMO cards are all streamed back through an authenticated, ownership-checked route: an HMO card carries a member number, a name and often a photo.

**PHI reads are audited; keep the scope narrow.** `auditService.logPhiRead` records reads of an *identified patient's* records (demographics, result history, report file). Do not add it to searches, worklists or queues — staff refresh those constantly, and the entries that matter would drown in traffic that is just people doing their job. That is the fan-out mistake that took `notification_reads` to 255,540 rows.

**`test_results` is versioned — always filter on `is_current`.** A test carries one row per version of its report (an amendment supersedes rather than overwrites; see [1.15.0]). A `LEFT JOIN test_results` without `AND tr.is_current` repeats the parent row once per amendment and shows superseded findings beside live ones, and an `UPDATE … WHERE visit_test_id = $1` without it rewrites the history. `findVersionHistoryByVisitTestId` is the only intentional reader of superseded rows.

**Never filter on `column::date`.** A B-tree index cannot serve a predicate on an expression, so `WHERE created_at::date = CURRENT_DATE` silently forces a sequential scan no matter what is indexed — `idx_patient_visits_created` existed for a year and was never used. Write half-open ranges on the raw column instead: `col >= $1::date AND col < ($2::date + 1)`. Measured at 219k rows: 50.7ms seq scan vs 0.84ms index scan. Casting in `SELECT`/`GROUP BY` is fine; only the filter matters.

**Statutory discounts are VAT-exempt, and the order matters.** The clinic is VAT-registered, so a Senior Citizen / PWD sale has the 12% VAT stripped **first** and the 20% applied to the VAT-exempt base (RA 9994 / RA 10754). A flat 20% off the shelf price overcharges the patient — 800.00 instead of 714.29 on a 1,000.00 service. `tests.price` is stored VAT-inclusive, so VAT is extracted rather than added. Only `is_statutory` discounts get this; a promo rate is an ordinary discount. See `discountService.computeBreakdown`.

**Dates: never use `toISOString()` for "today".** It returns the **UTC** date, which in Philippine time (UTC+8) is *yesterday* between midnight and 08:00 — silently, with no error. Postgres `CURRENT_DATE` is the server's local date, so the two disagree every morning. Frontend code uses `frontend/src/lib/date.js` (`todayStr` / `daysAgoStr`, built from local getters); backend code derives date strings **in SQL** rather than in JavaScript. This bug shipped twice: in four dashboard `todayStr` helpers, and in the receipt-number generator.

**Numbers that must be unique** (queue tickets, receipt numbers) come from `daily_counters` via `INSERT … ON CONFLICT DO UPDATE … RETURNING`, never from `SELECT COUNT(*) + 1`. Counting rows is not a sequence: it races under concurrency, and it rewinds when a row is cancelled or refunded, reissuing a number already handed to a patient. Unique indexes back all three invariants. Core flow through the tables:

`users` → `patients` (1:N via `user_id` — one account owns several profiles, e.g. a parent booking for dependents; `GET /patients/my-profiles` is plural for this reason, and ownership checks must compare per-patient rather than resolving a user to a single patient) → `patient_visits` (a clinic visit/queue entry) → `visit_tests` (tests attached to a visit, priced via `price_at_time`) → `test_results` (findings/file per visit_test, released by staff) and `payments` (billed against a visit). `appointments` link to a `patient_visit`. `hmo_requests` link a visit to an `hmo_providers` approval flow. `tests` belong to a `test_categories` row (Laboratory/Xray/Ultrasound/2D Echo/ECG) and have an `is_active` flag that controls public visibility.

**Polling revalidates rather than refetching.** Four screens poll to stay live, and a measured
idle reception terminal made 240 requests and pulled ~1.5 MB an hour — roughly 500,000 requests
and 3.2 GB a month across ten staff, nearly all of it re-sending unchanged bytes. Express already
emitted an `ETag` on every JSON response and already answered a matching `If-None-Match` with a
0-byte 304; **CORS was not exposing the validator to JavaScript**, so nothing ever asked. Two
lines of CORS config (`exposedHeaders: ['ETag']`, and `allowedHeaders` including `If-None-Match`)
plus `frontend/src/config/revalidationCache.js` cut measured traffic 47% over 95 seconds, and more
the longer a screen stays open.

The validators are held **in memory**, not via `Cache-Control`. The conventional header approach
would write active patient queues and result histories into the browser's on-disk HTTP cache,
where they outlive the logout and are keyed by URL alone — so two accounts on one reception
terminal would share them. The in-memory map is cleared on sign-out and on any 401. If you add a
polled endpoint it gets this for free; if you add one whose response must never be reused, give it
a distinct URL rather than trying to opt out.

`revalidation.spec.js` is the guard that matters here. The bandwidth is not the risk — a cache
that answers "nothing changed" when something did is, and a receptionist watching a queue that has
silently stopped updating is worse off than one on a slow connection.

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

- **The printed receipt is `components/Receipt.jsx`**, and the clinic's own identity is
  `lib/clinic.js`. Two rules. First, anything inside `.print-area` prints, including a toolbar
  that happens to be nested there — the old receipt's Print button printed itself; mark chrome
  `no-print`. Second, `lib/clinic.js` leaves `tin` / `businessPermit` blank unless configured
  (`VITE_CLINIC_TIN`), and the receipt then says it is *not* a BIR-registered Official Receipt.
  Do not invent those numbers to make it look official — a patient may file it for reimbursement.
- **A sticky action bar cannot be the last child.** `position: sticky` is constrained by its
  containing block, so an element already at the end of one has no space to slide into and never
  moves. The cashier's Take Payment button was measured at y=904 on a 900px viewport that way. It
  is a pinned *header* now, with the button outside the form reaching it via `form="checkout-form"`.
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
