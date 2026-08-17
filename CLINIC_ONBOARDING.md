# Clinic Onboarding — information needed from the client

Everything the system needs from the clinic before it can run as theirs rather than as a demo.

Written to be handed to the clinic owner or administrator. Each item says **why** it is needed and
**what happens if it is left blank**, because a good half of these are genuinely optional and a
questionnaire that does not distinguish the two gets abandoned halfway.

Nothing here is invented on the clinic's behalf. Where a value is missing the system says so
plainly on screen rather than guessing — a made-up TIN on a receipt a patient files for
reimbursement is a false record, which is a worse outcome than an obviously provisional one.

**Legend** — 🔴 blocks go-live · 🟡 degrades something visible · ⚪ optional

---

## 1. Clinic identity

Printed on receipts, on the sign-in page, and in result emails.

| # | Information | Need | If blank |
|---|---|---|---|
| 1.1 | Registered business name (as on the BIR Certificate of Registration) | 🟡 | Falls back to "Enlogada Ultrasound & Diagnostic Clinic" |
| 1.2 | Trading / short name for the receipt header | ⚪ | Falls back to "ENLOGADA" |
| 1.3 | Complete business address | 🟡 | Falls back to the built-in address — **wrong on every receipt if the clinic has moved** |
| 1.4 | Landline / mobile shown to patients | 🟡 | Falls back to the built-in number |
| 1.5 | Public email address | 🟡 | Falls back to the built-in address |
| 1.6 | Logo file (SVG or PNG, transparent background) | ⚪ | Current logo stays |

> Set in `backend/.env` as `CLINIC_NAME`, `CLINIC_SHORT_NAME`, `CLINIC_ADDRESS`, `CLINIC_PHONE`,
> `CLINIC_EMAIL`. Backend restart, no rebuild.

---

## 2. BIR and statutory registration

**This is the section that decides whether the clinic can hand a patient an Official Receipt.**

| # | Information | Need | If blank |
|---|---|---|---|
| 2.1 | **TIN**, as on the Certificate of Registration (Form 2303) | 🟡 | Not printed on the receipt |
| 2.2 | **Authority to Print (ATP) number** — or **Permit to Use (PTU)** if the clinic runs a BIR-accredited POS / computerised accounting system | 🔴 for OR | Receipt prints as "Payment Receipt" with a line saying it is **not** a BIR-registered Official Receipt |
| 2.3 | OR serial range covered by that ATP/PTU (from-to) | 🟡 | Receipt numbers come from the system's own daily counter instead of the BIR-issued series |
| 2.4 | Is the clinic **VAT-registered**, or VAT-exempt / non-VAT? | 🔴 | See §3 — the discount arithmetic depends on this |
| 2.5 | Mayor's / business permit number | ⚪ | Not printed |
| 2.6 | PhilHealth accreditation number | ⚪ | Not printed |

### Why the ATP matters more than the TIN

The system upgrades the receipt heading from "Payment Receipt" to "Official Receipt" based on the
**permit**, not the TIN. A TIN identifies the taxpayer; it does not authorise anybody to issue an
official receipt. A clinic that is registered but has no ATP or PTU still cannot issue one, so
keying the wording to the TIN would print "Official Receipt" on a document that is not one.

> Set as `CLINIC_TIN`, `CLINIC_PERMIT`, `CLINIC_ACCREDITATION`.

---

## 3. VAT and statutory discounts — **needs an accountant, not a developer**

The system applies the Senior Citizen and PWD discounts under RA 9994 / RA 10754 by stripping the
12% VAT **first** and applying the 20% to the VAT-exempt base. On a ₱1,000.00 service that is
₱714.29, not ₱800.00.

| # | Question | Need |
|---|---|---|
| 3.1 | Confirm the clinic is VAT-registered and that catalogue prices are **VAT-inclusive** | 🔴 |
| 3.2 | Have the clinic's accountant confirm the VAT-then-discount ordering above | 🔴 |
| 3.3 | Any non-statutory discounts (senior corporate rates, promos, package pricing)? Name and % for each | ⚪ |
| 3.4 | Does the clinic honour both Senior **and** PWD on one visit, or only the larger? | 🟡 |

> **This is the highest-risk item in the document.** It is money, it is regulated, and getting it
> wrong under-charges or over-charges every discounted patient. Nobody on the build side can sign
> this off.

---

## 4. Services and pricing

| # | Information | Need | If blank |
|---|---|---|---|
| 4.1 | Full test catalogue per department — Laboratory, X-Ray, Ultrasound, 2D Echo, ECG | 🔴 | Only the seeded demo catalogue exists |
| 4.2 | Current price for each, VAT-inclusive | 🔴 | Demo prices, which are invented |
| 4.3 | Which tests are currently offered vs. suspended | 🟡 | Everything shows as available to the public |
| 4.4 | Typical turnaround time per test (for "results ready by") | ⚪ | Not shown |
| 4.5 | Any test requiring preparation (fasting, full bladder) — the instruction text | ⚪ | Not shown to patients when booking |

> Editable in-app under **Services Catalog** once seeded; a spreadsheet is easiest for the initial
> load.

---

## 5. Referring physician policy — **one open decision**

The system records the doctor who requested a test, and currently **requires** one when:

- the visit carries an **HMO claim** (the LOA is issued against the referring physician), and
- the patient type is **Private** (which here means "referred by a private physician").

It does **not** require one for a Self Pay walk-in.

