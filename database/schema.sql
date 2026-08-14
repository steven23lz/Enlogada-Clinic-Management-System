-- Database Schema for Enlogada Ultrasound and Diagnostic Clinic Management System
-- Database: PostgreSQL (Local/Supabase hosted)

-- Drop existing tables to allow clean recreation
DROP TABLE IF EXISTS daily_counters CASCADE;
DROP TABLE IF EXISTS discount_types CASCADE;
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS notification_reads CASCADE;
DROP TABLE IF EXISTS notification_events CASCADE;
DROP TABLE IF EXISTS clinic_operating_hours CASCADE;
DROP TABLE IF EXISTS password_reset_tokens CASCADE;
DROP TABLE IF EXISTS role_permissions CASCADE;
DROP TABLE IF EXISTS permissions CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS test_results CASCADE;
DROP TABLE IF EXISTS hmo_request_tests CASCADE;
DROP TABLE IF EXISTS hmo_requests CASCADE;
DROP TABLE IF EXISTS hmo_providers CASCADE;
DROP TABLE IF EXISTS visit_tests CASCADE;
DROP TABLE IF EXISTS tests CASCADE;
DROP TABLE IF EXISTS test_categories CASCADE;
DROP TABLE IF EXISTS appointments CASCADE;
DROP TABLE IF EXISTS patient_visits CASCADE;
DROP TABLE IF EXISTS patients CASCADE;
DROP TABLE IF EXISTS patient_types CASCADE;
DROP TABLE IF EXISTS user_roles CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS roles CASCADE;

-- 1. Roles and RBAC
CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    contact_number VARCHAR(20),
    status BOOLEAN DEFAULT TRUE,
    avatar_path VARCHAR(255),
    avatar_mime_type VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_roles (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    role_id INT NOT NULL,
    assigned_by INT,
    starts_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES roles(id),
    CONSTRAINT fk_user_roles_assigned_by FOREIGN KEY (assigned_by) REFERENCES users(id),
    CONSTRAINT uq_user_role UNIQUE (user_id, role_id)
);

-- Fine-grained permissions (dynamic RBAC matrix). Data is seeded separately by
-- backend/src/scripts/setupRbac.js, which must be run after this schema is applied.
CREATE TABLE permissions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    module VARCHAR(50) NOT NULL,
    description TEXT
);

CREATE TABLE role_permissions (
    id SERIAL PRIMARY KEY,
    role_id INT NOT NULL,
    permission_id INT NOT NULL,
    CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
    CONSTRAINT uq_role_permission UNIQUE (role_id, permission_id)
);

-- Password reset tokens (Module 1: Authentication). Only the SHA-256 hash of the emailed
-- token is stored — never the raw token itself.
CREATE TABLE password_reset_tokens (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_password_reset_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 2. Patients (Only human profiles)
CREATE TABLE patient_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE patients (
    id SERIAL PRIMARY KEY,
    user_id INT, -- Nullable if registered by receptionist as walk-in without a web account
    patient_type_id INT NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    birthdate DATE NOT NULL,
    sex VARCHAR(20) NOT NULL,
    address TEXT,
    contact_number VARCHAR(20),
    emergency_contact VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_patients_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_patients_type FOREIGN KEY (patient_type_id) REFERENCES patient_types(id),
    CONSTRAINT chk_patients_sex CHECK (sex IN ('Male', 'Female'))
);

-- Discount catalogue. Senior Citizen and PWD are mandated by RA 9994 / RA 10754 (20% off
-- medical and diagnostic services); the same shape covers commercial discounts at no extra cost.
-- See migrations.md [1.14.0].
CREATE TABLE discount_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    percentage NUMERIC(5,2) NOT NULL,
    is_statutory BOOLEAN NOT NULL DEFAULT FALSE,  -- mandated by law; cannot be deactivated
    requires_id  BOOLEAN NOT NULL DEFAULT FALSE,  -- OSCA/PWD ID must be recorded on the visit
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_discount_percentage CHECK (percentage >= 0 AND percentage <= 100)
);

