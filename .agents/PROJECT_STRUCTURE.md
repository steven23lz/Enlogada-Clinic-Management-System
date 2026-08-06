# Project Structure Standards

This project must follow a clean, scalable, and maintainable folder structure.
Do not place files randomly.
Every file must have a clear responsibility.
Follow feature-based organization whenever practical.

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
* Document significant architectural decisions in `/docs/ARCHITECTURE.md`.
* Review the project structure regularly and refactor when necessary to maintain clarity and scalability.
