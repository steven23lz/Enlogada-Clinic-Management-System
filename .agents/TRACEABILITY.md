# Requirement Traceability Matrix

Living document. One row per **feature** (a module may have many features). No row may exist without a MODULE value from `MODULE_SCOPE.md`'s approved 18. This file is what lets Project Architect confirm "implemented" means "traced end-to-end," not just "code exists" — and it's the audit trail that makes silent scope creep (including any reintroduction of excluded functionality) structurally visible.

## Chain

```
MODULE → FEATURE → USER STORY → ACCEPTANCE CRITERIA → UI → API → DATABASE → SECURITY → ACCESSIBILITY → TEST → REVIEW → APPROVAL
```

*(Revised 2026-08-10: SECURITY and ACCESSIBILITY were previously bundled into one `VALIDATION` column, and REVIEW/APPROVAL into one `IMPLEMENTATION STATUS` column. They are now separate columns so a feature's status can't hide "security passed but accessibility didn't," or "code-reviewed but not yet Project-Architect-approved," behind a single combined cell.)*

## Column ownership and write access

Per `AGENTS.md`'s File Ownership Model, `TRACEABILITY.md` lives under `.agents/**`, which defaults to Project Architect ownership. The grants below are the **standing controlled exception** for this file: each listed agent may write to *its own column(s) only*, without asking Project Architect each time, because the change is necessary for their assigned task and the scope is explicitly documented here (satisfying all three conditions in the File Ownership Model). Writing to a column you don't own, or restructuring this file's chain/format, still requires Project Architect approval.

| Column | Owning agent(s) | Notes |
|---|---|---|
| MODULE | Feature/Module Architect | Must be one of the 18 in `MODULE_SCOPE.md`. No exceptions without escalation. |
| FEATURE | Feature/Module Architect | A named, bounded slice of the module. |
| USER STORY | Business Analyst | Standard "As a [role], I want [x], so that [y]" form. |
| ACCEPTANCE CRITERIA | Business Analyst | Testable, specific conditions of done. |
| UI | UX/UI Design Lead (spec reference) + Frontend Engineer (implementation reference) | Both write to this column, at different stages. |
| API | Backend Engineer | Endpoint(s) touched or added. |
| DATABASE | Database Engineer | Table(s)/column(s) touched or added. |
| SECURITY | Security Engineer | RBAC/auth/ownership review sign-off or blocking findings. |
| ACCESSIBILITY | Accessibility Specialist | WCAG sign-off or blocking findings (`a11y-audit`). |
| TEST | QA/Test Engineer | Playwright test file/case reference (see `frontend/tests/e2e/`). |
| REVIEW | Code Reviewer (mechanical/technical verdict) + UI/UX Auditor (holistic UX/consistency verdict) | Both write to this column — see `AGENTS.md` for why these are distinct, non-duplicating reviews. |
| APPROVAL | Project Architect | Final status: `Not started` / `In progress` / `Review` / `Approved` / `Escalated — out of scope`. |

## Table

Rows are added only when a feature enters Module Decomposition. First rows opened 2026-08-10 for Module 1.

| MODULE | FEATURE | USER STORY | ACCEPTANCE CRITERIA | UI | API | DATABASE | SECURITY | ACCESSIBILITY | TEST | REVIEW | APPROVAL |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Authentication | Register | As a visitor, I want to create an account, so that I can book appointments as a Client | Valid data creates a Client account; duplicate email rejected | `Register.jsx` (pre-existing) | `POST /auth/register` (pre-existing) | `users`, `user_roles` (pre-existing) | Clean — no findings | Clean — no findings | `smoke.spec.js`, `auth.spec.js` (indirect via login) | Pre-existing, re-verified this pass | Approved |
| Authentication | Login (email/password) | As a registered user, I want to sign in with email/password, so that I can reach my dashboard | Valid credentials issue a JWT with correct roles/permissions; invalid credentials rejected without revealing which field was wrong | `Login.jsx` (pre-existing) | `POST /auth/login` (pre-existing) | `users`, `user_roles`, `role_permissions` (pre-existing) | Clean — no findings | Clean — no findings | `auth.spec.js`, `api-authorization.spec.js` (login used as setup in both) | Pre-existing, re-verified this pass | Approved |
| Authentication | Google Sign-In | As a visitor, I want to sign in with Google, so that I don't need a separate password | Valid Google ID token logs in or auto-creates a Client account | `Login.jsx` `GoogleLogin` (pre-existing) | `POST /auth/google` (pre-existing) | `users`, `user_roles` (pre-existing) | Known gap unchanged by this pass: such accounts get a random password — now recoverable via Password Reset (see below) | Not independently re-audited this pass (third-party widget) | Not covered (requires a real Google token; no automated coverage) | Pre-existing, not re-reviewed line-by-line this pass | Approved (pre-existing scope) |
| Authentication | Session (JWT) | As a logged-in user, I want my session to persist across reloads, so that I stay logged in | Token in localStorage restores session via `GET /auth/me`; 401 clears session app-wide | `AuthContext.jsx` (pre-existing) | `GET /auth/me` (pre-existing) | — | Clean — no findings | Clean — no findings | Exercised implicitly by every authenticated test | Pre-existing, re-verified this pass | Approved |
| Authentication | Logout | As a logged-in user, I want to log out, so that my session ends on this device | Logout clears token and returns to public view | `Navbar.jsx`/`SidebarLayout.jsx` (pre-existing) | client-side only (pre-existing) | — | Clean — no findings | Clean — no findings | `auth.spec.js` "logout returns to the public view" | Pre-existing, re-verified this pass | Approved |
| Authentication | **Password Reset** (new) | As a user who forgot their password, I want to request a reset link by email and set a new password | No account enumeration; link single-use, expires in 1hr; Google-only accounts gain a real usable password | `ForgotPassword.jsx`, `ResetPassword.jsx` (new — color-consistency fix applied during UI/UX Audit) | `POST /auth/forgot-password`, `POST /auth/reset-password` (new) | `password_reset_tokens` (new, `migrations.md` [1.3.0]) | Reviewed — see findings below; all P0/P1 clear, 3 documented residual risks (P2/P3, accepted) | `role="alert"`/`role="status"` added during review; label-association gap noted as pre-existing app-wide, not fixed in isolation | `password-reset.spec.js` (9 tests) + one-time manual full-happy-path verification (see Module 1 report) | Reviewed — layering/reuse/naming clean, no dead code | Approved |

## Escalation row format

If a request arrives that does not trace to one of the 18 modules (including anything resembling excluded veterinary/pet functionality), it is recorded here instead of silently dropped or silently built:

| MODULE | FEATURE | ... | APPROVAL |
|---|---|---|---|
| `OUT OF SCOPE` | (brief description) | — | `Escalated — awaiting user/Project Architect decision` |

This keeps a visible record that the request was seen and deliberately not actioned, rather than it looking like it was simply forgotten.
