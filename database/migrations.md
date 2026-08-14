# Database Migration & Schema History

## [1.18.0] - 2026-08-15 (Date predicates that can actually use an index)

Run: `node src/scripts/migrateQueryPerformance.js` (additive, safe to re-run)

### Fixed — every date-ranged screen was doing a sequential scan
Eleven queries filtered on `column::date BETWEEN …` or `column::date = CURRENT_DATE`. **A B-tree index cannot serve a predicate on an expression**, so `idx_patient_visits_created` — added in [1.11.0] specifically for this — was never once used. The active queue sequentially scanned every visit ever recorded, on every load, for both the front desk and the cashier.

All eleven are rewritten as half-open ranges on the raw column (`col >= $1::date AND col < ($2::date + 1)`), which is exactly equivalent and lets a plain B-tree apply.

### Added
`payments.paid_at`, `visit_tests.created_at` and `test_results.released_at` had **no index at all**, and between them they carry the entire reporting suite, the cashier's transaction log and the diagnostic history. Added, plus composites for the predicates those screens actually use (`payments(payment_status, paid_at)`, `patient_visits(status, created_at)`), and an `ANALYZE` so the planner uses them immediately rather than after autovacuum next runs.

The index and the rewrite are useless apart, which is why they ship together.

### Measured, not assumed
On a throwaway database seeded with **219,000 payments** (three years at ~200/day), fetching one month of transactions:

| | plan | time | blocks read |
|---|---|---|---|
| `::date` cast | Seq Scan | 50.7 ms | 1,611 |
| half-open range | Index Scan | **0.84 ms** | 249 |

**60× faster, 6× fewer blocks**, with the date now inside the `Index Cond` rather than a post-filter. On the current demo dataset both forms are a seq scan and always will be — five rows fit in one page, and Postgres is right to prefer that — which is exactly why this had to be measured at volume instead of eyeballed locally.

