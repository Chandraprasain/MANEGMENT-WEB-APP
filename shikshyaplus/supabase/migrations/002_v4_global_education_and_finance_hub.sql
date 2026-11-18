-- ShikshyaPlus V4.0 + V4.1 PostgreSQL / Supabase Migration
-- Global Education OS, Intelligent Automation, CBT, Interoperability & School Finance Hub
-- Enforces strict multi-tenant school_id isolation and role-restricted RLS policies.

CREATE TABLE IF NOT EXISTS workflow_definitions (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  trigger_type TEXT NOT NULL,
  condition_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  action_type TEXT NOT NULL,
  target_role TEXT NOT NULL DEFAULT 'PARENT',
  action_template TEXT NOT NULL DEFAULT '',
  requires_human_approval BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_by_user_id TEXT NOT NULL REFERENCES global_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_executions (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  workflow_id TEXT NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL,
  idempotency_key TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL,
  result_summary TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  depth INTEGER NOT NULL DEFAULT 1,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  workflow_id TEXT REFERENCES workflow_definitions(id) ON DELETE SET NULL,
  requested_by_user_id TEXT NOT NULL REFERENCES global_users(id),
  action_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'PENDING',
  reviewed_by_user_id TEXT REFERENCES global_users(id),
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ai_governance_policies (
  school_id TEXT PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  daily_school_limit INTEGER NOT NULL DEFAULT 500,
  student_daily_limit INTEGER NOT NULL DEFAULT 25,
  require_human_review_for_actions BOOLEAN NOT NULL DEFAULT true,
  allow_gemini BOOLEAN NOT NULL DEFAULT true,
  allow_openai BOOLEAN NOT NULL DEFAULT false,
  prompt_version TEXT NOT NULL DEFAULT 'v4.0-safe-pedagogy',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS safeguarding_cases (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  reporter_user_id TEXT NOT NULL REFERENCES global_users(id),
  subject_student_id TEXT REFERENCES students(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'HIGH',
  summary TEXT NOT NULL,
  is_anonymous BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'OPEN',
  assigned_counselor_id TEXT REFERENCES global_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS school_bank_accounts (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  bank_name TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  account_holder_name TEXT NOT NULL,
  account_number_enc TEXT NOT NULL,
  account_number_masked TEXT NOT NULL,
  swift_code TEXT DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'NPR',
  purpose TEXT NOT NULL DEFAULT 'TUITION_FEES',
  verification_status TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',
  is_primary BOOLEAN NOT NULL DEFAULT false,
  settlement_active BOOLEAN NOT NULL DEFAULT false,
  verified_by_user_id TEXT REFERENCES global_users(id),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_merchants (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  merchant_code TEXT NOT NULL,
  public_key TEXT DEFAULT '',
  secret_key_enc TEXT DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'TEST',
  display_label TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  verified_status TEXT NOT NULL DEFAULT 'CONFIGURED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, provider)
);

CREATE TABLE IF NOT EXISTS payment_orders (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  invoice_id TEXT NOT NULL REFERENCES fee_invoices(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  payer_user_id TEXT NOT NULL REFERENCES global_users(id),
  provider TEXT NOT NULL,
  order_uuid TEXT UNIQUE NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NPR',
  status TEXT NOT NULL DEFAULT 'INITIATED',
  bank_reference TEXT,
  proof_attachment_url TEXT,
  payer_note TEXT,
  reviewed_by_user_id TEXT REFERENCES global_users(id),
  review_note TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_transactions (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
  invoice_id TEXT NOT NULL REFERENCES fee_invoices(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_txn_id TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  fee_deducted NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NPR',
  status TEXT NOT NULL DEFAULT 'SETTLED',
  idempotency_key TEXT UNIQUE NOT NULL,
  raw_status_note TEXT DEFAULT '',
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, code)
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  description TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES global_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES chart_of_accounts(id),
  debit NUMERIC(14,2) NOT NULL DEFAULT 0,
  credit NUMERIC(14,2) NOT NULL DEFAULT 0,
  memo TEXT DEFAULT ''
);

-- Strict Row-Level Security (RLS)
ALTER TABLE workflow_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE safeguarding_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_workflows_isolation ON workflow_definitions
  USING (EXISTS (SELECT 1 FROM school_memberships sm WHERE sm.school_id = workflow_definitions.school_id AND sm.user_id = auth.uid()::text AND sm.status = 'ACTIVE'));

CREATE POLICY restricted_safeguarding_access ON safeguarding_cases
  USING (
    reporter_user_id = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM school_memberships sm
      WHERE sm.school_id = safeguarding_cases.school_id
        AND sm.user_id = auth.uid()::text
        AND sm.status = 'ACTIVE'
        AND sm.role IN ('PRINCIPAL', 'VICE_PRINCIPAL')
    )
  );

CREATE POLICY finance_bank_accounts_isolation ON school_bank_accounts
  USING (
    EXISTS (
      SELECT 1 FROM school_memberships sm
      WHERE sm.school_id = school_bank_accounts.school_id
        AND sm.user_id = auth.uid()::text
        AND sm.status = 'ACTIVE'
        AND sm.role IN ('PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG', 'STAFF_ACCOUNTANT', 'STAFF_ADMIN')
    )
  );

CREATE POLICY finance_journals_isolation ON journal_entries
  USING (
    EXISTS (
      SELECT 1 FROM school_memberships sm
      WHERE sm.school_id = journal_entries.school_id
        AND sm.user_id = auth.uid()::text
        AND sm.status = 'ACTIVE'
        AND sm.role IN ('PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG', 'STAFF_ACCOUNTANT')
    )
  );
