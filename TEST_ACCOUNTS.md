# Test Accounts

Seeded by `backend/src/scripts/seedUsers.js` — one account per role, for local development only.

**Password for every account:** `Password123!`

| Role | Name | Email |
|---|---|---|
| SuperAdmin | Super Admin | @enadminlogada.com |
| Admin | Clinic Manager | clinicadmin@enlogada.com |
| Receptionist | Maria Santos | receptionist@enlogada.com |
| Cashier | Juan Cashier | cashier@enlogada.com |
| Laboratory Staff | Doc Lab | lab@enlogada.com |
| Ultrasound Staff | Sonya Ultrasound | ultrasound@enlogada.com |
| Xray Staff | Xavier Ray | xray@enlogada.com |
| Client | Elena Client | client@enlogada.com |
| Receptionist **+** Cashier | Multi Role | multirole@enlogada.com |

## Notes

- Re-run `node src/scripts/seedUsers.js` from `backend/` to recreate any of these if they're ever deleted — it skips accounts that already exist.
- These credentials are dev-only seed data, already present in plain text in `seedUsers.js` itself — not a new secret exposure, just a faster reference than reading the script.
- SuperAdmin and Admin have different capabilities in a few places (e.g. the RBAC/permission matrix under Super Admin Management), so testing "the admin experience" may need both accounts depending on what you're checking.
- `multirole@enlogada.com` holds **two** operational roles and exists to demonstrate combined-role
  access: signing in shows both the Front Desk and Billing sidebar groups, and both consoles open.
  It is not created by `seedUsers.js` — recreate it by inserting two `user_roles` rows for the same
  user. Use it whenever changing navigation or role gating; a single-role account cannot reveal the
  class of bug where the sidebar offers a screen the router refuses to open.
