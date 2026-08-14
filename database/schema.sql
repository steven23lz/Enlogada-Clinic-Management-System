-- Database Schema for Enlogada Ultrasound and Diagnostic Clinic Management System
-- Database: PostgreSQL (Local/Supabase hosted)

-- Drop existing tables to allow clean recreation
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

-- 3. Visits and Appointments
CREATE TABLE patient_visits (
    id SERIAL PRIMARY KEY,
    patient_id INT NOT NULL,
    visit_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'Pending',
    notes TEXT,
    queue_number VARCHAR(50), -- Tracks the physical queue number generated for receptionist/cashier flow
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_visits_patient FOREIGN KEY (patient_id) REFERENCES patients(id),
    CONSTRAINT fk_visits_created_by FOREIGN KEY (created_by) REFERENCES users(id),
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
    visit_test_id INT NOT NULL UNIQUE,
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
    CONSTRAINT fk_results_visit_test FOREIGN KEY (visit_test_id) REFERENCES visit_tests(id),
    CONSTRAINT fk_results_released_by FOREIGN KEY (released_by) REFERENCES users(id),
    CONSTRAINT fk_results_recorded_by FOREIGN KEY (recorded_by) REFERENCES users(id),
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
    CONSTRAINT chk_notification_events_type CHECK (type IN ('info', 'success', 'warning'))
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