-- 3. Visits and Appointments
CREATE TABLE patient_visits (
    id SERIAL PRIMARY KEY,
    patient_id INT NOT NULL,
    visit_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'Pending',
    notes TEXT,
    queue_number VARCHAR(50), -- Tracks the physical queue number generated for receptionist/cashier flow
    -- The discount ENTITLEMENT claimed for this visit. The amount actually deducted is
    -- snapshotted onto payments, so a receipt survives later catalogue edits.
    discount_type_id INT,
    discount_id_number VARCHAR(50),   -- OSCA / PWD ID presented
    discount_granted_by INT,
    discount_granted_at TIMESTAMP,
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_visits_patient FOREIGN KEY (patient_id) REFERENCES patients(id),
    CONSTRAINT fk_visits_created_by FOREIGN KEY (created_by) REFERENCES users(id),
    CONSTRAINT fk_visits_discount_type FOREIGN KEY (discount_type_id) REFERENCES discount_types(id),
    CONSTRAINT fk_visits_discount_granted_by FOREIGN KEY (discount_granted_by) REFERENCES users(id),
    CONSTRAINT chk_visits_type CHECK (visit_type IN ('Walk in', 'Appointment')),
    CONSTRAINT chk_visits_status CHECK (status IN ('Pending', 'Processing', 'Completed', 'Cancelled'))
);

CREATE TABLE appointments (
    id SERIAL PRIMARY KEY,
    patient_visit_id INT NOT NULL UNIQUE,
    appointment_reference VARCHAR(100) NOT NULL UNIQUE, -- Used for QR code generation and lookup
    scheduled_date DATE NOT NULL,
    scheduled_time TIME NOT NULL,
    status VARCHAR(50) DEFAULT 'Pending',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_appointments_visit FOREIGN KEY (patient_visit_id) REFERENCES patient_visits(id),
    CONSTRAINT chk_appointments_status CHECK (status IN ('Pending', 'Confirmed', 'Completed', 'Cancelled', 'No Show'))
);

-- 4. Diagnostic Tests
CREATE TABLE test_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE tests (
    id SERIAL PRIMARY KEY,
    category_id INT NOT NULL,
    name VARCHAR(150) NOT NULL,
    price NUMERIC(10,2) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_tests_category FOREIGN KEY (category_id) REFERENCES test_categories(id),
    CONSTRAINT chk_tests_price CHECK (price >= 0),
    CONSTRAINT uq_tests_category_name UNIQUE (category_id, name)
);

CREATE TABLE visit_tests (
    id SERIAL PRIMARY KEY,
    patient_visit_id INT NOT NULL,
    test_id INT NOT NULL,
    status VARCHAR(50) DEFAULT 'Pending',
    price_at_time NUMERIC(10,2) NOT NULL, -- Captures price of the test at the moment of booking/visit
    remarks TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_visit_tests_visit FOREIGN KEY (patient_visit_id) REFERENCES patient_visits(id),
    CONSTRAINT fk_visit_tests_test FOREIGN KEY (test_id) REFERENCES tests(id),
    -- 'Waiting for Release': the modality has performed the exam and recorded findings, but the
    -- result has not yet been authorised/released to the patient. Sits between 'Processing'
    -- (released to the modality, exam not yet done) and 'Completed' (result released).
    CONSTRAINT chk_visit_tests_status CHECK (status IN ('Pending', 'Approved', 'Processing', 'Waiting for Release', 'Completed', 'Cancelled')),
    CONSTRAINT chk_visit_tests_price CHECK (price_at_time >= 0),
    CONSTRAINT uq_visit_tests_visit_test UNIQUE (patient_visit_id, test_id)
);

