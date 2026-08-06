# Enlogada Clinic Management System — Master Project Status & Progress Report

> **Last Updated**: August 7, 2026  
> **Repository**: [`steven23lz/Enlogada-Clinic-Management-System`](https://github.com/steven23lz/Enlogada-Clinic-Management-System)  
> **Tech Stack**: React (Vite 8, Tailwind CSS v4), Node.js (Express 5), PostgreSQL (Local DB: `Enlogada`)

---

## 🎯 System Scope & Focus

The Enlogada Clinic Management System is an enterprise diagnostic healthcare platform exclusively for **human diagnostic services** (Ultrasound, Laboratory, Digital X-Ray, 2D Echo, and ECG).

- ❌ **Veterinary / Pet Services**: Fully removed from database seeds, public pages, patient forms, and operational workflows.
- ✅ **Dynamic Public Services Catalog**: The public Services Page (`ServicesPage.jsx`) dynamically fetches active diagnostic tests from the backend API (`GET /api/tests`). Any price updates or new services added by Admins immediately appear live on the public website.

---

## 🔑 System Roles & Test Credentials

All 8 system roles have pre-seeded test accounts in PostgreSQL for local testing:

> **Default Password for All Accounts**: `Password123!`

| Role Name | Test Email | Password | Primary Console & Capabilities |
|---|---|---|---|
| **SuperAdmin** | `superadmin@enlogada.com` | `Password123!` | System-wide configuration, full console switcher, RBAC management |
| **Admin** | `admin@enlogada.com` | `Password123!` | Executive clinic dashboard, Services Catalog management, revenue reports |
| **Receptionist** | `receptionist@enlogada.com` | `Password123!` | Walk-in patient check-in, queue generation, appointment verification, HMO logging |
| **Cashier** | `cashier@enlogada.com` | `Password123!` | Patient billing computation, payment recording (Cash/GCash/PayMaya), receipt printing |
| **Laboratory Staff** | `lab@enlogada.com` | `Password123!` | Pending lab queue processing, findings upload, result releasing & patient email notification |
| **Xray Staff** | `xray@enlogada.com` | `Password123!` | Pending X-Ray queue processing, findings upload, result releasing |
| **Ultrasound Staff** | `ultrasound@enlogada.com` | `Password123!` | Pending ultrasound queue processing, findings upload, result releasing |
| **Client** | `client@enlogada.com` | `Password123!` | Patient portal, profile creation, online appointment booking with service selection |

---

## 🔐 Authentication & Session Architecture

1. **Standard Password Auth**:
   - `POST /api/auth/register` (Client registration)
   - `POST /api/auth/login` (Role-based login returning JWT + user profile)
   - `GET /api/auth/me` (Profile re-verification on mount)

2. **Google OAuth 2.0 Auth**:
   - **Google Consent App**: `Enlogada Website`
   - **Credentials Name**: `Enloga Web client`
   - **Client ID**: `899306468454-hbjircavd5973feifm6o7vm1i2v1d4gi.apps.googleusercontent.com`
   - `POST /api/auth/google` verifies signed ID token via `google-auth-library` and logs in or creates the patient user.

3. **Session Interceptor**:
   - Axios `api.js` dispatches an `auth:unauthorized` window event on HTTP 401. `AuthContext.jsx` listens for this event to reset user state without breaking React SPA routing.

---

## 🗄️ Database Schema & Active Endpoints Mapping

### Core Tables
- `users`: `id`, `first_name`, `last_name`, `email`, `password_hash`, `contact_number`, `status`
- `roles`: `id`, `name`, `description`
- `user_roles`: `id`, `user_id`, `role_id`, `assigned_by`, `is_active`
- `patient_types`: `id`, `name` (`HMO`, `Private`, `Self Pay`)
- `patients`: `id`, `user_id`, `patient_type_id`, `first_name`, `last_name`, `birthdate`, `sex`, `address`, `contact_number`, `emergency_contact`
- `patient_visits`: `id`, `patient_id`, `visit_type`, `queue_number`, `status`, `notes`
- `appointments`: `id`, `patient_visit_id`, `appointment_reference`, `scheduled_date`, `scheduled_time`, `status`
- `test_categories`: `id`, `name` (`Laboratory`, `Xray`, `Ultrasound`, `2D Echo`, `ECG`)
- `tests`: `id`, `category_id`, `name`, `price`, `is_active`
- `visit_tests`: `id`, `patient_visit_id`, `test_id`, `status`, `price_at_time`, `remarks`
- `payments`: `id`, `patient_visit_id`, `total_amount`, `payment_method`, `reference_number`, `status`, `processed_by`
- `test_results`: `id`, `visit_test_id`, `file_url`, `findings`, `remarks`, `released_by`, `released_at`
- `hmo_providers`: `id`, `name`
- `hmo_requests`: `id`, `patient_visit_id`, `hmo_provider_id`, `approval_code`, `status`

### Key API Endpoints
- `GET /api/tests` — Public tests list (supports `?includeInactive=true` for Admins)
- `GET /api/tests/categories` — Public test categories
- `POST /api/tests` — Add new service (Admin/SuperAdmin)
- `PUT /api/tests/:id` — Update service name/price/status (Admin/SuperAdmin)
- `POST /api/tests/visit-tests` — Attach tests to visit (Client, Receptionist, Admin)
- `GET /api/visits/active` — Active clinic queue (Receptionist, Cashier)
- `GET /api/payments/bill/:visitId` — Compute visit total bill (Cashier)
- `POST /api/payments` — Process payment (Cashier)
- `GET /api/results/pending/:category` — Pending diagnostic queue (Lab, Xray, Ultrasound Staff)
- `POST /api/results/:visitTestId` — Upload findings & set completed (Lab, Xray, Ultrasound Staff)
- `POST /api/results/:visitTestId/release` — Release result & send email notification (Lab, Xray, Ultrasound Staff)

---

## 🎨 UI Architecture & HCI Compliance

1. **Design System**:
   - Primary Accent: Green `#769046`
   - Dark Slate Containers: `#1e293b` & `#192534`
   - Typography: Google Font `'Outfit'`
   - Branding: Vector Enlogada Medical Cross logo used consistently in top bar, favicon, and login cards.

2. **Public Views**:
   - `Home.jsx` — Clinic Hero, Book CTA, Services Highlights, Dark Footer.
   - `ServicesPage.jsx` — Dynamic grid of active diagnostic services fetched from database.
   - `Login.jsx` — Figma-matched Login form with Google Sign-In.
   - `Register.jsx` — Figma-matched Registration form.

3. **Staff & Admin Consoles**:
   - `SidebarLayout.jsx` — Responsive left dark sidebar + top search bar + notification bell.
   - `AdminDashboard.jsx` — Metric summary cards (Today's Appointments, Revenue, Pending Requests, Active Staff) + performance charts.
   - `ServicesCatalog.jsx` — Admin management interface for adding/editing services and updating prices live.
   - `ReceptionistDashboard.jsx` — Patient check-in, queue assignment, walk-in registration, HMO logging.
   - `CashierDashboard.jsx` — Patient billing summary, multi-method payment modal, receipt generation.
   - `DiagnosticDashboard.jsx` — Category-filtered pending queue, medical findings upload modal, result releasing.
   - `ClientDashboard.jsx` — Patient portal, family profile creation, online appointment booking.

---

## 🚀 How to Run the Project

```bash
# Terminal 1 — Backend (Port 5000)
cd backend
npm run dev

# Terminal 2 — Frontend (Port 5173)
cd frontend
npm run dev
```

Open **`http://localhost:5173`** in your browser.
