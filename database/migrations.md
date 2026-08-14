# Database Migration & Schema History

## [1.15.0] - 2026-08-15 (Result versioning and critical-value flagging)

Run: `node src/scripts/migrateResultVersioning.js` (additive, safe to re-run)

### Fixed — a correction destroyed the original
`test_results` carried `UNIQUE(visit_test_id)` and `createResult` was an `ON CONFLICT DO UPDATE`, so editing an already-released result overwrote findings, remarks and file metadata **in place**. A radiology report issued to a patient could be silently rewritten with nothing anywhere recording what it originally said, and the audit entry noted only *that* a correction happened — never what changed, and the previous text no longer existed to compare against.

That is indefensible for a diagnostic report. The patient may have acted on the first version, and a referring physician certainly may have.

Each save now writes a **new row with an incremented version**. The previous row is marked `is_current = FALSE` and points at its replacement through `superseded_by`, so the chain is walkable in both directions. `amendment_reason` is required by the UI on an amendment, and the audit entry now names both versions and the reason.

### Fixed — a panic value released like a routine result
A critical result went out with the same silent "your results are ready" email as a normal CBC. `is_critical` is set by whoever records the findings and, on release, routes an urgent notification (with the patient's phone number) to Receptionist/Admin/SuperAdmin, and replaces the patient email with one asking them to contact the clinic. `critical_acknowledged_at` / `_by` / `_note` record the callback actually being made — the flag is the cheap half; the evidence that a human made contact is the part with medico-legal weight.

### Added
* `test_results.version` / `is_current` / `superseded_by` / `amendment_reason`.
* `test_results.is_critical` / `critical_acknowledged_at` / `critical_acknowledged_by` / `critical_acknowledgement_note`.
* Partial unique index `uq_test_results_current_per_test ON test_results(visit_test_id) WHERE is_current` — replaces the old `UNIQUE(visit_test_id)`, keeping "exactly one current result per test" (the invariant that UNIQUE was really protecting) while allowing history.
* `GET /api/results/:visitTestId/versions` (amendment history, department-scoped like every other result read) and `POST /api/results/:visitTestId/acknowledge-critical` (callback log — deliberately open to Receptionist, since the front desk usually makes the call and a callback that cannot be recorded by whoever made it does not get recorded).
* `'critical'` added to `chk_notification_events_type`.

### Watch out for
**Every reader of `test_results` must filter on `is_current`.** A `LEFT JOIN test_results` without it repeats the parent row once per amendment and shows superseded findings beside live ones. All five existing readers were updated (`findReleasedByCategory`, `findResultsByPatientId`, `findResultByVisitTestId`, `markReleased`, and `reportRepository.getDiagnosticWorkload` — the last would otherwise have inflated a clinician's throughput every time somebody corrected a report). A spec asserts lists never repeat a row per version.

`markReleased` in particular needed it: without the filter it stamped the releasing user onto *every* superseded version, rewriting the attribution of reports authorised by someone else at an earlier time — destroying exactly the history versioning was added to keep.

### Also found while building this
`notification_events.type` was CHECKed to `('info','success','warning')` and `notificationService` **silently coerces** anything else to `'info'`. The critical escalation was therefore arriving in the notification bell looking exactly like "New Appointment Booked". Nothing errored and nothing was lost, which is precisely why it would never have been noticed. `'critical'` is now a real severity, the notification list renders it distinctly (red, with an icon, not colour alone), and an unknown type is logged rather than downgraded in silence.

---

## [1.14.0] - 2026-08-15 (Statutory Senior Citizen / PWD discounts)

Run: `node src/scripts/migrateDiscounts.js` (additive, safe to re-run)

### Added
* `discount_types` catalogue, seeded with the two discounts mandated by **RA 9994** (Senior Citizen) and **RA 10754** (PWD) at 20%. Modelled generally rather than as two hardcoded cases, because the same shape covers the commercial discounts a clinic also needs (corporate, employee, promo) at no extra cost. `is_statutory` marks the two that exist by law: they require the holder's ID to be recorded, and are not meant to be deactivated.
* `patient_visits.discount_type_id` / `discount_id_number` / `discount_granted_by` / `discount_granted_at` — the **entitlement** claimed for a visit. It lives on the visit because the bill is computed per visit and the cashier must see the discounted total *before* taking any money.
* `payments.discount_amount` / `discount_type_name` / `discount_id_number` — an immutable **snapshot** of what was actually deducted. Deliberately not a foreign key: a receipt is a historical record and must keep saying what it said even if the catalogue is later renamed or re-rated, exactly as `visit_tests.price_at_time` does for prices. The statutory register reads from here, so it reflects money that actually changed hands.
* `GET /api/discounts` (catalogue), `POST|DELETE /api/discounts/visit/:visitId` (grant/remove, audit-logged), and `GET /api/discounts/register` (Admin/SuperAdmin only) — the separate register BIR expects for mandated discounts, with per-type totals. Refunded rows are listed but excluded from the totals: a reversed sale is not a discount the clinic granted.

### Why this mattered more than a missing feature
The clinic could not lawfully bill a senior citizen or PWD — the only occurrence of the word "discount" anywhere in the app was a mislabel on the HMO coverage line. The practical consequence is not that seniors paid full price; it is that cashiers work around it, by editing the catalogue price or taking the difference in cash and out of the system. Either one destroys the receipt trail that every other control in this codebase depends on.

### Decisions worth knowing
* **The discount base is the patient's out-of-pocket amount** (subtotal − approved HMO coverage), not the gross subtotal. A statutory discount reduces what the *patient* pays; applying it to amounts an insurer is settling would discount somebody else's money and understate the HMO receivable.
* **VAT is deliberately not modelled.** For a VAT-registered establishment the statute requires the 12% VAT to be stripped first and the 20% applied to the VAT-exempt base; for a non-VAT establishment it is a flat 20%. This system has no VAT decomposition anywhere — `tests.price` is a single figure with no tax component — so the flat percentage is correct for a non-VAT clinic and understates the discount for a VAT-registered one. Which applies depends on the clinic's BIR registration, so it is flagged in `discountService.computeDiscount` rather than silently assumed.
* **A discount cannot be changed once the visit is paid** (409). Changing it afterwards would disagree with the receipt already issued and with the register, and there is no re-bill path; a correction goes through the existing refund flow.

### Fixed
* **Receipt numbers carried the wrong date for eight hours of every day.** The date portion was formatted in JavaScript with `new Date().toISOString()` — which is UTC — while the sequence came from Postgres `CURRENT_DATE`, which is the server's local date. In Philippine time (UTC+8) a payment taken at 01:00 on the 15th was stamped `RCT-20260814-…` from the 15th's counter. Both halves now come from the same row in one statement, so they cannot disagree. With `uq_payments_receipt_number` in place from [1.13.0] this had also become a *failed payment* rather than a silent mis-dating, since the stamp reappeared the next morning.
* The same UTC-vs-local bug in four frontend screens (`todayStr` defined separately in each), which made "Today's Revenue" and the default History ranges show *yesterday* between midnight and 08:00. Now one shared `frontend/src/lib/date.js` built from local getters.
* The cashier's **"Print Receipt" produced a blank page** — `index.css` hides `body *` and reveals only `.print-area`, and the receipt modal never carried the class. On the one document a patient actually leaves with.

---

## [1.13.0] - 2026-08-14 (Concurrency-safe numbering, billing uniqueness, real transactions)

Run: `node src/scripts/migrateDataIntegrity.js` (additive, safe to re-run)

### Fixed
* **`schema.sql` could not be applied at all.** `test_results` declared `fk_results_recorded_by` twice on consecutive lines. PostgreSQL rejects a duplicate constraint name (42710), and `migrateDb.js` submits the file as a single statement — so the implicit transaction rolled back *everything*, including the `DROP TABLE`s at the top. The existing dev database predates the line, which is why nobody hit it; the first person to provision staging or production would have got a hard stop and zero tables. Now verified by applying the file to a throwaway database (22 tables, 25 foreign keys).
* **Queue numbers and receipt numbers were generated by `SELECT COUNT(*) … + 1`** followed by a separate INSERT, with nothing enforcing uniqueness behind them. Two receptionists registering at the same moment issued the same ticket; two cashiers settling at the same moment issued the same official receipt number. Both also had a no-concurrency trigger: counting *surviving rows* rather than *issuances* meant cancelling a visit, or refunding a payment, rewound the sequence and reissued a number already handed to someone.
* **The same visit could be charged twice** — `hasPaidPayment()` then INSERT, with no constraint behind it. A double-clicked "Confirm Payment" or a retry after a network blip took the money twice, and because the pre-check then returned true the duplicate was never flagged. Both rows counted toward revenue reporting.

### Added
* `daily_counters (counter_date, counter_name, last_number)` — one atomic per-day sequence, shared by queue tickets and receipts. Issued via `INSERT … ON CONFLICT DO UPDATE … RETURNING`, which takes a row lock so concurrent callers serialise. Seeded from existing visits and payments so numbering continues rather than restarting and colliding with numbers already in circulation.
* Unique index `uq_patient_visits_daily_queue` on `(created_at::date, queue_number)`.
* Unique index `uq_payments_receipt_number` on `receipt_number`.
* Partial unique index `uq_payments_one_paid_per_visit` on `payments(patient_visit_id) WHERE payment_status = 'Paid'` — a visit may still accumulate cancelled/failed gateway attempts and a refunded row, but only one settled charge.
* `db.withTransaction(fn)` in `config/database.js`. Uses `AsyncLocalStorage` so every query issued underneath it — at any call depth, through any repository, across any await — joins the same connection automatically. Chosen over threading a `client` argument through 100+ call sites in 14 repositories because that change fails *silently*: miss one and the write quietly commits outside the transaction, which is the exact bug the transaction was added to prevent. Nested calls join the transaction in progress rather than opening a second one.
* Connection pool bounds and timeouts (`max`, `connectionTimeoutMillis`, server-side `statement_timeout`) plus an idle-client error handler, so a database hiccup no longer takes the process down.

### Changed
* Multi-write flows are now atomic: client and staff account creation (previously could leave a user with valid credentials and no role — able to log in, landing nowhere, invisible to Admin's staff list because that query inner-joins `user_roles`, and unrecoverable because the email is taken), password reset (previously could change the password without consuming the token, leaving a live reset link in an inbox), result release, HMO request creation, appointment cancellation, and role-permission edits.
* Role grants now honour `starts_at` / `expires_at`. Both columns have existed since [1.0.0] and nothing ever read them, so a deliberately time-bounded grant never actually ended. This was the one revocation path that [1.11.0]'s per-request authorization did not already cover.

---

## [1.12.0] - 2026-08-14 (Separate result recording from result release)

### Added
* `test_results.recorded_by` — the staff member who wrote the findings. Backfilled from `released_by`, which is accurate for every pre-existing row since only the upload path ever set it.
* `test_results.authorised_at` — when release was authorised. The existing `released_at` is set on INSERT (i.e. when findings were recorded) and is deliberately left as-is rather than redefined underneath code that already reads it.
* `idx_test_results_recorded_by`, for per-staff workload reporting.

### Why
* `releaseResult()` was handed the releasing user's id by its controller and then silently dropped it — only the findings-upload path ever wrote `released_by`. A column named "released by" was therefore recording whoever last *typed the findings*. This is invisible while one person performs both steps, and exactly wrong the moment they are two people — which is the case the workflow is built around, since recording findings and authorising their release are separate events and `'Waiting for Release'` exists as a state precisely to separate them.
* Found while testing a temporarily-granted role: a Laboratory user borrowing Ultrasound access recorded findings, the Ultrasound staff released them, and the record credited the Laboratory user with the release.

### Migration
* `node src/scripts/migrateResultAttribution.js` — additive and idempotent.

## [1.11.0] - 2026-08-14 (Foreign-key and status indexes)

### Added
* 23 indexes covering every foreign key on the visit chain (`patients.user_id`, `patient_visits.patient_id`, `visit_tests.patient_visit_id`, `test_results.visit_test_id`, `payments.patient_visit_id`, `appointments.patient_visit_id`, the HMO join table, `user_roles`, `role_permissions`, `notification_reads.event_id`, `password_reset_tokens.user_id`, `tests.category_id`) and the status/date columns behind the queue screens (`patient_visits.status`, `visit_tests.status`, `payments.payment_status`, `appointments.status`, `appointments(scheduled_date, scheduled_time)`, `patient_visits.created_at`, `test_results.released_by`, `notification_events.created_at`).

### Why
* PostgreSQL indexes PRIMARY KEY and UNIQUE columns automatically but **not** foreign keys. The schema had three indexes in total, all added recently for specific features, so every join across the visit chain and every queue filter was a sequential scan — and each delete of a parent row scanned the entire child table to check for references. Invisible on a small database; it surfaces after a year of real visits as screens that were instant becoming slow together.

### Migration
* `node src/scripts/migrateIndexes.js` — additive and idempotent (`CREATE INDEX IF NOT EXISTS`), safe to re-run. `schema.sql` carries the same statements for fresh installs. A column missing on an older database is logged and skipped rather than aborting the run.

## [1.10.0] - 2026-08-12 (Ticket Release Gating + Online Payment Gateway)

### Changed
* `visit_tests.chk_visit_tests_status` widened to allow **`'Waiting for Release'`**: the state between `'Processing'` (released to a modality, exam not yet performed) and `'Completed'` (result released to the patient). Recording findings and releasing them are two distinct clinical events and now have two distinct states, both visible to the front desk.

### Added
* `payments.gateway_provider`, `payments.gateway_session_id`, `payments.gateway_payment_id` — links a payment row to an online GCash/Maya checkout session (PayMongo hosted checkout). NULL for counter payments. Plus `uq_payments_gateway_session` (UNIQUE) and `idx_payments_gateway_session`, which the webhook uses to resolve a session back to its pending payment.
* A gateway payment is inserted as `payment_status = 'Pending'` when the patient is redirected, and only flips to `'Paid'` when a signature-verified `checkout_session.payment.paid` webhook arrives. The browser's return to `success_url` is never trusted — it is a plain URL the patient can navigate to directly.

### Migration
* Applied additively by **`backend/src/scripts/migrateTicketFlow.js`** (idempotent, runs in a single transaction, safe to re-run) rather than by `migrateDb.js`, which is destructive and would discard accumulated seed/test data. Same approach as [1.5.0] through [1.9.0]. `schema.sql` remains canonical for fresh installs and already carries every change above.

```bash
cd backend && node src/scripts/migrateTicketFlow.js
```

### Behavioural consequence (no schema change, but load-bearing)
* `resultRepository.findPendingByCategory` now joins `patient_visits` and requires `pv.status = 'Processing'`. Previously it filtered on `visit_tests.status` alone and never looked at the parent visit, so a ticket appeared on a modality worklist the instant a client attached tests during online booking — before confirmation, before payment, and even for cancelled visits.

## [1.9.0] - 2026-08-12 (UI/UX Modernization Phase 8: profile avatar upload)

### Added
* `users.avatar_path VARCHAR(255)`, `avatar_mime_type VARCHAR(100)` (both nullable) — backs a real profile-photo upload on the My Account/Profile page, available to every role (self-service only, no admin-on-behalf-of upload). Reuses the multer disk-storage pattern from [1.7.0] (`backend/uploads/avatars/`, server-generated filename keyed on the uploading user's own ID + random hex, never the client-submitted name). `GET /auth/me/avatar` streams the file back through an authenticated route (never `express.static`) since profile photos aren't public. Uploading a new photo deletes the previous file from disk (best-effort, doesn't fail the request if cleanup fails); `DELETE /auth/me/avatar` removes it entirely, falling back to the existing initials-circle UI.
* Deliberately self-only and profile-page-scoped: the existing initials-circle avatars elsewhere in the app (sidebar user-info block, public header user chip) are unchanged — replacing those with the uploaded photo everywhere they appear was judged a separate, larger UI sweep beyond this phase's "My Account" scope.
* Applied additively directly against the live dev database, same as [1.6.0]-[1.8.0]. `schema.sql` updated to match for fresh installs. New `backend/uploads/avatars/` directory covered by the existing `backend/uploads/` gitignore entry from [1.7.0].

## [1.8.0] - 2026-08-11 (Feature Gap Plan Phase D: audit trail, staff workload, patient lookup context)

### Added
* `audit_log(id, actor_id → users.id, actor_name, action, entity_type, entity_id, description, created_at)`, plus `idx_audit_log_created_at`. `actor_name` is denormalized (not just a join to `users`) so a log entry stays legible even if the actor's account is later renamed or removed — it's a record of what happened, not a live view of current user data. Backs a new `GET /admin/activity` endpoint and Admin/SuperAdmin "Activity" page. Scoped to the sensitive actions already built this session — payment refund/cancel, staff password reset/status toggle, HMO provider create/update, result corrections — rather than instrumenting every write path in the app.
* No new columns needed for staff workload (Reception check-ins grouped by `patient_visits.created_by`, Diagnostic releases grouped by `test_results.released_by`) or patient-lookup financial context (`patients.searchPatients` gained correlated-subquery visit/unpaid counts) — both reuse existing columns.
* Applied additively directly against the live dev database, same as [1.7.0]/[1.6.0]. `schema.sql` updated to match for fresh installs.

## [1.7.0] - 2026-08-11 (Feature Gap Plan Phase B: real diagnostic result file upload)

### Added
* `test_results.file_path TEXT`, `file_original_name TEXT`, `file_mime_type TEXT`, `file_size_bytes INT` — this is the headline finding from the original gap-analysis pass: releasing a diagnostic result never actually stored a file, only `file_url` (a free-text string a staff member had to fill in with a link to somewhere else). These columns back a real upload, handled by `multer` (disk storage, `backend/uploads/results/`, server-generated filenames — never the client-submitted name, closing off path traversal). `file_url` is kept as-is (nullable) as a legacy/graceful fallback; new uploads populate the four new columns instead and leave `file_url` null.
* New `GET /results/:visitTestId/file` — authenticated, ownership-checked (reuses `assertStaffOwnsVisitTest` for staff, the same Client-owns-this-patient check `resultController.getPatientHistory` already performs) file download route. Deliberately not served via `express.static` — these are PHI, and a public static path would make every file reachable by anyone who guesses or leaks a URL.
* Applied additively (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) directly against the live dev database, same as [1.6.0]/[1.5.0], to avoid discarding accumulated seed/test data. `schema.sql` updated to match for fresh installs. `backend/uploads/` is gitignored — uploaded files are local/instance state, not source.

## [1.6.0] - 2026-08-11 (Feature Gap Plan Phase A: refund/void, HMO provider management)

### Added
* `payments.refund_reason TEXT` (nullable) — captures why a payment was moved to `Refunded`/`Cancelled` via the new `PATCH /payments/:id/status` endpoint. The status values themselves (`Refunded`, `Cancelled`) already existed in `payments.payment_status`'s CHECK constraint since the [1.0.0] baseline; no endpoint ever set them until this phase.
* `hmo_providers.is_active BOOLEAN DEFAULT TRUE` — backs the new provider CRUD (`POST`/`PUT /hmo/providers`). Providers are deactivated, not deleted, since `hmo_requests` holds a `NOT NULL` FK to `hmo_provider_id` and a hard delete would either fail or orphan historical requests.
* Applied additively (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) directly against the live dev database, same as [1.4.0]/[1.3.0], to avoid discarding accumulated seed/test data. `schema.sql` updated to match for fresh installs.

## [1.5.0] - 2026-08-10 (Module 18: Notification — normalization refinement)

### Changed
* Replaced the single `notifications(id, user_id, title, message, type, is_read, created_at)` table from [1.4.0] with two tables: `notification_events(id, title, message, type, created_at)` and `notification_reads(id, event_id → notification_events.id ON DELETE CASCADE, user_id → users.id ON DELETE CASCADE, is_read, UNIQUE(event_id, user_id))`, plus `idx_notification_reads_user (user_id, is_read)`.
* Reason: the original design inserted one full row (duplicating `title`/`message`/`type`/`created_at`) per broadcast recipient. That's not a formal normal-form violation (each row is fully determined by its own single-column key), but it duplicates event content N times per broadcast with no single place to correct it — a genuine event/read-state entity split. This shape separates the event (written once, immutable) from who has read it (per-user, mutable).
* No API contract change — `GET /notifications`/`PATCH /notifications/:id/read`/`PATCH /notifications/read-all` return the identical JSON shape as before (`notificationRepository.js` joins the two tables and aliases columns back to the original flat shape), so `notificationService.js`, the controller, routes, and the frontend needed zero changes. Applied additively/replacively on the live dev DB (old `notifications` table dropped — held only disposable test data from Module 18's own verification).

## [1.4.0] - 2026-08-10 (Module 18: Notification)

### Added
* `notifications(id, user_id → users.id ON DELETE CASCADE, title, message, type CHECK IN ('info','success','warning'), is_read, created_at)`, plus `idx_notifications_user_created (user_id, created_at DESC)`. Backs the real notification center behind `SidebarLayout.jsx`'s previously-static mock list. A broadcast-to-role event (e.g. "a new appointment was booked") fans out into one row per recipient user at insert time, rather than one shared row per event — each recipient gets an independent read state instead of racing to mark a shared row read.
* Applied additively (`CREATE TABLE IF NOT EXISTS`) directly against the live dev database rather than via a full `migrateDb.js` re-create, to avoid discarding the substantial accumulated seed/test data from Modules 1–17. `schema.sql` is still the canonical source of truth for fresh installs.

## [1.3.0] - 2026-08-10 (Module 1: Authentication — Password Reset)

### Added
* `password_reset_tokens(id, user_id → users.id ON DELETE CASCADE, token_hash UNIQUE, expires_at, used_at, created_at)` — supports the forgot-password/reset-password flow (`POST /api/auth/forgot-password`, `POST /api/auth/reset-password`). Only a SHA-256 hash of the emailed token is persisted. Tokens are single-use (`used_at`) and expire after 1 hour; a new request deletes any prior unused tokens for that user.
* This closes the "Forgot password?" dead-button gap and the Google-OAuth-only-account login gap documented in `.agents/MODULE_SCOPE.md`'s Known Gaps — a Google-created account can now obtain a real, usable password via reset.


This file tracks all structural changes, migrations, and updates made to the PostgreSQL schema.

## Canonical database initialization sequence

Run these three scripts from `backend/`, in this exact order, against a fresh database:

```bash
node src/scripts/migrateDb.js     # (re)creates all tables from database/schema.sql, incl. permissions/role_permissions — destructive, drops/recreates
node src/scripts/setupRbac.js     # seeds permissions + role_permissions data (requires the tables above to already exist)
node src/scripts/seedUsers.js     # seeds one demo user per role
```

There is no single combined command — this is a deliberate three-step sequence, not an oversight. `migrateDb.js` owns structure only; `setupRbac.js` and `seedUsers.js` own data.

---

## [1.2.0] - 2026-08-10

### Fixed
* **RBAC schema/migration drift**: `permissions` and `role_permissions` were previously created ad hoc by `backend/src/scripts/setupRbac.js` (`CREATE TABLE IF NOT EXISTS`), entirely outside `schema.sql`/`migrateDb.js`, and undocumented here. Consequence: re-running `migrateDb.js` (`DROP TABLE roles CASCADE`) silently dropped `role_permissions`' foreign-key constraint to `roles` without recreating it (`CREATE TABLE IF NOT EXISTS` is a no-op once the table exists), leaving stale `role_id` values with no enforced referential integrity.
* `permissions` and `role_permissions` are now created by `schema.sql` itself (in the "Roles and RBAC" section, right after `user_roles`), with proper `DROP TABLE ... CASCADE` entries at the top of the file alongside every other table. They are now dropped and recreated together with `roles` on every `migrateDb.js` run, so the FK relationship can never be left orphaned.
* `setupRbac.js` no longer creates these tables (removed its `CREATE TABLE IF NOT EXISTS` statements) — it is now a pure data-seeding script with an explicit precondition that `migrateDb.js` has already been run. Its seed data (13 permissions, per-role mappings) is unchanged.

---

## [1.1.0] - 2026-08-09

### Added
* Created `clinic_operating_hours` table (per-weekday open/close window, slot granularity, and per-slot capacity) to drive dynamic appointment availability.
* Seeded default operating hours: Mon-Fri 08:00-17:00, Sat 08:00-12:00 (30-minute slots), Sunday closed.
* Added `GET /api/appointments/availability?date=YYYY-MM-DD` endpoint (new `scheduleRepository`) returning bookable time slots for a given date, computed from `clinic_operating_hours` minus already-booked, non-cancelled `appointments` rows.

### Changed
* `appointmentService.createAppointment` now performs a transactional, capacity-aware conflict check (Postgres advisory lock + row count against `max_concurrent_bookings`) before inserting an appointment, rejecting out-of-hours or already-full slots with HTTP 409.

---

## [1.0.0] - 2026-08-05 (Baseline)

### Added
* Created baseline [schema.sql](file:///c:/Users/Steven/Desktop/Enlogada%20Clinic%20Management%20System/database/schema.sql).
* Configured core tables: `roles`, `users`, `user_roles`, `patient_types`, `patients`, `patient_visits`, `appointments`, `test_categories`, `tests`, `visit_tests`, `hmo_providers`, `hmo_requests`, `hmo_request_tests`, `test_results`, and `payments`.
* Seeded default static values for Roles, Patient Types, Test Categories, and initial HMO Providers.

### Changed from Initial Draft
* **Removed Pet support**: Excluded `is_pet`, `species`, and `breed` details from `patients` as the clinic has finalized that they only handle human patients.
* **Added `queue_number` column** to `patient_visits` to support front desk and cashier workflow.
* **Added `appointment_reference` column** to `appointments` to support QR code generation/lookup.
* **Added `receipt_number` column** to `payments` to track cashier receipt issuance.
* **Enforced Referential Integrity**: Added missing foreign keys for audit trail fields pointing back to `users(id)`:
  * `patient_visits(created_by)`
  * `payments(processed_by)`
  * `test_results(released_by)`
  * `user_roles(assigned_by)`
