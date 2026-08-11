# Visual Identity — Enlogada Clinic Management System

**Source of truth.** Every value below is transcribed directly from the existing, shipped codebase (`frontend/src/index.css`'s Tailwind v4 `@theme` block, and observed usage across `frontend/src/pages/**`). Nothing here is invented. This document exists so the UX/UI Design Lead and UI/UX Auditor have one place to check the *actual* system instead of guessing from screenshots or memory.

**Governing rule:** the visual identity is to be **preserved and enhanced**, not replaced. New UI work reuses these tokens and the existing `frontend/src/components/ui/` primitives. Introducing a new color, font, or primitive requires UX/UI Design Lead sign-off and a documented reason (see `AGENTS.md` file-ownership rule).

---

## 1. Color tokens (canonical — `frontend/src/index.css` `@theme` block)

| Token | Value | Used for |
|---|---|---|
| `--color-primary` / `--color-primary-sage` | `#769046` | Primary brand accent — buttons, links, active states, icons |
| `--color-primary-hover` | `#657c3a` | Primary hover state |
| `--color-primary-foreground` | `#ffffff` | Text/icons on primary-colored surfaces |
| `--color-primary-navy` / `--color-secondary` | `#34466b` | Secondary accent |
| `--color-secondary-foreground` | `#ffffff` | Text on secondary surfaces |
| `--color-destructive` | `#ef4444` | Errors, destructive actions |
| `--color-destructive-foreground` | `#ffffff` | Text on destructive surfaces |
| `--color-muted` | `#f3f4f6` | Muted backgrounds |
| `--color-muted-foreground` | `#6b7280` | Muted text |
| `--color-accent` | `#f3f4f6` | Accent surfaces |
| `--color-accent-foreground` | `#111827` | Text on accent surfaces |
| `--color-card` / `--color-popover` | `#ffffff` | Card and popover backgrounds |
| `--color-card-foreground` / `--color-popover-foreground` | `#111827` | Text on card/popover |
| `--color-dark-slate` / `--color-foreground` | `#192534` | Dark containers (hero banners, sidebar), default body text color |
| `--color-border` / `--color-input` | `#e5e7eb` | Borders, input borders |
| `--color-ring` | `#769046` | Focus rings |
| `--color-background` | `#f8f9fa` | Page background |

**Border radius scale:** `--radius-sm: 8px`, `--radius-md: 12px`, `--radius-lg: 16px`.

**Typography:** `'Outfit'` (Google Fonts, weights 300–700), applied as the body font. No secondary/heading font is defined — `Outfit` is used throughout.

---

## 2. Observed inconsistencies (documented, not yet reconciled)

These exist in the shipped code today. They are **not** to be silently "fixed" by any agent as a drive-by change — they're recorded here so the UX/UI Design Lead can make a deliberate call, and so the UI/UX Auditor knows they're pre-existing, not new regressions:

- **Two different "dark" hex values are both used as dark-slate containers:** the tokenized `#192534` (`AdminDashboard.jsx`, `ClientDashboard.jsx`) and the untokenized `#1e293b` (`Home.jsx`, `Login.jsx`) — both read as "dark navy/slate" but are not the same color. `CLAUDE.md` itself documents both as if interchangeable ("dark slate containers `#1e293b`/`#192534`").
- **Two different primary-hover values:** the tokenized `#657c3a` (most pages) vs. an untokenized `#687e3d` used in `Home.jsx`.
- Most colors are applied as raw Tailwind arbitrary values (`bg-[#769046]`) rather than the `@theme` token classes (`bg-primary`) — the tokens exist in `index.css` but aren't consistently used in components yet.

---

## 3. Structural / component identity

- **Component library:** `frontend/src/components/ui/` — shadcn/radix-based primitives (`button`, `card`, `dialog`, `select`, `table`, `tabs`, `input`, `badge`, `confirm-dialog`). New UI work reuses these before adding anything new.
- **Layout shells:**
  - `SidebarLayout.jsx` — shared shell for staff/admin consoles: dark, icon-driven sidebar (`LayoutDashboard`, `Users`, `ClipboardList`, etc. from `lucide-react`) with role-gated nav sections ("Main Navigation" for Admin/SuperAdmin, "Clinical Operations" for ops roles), search bar, notification bell, top bar.
  - `DashboardLayout.jsx`, `PublicHeader.jsx`, `PublicFooter.jsx` — public-page equivalents.
- **Card pattern:** white background, `rounded-xl`/`rounded-2xl`/`rounded-3xl`, `shadow-sm`/`shadow-lg`, thin `border-gray-100`/`border-gray-200`. A recurring "top accent bar" pattern appears on key cards (e.g. `Login.jsx`'s `border-t-4 border-t-[#769046]`).
- **Section labels:** small, uppercase, extra-bold, wide-tracking micro-labels (`text-[10px] font-extrabold uppercase tracking-widest`) used for section headers throughout dashboards.
- **Buttons:** primary action = `bg-[#769046]` with `hover:bg-[#657c3a]`, white text, `rounded-xl`, bold text, `shadow-sm`/`shadow-md`. Dark/secondary action = dark-slate background, white text.
- **Icon set:** `lucide-react` exclusively, used consistently across nav, buttons, and stat cards.
- **Brand mark:** `Logo.jsx` component, paired with the two-line wordmark "Enlogada Ultrasound" / "& Diagnostic Clinic" (or "Diagnostic Clinic" variants) in the sidebar and public header.

---

## 3a. Design-system foundation decisions (2026-08-10, Project Architect + UX/UI Design Lead)

Made in response to the inconsistencies documented in §2, as part of the pre-implementation remediation pass. These are **decisions to converge toward**, not a mandate to refactor every existing page immediately — see `database/migrations.md` [1.2.0]-adjacent work and the remediation report for what was and wasn't touched.

1. **Dark surface color**: canonical is the tokenized `#192534` (`--color-dark-slate`). The untokenized `#1e293b` and the Login-only `#0f172a` are drift — replace with `#192534`/`bg-dark-slate` (or `text-dark-slate`) the next time a file using them is touched for another reason. Do not batch-replace across the app in one sweep.
2. **Primary hover color**: canonical is the tokenized `#657c3a` (`--color-primary-hover`). The untokenized `#687e3d` (Home.jsx, PublicHeader.jsx, Register.jsx, ServicesCatalog.jsx) is drift — same "fix on next touch" rule as above.
3. **Error/status color family**: canonical is the `red-*` Tailwind family (matches `--color-destructive: #ef4444`). The `rose-*` family used in most dashboard-level error banners is drift — same rule.
4. **Radius scale**: canonical is the named `rounded-sm`/`rounded-md`/`rounded-lg` classes, backed by this app's `--radius-sm/md/lg` (8/12/16px) theme tokens. `rounded-xl`/`rounded-2xl`, used as the de facto standard throughout the app today, are the accepted **de facto equivalents** in existing code and are not required to be mass-replaced — but new code should prefer the named token classes. `rounded-3xl` (24px, used on 5 hero/banner surfaces) has no token and is the one radius value flagged as genuinely off-system; new hero/banner surfaces should use `rounded-2xl` instead, existing ones are left as-is for now.
5. **Status-to-color mapping**: canonicalized in `frontend/src/components/ui/status-badge.jsx` (new — see below), covering every status/approval_status value used across the schema (`Pending`, `Processing`, `Approved`, `Confirmed`, `Completed`, `Paid` → success/neutral tones; `Cancelled`, `Rejected`, `Failed`, `No Show` → destructive tone; `Refunded` → neutral-gray). This replaces the three independently hand-copied color maps found in `ClientDashboard.jsx`, `ReceptionistDashboard.jsx`, and `DiagnosticDashboard.jsx` — those call sites are not migrated yet, but any new status-displaying UI must use `StatusBadge`, not a new inline color map.
6. **Shared search input**: canonicalized in `frontend/src/components/ui/search-input.jsx` (new), matching the existing hand-rolled pattern's visual style exactly so adopting it is a drop-in replacement whenever a page's search box is next touched.
7. **Shared status badge**: see #5 — same component.
8. **Checkbox / textarea primitives**: added `frontend/src/components/ui/checkbox.jsx` and `frontend/src/components/ui/textarea.jsx` (new), matching the existing `input.jsx`/`badge.jsx` conventions (`cn()` + `forwardRef`), so future forms don't need to hand-roll these. `checkbox.jsx` deliberately wraps a plain `<input type="checkbox">` rather than adding `@radix-ui/react-checkbox` as a new dependency — upgrade to Radix only if a concrete future need (indeterminate state, custom check icon) justifies it.
9. **WCAG AA contrast on white-on-green buttons** (2026-08-11, UI/UX Phase 4): white text on the base `#769046` primary green measures ~3.59:1, failing WCAG AA's 4.5:1 normal-text threshold. New token `--color-primary-active: #536630` (white-text contrast ~6.3:1) was added as a third rung below `--color-primary`/`--color-primary-hover`. Public, first-contact entry points (`PublicHeader.jsx`, `Home.jsx`, `Login.jsx`, `Register.jsx`, `ForgotPassword.jsx`, `ResetPassword.jsx`) had their white-text buttons switched to rest on `bg-primary-hover` (`#657c3a`, ~4.67:1, already passes AA) with `hover:bg-primary-active` as the new pressed-state shade. This is scoped to public pages only, matching the original audit's public-page contrast finding — the many internal staff/admin dashboard buttons using `bg-[#769046]` are unchanged for now; apply the same `bg-primary-hover hover:bg-primary-active` swap there the next time one of those buttons is touched for another reason, per the "fix on next touch" rule above.

10. **`Processing`-state indigo is intentional, not drift.** `DiagnosticDashboard.jsx`'s "Start Processing" button (`bg-indigo-600`), its `Currently Processing` `MetricCard` (`tone="indigo"`), and `status-badge.jsx`'s own `Processing: "bg-indigo-100 text-indigo-800"` all independently agree: indigo is this app's semantic color for "processing," distinct from the brand-green primary-action color. A 2026-08-11 pass flagged the button as an off-system color before checking `status-badge.jsx`'s own mapping — it isn't; the button's target-state color matching the status it transitions a row into is a deliberate, consistent pattern and should be kept, not "fixed" to green.
11. **Table density & pagination standard** (2026-08-11, Visual Design Improvement Plan Phase V0): any table that can exceed ~20 rows must paginate — reuse `frontend/src/components/ui/pagination.jsx` (client-side slicing is fine for tables backed by a single unpaginated fetch, e.g. staff lists; server-side paging, as `visitRepository.findActiveVisits` already does, is preferred once a table's row count is large enough that fetching it all is itself wasteful). Row height and header treatment follow the existing `Table`/`TableHeader`/`TableRow` primitives' defaults (`py-3`/`py-3.5` cells, `bg-gray-50/80` header) — no new row-height scale introduced. Long free-text values (names, emails) get `truncate` with a `title` attribute carrying the full value, rather than being left to stretch the row.
12. **StatusBadge adoption completed for the three flagged call sites** (2026-08-11): `ClientDashboard.jsx`'s `getStatusColor` (Diagnostic Results tab), `ReceptionistDashboard.jsx`'s inline Active-Queue ternary, and `DiagnosticDashboard.jsx`'s inline worklist ternary were all replaced with `<StatusBadge>` — all three already computed the exact same colors `status-badge.jsx` does, so this was a zero-visual-difference internal refactor, not a redesign. `search-input.jsx` remains unwired elsewhere; `checkbox.jsx`/`textarea.jsx` remain unused — still available for the next form that needs them.
13. **`rose-*` vs. `red-*` (§2, item 3) deliberately not batch-swept.** Reconciled only where a file was already being touched for another reason in the 2026-08-11 visual pass (none qualified this round) — the broad `rose-*` usage across dashboard error banners remains as documented drift, per this file's own "not a blanket license to clean up... during unrelated feature work" rule. `#1e293b` (§2, item 1) was fixed in `ServicesCatalog.jsx`'s category-filter pill (the one remaining non-public-page instance) while that file was already open for the `#687e3d` fix; `#687e3d` itself (§2, item 2) has no remaining occurrences as of this pass.
   - **2026-08-12 update (UI/UX Modernization Phase 3):** reconciled the `role="alert"` error-banner divs (`bg-rose-50 border-rose-200 text-rose-700` → canonical `bg-red-50 border-red-100 text-red-600`) in the four files already being touched for the same phase's toast/alert sweep: `CashierDashboard.jsx` (queue error, payment error, refund error — 3 instances), `ClientDashboard.jsx` (add-profile error, edit-profile error, booking error — 3 instances), `DiagnosticDashboard.jsx` (upload error — 1 instance), `ReceptionistDashboard.jsx` (patient-search error, walk-in registration error, verify error, HMO error — 4 instances). Deliberately left alone in these same files, as out of scope for "error banner" reconciliation: the required-field-asterisk `text-rose-600` convention (used identically in `ClientDashboard.jsx`, `ReceptionistDashboard.jsx`, and `AccountSettingsForm.jsx` — a distinct, pervasive pattern, not drift), destructive-action button styling (e.g. Cashier's Refund button, Client's Cancel Appointment button — already correctly using the canonical `red-*`/matches `--color-destructive`), and table empty-state/retry-link text color in `DiagnosticDashboard.jsx`/`ReceptionistDashboard.jsx`. Remaining `rose-*` error banners in untouched files are still drift, per the "fix on next touch" rule.

None of `status-badge.jsx` (now wired in 3 places, see #12), `search-input.jsx`, `checkbox.jsx`, or `textarea.jsx` were originally wired into any existing page as part of the 2026-08-10 remediation pass — they existed so Frontend Engineer had them available for the next feature/module that needed them, per that task's explicit instruction not to refactor working pages as a side effect of foundation work. The 2026-08-11 visual pass was that next touch for `status-badge.jsx`, and also for `search-input.jsx` (now wired into `StaffAccounts.jsx`, in addition to its prior uses).

14. **UI/UX Auditor sign-off (2026-08-11, Visual Design Improvement Plan Phase V4).** All five Section 08 findings from the plan re-verified live post-implementation, across both desktop and a 375px mobile viewport (drawer nav, card/table stacking): empty Admin/SuperAdmin home → resolved (Quick Actions, Revenue Trend, Recent Activity); dense unpaginated tables → resolved (Staff Accounts, Cashier Monitoring); indigo button → reclassified as intentional (#10), no change needed; hand-rolled color maps → resolved (#12); untruncated long values → resolved on the two originally-flagged tables. Responsive behavior was verified for the first time in this pass (not explicitly checked during V1–V3): the grouped sidebar renders correctly in the mobile drawer, stat cards and the Staff Accounts search bar stack single-column, and `Table`'s own `overflow-auto` wrapper (already existing, not new) handles wide tables at narrow widths correctly. No regressions found.

## 3b. Required data-state pattern (2026-08-10 remediation)

The 2026-08-10 audit found `AdminDashboard.jsx`, `ReceptionistDashboard.jsx`, `CashierDashboard.jsx`, and `DiagnosticDashboard.jsx` all declared a `loading` state that was set but never read in JSX — meaning a slow fetch and a genuinely empty result looked identical to the user, and no page distinguished "fetch failed" from "no records." The dead-`loading`-state instances (each dashboard's primary table) were fixed as part of this remediation pass — see `git diff` for the four one-line-condition changes. This did **not** extend to adding real error/retry UI everywhere; that remains future work, following the pattern below.

Every data-fetching view going forward must be able to represent five distinct states, and must not collapse any two of them into the same visual result:

| State | Meaning | Must look like |
|---|---|---|
| **Loading** | Request in flight | An explicit loading indicator/text — never a bare empty table. |
| **Empty** | Request succeeded, zero records | A clear "no records" message, distinguishable from loading and from error. |
| **Error** | Request failed | A clear failure message — must **not** render as "no records." This is the state that was entirely missing everywhere in the audited app; every primary fetch caught its error with `console.error` only. |
| **Retry** | Following an error, where applicable | A retry affordance (button re-running the failed fetch) — not required for every view, but required wherever a transient failure (network blip) is plausible and the cost of not retrying is high (e.g. a dashboard's primary data load). |
| **Success** | Request succeeded, data shown | The actual data — the only state most of the app currently handles. |

Minimal implementation shape (no new dependency needed — plain React state):
```jsx
const [loading, setLoading] = useState(true);
const [error, setError] = useState(null);
// ...
try {
  setError(null);
  const res = await api.get('/whatever');
  setData(res.data.data.whatever);
} catch (err) {
  setError('Could not load data. Please try again.');
} finally {
  setLoading(false);
}
// ...
{loading ? <LoadingRow /> : error ? <ErrorRow message={error} onRetry={refetch} /> : data.length === 0 ? <EmptyRow /> : <DataRows data={data} />}
```

## 4. What UX/UI Design Lead and Frontend Engineer must do with this

- Reuse the tokens and primitives above by default.
- If a new module's UI genuinely needs something not covered here (a new component pattern, a new color), the UX/UI Design Lead documents the addition **in this file** with a reason, rather than the Frontend Engineer inventing it ad hoc mid-implementation.
- The observed inconsistencies in §2 are not blanket license to "clean up" colors during unrelated feature work — a deliberate reconciliation is itself a task that needs its own scope/approval.
