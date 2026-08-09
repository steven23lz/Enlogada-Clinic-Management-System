# AI Development Team — Roster

This file is an **index**, not a persona definition. Each agent's full definition (mission, responsibilities, inputs/outputs, file ownership, forbidden modifications, required skills, dependencies, collaboration rules, verification, completion criteria) lives in exactly one place: `.agents/skills/<agent>/SKILL.md`. This file used to duplicate that content; it no longer does, so there is one source of truth per agent instead of two that can drift apart.

Before any agent acts, it (and whoever is directing it) should also have read:
- `MODULE_SCOPE.md` — the canonical 18-module boundary and excluded-functionality list.
- `TRACEABILITY.md` — the requirement-tracing chain and matrix.
- `PROJECT_STRUCTURE.md` — folder/naming/layering conventions.
- `_shared/ZERO_HALLUCINATION_METHOD.md` — the required implementation discipline.
- `_shared/VISUAL_IDENTITY.md` — the canonical design tokens (UI-touching agents).

---

## The team

| # | Agent | One-line mission | Skill definition |
|---|---|---|---|
| 1 | **Project Architect / Chief Architect** | Final approval authority; owns team governance and `write-a-skill`. | `skills/project_architect/SKILL.md` |
| 2 | **Business Analyst** | Turns requirements into module-tagged user stories and acceptance criteria. | `skills/business_analyst/SKILL.md` |
| 3 | **Feature/Module Architect** | Decomposes requirements into approved modules; first gate against scope creep. | `skills/module_architect/SKILL.md` |
| 4 | **UX/UI Design Lead** | Owns UI specification; protects the existing Enlogada visual identity. | `skills/uiux_design_lead/SKILL.md` |
| 5 | **Frontend Engineer** | Implements React UI per spec. | `skills/frontend_engineer/SKILL.md` |
| 6 | **Backend Engineer** | Implements Express/Node APIs per the routes→controllers→services→repositories layering. | `skills/backend_engineer/SKILL.md` |
| 7 | **Database Engineer** | Owns PostgreSQL schema integrity. | `skills/database_engineer/SKILL.md` |
| 8 | **Security Engineer** | Owns RBAC/JWT/auth review and `security-guidance` findings. | `skills/security_engineer/SKILL.md` |
| 9 | **QA/Test Engineer** | Builds and owns the automated test suite via Playwright. | `skills/qa_test_engineer/SKILL.md` |
| 10 | **Accessibility Specialist** | WCAG-focused implementation auditing via `a11y-audit`. | `skills/accessibility_specialist/SKILL.md` |
| 11 | **UI/UX Auditor** | Reviews completed interfaces for hierarchy, usability, states, consistency, and identity fidelity. | `skills/uiux_auditor/SKILL.md` |
| 12 | **Code Reviewer** | General technical/diff review; defers security and accessibility findings to their owners. | `skills/code_reviewer/SKILL.md` |
| 13 | **Version Control Agent** | Checkpoints, rollback, GitHub sync. | `skills/version_control_agent/SKILL.md` |

**Not separate agents (by design):**
- `zero-hallucination-coder` is a shared working discipline (`_shared/ZERO_HALLUCINATION_METHOD.md`), used by every implementing/reviewing agent — not its own persona.
- `write-a-skill` is a governance capability owned by the Project Architect, for formalizing future Enlogada-specific skills — not its own persona.
- Cross-module integration/release responsibility belongs jointly to the Feature/Module Architect and Project Architect — there is no separate integration/release agent yet.

---

## Team Collaboration Rules

- No implementation is accepted without Project Architect approval.
- Every agent may review another's work and should ask questions when requirements are unclear, but only the agent that **owns** a finding type resolves it: Security Engineer owns security findings, Accessibility Specialist owns WCAG findings, UI/UX Auditor owns holistic-interface findings, Code Reviewer owns everything else. No agent re-litigates another owner's domain.
- Prioritize correctness, existing architecture, the approved module scope, RBAC correctness, database integrity, consistent UI/UX, responsive design, accessibility, security, test coverage, and maintainability over speed.
- Never implement anything — however plausible or however present in the original paper/specification — that isn't traceable to `MODULE_SCOPE.md`. Escalate instead.

## File Ownership Model

Ownership below (and in each `SKILL.md`) is **default ownership, not absolute isolation**. An agent may touch files outside its default ownership only when:
1. the change is necessary for the assigned task,
2. it is explicitly documented (in the PR/commit description and, where relevant, in `TRACEABILITY.md`), and
3. the owning agent is consulted, or the Project Architect approves it.

