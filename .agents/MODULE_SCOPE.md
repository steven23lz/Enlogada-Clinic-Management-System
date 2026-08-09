# Module Scope — Canonical Boundary

> **Revision note (2026-08-10):** modules 9–11 were previously named "Laboratory," "Ultrasound," "X-ray" — matching neither the approved functional scope's naming ("...Staff") nor, for module 11, the live database role string (`Xray Staff`, no hyphen). Corrected below to match the approved scope exactly, with the live role-string discrepancy for module 11 called out explicitly rather than silently reconciled by renaming the database role (no architectural reason was found to justify that rename — see `database/migrations.md`).

This file is the **single authoritative source** for what is in scope for the Enlogada Clinic Management System. It supersedes any module list implied by the original paper/specification, by conversation history, or by any agent's assumption.

**Rule:** No agent may implement, scaffold, or design a feature that does not trace to one of the 18 modules below. Anything that does not trace to this list — including anything present in the original paper/specification but not listed here — requires explicit escalation to the user or the Project Architect before any implementation work begins. It is never implemented "because it was in the original spec."

This file must be checked by the Feature/Module Architect before any MODULE row is opened in `TRACEABILITY.md`, and by the Code Reviewer / Project Architect before any checkpoint.

---

## The 18 Approved Modules

### CLIENT

| # | Module | Functional boundary |
|---|---|---|
| 1 | **Authentication** | Register, login (email/password), Google OAuth sign-in, session handling (JWT), logout. Password reset is in scope for design but has no working implementation yet (see Known Gaps below — escalate before building it). |
| 2 | **Home** | Public landing page: clinic introduction, service highlights, calls to action (Book Now / View Services). Unauthenticated. |
| 3 | **Appointment** | Client-facing appointment booking against live clinic operating hours and slot capacity; viewing/cancelling own appointments. |
| 4 | **Patient Management** | A client's own patient profile: personal/contact details, patient-type/HMO association. Not staff-side patient record management (that is covered under Receptionist/Admin, module 7/12). |
| 5 | **Profile** | Client's own account settings: contact info, password/account management, viewing own role/permissions. |
| 6 | **Diagnostic Result Viewing** | Client's read-only access to their own released `test_results`, tied to their `patient_visits`/`visit_tests`. |

### STAFF

| # | Module | Functional boundary |
|---|---|---|
| 7 | **Receptionist** | Visit/queue intake, QR/reference-code appointment verification, patient record creation/lookup, HMO request initiation, visit-test attachment. |
| 8 | **Cashier** | Billing against a `patient_visit`, `payments` processing, receipt handling, cashier-side HMO/payment status. |
| 9 | **Laboratory Staff** | Laboratory-category `test_results` entry, review, and release for visits with Laboratory tests. Live DB/code role name: `Laboratory Staff` (matches). |
| 10 | **Ultrasound Staff** | Ultrasound-category (including 2D Echo) `test_results` entry, review, and release. Live DB/code role name: `Ultrasound Staff` (matches). |
| 11 | **X-ray Staff** | Digital X-Ray-category `test_results` entry, review, and release. **Live DB/code role name is `Xray Staff` (no hyphen)** — use that exact string in any role check/seed/query; "X-ray Staff" (with hyphen) is this module's display/approved-scope name only. |

### ADMIN

| # | Module | Functional boundary |
|---|---|---|
| 12 | **Admin Dashboard** | Admin/SuperAdmin console: staff account management, services catalog price/active-status management, cashier monitoring, appointments/patient-records oversight, clinic-wide reporting entry point. |
| 13 | **Super Admin Management** | RBAC administration: roles, permissions, role-permission matrix, elevated account management beyond what Admin can do. |

### SYSTEM-WIDE

| # | Module | Functional boundary |
|---|---|---|
| 14 | **Payment** | Payment records tied to visits, billing status, HMO-approval-linked payment flows — the data/logic layer shared by Cashier (8) and Client-side payment visibility. |
| 15 | **Test and Service Request** | The `tests`/`test_categories` catalog, `visit_tests` attachment, HMO request/approval flow (`hmo_requests`, `hmo_providers`). |
| 16 | **Diagnostic Result** | The shared `test_results` data/logic layer (findings, files, release status) consumed by Laboratory/Ultrasound/X-ray (9–11) and surfaced read-only to Client (6). |
| 17 | **Reporting** | Clinic-wide metrics and reports (revenue, service volume, RBAC matrix, operational reporting) surfaced to Admin/SuperAdmin. |
| 18 | **Notification** | System notifications (e.g. appointment/result/payment events) — currently only a static/mock notification list exists in the UI (`SidebarLayout.jsx`); no backend notification system exists yet. Building the real backend for this is in-scope for module 18, but must go through full Business Analysis → Architecture before implementation, not be assumed from the mock UI. |

---

## Explicit Excluded Functionality

The following is **permanently out of scope** and must never be reintroduced, regardless of what appears in the original paper/specification, historical code, or any agent's suggestion:

- **Veterinary / pet functionality of any kind** — pet profiles, animal species/breed fields, veterinary service categories, veterinary staff roles, or any schema/UI/API element implying non-human patients. This was explicitly and fully removed from this project (see `CLAUDE.md`: "Veterinary/pet functionality was fully removed; do not reintroduce it.").
- Any module, feature, or field not listed in the table above.

Any agent — including Database Engineer, Backend Engineer, Frontend Engineer — that encounters a request, a legacy reference, or an inferred requirement resembling excluded functionality must **stop and escalate to the Project Architect**, not implement it and not silently drop it without saying why.

---

## Approval Rule

> Anything not traceable to one of the 18 modules above requires explicit user or Project Architect approval before any design or implementation work proceeds.

This applies even to work that seems small, obviously useful, or clearly implied by an approved module — if it isn't traceable to a row in this table, it goes through escalation first.

---

## Known Gaps (informational — not authorization to build)

These are observed today by inspecting the live codebase; they are listed here so agents don't assume they're already solved, and so nobody accidentally treats "it's mentioned in code" as "it's approved to expand":

- **Notification (18)** has no backend — only a hardcoded mock list in `SidebarLayout.jsx`.
- **Authentication (1)** has a "Forgot password?" button in `Login.jsx` with no handler wired up.
- **Google Sign-In (1)** accounts get a random, uncommunicated password — such accounts cannot use the email/password login form; this is a known UX gap, not a bug in the OAuth flow itself.

Closing these gaps is legitimate future work under their respective modules, but each still needs to go through Business Analysis → Module Decomposition → Architecture like any other feature — this section documents the gap, it does not pre-approve the fix.