| # | Question | Need |
|---|---|---|
| 5.1 | Confirm "Private" means a physician-referred patient at this clinic | 🟡 |
| 5.2 | **Does the clinic's DOH / BHDT licensing require a physician's request before a diagnostic X-ray, regardless of who is paying?** | 🔴 |
| 5.3 | Same question for Ultrasound, 2D Echo and ECG | 🟡 |

> **5.2 is the one to actually ask about.** Diagnostic radiography is normally performed on a
> licensed physician's request, and that is a radiation-safety rule which does not care who is
> paying — so the current payer-based rule may be too narrow. If the answer is yes, the fix is a
> per-test-category "requires referral" setting rather than anything to do with HMO or patient
> type. Recorded in `database/migrations.md` under `[1.23.0]`.

---

## 6. Operating hours and appointment capacity

| # | Information | Need | If blank |
|---|---|---|---|
| 6.1 | Opening and closing time for each day of the week | 🔴 | Mon–Fri 08:00–17:00, Sat 08:00–12:00, Sun closed |
| 6.2 | Appointment slot length | 🟡 | 30 minutes |
| 6.3 | **How many patients can be booked into one slot?** | 🟡 | 1 |
| 6.4 | Public holidays / annual closures | ⚪ | Not modelled — those days accept bookings |

> 6.3 matters more than it looks. At 1 the online booking page offers each time once and then
> shows it taken. Clinics that run several rooms in parallel usually want a higher number.

---

## 7. HMO providers

| # | Information | Need | If blank |
|---|---|---|---|
| 7.1 | Every HMO the clinic is accredited with | 🔴 for HMO patients | Only the seeded provider exists |
| 7.2 | Accreditation / provider code per HMO, if they issue one | ⚪ | Not stored |
| 7.3 | Who approves an HMO claim internally — Admin only, or may Reception? | 🟡 | Admin and SuperAdmin only |

> Note: the clinic must confirm they are happy that a client booking online can **state** HMO
> coverage themselves. It is only ever a claim — staff still approve it — and the patient must
> upload a photo of their card as evidence.

---

## 8. Staff accounts

| # | Information | Need |
|---|---|---|
| 8.1 | Full name, email and role for every staff member | 🔴 |
| 8.2 | For diagnostic staff — which department(s) each covers | 🔴 |
| 8.3 | Who should hold **SuperAdmin** (can edit the permission matrix)? Usually one person | 🔴 |
| 8.4 | Who should hold **Admin** (oversight, cannot take payment or author results)? | 🟡 |
| 8.5 | Any staff member who needs an exception to their role's normal permissions | ⚪ |

> Roles available: SuperAdmin, Admin, Receptionist, Cashier, Laboratory Staff, Xray Staff,
> Ultrasound Staff. **There is no ECG-specific role** — ECG tickets are currently overseen by
> Admin. Ask whether that is acceptable or whether one is needed.

---

## 9. Email (result release notifications)

Patients are emailed when a result is released.

| # | Information | Need | If blank |
|---|---|---|---|
| 9.1 | SMTP host, port, username, password | 🔴 | **No result emails are sent at all** |
| 9.2 | "From" address and display name patients should see | 🟡 | Falls back to the SMTP username |
| 9.3 | Should the report be attached, or only a link to sign in? | 🟡 | Currently a notification only |

> If the clinic uses Gmail / Google Workspace this needs an **app password**, not the account
> password.

---

## 10. Google Sign-In (optional)

| # | Information | Need | If blank |
|---|---|---|---|
| 10.1 | Google Cloud OAuth **client ID** for the clinic's own project | ⚪ | The button is hidden and the page says Google Sign-In is not configured. Email/password works normally |
| 10.2 | The exact public URL the app will be served from | 🟡 | Must be added under "Authorized JavaScript origins" or the button silently fails to render |

> Currently unconfigured for `http://localhost:5173`, which is why the sign-in page shows that
> notice in development. Harmless.

---

## 11. Data retention

The clinic decides how long things are kept. Defaults are in place and are reasonable; they should
still be a decision rather than an accident.

| # | Question | Default |
|---|---|---|
| 11.1 | How long to keep read / unread in-app notifications? | 30 days / 90 days |
| 11.2 | How long to keep audit entries recording who **read** a patient file? | 2 years |
| 11.3 | How long to keep all other audit entries? | 7 years |
| 11.4 | How long to keep uploaded **HMO card images**? | 365 days from the claim |
| 11.5 | How long to keep diagnostic **report files**? | Indefinitely — never auto-deleted |

> 11.5 is deliberate: a diagnostic report is a medical record. Confirm the clinic agrees, and ask
> what their own record-retention policy says.

---

## 12. Deployment

| # | Information | Need |
|---|---|---|
| 12.1 | Public domain name for the system | 🔴 |
| 12.2 | Where it will be hosted, and who administers that | 🔴 |
| 12.3 | Who receives the database backups, and how often | 🔴 |
| 12.4 | Online payment: does the clinic have a GCash / PayMaya merchant account, or is it counter-only? | 🟡 |

---

## Minimum set to go live

If the client can only answer some of this, these are the ones that actually block:

1. **§3** — VAT registration status and accountant sign-off on the discount arithmetic
2. **§4.1–4.2** — the real test catalogue and prices
3. **§5.2** — whether an X-ray needs a physician's request regardless of payer
4. **§6.1** — real operating hours
5. **§8** — the staff roster
6. **§9.1** — SMTP, or patients get no result emails
7. **§12** — domain, hosting, backups

Everything else has a working default, or degrades to something the system states plainly on
screen rather than faking.
