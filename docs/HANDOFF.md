# Handoff: open threads

Last updated 2026-11-05, after [1.154.0]. For the next Claude Code agent working in this repo.
CLAUDE.md and the project memory load on their own; this file holds what they do not.

The diagram update this file used to brief is done: [1.133.0] made it and [1.134.0] checked it
against the code and corrected it (see `database/migrations.md`). [1.143.0] drew X-ray as a
reporting department again (flowchart, use case, DFD 0 and 1; process 21.0 is now Manage Patient
Feedback). After the next change to a process, re-run the check [1.134.0] describes.

## Unfinished tasks

Steven's own name for work he has parked, to come back to (2026-11-01, after [1.147.0]). Nothing is
built; each fix below is what was agreed. If built, in this order: 3, then 2, then 1.

1. **Lost inbox.** A patient who can no longer open their sign-in email cannot get back in: reset
   codes go to that inbox. Fix: an assisted email change at the clinic. The patient shows an ID; an
   Admin (a new permission, perhaps with unlink's two-person rule) checks it against the record's
   name and birthdate and types the new email; a code goes to the new address and the patient enters
   it there and then; sessions end, a new password is set, the old address is told, and it is
   audited. In person only, never by phone. Needs a clinic procedure agreed with the DPO.
2. **Duplicate profiles.** A walk-in who adds their own profile in the portal gets a second record.
   Fix: (a) the add-profile form always says "Visited the clinic before? Ask the front desk to invite
   this email" (no lookup, so nothing is revealed); (b) a portal profile with the same name and
   birthdate as a walk-in record that has no account is flagged to the desk only (Today, or "possible
   duplicate" in Patient Records), never to the patient, who could otherwise test who has visited.
   The desk invites; on accept, a portal profile with no visits is replaced by the walk-in record. A
   staff "merge records" tool only if that is not enough: it can mix two people's medical records.
3. **Google with another address.** Google sign-in matches accounts by email, so a Google address
   with no account silently creates a new one. Fix: keep Google's own account id on the account
   (`users.google_sub`) and look it up first; with no match, ask "create a new account, or sign in to
   your existing one and connect Google?"; My Account shows Google connected, with disconnect.

## Open threads

- **[1.151.0] / [1.152.0] What the patient walk left open.** Steven decided four of the six: no limit on
  unpaid bookings per account (one account may hold every slot of a day for its time to pay); a patient
  cannot rewrite the identity on a record with a released report; one transfer pays for one booking;
  Back closes dialogs and moves between screens. [1.153.0] closed online booking when no payment account
  is published, and [1.154.0] refuses a booking on an archived record. None of the six is left open.
  Also: the Terms now say a paid receipt is final and not refunded, which the clinic should read.
- **[1.150.0] Cash count.** On another database run `node src/scripts/migrateCashCounts.js`. It assumes
  one drawer for the clinic, a choice made without Steven, to confirm: two drawers would need a count
  per cashier. The flowcharts and DFDs do not show calling or counting yet; the use cases and ERD do.
- **[1.149.0] "Now serving" screen.** On another database run `node src/scripts/migrateQueueCalls.js`.
  Set up: open the Desk's "Waiting-room screen" on the TV's PC, press Full screen and Turn on sound
  (the browser asks for that press every time the page is opened). Production's shared limit of 100
  requests per 15 minutes per address looks low for a clinic where every PC shares one address on a
  cloud host: the screen has its own allowance now, but the staff screens do not. Decide with the
  deployment question below.
- **[1.148.0] Seven automations** (backups, three patient emails, retention, HMO countdown,
  worklist target). On another database run `node src/scripts/migratePatientMessages.js`. Left for
  Steven:
  - **Where the system will be deployed** (asked, not answered). On the clinic PC or a server with its
    own disk, backups work as built; set `BACKUP_COPY_DIR` (USB or a cloud-synced folder) and
    `BACKUP_PASSPHRASE` there, and write the passphrase down. On a cloud host with a managed
    database, `BACKUPS=host` and the host's backups; the uploaded reports then need a persistent disk,
    which the app does not have yet. See docs/BACKUP_AND_RESTORE.md.
  - `TURNAROUND_TARGETS` is still unset, so no worklist test is flagged. Setting it is the clinic
    agreeing a promise ([1.63.0]), so it is theirs to choose.
  - The DPO should know two things: backups hold every record (encrypt any copy that leaves the PC),
    and the server now emails patients by itself (no report or test name in any of the three).
  - The diagrams do not show the automatic jobs yet.

- **[1.146.0] What-ifs.** On another database run `node src/scripts/migrateDiscountDeclaration.js`
  (patients declaring a Senior/PWD discount online with an ID photo). Patients can now release their
  own unpaid booking. Steven chose both; the reasoning is in migrations.md [1.146.0]. The DPO should
  know ID photos are now stored (`uploads/discount-ids`), kept with the visit like the doctor's request.
- **[1.143.0] X-ray reports here again.** `NO_REPORT_CATEGORIES` is empty; X-ray exams marked done
  from [1.129.0] until then stay Done, judged row by row (`result_id` null). Nothing to run on
  another database. The demo seed draws X-ray reports again; re-seed before a demo.
- **The ERD leaves out `patient_invitations`** ([1.136.0]): `buildDiagrams.cjs` reports it missing
  from its sheets. The diagrams also have no invitation flow yet. Offered to Steven, not answered.

- **[1.136.0] Portal invitations for walk-ins are built** (see `docs/PORTAL_ACCESS_GUIDE.md` for the
  staff how-to, migrations.md for the design). On another database run
  `node src/scripts/migratePatientInvitations.js`, then `node src/scripts/setupRbac.js`. Planned with
  the `.agents` roles and reviewed by them after the build; every finding was fixed. Left as they
  are, deliberately:
  - The invitation caps (5 emails an address a day, 50 invitations a staff member a day) apply only
    under `NODE_ENV=production`, like the rate limiters. A deployment must set it.
  - Google sign-in cannot be driven by the suite. It marks the address verified (`googleLogin`);
    check it by hand once: sign in with Google using an invited address, and the record waits.
  - The family-consent rules were chosen with the user; the clinic's Data Protection Officer
    should confirm them (RA 10173), especially the phone path.
- **Joel (cashier@enlogada.com) holds the Receptionist role too**, unless Steven has unticked it on
  Staff Accounts or run `npm run demo` (which resets the demo accounts). While he does, seven E2E
  tests that take that account to be a cashier only fail. Last full run: 521 of 529 passed; the
  other failure was two random fixture patients sharing a name (`laboratory.spec.js`), which passes
  on its own.
- **Offered to Steven, not answered yet:** a "Book for a later day" button on the Desk (the API
  takes a staff booking with its payment; a screen would also need the senior/PWD discount before
  payment), and the patient's phone number on the Desk's "From earlier days" table.
- **A choice made without him, to confirm:** an HMO booking approved in part (some tests refused)
  is kept, and the refused tests are paid at the clinic.

## Running the E2E suite

Steven's own dev servers run on 5000/5173, so start your own and stop only those afterwards:

    # backend/
    PORT=5001 CORS_ORIGINS=http://localhost:5174,http://localhost:5173 FRONTEND_URL=http://localhost:5174 \
      APPOINTMENT_REMINDERS=off UNPAID_EXPIRY=off node src/server.js
    # frontend/
    VITE_API_BASE_URL=http://localhost:5001/api npx vite --port 5174 --strictPort
    # frontend/, the run itself
    E2E_SKIP_PURGE=1 E2E_API_URL=http://localhost:5001 E2E_BASE_URL=http://localhost:5174 npx playwright test

Check nobody is using the app first (the purge deletes what was created in the run's window), never
start two Playwright runs at once, and afterwards run
`node src/scripts/purgeE2eData.js --since=<first run's start> --dry-run`, then without `--dry-run`.
The timestamp columns are local time, so compare a UTC `--since` with `($1::timestamptz)::timestamp`
when you check by hand who wrote rows in the window.