### Standing exception: `TRACEABILITY.md`

`TRACEABILITY.md` lives under `.agents/**`, which defaults to Project Architect ownership like every other file here — but nearly every agent needs to write a status into it as part of normal work. Rather than requiring Project Architect's explicit sign-off on every single traceability entry (impractical, and not what was intended), `TRACEABILITY.md` itself names, per-column, exactly which agent may write which column — see its "Column ownership and write access" section. That table **is** the satisfied condition-2/condition-3 documentation for this file; no separate per-entry approval is needed as long as an agent only writes its own column(s). Restructuring the file itself (adding/removing columns, changing the chain) is not covered by this exception and still requires Project Architect approval.

## Agent Execution Workflow

This is the single persisted pipeline reference — previously this only existed implicitly, reconstructed from each agent's `SKILL.md` "Dependencies" field, which left room for disagreement (see the 2026-08-10 audit). This section is authoritative; if any `SKILL.md`'s Dependencies field appears to disagree with it, this section wins and the `SKILL.md` should be corrected.

```
REQUIREMENTS
  → BUSINESS ANALYSIS            [Business Analyst]
  → MODULE DECOMPOSITION         [Feature/Module Architect]        — first scope-rejection gate; escalates out-of-scope requests
  → ARCHITECTURE                 [Project Architect, participating directly + Feature/Module Architect]
  → UX/UI SPECIFICATION          [UX/UI Design Lead]
  → DATABASE/API DESIGN          [Database Engineer + Backend Engineer]
  → IMPLEMENTATION               [Frontend Engineer + Backend Engineer + Database Engineer]  — Zero-Hallucination Method
  → SELF-VERIFICATION            [the implementing engineer(s)]    — Zero-Hallucination Method's own Verify phase
  → QA                           [QA/Test Engineer]                 ┐
  → SECURITY                     [Security Engineer]                ├─ run in parallel against the same build
  → ACCESSIBILITY                [Accessibility Specialist]         │
  → UI/UX AUDIT                  [UI/UX Auditor]                    ┘
  → CODE REVIEW                  [Code Reviewer]                    — mechanical/technical review; requires QA+Security+Accessibility+UI/UX Audit already done
  → PROJECT ARCHITECT APPROVAL   [Project Architect]                — final gate; requires Code Review to have passed
  → VERSION CONTROL CHECKPOINT   [Version Control Agent]            — only executes on Project Architect's instruction
```

**Explicit answers to the recurring "who does what" questions:**
- **Who owns architecture decisions?** Project Architect, at the dedicated ARCHITECTURE stage — this was previously ambiguous (Project Architect's own `SKILL.md` described only a final-gate role, while Feature/Module Architect's text implied earlier participation). Both are now correct: Project Architect participates directly in ARCHITECTURE *and* owns the final PROJECT ARCHITECT APPROVAL gate — two distinct stages, not a contradiction.
- **Who participates in architecture?** Project Architect (owner) and Feature/Module Architect (brings module-decomposition context). Database Engineer and Backend Engineer are consulted for feasibility but own the next stage (DATABASE/API DESIGN), not ARCHITECTURE itself.
- **Who can reject scope?** Feature/Module Architect, at MODULE DECOMPOSITION — first gate. Project Architect can also reject at ARCHITECTURE or PROJECT ARCHITECT APPROVAL if something slipped through. Either rejection is logged as an escalation row in `TRACEABILITY.md`, never silently dropped.
- **Who performs mechanical code review?** Code Reviewer.
- **Who performs security review?** Security Engineer.
- **Who performs accessibility review?** Accessibility Specialist.
- **Who performs holistic UI/UX review?** UI/UX Auditor — a named, required stage (UI/UX AUDIT) between ACCESSIBILITY and CODE REVIEW, not an implied/optional participant. Code Reviewer's own `SKILL.md` already required this dependency; it's now also visible here and in `TRACEABILITY.md`'s REVIEW column.
- **Who gives final approval?** Project Architect, and only after Code Review has passed (which itself only runs after QA/Security/Accessibility/UI-UX-Audit are done).
- **Who is allowed to create a checkpoint?** Version Control Agent executes it, but only Project Architect may instruct it to.

No circular dependencies exist in this chain — each stage depends only on stages before it.

## Project Structure Standards

All agents must follow `PROJECT_STRUCTURE.md`, read alongside `CLAUDE.md` (the authoritative description of what's actually shipped — where the two disagree, that is itself an escalation to Project Architect, not a silent pick).
