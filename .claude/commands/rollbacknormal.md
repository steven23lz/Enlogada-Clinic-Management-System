---
description: Restore the system to the save point made before the UI redesign (tag save/rollbacknormal)
---

Restore this repository to the save point Steven made on 2026-11-13, before the UI redesign: the git
tag `save/rollbacknormal` (commit 6a7ead4, "Drop test_results.superseded_by"). That state is the
system as the submitted paper describes it. Steven asked for this command, so run it when invoked,
but follow every step: it must never lose work silently.

1. **Look first.** Run `git fetch --tags` and `git status --short`. If there are uncommitted changes,
   stash them as `git stash push -u -m "before rollbacknormal <date-time>"` and say so.
2. **Show what will be undone.** `git log --oneline save/rollbacknormal..origin/main` and
   `git diff --stat save/rollbacknormal origin/main`. If any of those commits were made by someone
   other than Steven's own account (a teammate such as Diazzzz-cpu), or change anything that is
   not the redesign, list them and ASK whether to keep them before going on.
3. **Database.** If the diff touches `database/` or adds a `backend/src/scripts/migrate*.js`, run each
   new migration's `--rollback` in reverse order NOW, while the scripts still exist. The redesign is
   not expected to change the database. A backup taken at the save point is
   `C:\Users\Steven\Desktop\enlogada-backups\enlogada-2026-11-13-1755.dump`
   (restore with `node src/scripts/restoreBackup.js`, see docs/BACKUP_AND_RESTORE.md, only if asked).
4. **Make the rollback undoable.** Tag where main is now: `git tag -a save/before-rollback-<yyyymmdd-HHMM>
   -m "main just before /rollbacknormal"` and push the tag.
5. **Restore, as a new commit; never a reset or a force push.**
   `git restore --source=save/rollbacknormal --staged --worktree -- . ":!.claude/commands/rollbacknormal.md"`
   (it also removes files added since the save point; this command file is kept). Then commit
   "Roll back to the save point before the UI redesign" as the repo's own git identity with NO
   Co-Authored-By line, `git fetch`, and push to main.
6. **Check.** `git diff save/rollbacknormal HEAD --stat` must list only this command file. Run
   `cd backend && npm test` and `cd frontend && npm run test:unit && npm run build`. If dev servers are
   running, restart Vite so the old look loads.
7. **Report** what was undone (the commits), the tag that undoes the rollback, anything stashed, and
   the test results.