-- 5. HMO Integrations (Manual Record Keeping)
CREATE TABLE hmo_providers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE hmo_requests (
    id SERIAL PRIMARY KEY,
    hmo_provider_id INT NOT NULL,
    approval_code VARCHAR(100),
    status VARCHAR(50) DEFAULT 'Pending',
    request_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    approved_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_hmo_provider FOREIGN KEY (hmo_provider_id) REFERENCES hmo_providers(id),
    CONSTRAINT chk_hmo_status CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Cancelled'))
);

CREATE TABLE hmo_request_tests (
    id SERIAL PRIMARY KEY,
    hmo_request_id INT NOT NULL,
    visit_test_id INT NOT NULL,
    approval_status VARCHAR(50) DEFAULT 'Pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_hmo_request_tests_request FOREIGN KEY (hmo_request_id) REFERENCES hmo_requests(id),
    CONSTRAINT fk_hmo_request_tests_visit_test FOREIGN KEY (visit_test_id) REFERENCES visit_tests(id),
    CONSTRAINT chk_hmo_request_tests_status CHECK (approval_status IN ('Pending', 'Approved', 'Rejected')),
    CONSTRAINT uq_hmo_request_visit_test UNIQUE (hmo_request_id, visit_test_id)
);

-- 6. Results and Releasing
CREATE TABLE test_results (
    id SERIAL PRIMARY KEY,
    -- NOT unique: a test carries one row per VERSION. Exactly one of them is current, enforced by
    -- the partial unique index uq_test_results_current_per_test below. The old UNIQUE here is
    -- what made a correction overwrite the original — see migrations.md [1.15.0].
    visit_test_id INT NOT NULL,
    file_url TEXT,
    file_path TEXT,
    file_original_name TEXT,
    file_mime_type TEXT,
    file_size_bytes INT,
    findings TEXT,
    remarks TEXT,
    -- Two distinct actors, because recording findings and authorising their release are two
    -- distinct clinical events — that is exactly what the 'Waiting for Release' state exists
    -- for. A single column could only ever name one of them, and named the wrong one whenever
    -- they differed. See migrations.md [1.12.0].
    recorded_by INT,                                  -- who wrote the findings
    released_by INT NOT NULL,                         -- who authorised release to the patient
    released_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  -- when the findings were recorded
    authorised_at TIMESTAMP,                          -- when the release was authorised

    -- Amendment chain. A released report may be corrected, and the version it replaces must stay
    -- readable: the patient may already have acted on it, and a referring physician certainly
    -- may have. superseded_by points forward, version counts backward.
    version INT NOT NULL DEFAULT 1,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    superseded_by INT,
    amendment_reason TEXT,

    -- Critical (panic) values. The flag routes an urgent callback notification on release; the
    -- acknowledgement is the record that a human actually made contact, which is the part with
    -- medico-legal weight.
    is_critical BOOLEAN NOT NULL DEFAULT FALSE,
    critical_acknowledged_at TIMESTAMP,
    critical_acknowledged_by INT,
    critical_acknowledgement_note TEXT,

    CONSTRAINT fk_results_superseded_by FOREIGN KEY (superseded_by) REFERENCES test_results(id),
    CONSTRAINT fk_results_critical_ack_by FOREIGN KEY (critical_acknowledged_by) REFERENCES users(id),
    CONSTRAINT fk_results_visit_test FOREIGN KEY (visit_test_id) REFERENCES visit_tests(id),
    CONSTRAINT fk_results_released_by FOREIGN KEY (released_by) REFERENCES users(id),
    CONSTRAINT fk_results_recorded_by FOREIGN KEY (recorded_by) REFERENCES users(id)
);

