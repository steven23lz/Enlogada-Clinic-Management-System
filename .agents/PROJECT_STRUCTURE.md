# Project Structure Standards

This project must follow a clean, scalable, and maintainable folder structure.
Do not place files randomly.
Every file must have a clear responsibility.
Follow feature-based organization whenever practical.

> **Reconciliation note:** where this file's prescribed structure and `CLAUDE.md`'s description of what's actually shipped disagree, `CLAUDE.md` reflects reality and this file is aspirational for that point — see the Frontend Structure section below for the specific, known case. Any agent that finds a new disagreement between this file and the live code should escalate to the Project Architect rather than silently following either doc. See also `MODULE_SCOPE.md` for the functional boundary and `_shared/VISUAL_IDENTITY.md` for design tokens.

---

# Overall Project Structure

```
project-root/
├── backend/
├── frontend/
├── database/
├── docs/
├── uploads/
├── .gitignore
├── README.md
└── docker-compose.yml (optional)
```

---

# Backend Structure (Express + Node.js)

```
backend/
src/
├── config/
│   ├── database.js
│   ├── environment.js
│   └── logger.js
├── routes/
├── controllers/
├── services/
├── repositories/
├── middlewares/
├── validations/
├── models/
├── utils/
├── constants/
├── helpers/
├── uploads/
├── jobs/
├── sockets/
├── docs/
├── app.js
└── server.js
```

---

## Backend Responsibilities

### Routes
Only define endpoints.
Never contain business logic.

---

### Controllers
Receive requests.
Validate input.
Call services.
Return responses.
Never contain heavy business logic.

---

### Services
Contain all business logic.
Controllers should remain thin.

---

### Repositories
Contain database queries.
Never write SQL inside controllers.
Never write SQL inside services.
Repositories communicate with PostgreSQL.

---

### Middlewares
* Authentication
* Authorization
* RBAC
* Validation
* Logging
* Error handling
* Rate limiting

---

### Validations
Centralize request validation.
Use validation libraries.

---

### Utilities
Reusable helper functions.

---

### Config
* Environment variables
* Database connection
* Application configuration

---

# Frontend Structure (React)

**Current, actual structure (authoritative — matches `CLAUDE.md` and the live code):**

```
frontend/
src/
├── assets/
├── components/       (including components/ui/ — shadcn/radix primitives)
├── pages/
├── hooks/
├── contexts/
├── config/           (api.js — Axios client)
├── validations/
├── App.jsx
└── main.jsx
```

There is **no router library**. `App.jsx` performs manual, role-based conditional rendering driven by `user.roles` (from `AuthContext`) plus local `currentTab`/`activeNav` state. New pages/dashboards are wired into that branching logic in `App.jsx`, not into a `routes/` folder or a routing library. Do not introduce a routing library as a "structure fix" — `CLAUDE.md` documents this as the deliberate current pattern, not an oversight.

**Aspirational structure (below) — not yet in use.** These folders (`api/`, `features/`, `routes/`, `services/`, `store/`, `types/`, `styles/`, `layouts/`, `constants/`) may be introduced in the future if a module genuinely needs them (e.g. `store/` if state outgrows Context), but scaffolding them speculatively — without a concrete module requirement driving it — is out of scope. Any agent proposing to introduce one of these needs Project Architect sign-off first.

```
frontend/
src/
├── api/
├── assets/
├── components/
├── features/
├── layouts/
├── pages/
├── routes/
├── hooks/
├── contexts/
├── services/
├── utils/
├── constants/
├── types/
├── styles/
├── validations/
├── store/
├── App.jsx
└── main.jsx
```

---

## Frontend Responsibilities

### Components
Reusable UI.
* Buttons
* Cards
* Tables
* Inputs
* Modals
* Badges

---

### Pages
Entire screens.
* Dashboard
* Appointments
* Patients
* Payments
* Settings

---

### Features
Feature-specific logic.
* Patient Management
* Appointment Module
* Payments Module
* HMO Module
* Results Module

---

### API
Axios configuration.
API functions.
Never call fetch directly inside components.

---

### Hooks
Reusable React hooks.

---

### Contexts
* Authentication
* Theme
* Global settings

---

### Store
Global state management.
Redux or Zustand if needed.

---

### Services
Business logic shared across pages.

---

### Styles
Global styling.
Theme.
Variables.
Canonical color/typography tokens are documented in `_shared/VISUAL_IDENTITY.md` (transcribed from `frontend/src/index.css`'s Tailwind `@theme` block) — check that file before introducing any new color or font.

---

# Naming Conventions

### Folders
lowercase

### Files
* PascalCase for React components (e.g. `PatientCard.jsx`)
* camelCase for utilities (e.g. `formatDate.js`)

### Database
snake_case

### React Components
PascalCase

### Variables
camelCase

### Constants
UPPER_SNAKE_CASE

---

# General Rules

* Never duplicate code.
* Prefer composition over inheritance.
* Keep files focused on one responsibility.
* Split files when they become too large.
* Avoid files exceeding 300–500 lines unless justified.
* Keep components small and reusable.
* Prefer reusable services over repeated logic.
* Document significant architectural decisions in `/docs/ARCHITECTURE.md`. (Note: this file does not exist yet as of this writing — creating it is a future task for the Project Architect, not implied authorization to create it as a side effect of unrelated work.)
* Review the project structure regularly and refactor when necessary to maintain clarity and scalability.
