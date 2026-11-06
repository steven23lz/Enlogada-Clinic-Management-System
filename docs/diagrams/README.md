# Capstone paper diagrams

The figures for *Design and Development of a Web-Based Clinic Management System for Enlogada
Ultrasound and Diagnostic Clinic*, drawn to match what the system actually does. The System
Architecture figure (Figure 2) keeps the layout and colours of the paper's first version.

Drawn in the style of a printed figure: draw.io, default shapes, black ink on white, the actor
icon for a flowchart header, a stick figure for a use case, nested flow corridors on the data flow
diagrams, and Workbench-style tables for the ERD. What changed is the content.

## Files

| File | Pages | Figures it replaces |
|---|---|---|
| `flowcharts.drawio` | 8 | the role flowcharts, plus a Super Admin chart the paper never had |
| `usecases.drawio` | 8 | the use case diagrams |
| `dfd-level0.drawio` | 9 | the per-actor Level 0 sheets, plus a context diagram showing all eight entities |
| `dfd-level1.drawio` | 8 | the per-actor Level 1 sheets |
| `erd.drawio` | 3 | the single ERD, split because 38 tables do not read on one page |
| `erd-overview.svg` | 1 | the ERD in the paper: every table on one page, key columns only (`node docs/diagrams/buildErdOverview.cjs`, also from the live database; it fails on a line through a table) |
| `system-architecture.drawio` | 1 | Figure 2 (`node docs/diagrams/buildArchitecture.cjs`; fails if a table, route file or job is left off) |
| `png/` | 38 | exports at scale 3 for placing in the paper |

## Regenerating

    node docs/diagrams/buildDiagrams.cjs

The flowcharts, use cases and data flow diagrams come from the specs inside that script. The ERD is
read from the live database, so it cannot drift from the schema: tables, columns, PostgreSQL types,
nullability, primary keys and foreign keys are all queried, and the script fails loudly if a table
is missing from one of the three sheets.

Checking the diagrams for missing decision branches, dead ends, crossings, overlaps, long labels, and any flow on one DFD level and not the other:

    node docs/diagrams/checkDiagrams.cjs

Re-exporting the images (run from inside `docs/diagrams/`):

    powershell -ExecutionPolicy Bypass -File exportPng.ps1

## Two things that will bite

**draw.io's `-p` page index is one-based.** Passing `0` exports the first page without an error, so
a whole run comes out shifted by one and the files look fine until you read them.

**Never edit the `.drawio` files by hand.** Change the specs in `buildDiagrams.cjs`, run
`checkDiagrams.cjs` until it prints `Clean.`, and re-export the PNGs so the next regeneration never
throws work away.

## What these diagrams assert about the system

Worth knowing before a panelist asks, because each one differs from the old figures:

- There is no veterinary branch anywhere. Pet patients were removed from the system.
- A refused login asks **Forgot Password?** on all eight flowcharts: no tries again, yes resets by a code emailed to the address, and both return to Login. A patient logs in only on the way to booking, because the services are public, and a new account's emailed code finishes the sign-up already signed in.
- A booking issues a reference and confirmation email first. A self-pay booking holds its slot for 60 minutes while the patient confirms final tests, pays via GCash or bank transfer, and uploads proof; an HMO booking holds its slot until its own start time while an Admin decides the claim (refused, the patient has 60 minutes to pay it). Neither paid nor approved in time, the slot is released and the patient emailed. The **QR booking pass** is issued only once the booking is paid or HMO-approved.
- A patient **moves their own booking** with a reason, and it takes effect at once: no one approves it, and the desk is notified. They can do so until they check in. That is why the DFD flow reads "New date, time and reason", not a request.
- The **queue ticket** is issued later, at check-in or walk-in registration at the Front Desk, once the visit's tests are chosen: a visit is never opened without them.
- A visit reaches its department only once it is **paid**. An HMO patient still goes to the cashier, whose receipt covers the patient's share (₱0 when the HMO approved everything).
- Before taking payment, the cashier confirms the final list of tests with the patient and issues the **receipt** (never the queue number). A pending HMO decision stops the till unless the claim is withdrawn and the bill charged in full.
- A paid receipt is final, with **two recorded refund cases**: the clinic cannot perform a test, or a payment was recorded by mistake. Only a Super Admin refunds, never on a receipt they took themselves, and the patient is emailed.
- The cashier **counts the drawer** at the end of the day. The server adds up the count, and a difference needs a note. Super Admin can switch from one shared drawer to one per cashier.
- A mistake can be taken back: the desk **undoes a check-in** until a department has started, and a department **withdraws** a report on the wrong patient or file. A wrong figure is amended instead.
- With **no test result uploaded** 60 minutes after a patient joins the queue, or 15 minutes before closing, the department, Admin and Super Admin are alerted until it is uploaded.
- An HMO covering only part of a package ends its price, and each test goes back to its own price.
- A walk-in's record reaches a portal account by **invitation**, never by the desk linking it.
- There is no waiting-room screen and no Call button; both are future recommendations in the paper.
- Bookings and visits are never cancelled or marked no-show by hand. Unpaid bookings and unpaid visits expire automatically on a timer and log the expiry to the Activity Log; paid bookings that need another date are rescheduled.
- An Admin decides HMO claims (a claim on a booking must be decided by the booking's start time, shown as "decide by") and generates four-tab A4/Excel reports, but cannot write or release a diagnostic result; the department does that.
- Laboratory, Ultrasound and X-Ray attach and authorise a report file, placing a marked digital copy with a verification code in the patient's portal. Emailing the report to the patient is an optional choice after release or from History, never automatic on release. (From [1.129.0] to [1.143.0] X-ray only marked its exams done; those exams still read Done, with no report.)
- Results keep their history: an amendment releases a new version and the previous one stays on record.
- Patients can answer a visit feedback survey in the portal (or have a paper form recorded by the Receptionist from Visit History), and Admin / Super Admin manage the survey questions.