-- 7. Billing and Payments
CREATE TABLE payments (
    id SERIAL PRIMARY KEY,
    patient_visit_id INT NOT NULL,
    processed_by INT NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    reference_number VARCHAR(100),
    receipt_number VARCHAR(100), -- Explicitly added for cashier tracking
    amount NUMERIC(10,2) NOT NULL,
    payment_status VARCHAR(50) DEFAULT 'Paid',
    refund_reason TEXT,
    paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- Online payment gateway linkage (GCash / Maya via PayMongo hosted checkout). NULL for
    -- payments recorded at the counter by a cashier. A gateway payment is inserted as
    -- 'Pending' when checkout starts and only flips to 'Paid' when the signed
    -- 'checkout_session.payment.paid' webhook arrives — never from the browser redirect,
    -- which is attacker-controllable.
    gateway_provider VARCHAR(30),
    gateway_session_id VARCHAR(120),
    gateway_payment_id VARCHAR(120),
    -- Snapshot of the discount actually deducted. Deliberately NOT a reference to
    -- discount_types: a receipt is a historical record and must keep saying what it said even if
    -- the catalogue is renamed or re-rated. Same reasoning as visit_tests.price_at_time. This is
    -- also what the BIR statutory register reads.
    discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    discount_type_name VARCHAR(50),
    discount_id_number VARCHAR(50),
    CONSTRAINT chk_payments_discount_nonneg CHECK (discount_amount >= 0),
    CONSTRAINT fk_payments_visit FOREIGN KEY (patient_visit_id) REFERENCES patient_visits(id),
    CONSTRAINT fk_payments_processed_by FOREIGN KEY (processed_by) REFERENCES users(id),
    CONSTRAINT chk_payment_method CHECK (payment_method IN ('Cash', 'GCash', 'PayMaya', 'Bank')),
    CONSTRAINT chk_payment_status CHECK (payment_status IN ('Pending', 'Paid', 'Failed', 'Refunded', 'Cancelled')),
    CONSTRAINT chk_payment_amount CHECK (amount >= 0),
    CONSTRAINT uq_payments_gateway_session UNIQUE (gateway_session_id)
);

-- Webhook lookups resolve a checkout session back to its pending payment row.
CREATE INDEX idx_payments_gateway_session ON payments(gateway_session_id);

-- 8. Clinic Availability
CREATE TABLE clinic_operating_hours (
    id SERIAL PRIMARY KEY,
    day_of_week SMALLINT NOT NULL UNIQUE, -- 0=Sunday .. 6=Saturday
    is_open BOOLEAN NOT NULL DEFAULT TRUE,
    open_time TIME,
    close_time TIME,
    slot_interval_minutes SMALLINT NOT NULL DEFAULT 30,
    max_concurrent_bookings SMALLINT NOT NULL DEFAULT 1,
    CONSTRAINT chk_operating_hours_day CHECK (day_of_week BETWEEN 0 AND 6),
    CONSTRAINT chk_operating_hours_times CHECK (
      is_open = FALSE OR (open_time IS NOT NULL AND close_time IS NOT NULL AND open_time < close_time)
    )
);

-- 9. Notifications (Module 18). Split into two tables rather than one flat, per-recipient
-- table: an event (title/message/type) is a fact that exists once and never changes; who has
-- read it is a separate, per-user, mutable fact. Flattening both into one row per recipient
-- (the original design) duplicated the event text N times per broadcast and offered no single
-- place to correct it. This shape avoids that duplication and matches the real entities.
CREATE TABLE notification_events (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(20) NOT NULL DEFAULT 'info',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_notification_events_type CHECK (type IN ('info', 'success', 'warning', 'critical'))
);

CREATE TABLE notification_reads (
    id SERIAL PRIMARY KEY,
    event_id INT NOT NULL,
    user_id INT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    CONSTRAINT fk_notification_reads_event FOREIGN KEY (event_id) REFERENCES notification_events(id) ON DELETE CASCADE,
    CONSTRAINT fk_notification_reads_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT uq_notification_reads_event_user UNIQUE (event_id, user_id)
);
CREATE INDEX idx_notification_reads_user ON notification_reads(user_id, is_read);

