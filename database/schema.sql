-- Database Schema for Enlogada Ultrasound and Diagnostic Clinic Management System
-- Database: PostgreSQL (Local/Supabase hosted)

-- Drop existing tables to allow clean recreation
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
    CONSTRAINT chk_visit_tests_status CHECK (status IN ('Pending', 'Approved', 'Processing', 'Completed', 'Cancelled')),
    CONSTRAINT chk_visit_tests_price CHECK (price_at_time >= 0),
    CONSTRAINT uq_visit_tests_visit_test UNIQUE (patient_visit_id, test_id)
);

-- 5. HMO Integrations (Manual Record Keeping)
CREATE TABLE hmo_providers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE
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
    findings TEXT,
    remarks TEXT,
    released_by INT NOT NULL,
    released_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_results_visit_test FOREIGN KEY (visit_test_id) REFERENCES visit_tests(id),
    CONSTRAINT fk_results_released_by FOREIGN KEY (released_by) REFERENCES users(id)
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
    paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_payments_visit FOREIGN KEY (patient_visit_id) REFERENCES patient_visits(id),
    CONSTRAINT fk_payments_processed_by FOREIGN KEY (processed_by) REFERENCES users(id),
    CONSTRAINT chk_payment_method CHECK (payment_method IN ('Cash', 'GCash', 'PayMaya', 'Bank')),
    CONSTRAINT chk_payment_status CHECK (payment_status IN ('Pending', 'Paid', 'Failed', 'Refunded', 'Cancelled')),
    CONSTRAINT chk_payment_amount CHECK (amount >= 0)
);

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
