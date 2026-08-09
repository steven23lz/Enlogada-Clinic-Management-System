# Zero-Hallucination Method — Shared Implementation Discipline

This is **not an agent**. It is the required working method for every agent that writes or changes anything — primarily Frontend Engineer, Backend Engineer, Database Engineer, and the Code Reviewer's verification pass. It is backed by the installed `zero-hallucination-coder` skill/plugin, which any of those agents should invoke when doing implementation work.

## The five phases

1. **Discuss** — Restate the task and its acceptance criteria before touching anything. If the task doesn't trace to a `MODULE_SCOPE.md` entry, stop here and escalate (see `MODULE_SCOPE.md`'s approval rule).
2. **Map** — Inspect the actual current state of every file you intend to touch. Do not assume behavior from memory, from a prior session, or from what a doc *says* should be there — read the real file. (This project's own history has an example of why: `PROJECT_STRUCTURE.md` describes a frontend folder structure that doesn't match the real `frontend/src/`; an agent that trusted the doc over the code would build the wrong thing.)
3. **Decompose** — Break the change into the smallest verifiable steps, each tied to one acceptance criterion or one file-ownership boundary.
4. **Execute** — Make the change, staying inside your default file ownership (see each `SKILL.md`'s "Allowed file ownership" / "Controlled exceptions" sections).
5. **Verify** — Confirm the change actually does what step 1 said it would, against the real running system where possible (build, lint, boot, manual smoke, or automated test — not "it looks right"). Record what verification was done; an unverified claim of completion is treated as incomplete.

## Rules that follow from this

- **Never claim a fix works without running/observing it.** If you can't run it (e.g. no test harness exists yet for a given surface), say so explicitly instead of asserting success.
- **Prefer reading the actual file over trusting a summary of it** — including summaries in this `.agents/` system itself. Docs drift; code is ground truth for what's currently shipped.
- **Surface contradictions instead of silently picking one side.** If `PROJECT_STRUCTURE.md` and `CLAUDE.md` (or any two docs) disagree, that's an escalation to Project Architect, not a coin flip.
- **A "verify" step that only re-reads your own diff is not verification.** Verification means checking against the running app, a test, or an explicit human confirmation — consistent with how `CLAUDE.md` already documents this project's manual-verification convention (no automated test suite existed before the QA/Test Engineer role and `pw` skill were introduced).

## Where this shows up per agent

| Agent | How it applies |
|---|---|
| Frontend Engineer | Map the real component/page before editing; verify via running dev server + manual interaction (or, once available, QA/Test Engineer's Playwright suite). |
| Backend Engineer | Map the real route→controller→service→repository chain; verify via syntax check + server boot + manual endpoint call (pattern already established by `testRbacEndpoints.js`). |
| Database Engineer | Map the real `schema.sql`, not an assumed one; verify via a clean `migrateDb.js` run against a scratch DB. |
| Code Reviewer | Verify phase is the review itself — confirms the implementing agent's claimed verification actually happened and holds up. |