-- 10. Audit Log (Feature Gap Plan Phase D). Denormalized actor_name (rather than requiring a
-- join to users every time the log is read) since the log must remain legible even if the
-- actor's account is later deleted or renamed — it's a record of what happened, not a live
-- view of current user data. Scoped to the sensitive actions this phase's other work
-- introduced (payment status changes, staff account changes, HMO provider changes, result
-- corrections) rather than instrumenting every write in the app.
CREATE TABLE audit_log (
    id SERIAL PRIMARY KEY,
    actor_id INT REFERENCES users(id),
    actor_name VARCHAR(200) NOT NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id INT,
    description TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at DESC);

-- Seed Initial Data
INSERT INTO roles (name) VALUES
('SuperAdmin'),
('Admin'),
('Receptionist'),
('Cashier'),
('Laboratory Staff'),
('Xray Staff'),
('Ultrasound Staff'),
('Client');

INSERT INTO patient_types (name) VALUES
('HMO'),
('Private'),
('Self Pay');

INSERT INTO test_categories (name) VALUES
('Laboratory'),
('Xray'),
('Ultrasound'),
('2D Echo'),
('ECG');

INSERT INTO hmo_providers (name) VALUES
('1CoopHealth');

-- Seed Diagnostic Tests (Human Patients Only)
INSERT INTO tests (category_id, name, price) VALUES
-- Laboratory Tests
(1, 'Complete Blood Count (CBC)', 350.00),
(1, 'Urinalysis', 150.00),
(1, 'Fasting Blood Sugar (FBS)', 200.00),
(1, 'Lipid Profile', 850.00),
(1, 'HbA1c', 750.00),
-- X-Ray Tests
(2, 'Chest X-Ray (PA)', 450.00),
(2, 'Chest X-Ray (AP/Lateral)', 650.00),
(2, 'Abdominal X-Ray', 550.00),
-- Ultrasound Tests
(3, 'Pelvic Ultrasound', 1200.00),
(3, 'Abdominal Ultrasound', 1500.00),
(3, 'Thyroid Ultrasound', 1000.00),
(3, 'Breast Ultrasound', 1200.00),
-- 2D Echo Tests
(4, 'Plain 2D Echo with Doppler', 2580.00),
(4, 'Pediatric 2D Echo', 3080.00),
-- ECG Tests
(5, '12 Lead ECG', 480.00);

-- Seed Clinic Operating Hours (Mon-Fri 08:00-17:00, Sat 08:00-12:00, Sun closed, 30-min slots)
INSERT INTO clinic_operating_hours (day_of_week, is_open, open_time, close_time, slot_interval_minutes, max_concurrent_bookings) VALUES
(0, FALSE, NULL, NULL, 30, 1),
(1, TRUE, '08:00', '17:00', 30, 1),
(2, TRUE, '08:00', '17:00', 30, 1),
(3, TRUE, '08:00', '17:00', 30, 1),
(4, TRUE, '08:00', '17:00', 30, 1),
(5, TRUE, '08:00', '17:00', 30, 1),
(6, TRUE, '08:00', '12:00', 30, 1);