### Fixed — the released-results list was unbounded
`findReleasedByCategory` had no `LIMIT` and no date bound, and selects `findings`/`remarks`, which are unbounded `TEXT`. It backs the "Released" tab, hit on every visit to that screen. At 30 laboratory tests a day that is 7,500 rows of full clinical narrative in one response after a year, 22,500 after three — for a screen that shows ten at a time. Now defaults to the last 90 days with a hard `LIMIT`, both overridable via query string and **clamped server-side** (an unclamped `limit` would let any staff member pull the department's whole history in one request).

### Also
The receptionist's **"Print Queue Ticket" produced a blank page** — a bare `window.print()` on a view with no `.print-area`, so the CSS hid everything. It now renders a real slip: the queue number at 64px for reading across a waiting room, the patient's name, visit type and time, and which departments to proceed to. Both icon-only buttons on that row also gained `aria-label`s; `title` alone is not a reliable accessible name and is invisible on touch.

---

## [1.17.0] - 2026-08-15 (VAT-exempt treatment for statutory discounts)

Run: `node src/scripts/migrateVatExemption.js` (additive, safe to re-run)

### Completes the open question from [1.14.0]
That release shipped the statutory discount as a flat 20% and said so explicitly: correct for a non-VAT establishment, an understatement for a VAT-registered one, pending confirmation of the clinic's BIR registration. **Enlogada is VAT-registered**, so the flat calculation was wrong.

RA 9994 and RA 10754 make a sale to a senior citizen or PWD **VAT-exempt**, and the order of operations is fixed by statute — it is not the intuitive one:

```
VAT-inclusive price          1,000.00
less 12% VAT                  -107.14     (1000 - 1000/1.12)
----------------------------------------
VAT-exempt sale                892.86
less 20% discount             -178.57     (20% of the VAT-EXEMPT base, not of the price)
----------------------------------------
Amount due                     714.29
```

A flat 20% off the price gives **800.00**, so seniors and PWDs were being **overcharged by ₱85.71 per ₱1,000**, and the clinic was understating the deduction it could claim. Discounting before removing VAT would also mean charging a VAT-exempt patient VAT on part of the sale.

Only **statutory** discounts get this treatment — a promo or corporate rate is an ordinary discount on a VAT-inclusive price and carries no exemption, so `discount_types.is_statutory` drives the branch rather than the percentage.

### Added
* `payments.vat_amount` — the VAT removed, snapshotted like the discount. With it the sale reconciles from the payment row alone: `amount + discount_amount + vat_amount = the VAT-inclusive price the patient was quoted`.
* `CLINIC_VAT_REGISTERED` (default `true`) and `VAT_RATE` (default `0.12`) in `backend/.env`, documented in `.env.example`.
* The bill and the receipt now show **Less VAT (12%)** and **VAT-Exempt Sale** as their own lines. BIR requires a VAT-exempt sale to be presented that way rather than folded into a single discount figure, and a patient comparing the shelf price to what they paid needs the difference explained.
* The statutory register reports `vatExemptSalesTotal` and `vatTotal` alongside gross, discount and net — the figures a senior/PWD register is actually filed with. Its `gross_amount` now adds the VAT back, so a row ties to the quoted price.

### Not backfilled, deliberately
Existing payments keep `vat_amount = 0`. Every one of them either carried no statutory discount or was computed the flat way, and restating historical rows to claim a VAT treatment they were not issued under would be worse than leaving them alone — those receipts are already in patients' hands.

### Rounding
Each figure is rounded to centavos and the balance is derived from the rounded parts, so the three components always sum exactly to the gross. `processPayment` rejects a submitted amount differing by more than a centavo, so an arithmetic disagreement here would surface as a payment the cashier cannot complete rather than as a rounding footnote.

### Test note
`discounts.spec.js` asserted the flat calculation and legitimately went red on this change. It now pins the statutory order, checks every centavo reconciles, and asserts explicitly that the flat figure is *not* what gets charged.

---

## [1.16.0] - 2026-08-15 (Session revocation, credential rate limiting, JWT secret guard)

Run: `node src/scripts/migrateSessionRevocation.js` (additive, safe to re-run)

### Fixed — resetting a password did nothing to a stolen session
"Reset the password" is the standard response to a stolen token, and it had no effect on the attacker. The token lives in `localStorage`, so XSS, a shared reception workstation, or a token captured from a log is enough to lift one. `updatePasswordHash` wrote only the hash, `verifyToken` checked only the signature, the account's existence and its `status`, and there is no server-side logout route. **The lifted token kept full access to patient records until it expired on its own** — which the deployed `.env` set to seven days.

`users.password_changed_at` closes it: `verifyToken` rejects any token issued before it. This costs nothing extra, because `verifyToken` already loads the user row on every request ([1.11.0]) — no denylist, no shared state between instances.

Every password path goes through `updatePasswordHash` (self-service change, emailed reset, and an administrator resetting a staff password), so revocation cannot be skipped by one of them.

Two details worth knowing:
* **`changePassword` now returns a replacement token**, and `AuthContext` stores it. Without that, changing your own password would sign you out one request later — the revocation is aimed at the *other* device, not the person doing the changing.
* **The check allows one second of slack.** A JWT's `iat` is whole seconds while `password_changed_at` carries milliseconds, so a token minted in the same second as the change can look up to 999ms older than it is; with no slack the replacement token would reject itself. One second is far below any realistic attack window. It also means a test has to age its tokens past a second for the assertion to mean anything — the spec says so explicitly.

Backfilled from `updated_at` rather than `NOW()`: stamping "now" would claim every password had just changed and sign the whole clinic out, and leaving it NULL would make the check inert.

### Added — a tighter bucket for credential endpoints
The rate limiter was one shared allowance across all 84 routes: 100 per 15 minutes in production (so an attacker's guessing also consumed the clinic's own budget) and 20,000 everywhere else, which is no limit at all for password guessing. There is no failed-login counter or account lockout in the schema, so nothing else slowed credential stuffing.

`/api/auth/login`, `/forgot-password` and `/reset-password` now carry a second limiter with `skipSuccessfulRequests: true` — staff signing in all morning never touch it, while wrong guesses accumulate immediately. It is keyed by IP, so a distributed attack still evades it: this raises the cost, it does not replace account lockout, which needs its own schema change and is still open.

### Added — the server refuses to start with a guessable JWT secret
`.env.example` shipped `JWT_SECRET=supersecretkeyreplaceinproduction`, and the setup instructions say to base `.env` on it. Any deployment that copied the file without editing that line was signing tokens with a string published in this repository — and since authority is read from the database for whatever `userId` a token names ([1.11.0]), an attacker signing `{ userId: 1 }` receives the seeded SuperAdmin's full role set. Presence was the only check.

Startup now rejects a blank secret, a known example value, or anything shorter than 32 characters, and `.env.example` ships the key **blank** with `openssl rand -hex 32` in the comment. `JWT_EXPIRES_IN` there is now `1d` rather than `7d`, matching the code default it was silently overriding.

---

## [1.15.1] - 2026-08-15 (Online payments that were taken but never recorded)

No schema change — service and repository only.

### Fixed — an online payment could be taken and recorded nowhere
`createCheckoutSession` cancelled the visit's in-flight gateway session **before** calling PayMongo, and only inserted the replacement row **after** the provider responded. Two ways that lost money:

1. **The ordinary double-click.** A patient opens the checkout tab, goes back, and clicks Pay again. The second call marked session S1 `Cancelled` and created S2 — but S1's tab was still open and still payable. If the patient completed *that* one, PayMongo charged them and fired the webhook for S1. `markGatewayPaymentPaid` is `WHERE gateway_session_id = $1 AND payment_status = 'Pending'`, S1 was `Cancelled`, so zero rows updated, and the handler reported `{ handled: true, alreadySettled: true }` with a 200. **The patient was charged, no `Paid` row existed, the visit was never released to any department, and nobody was told.**
2. **A provider failure.** If the PayMongo call threw or was rejected, the previous session had already been cancelled and no new row was written — same orphaned-tab exposure.

The cancel and the insert now happen together, in one transaction, *after* PayMongo returns a session id. That narrows the window to the moments between the provider minting a session and the commit, where the worst case is a second live session rather than a live session with no row behind it.

### Fixed — the webhook could not tell a redelivery from a lost payment
`if (!settled) return { handled: true, alreadySettled: true }` conflated "PayMongo retried an event we already processed" (normal, must not double-release) with "we cancelled this session out from under the payer" (money taken, nothing recorded). The handler now re-reads the row:

* already `Paid` → genuine redelivery, still idempotent;
* `Cancelled`/`Failed` → **the money moved anyway**. Logged at error level, settled through `forceSettleGatewayPayment`, and staff are notified to verify against the provider dashboard. Refusing to record it does not give the money back; it just means the clinic holds an unrecorded payment and the patient waits for an exam nobody can see.
* the settle hits `uq_payments_one_paid_per_visit` → the visit was **also** paid at the counter. That is a genuine double charge needing a refund, so it is *not* recorded as a second payment: it raises a `critical` notification and returns `requiresRefund`. Verified: exactly one `Paid` row survives.

### Also fixed
`getNextReceiptNumber()` was called before knowing whether the update would succeed, so every webhook redelivery burned a receipt number. Now that receipt numbers come from a counter that never rewinds ([1.13.0]), that punched permanent gaps in the official sequence. The handler checks for an already-`Paid` row first and mints a number only when it is going to use one. Verified: a redelivery leaves the counter unchanged.

---

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
