-- ShikshyaPlus Multi-Tenant PostgreSQL / Supabase Migration
-- Strictly enforces school tenant isolation via school_id and Row-Level Security (RLS)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS schools (
  id TEXT PRIMARY KEY,
  school_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  school_type TEXT NOT NULL,
  category TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'Nepal',
  province TEXT NOT NULL,
  district TEXT NOT NULL,
  municipality TEXT NOT NULL,
  ward TEXT,
  address TEXT NOT NULL,
  telephone TEXT NOT NULL,
  official_email TEXT NOT NULL,
  website TEXT,
  established_year INTEGER NOT NULL,
  registration_number TEXT NOT NULL UNIQUE,
  education_board TEXT NOT NULL,
  principal_name TEXT NOT NULL,
  principal_email TEXT NOT NULL,
  principal_phone TEXT NOT NULL,
  logo_url TEXT,
  cover_url TEXT,
  about TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','SUSPENDED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS global_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  full_name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  global_role TEXT NOT NULL DEFAULT 'USER',
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  account_status TEXT NOT NULL DEFAULT 'ACTIVE',
  strike_count INTEGER NOT NULL DEFAULT 0,
  preferred_language TEXT NOT NULL DEFAULT 'en',
  preferred_calendar TEXT NOT NULL DEFAULT 'AD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS school_memberships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  user_code TEXT NOT NULL,
  department TEXT,
  designation TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, user_code)
);

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES global_users(id) ON DELETE SET NULL,
  student_code TEXT NOT NULL,
  admission_number TEXT NOT NULL,
  full_name TEXT NOT NULL,
  class_id TEXT NOT NULL,
  roll_number INTEGER NOT NULL,
  guardian_name TEXT NOT NULL,
  guardian_phone TEXT NOT NULL,
  enrollment_status TEXT NOT NULL DEFAULT 'VERIFIED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, student_code),
  UNIQUE (school_id, admission_number)
);

CREATE TABLE IF NOT EXISTS student_guardians (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  parent_user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, parent_user_id)
);

CREATE TABLE IF NOT EXISTS social_posts (
  id TEXT PRIMARY KEY,
  school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
  author_user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  post_type TEXT NOT NULL DEFAULT 'UPDATE',
  audience TEXT NOT NULL,
  moderation_status TEXT NOT NULL DEFAULT 'APPROVED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fee_invoices (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'UNPAID',
  gateway TEXT,
  receipt_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable Row Level Security (RLS) on tenant-scoped tables
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_students_isolation ON students
  USING (
    EXISTS (
      SELECT 1 FROM school_memberships sm
      WHERE sm.school_id = students.school_id
        AND sm.user_id = auth.uid()::text
        AND sm.status = 'ACTIVE'
    )
  );

CREATE POLICY tenant_invoices_isolation ON fee_invoices
  USING (
    EXISTS (
      SELECT 1 FROM school_memberships sm
      WHERE sm.school_id = fee_invoices.school_id
        AND sm.user_id = auth.uid()::text
        AND sm.status = 'ACTIVE'
    )
  );

CREATE TABLE IF NOT EXISTS school_expenses (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  expense_date DATE NOT NULL,
  paid_to TEXT NOT NULL,
  recorded_by_user_id TEXT NOT NULL REFERENCES global_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_assets (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  condition_status TEXT NOT NULL DEFAULT 'GOOD',
  location TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS visitor_logs (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  visitor_name TEXT NOT NULL,
  visitor_phone TEXT NOT NULL,
  purpose TEXT NOT NULL,
  visiting_person TEXT NOT NULL,
  check_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  check_out_at TIMESTAMPTZ,
  recorded_by_user_id TEXT NOT NULL REFERENCES global_users(id)
);

CREATE TABLE IF NOT EXISTS student_certificates (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  certificate_type TEXT NOT NULL,
  certificate_number TEXT NOT NULL,
  remarks TEXT DEFAULT '',
  issued_by_user_id TEXT NOT NULL REFERENCES global_users(id),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, certificate_number)
);

CREATE TABLE IF NOT EXISTS user_blocks (
  id TEXT PRIMARY KEY,
  blocker_user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
  blocked_user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (blocker_user_id, blocked_user_id)
);

ALTER TABLE school_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_certificates ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_expenses_isolation ON school_expenses
  USING (EXISTS (SELECT 1 FROM school_memberships sm WHERE sm.school_id = school_expenses.school_id AND sm.user_id = auth.uid()::text AND sm.status = 'ACTIVE'));

CREATE POLICY tenant_inventory_isolation ON inventory_assets
  USING (EXISTS (SELECT 1 FROM school_memberships sm WHERE sm.school_id = inventory_assets.school_id AND sm.user_id = auth.uid()::text AND sm.status = 'ACTIVE'));

CREATE POLICY tenant_visitors_isolation ON visitor_logs
  USING (EXISTS (SELECT 1 FROM school_memberships sm WHERE sm.school_id = visitor_logs.school_id AND sm.user_id = auth.uid()::text AND sm.status = 'ACTIVE'));

CREATE POLICY tenant_certificates_isolation ON student_certificates
  USING (EXISTS (SELECT 1 FROM school_memberships sm WHERE sm.school_id = student_certificates.school_id AND sm.user_id = auth.uid()::text AND sm.status = 'ACTIVE'));