-- 11. Indexes on foreign keys and status columns ([1.11.0]).
--
-- PostgreSQL indexes PRIMARY KEY and UNIQUE columns automatically but NOT foreign keys. Without
-- these, every join across the visit chain and every queue filter is a sequential scan, and each
-- delete of a parent row scans the whole child table to check for references. Harmless on a small
-- database; it is the kind of thing that turns instant screens slow all at once after a year of
-- real visits. Mirrored by src/scripts/migrateIndexes.js for existing databases.
CREATE INDEX IF NOT EXISTS idx_patients_user ON patients(user_id);
CREATE INDEX IF NOT EXISTS idx_patient_visits_patient ON patient_visits(patient_id);
CREATE INDEX IF NOT EXISTS idx_visit_tests_visit ON visit_tests(patient_visit_id);
CREATE INDEX IF NOT EXISTS idx_visit_tests_test ON visit_tests(test_id);
CREATE INDEX IF NOT EXISTS idx_test_results_visit_test ON test_results(visit_test_id);
CREATE INDEX IF NOT EXISTS idx_payments_visit ON payments(patient_visit_id);
CREATE INDEX IF NOT EXISTS idx_appointments_visit ON appointments(patient_visit_id);
CREATE INDEX IF NOT EXISTS idx_hmo_request_tests_request ON hmo_request_tests(hmo_request_id);
CREATE INDEX IF NOT EXISTS idx_hmo_request_tests_visit_test ON hmo_request_tests(visit_test_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_notification_reads_event ON notification_reads(event_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_tests_category ON tests(category_id);
CREATE INDEX IF NOT EXISTS idx_patient_visits_status ON patient_visits(status);
CREATE INDEX IF NOT EXISTS idx_visit_tests_status ON visit_tests(status);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(payment_status);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled ON appointments(scheduled_date, scheduled_time);
CREATE INDEX IF NOT EXISTS idx_patient_visits_created ON patient_visits(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_results_released_by ON test_results(released_by);
CREATE INDEX IF NOT EXISTS idx_notification_events_created ON notification_events(created_at DESC);

-- =====================================================================================
-- Daily counters — see migrations.md [1.13.0]
--
-- Queue tickets and receipt numbers were previously derived from SELECT COUNT(*) + 1 and then
-- written by a separate INSERT. A read followed by an unrelated write is not a sequence: two
-- receptionists registering in the same moment issued the same ticket, and two cashiers settling
-- together issued the same official receipt number. Counting surviving rows rather than
-- issuances also meant a cancellation or a refund rewound the sequence and reissued a number
-- that had already been printed and handed to a patient.
--
-- One row per (day, counter), incremented by the database itself:
--   INSERT INTO daily_counters (counter_date, counter_name, last_number)
--   VALUES (CURRENT_DATE, 'queue', 1)
--   ON CONFLICT (counter_date, counter_name)
--   DO UPDATE SET last_number = daily_counters.last_number + 1
--   RETURNING last_number;
-- ON CONFLICT DO UPDATE takes a row lock, so concurrent callers serialise.
-- =====================================================================================
CREATE TABLE IF NOT EXISTS daily_counters (
    counter_date DATE NOT NULL,
    counter_name TEXT NOT NULL,          -- 'queue' | 'receipt'
    last_number  INT  NOT NULL DEFAULT 0,
    PRIMARY KEY (counter_date, counter_name),
    CONSTRAINT chk_daily_counters_nonneg CHECK (last_number >= 0)
);

-- Uniqueness the counters above are meant to guarantee, enforced by the database so a future
-- code path cannot quietly reintroduce a duplicate.
-- Statutory discounts mandated by RA 9994 (Senior Citizen) and RA 10754 (PWD).
INSERT INTO discount_types (name, percentage, is_statutory, requires_id)
VALUES ('Senior Citizen', 20.00, TRUE, TRUE),
       ('PWD',            20.00, TRUE, TRUE)
ON CONFLICT (name) DO NOTHING;

-- The statutory discount register BIR expects for mandated discounts.
CREATE INDEX IF NOT EXISTS idx_payments_discount_type
    ON payments (discount_type_name, paid_at) WHERE discount_type_name IS NOT NULL;

-- Exactly one CURRENT result per test. This replaces the old UNIQUE(visit_test_id), which
-- prevented any second version existing at all and so forced a correction to overwrite the
-- original in place.
CREATE UNIQUE INDEX IF NOT EXISTS uq_test_results_current_per_test
    ON test_results (visit_test_id) WHERE is_current;
CREATE INDEX IF NOT EXISTS idx_test_results_visit_test_version
    ON test_results (visit_test_id, version DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_visits_daily_queue
    ON patient_visits ((created_at::date), queue_number) WHERE queue_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_receipt_number
    ON payments (receipt_number) WHERE receipt_number IS NOT NULL;
-- Partial on 'Paid': a visit may accumulate Cancelled/Failed gateway attempts and a Refunded row
-- alongside its one live payment, but never two settled charges.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_one_paid_per_visit
    ON payments (patient_visit_id) WHERE payment_status = 'Paid';
