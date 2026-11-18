import type { DatabaseSync } from 'node:sqlite';
import { encryptSensitiveField, signOpenBadgePayload } from './services/encryption';
import { ensureSchoolDefaultAccounts, postDoubleEntryJournal } from './services/paymentAdapters';

export function createV4Schema(db: DatabaseSync) {
  db.exec(`
    -- System 1: Intelligent School Automation Engine
    CREATE TABLE IF NOT EXISTS workflow_definitions (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      trigger_type TEXT NOT NULL,
      condition_json TEXT NOT NULL DEFAULT '{}',
      action_type TEXT NOT NULL,
      target_role TEXT NOT NULL DEFAULT 'PARENT',
      action_template TEXT NOT NULL DEFAULT '',
      requires_human_approval INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_by_user_id TEXT NOT NULL REFERENCES global_users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflow_executions (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      workflow_id TEXT NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
      trigger_type TEXT NOT NULL,
      idempotency_key TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL,
      result_summary TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      depth INTEGER NOT NULL DEFAULT 1,
      executed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS approval_requests (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      workflow_id TEXT REFERENCES workflow_definitions(id) ON DELETE SET NULL,
      requested_by_user_id TEXT NOT NULL REFERENCES global_users(id),
      action_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'PENDING',
      reviewed_by_user_id TEXT REFERENCES global_users(id),
      review_note TEXT,
      created_at TEXT NOT NULL,
      reviewed_at TEXT
    );

    -- System 2 & 21: Role-Specific AI Agents & Governance
    CREATE TABLE IF NOT EXISTS ai_governance_policies (
      school_id TEXT PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
      daily_school_limit INTEGER NOT NULL DEFAULT 500,
      student_daily_limit INTEGER NOT NULL DEFAULT 25,
      require_human_review_for_actions INTEGER NOT NULL DEFAULT 1,
      allow_gemini INTEGER NOT NULL DEFAULT 1,
      allow_openai INTEGER NOT NULL DEFAULT 0,
      prompt_version TEXT NOT NULL DEFAULT 'v4.0-safe-pedagogy',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_agent_runs (
      id TEXT PRIMARY KEY,
      school_id TEXT REFERENCES schools(id) ON DELETE SET NULL,
      user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
      agent_type TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      provider TEXT NOT NULL,
      prompt_excerpt TEXT NOT NULL,
      response_summary TEXT NOT NULL,
      proposed_action TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- System 3: Curriculum & Competency Management
    CREATE TABLE IF NOT EXISTS curriculum_frameworks (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      board TEXT NOT NULL,
      grade_level TEXT NOT NULL,
      subject_name TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '1.0',
      status TEXT NOT NULL DEFAULT 'PUBLISHED',
      created_by_user_id TEXT NOT NULL REFERENCES global_users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS learning_objectives (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      framework_id TEXT NOT NULL REFERENCES curriculum_frameworks(id) ON DELETE CASCADE,
      unit_title TEXT NOT NULL,
      objective_code TEXT NOT NULL,
      description TEXT NOT NULL,
      competency_tag TEXT NOT NULL DEFAULT 'CORE'
    );

    CREATE TABLE IF NOT EXISTS competency_progress (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      objective_id TEXT NOT NULL REFERENCES learning_objectives(id) ON DELETE CASCADE,
      mastery_level TEXT NOT NULL DEFAULT 'DEVELOPING',
      assessed_by_user_id TEXT NOT NULL REFERENCES global_users(id),
      evidence_note TEXT DEFAULT '',
      updated_at TEXT NOT NULL,
      UNIQUE(student_id, objective_id)
    );

    CREATE TABLE IF NOT EXISTS individual_learning_plans (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      goal_title TEXT NOT NULL,
      accommodations TEXT NOT NULL,
      target_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_by_user_id TEXT NOT NULL REFERENCES global_users(id),
      created_at TEXT NOT NULL
    );

    -- System 4: Question Bank, Papers & CBT Online Assessments
    CREATE TABLE IF NOT EXISTS question_items (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      subject_name TEXT NOT NULL,
      grade_level TEXT NOT NULL,
      question_type TEXT NOT NULL DEFAULT 'MCQ',
      difficulty TEXT NOT NULL DEFAULT 'MEDIUM',
      prompt TEXT NOT NULL,
      options_json TEXT NOT NULL DEFAULT '[]',
      correct_answer TEXT NOT NULL,
      explanation TEXT DEFAULT '',
      marks REAL NOT NULL DEFAULT 1,
      created_by_user_id TEXT NOT NULL REFERENCES global_users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assessments (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      subject_name TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 30,
      max_attempts INTEGER NOT NULL DEFAULT 2,
      question_ids_json TEXT NOT NULL DEFAULT '[]',
      total_marks REAL NOT NULL DEFAULT 10,
      status TEXT NOT NULL DEFAULT 'PUBLISHED',
      created_by_user_id TEXT NOT NULL REFERENCES global_users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assessment_attempts (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      answers_json TEXT NOT NULL DEFAULT '{}',
      objective_score REAL NOT NULL DEFAULT 0,
      max_score REAL NOT NULL DEFAULT 10,
      status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
      started_at TEXT NOT NULL,
      submitted_at TEXT
    );

    -- System 5 & 15: Digital Marketplace & International School Exchange
    CREATE TABLE IF NOT EXISTS learning_resources (
      id TEXT PRIMARY KEY,
      school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      subject_name TEXT NOT NULL,
      grade_level TEXT NOT NULL,
      author_name TEXT NOT NULL,
      price_npr REAL NOT NULL DEFAULT 0,
      rating REAL NOT NULL DEFAULT 4.8,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'APPROVED',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS school_partnerships (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      partner_school_name TEXT NOT NULL,
      partner_country TEXT NOT NULL,
      program_type TEXT NOT NULL,
      focus_area TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS competitions (
      id TEXT PRIMARY KEY,
      school_id TEXT REFERENCES schools(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      deadline TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'GLOBAL',
      description TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- System 6: Confidential Student Safeguarding & Wellbeing (Strictly Restricted)
    CREATE TABLE IF NOT EXISTS safeguarding_cases (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      reporter_user_id TEXT NOT NULL REFERENCES global_users(id),
      subject_student_id TEXT REFERENCES students(id) ON DELETE SET NULL,
      category TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'HIGH',
      summary TEXT NOT NULL,
      is_anonymous INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'OPEN',
      assigned_counselor_id TEXT REFERENCES global_users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS safeguarding_case_actions (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES safeguarding_cases(id) ON DELETE CASCADE,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      actor_user_id TEXT NOT NULL REFERENCES global_users(id),
      action_note TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wellbeing_appointments (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      requester_user_id TEXT NOT NULL REFERENCES global_users(id),
      preferred_date TEXT NOT NULL,
      topic TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'REQUESTED',
      created_at TEXT NOT NULL
    );

    -- System 7 & 24: Verifiable Open Badges 3.0
    CREATE TABLE IF NOT EXISTS open_badges (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      badge_name TEXT NOT NULL,
      criteria TEXT NOT NULL,
      credential_json TEXT NOT NULL,
      signature_hex TEXT NOT NULL,
      verification_code TEXT UNIQUE NOT NULL,
      issued_by_user_id TEXT NOT NULL REFERENCES global_users(id),
      issued_at TEXT NOT NULL
    );

    -- System 12: Family Engagement, Consents & Authorized Pickups
    CREATE TABLE IF NOT EXISTS consent_records (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      parent_user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
      consent_type TEXT NOT NULL,
      granted INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      UNIQUE(student_id, consent_type)
    );

    CREATE TABLE IF NOT EXISTS authorized_pickups (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      parent_user_id TEXT NOT NULL REFERENCES global_users(id),
      person_name TEXT NOT NULL,
      relationship TEXT NOT NULL,
      phone TEXT NOT NULL,
      id_last4 TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL
    );

    -- V4.1 School Finance & Digital Payment Hub
    CREATE TABLE IF NOT EXISTS school_bank_accounts (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      bank_name TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      account_holder_name TEXT NOT NULL,
      account_number_enc TEXT NOT NULL,
      account_number_masked TEXT NOT NULL,
      swift_code TEXT DEFAULT '',
      iban TEXT DEFAULT '',
      routing_code TEXT DEFAULT '',
      currency TEXT NOT NULL DEFAULT 'NPR',
      purpose TEXT NOT NULL DEFAULT 'TUITION_FEES',
      verification_status TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',
      is_primary INTEGER NOT NULL DEFAULT 0,
      settlement_active INTEGER NOT NULL DEFAULT 0,
      verified_by_user_id TEXT REFERENCES global_users(id),
      verified_at TEXT,
      created_at TEXT NOT NULL
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
      is_active INTEGER NOT NULL DEFAULT 1,
      verified_status TEXT NOT NULL DEFAULT 'CONFIGURED',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(school_id, provider)
    );

    CREATE TABLE IF NOT EXISTS fee_structures (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      class_id TEXT REFERENCES classes(id) ON DELETE SET NULL,
      fee_type TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'NPR',
      billing_cycle TEXT NOT NULL DEFAULT 'MONTHLY',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payment_orders (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      invoice_id TEXT NOT NULL REFERENCES fee_invoices(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      payer_user_id TEXT NOT NULL REFERENCES global_users(id),
      provider TEXT NOT NULL,
      order_uuid TEXT UNIQUE NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'NPR',
      status TEXT NOT NULL DEFAULT 'INITIATED',
      bank_reference TEXT,
      proof_attachment_url TEXT,
      payer_note TEXT,
      reviewed_by_user_id TEXT REFERENCES global_users(id),
      review_note TEXT,
      idempotency_key TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payment_transactions (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      order_id TEXT NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
      invoice_id TEXT NOT NULL REFERENCES fee_invoices(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_txn_id TEXT NOT NULL,
      amount REAL NOT NULL,
      fee_deducted REAL NOT NULL DEFAULT 0,
      net_amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'NPR',
      status TEXT NOT NULL DEFAULT 'SETTLED',
      idempotency_key TEXT UNIQUE NOT NULL,
      raw_status_note TEXT DEFAULT '',
      verified_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payment_refunds (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      transaction_id TEXT NOT NULL REFERENCES payment_transactions(id) ON DELETE CASCADE,
      invoice_id TEXT NOT NULL REFERENCES fee_invoices(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'COMPLETED',
      initiated_by_user_id TEXT NOT NULL REFERENCES global_users(id),
      approved_by_user_id TEXT REFERENCES global_users(id),
      created_at TEXT NOT NULL,
      processed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS provider_settlements (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      settlement_ref TEXT NOT NULL,
      gross_amount REAL NOT NULL,
      gateway_fee REAL NOT NULL DEFAULT 0,
      net_settled REAL NOT NULL,
      bank_account_id TEXT REFERENCES school_bank_accounts(id),
      settlement_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'RECONCILED',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chart_of_accounts (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      account_type TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE(school_id, code)
    );

    CREATE TABLE IF NOT EXISTS journal_entries (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      entry_date TEXT NOT NULL,
      reference_type TEXT NOT NULL,
      reference_id TEXT NOT NULL,
      description TEXT NOT NULL,
      created_by_user_id TEXT NOT NULL REFERENCES global_users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS journal_entry_lines (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES chart_of_accounts(id),
      debit REAL NOT NULL DEFAULT 0,
      credit REAL NOT NULL DEFAULT 0,
      memo TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS vendors (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      contact_phone TEXT NOT NULL,
      pan_vat_number TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchase_orders (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      vendor_id TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'APPROVED',
      created_by_user_id TEXT NOT NULL REFERENCES global_users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS platform_subscription_plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      target_audience TEXT NOT NULL,
      monthly_npr REAL NOT NULL,
      student_limit INTEGER NOT NULL,
      features_summary TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS school_subscriptions (
      id TEXT PRIMARY KEY,
      school_id TEXT UNIQUE NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      plan_id TEXT NOT NULL REFERENCES platform_subscription_plans(id),
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      renews_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- HR, Facilities, Developer API & Security Ops
    CREATE TABLE IF NOT EXISTS teacher_leave_requests (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      teacher_user_id TEXT NOT NULL REFERENCES global_users(id),
      leave_date TEXT NOT NULL,
      reason TEXT NOT NULL,
      substitute_user_id TEXT REFERENCES global_users(id),
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS facilities (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      facility_type TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 30,
      status TEXT NOT NULL DEFAULT 'AVAILABLE'
    );

    CREATE TABLE IF NOT EXISTS facility_bookings (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      facility_id TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
      booked_by_user_id TEXT NOT NULL REFERENCES global_users(id),
      booking_date TEXT NOT NULL,
      time_slot TEXT NOT NULL,
      purpose TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'CONFIRMED',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_clients (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      scopes TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_by_user_id TEXT NOT NULL REFERENCES global_users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webhook_subscriptions (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      target_url TEXT NOT NULL,
      events_csv TEXT NOT NULL,
      signing_secret_enc TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS security_incidents (
      id TEXT PRIMARY KEY,
      school_id TEXT REFERENCES schools(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      summary TEXT NOT NULL,
      reported_by_user_id TEXT NOT NULL REFERENCES global_users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backup_records (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL DEFAULT 'PLATFORM',
      backup_label TEXT NOT NULL,
      checksum_sha256 TEXT NOT NULL,
      verified_restore INTEGER NOT NULL DEFAULT 1,
      created_by_user_id TEXT NOT NULL REFERENCES global_users(id),
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_workflows_school ON workflow_definitions(school_id, trigger_type);
    CREATE INDEX IF NOT EXISTS idx_safeguarding_school ON safeguarding_cases(school_id, status);
    CREATE INDEX IF NOT EXISTS idx_bank_accounts_school ON school_bank_accounts(school_id);
    CREATE INDEX IF NOT EXISTS idx_payment_orders_school ON payment_orders(school_id, invoice_id);
    CREATE INDEX IF NOT EXISTS idx_payment_txn_school ON payment_transactions(school_id, invoice_id);
    CREATE INDEX IF NOT EXISTS idx_journal_school ON journal_entries(school_id, entry_date);
  `);
}

export function ensureV4Seeds(db: DatabaseSync) {
  const sunrise = 'sch-sunrise-2026';
  const everest = 'sch-everest-2026';
  const hasSchool = db.prepare(`SELECT id FROM schools WHERE id = ?`).get(sunrise);
  if (!hasSchool) return;

  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  // Platform Subscription Plans
  if ((db.prepare(`SELECT COUNT(*) as c FROM platform_subscription_plans`).get() as { c: number }).c === 0) {
    db.prepare(
      `INSERT INTO platform_subscription_plans (id, name, target_audience, monthly_npr, student_limit, features_summary)
       VALUES
       ('plan-starter', 'Starter School', 'Community & emerging schools', 0, 250, 'Core SIS, Attendance, Homework, Parent Messaging'),
       ('plan-growth', 'Growth Campus', 'Full K-12 institutions', 12000, 2000, 'Full Finance Hub, Workflows, CBT Exams, Open Badges, AI Governance'),
       ('plan-enterprise', 'Global Network', 'Multi-campus groups', 35000, 10000, 'OneRoster/QTI API, Custom Webhooks, Dedicated SOC & Backup Verification')`
    ).run();

    const renew = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    db.prepare(`INSERT INTO school_subscriptions (id, school_id, plan_id, status, renews_at, updated_at) VALUES ('sub-sun', ?, 'plan-growth', 'ACTIVE', ?, ?)`).run(sunrise, renew, now);
    db.prepare(`INSERT INTO school_subscriptions (id, school_id, plan_id, status, renews_at, updated_at) VALUES ('sub-ev', ?, 'plan-starter', 'ACTIVE', ?, ?)`).run(everest, renew, now);
  }

  // Workflows
  if ((db.prepare(`SELECT COUNT(*) as c FROM workflow_definitions`).get() as { c: number }).c === 0) {
    db.prepare(
      `INSERT INTO workflow_definitions (id, school_id, name, description, trigger_type, condition_json, action_type, target_role, action_template, requires_human_approval, status, created_by_user_id, created_at, updated_at)
       VALUES
       ('wf-1', ?, 'Guardian Attendance Absence Alert', 'Automatically notify verified parents when a student is marked absent.', 'ATTENDANCE_ABSENT', '{"status":"ABSENT"}', 'SEND_NOTIFICATION', 'PARENT', 'Attendance notice: please check your child attendance record for today.', 0, 'ACTIVE', 'usr-sun-pri', ?, ?),
       ('wf-2', ?, 'Exam Publication Principal Gate', 'Requires explicit human approval before dispatching broadcast exam summary.', 'EXAM_PUBLISHED', '{}', 'PUBLISH_OFFICIAL_GRADES', 'PARENT', 'Terminal examination results approved and ready.', 1, 'ACTIVE', 'usr-sun-pri', ?, ?)`
    ).run(sunrise, now, now, sunrise, now, now);
  }

  // AI Governance Policies
  if ((db.prepare(`SELECT COUNT(*) as c FROM ai_governance_policies`).get() as { c: number }).c === 0) {
    db.prepare(
      `INSERT INTO ai_governance_policies (school_id, daily_school_limit, student_daily_limit, require_human_review_for_actions, allow_gemini, allow_openai, prompt_version, updated_at)
       VALUES (?, 500, 25, 1, 1, 0, 'v4.0-safe-pedagogy', ?)`
    ).run(sunrise, now);
  }

  // Curriculum & Competency
  if ((db.prepare(`SELECT COUNT(*) as c FROM curriculum_frameworks`).get() as { c: number }).c === 0) {
    db.prepare(
      `INSERT INTO curriculum_frameworks (id, school_id, name, board, grade_level, subject_name, version, status, created_by_user_id, created_at)
       VALUES ('cur-1', ?, 'NEB Grade 10 Mathematics Competency Map', 'NEB Nepal', 'Class 10', 'Compulsory Mathematics', '2083.1', 'PUBLISHED', 'usr-sun-tch', ?)`
    ).run(sunrise, now);
    db.prepare(
      `INSERT INTO learning_objectives (id, school_id, framework_id, unit_title, objective_code, description, competency_tag)
       VALUES
       ('obj-1', ?, 'cur-1', 'Algebra & Quadratics', 'MTH-10.1', 'Solve quadratic equations by factorization, completing the square, and discriminant analysis.', 'PROBLEM_SOLVING'),
       ('obj-2', ?, 'cur-1', 'Geometry & Trigonometry', 'MTH-10.2', 'Apply heights and distances trigonometric ratios to surveying scenarios.', 'APPLIED_MATH')`
    ).run(sunrise, sunrise);
    db.prepare(
      `INSERT INTO competency_progress (id, school_id, student_id, objective_id, mastery_level, assessed_by_user_id, evidence_note, updated_at)
       VALUES ('cmp-1', ?, 'stu-sun-1', 'obj-1', 'MASTERED', 'usr-sun-tch', 'Scored 100% on Quadratic Lab & First Terminal Q4.', ?)`
    ).run(sunrise, now);
  }

  // Question Bank & CBT Assessments
  if ((db.prepare(`SELECT COUNT(*) as c FROM question_items`).get() as { c: number }).c === 0) {
    db.prepare(
      `INSERT INTO question_items (id, school_id, subject_name, grade_level, question_type, difficulty, prompt, options_json, correct_answer, explanation, marks, created_by_user_id, created_at)
       VALUES
       ('qst-1', ?, 'Compulsory Mathematics', 'Class 10', 'MCQ', 'MEDIUM', 'What is the discriminant of x^2 - 6x + 9 = 0?', '["0","12","-12","36"]', '0', 'b^2 - 4ac = (-6)^2 - 4(1)(9) = 36 - 36 = 0.', 2, 'usr-sun-tch', ?),
       ('qst-2', ?, 'Science & Technology', 'Class 10', 'MCQ', 'EASY', 'Which SI unit measures electrical resistance?', '["Ohm","Volt","Ampere","Watt"]', 'Ohm', 'Resistance R = V/I is measured in Ohms.', 2, 'usr-sun-tch', ?),
       ('qst-3', ?, 'Compulsory Mathematics', 'Class 10', 'TRUE_FALSE', 'EASY', 'If discriminant D > 0, a quadratic equation has two distinct real roots.', '["True","False"]', 'True', 'Positive discriminant produces two distinct real roots.', 2, 'usr-sun-tch', ?)`
    ).run(sunrise, now, sunrise, now, sunrise, now);

    db.prepare(
      `INSERT INTO assessments (id, school_id, class_id, title, subject_name, duration_minutes, max_attempts, question_ids_json, total_marks, status, created_by_user_id, created_at)
       VALUES ('asmt-1', ?, 'cls-sun-10a', 'Mid-Term Algebra & Physics Readiness Check', 'Compulsory Mathematics', 15, 3, '["qst-1","qst-2","qst-3"]', 6, 'PUBLISHED', 'usr-sun-tch', ?)`
    ).run(sunrise, now);
  }

  // Open Badges 3.0
  if ((db.prepare(`SELECT COUNT(*) as c FROM open_badges`).get() as { c: number }).c === 0) {
    const signed = signOpenBadgePayload({
      studentCode: 'STU-001',
      studentName: 'Aarav Sharma',
      schoolCode: 'SUNRISE-2026',
      achievement: 'Quadratic Problem Solving & Solar Robotics Pioneer',
    });
    db.prepare(
      `INSERT INTO open_badges (id, school_id, student_id, badge_name, criteria, credential_json, signature_hex, verification_code, issued_by_user_id, issued_at)
       VALUES ('bdg-1', ?, 'stu-sun-1', 'STEM Robotics & Mathematics Mastery', 'Mastered Class 10 Quadratics & built Solar Tracker prototype', ?, ?, ?, 'usr-sun-pri', ?)`
    ).run(sunrise, signed.credentialJson, signed.signatureHex, signed.verificationHash, now);
  }

  // Marketplace & Global Collaboration
  if ((db.prepare(`SELECT COUNT(*) as c FROM learning_resources`).get() as { c: number }).c === 0) {
    db.prepare(
      `INSERT INTO learning_resources (id, school_id, title, resource_type, subject_name, grade_level, author_name, price_npr, rating, description, status, created_at)
       VALUES
       ('res-1', ?, 'SEE Mathematics Formula & Proof Handbook', 'WORKBOOK', 'Compulsory Mathematics', 'Class 10', 'Anjali Shrestha', 0, 4.9, 'Open licensed faculty revision booklet aligned with NEB Grade 10 units.', 'APPROVED', ?),
       ('res-2', ?, 'Himalayan Climate & Renewable Energy Lab Kit Guide', 'COURSE_GUIDE', 'Science & Technology', 'Class 9-10', 'Everest Science Dept', 350, 4.8, 'Project-based solar microgrid curriculum modules for Nepali classrooms.', 'APPROVED', ?)`
    ).run(sunrise, now, everest, now);

    db.prepare(
      `INSERT INTO school_partnerships (id, school_id, partner_school_name, partner_country, program_type, focus_area, status, created_at)
       VALUES ('prt-1', ?, 'Kyoto Frontier High School', 'Japan', 'STEM_EXCHANGE', 'Solar Microgrid & Seismic Engineering Collaboration', 'ACTIVE', ?)`
    ).run(sunrise, now);

    db.prepare(
      `INSERT INTO competitions (id, school_id, title, category, deadline, scope, description, created_at)
       VALUES ('cmpg-1', ?, 'South Asia Youth Climate & Clean Tech Challenge 2026', 'STEM & Sustainability', '2026-12-20', 'GLOBAL', 'Student teams submit working clean-energy prototypes and open datasets.', ?)`
    ).run(sunrise, now);
  }

  // Safeguarding Case & Consents
  if ((db.prepare(`SELECT COUNT(*) as c FROM safeguarding_cases`).get() as { c: number }).c === 0) {
    db.prepare(
      `INSERT INTO safeguarding_cases (id, school_id, reporter_user_id, subject_student_id, category, severity, summary, is_anonymous, status, assigned_counselor_id, created_at, updated_at)
       VALUES ('sg-1', ?, 'usr-sun-par1', 'stu-sun-1', 'TRANSPORT_SAFETY', 'MEDIUM', 'Parent requested lighting check near evening Ring Road drop-off point.', 0, 'UNDER_REVIEW', 'usr-sun-pri', ?, ?)`
    ).run(sunrise, now, now);
  }

  if ((db.prepare(`SELECT COUNT(*) as c FROM consent_records`).get() as { c: number }).c === 0) {
    db.prepare(
      `INSERT INTO consent_records (id, school_id, student_id, parent_user_id, consent_type, granted, updated_at)
       VALUES
       ('cns-1', ?, 'stu-sun-1', 'usr-sun-par1', 'DIGITAL_LEARNING_AI', 1, ?),
       ('cns-2', ?, 'stu-sun-1', 'usr-sun-par1', 'PHOTO_VIDEO_MEDIA', 1, ?),
       ('cns-3', ?, 'stu-sun-1', 'usr-sun-par1', 'FIELD_TRIP_PARTICIPATION', 0, ?)`
    ).run(sunrise, now, sunrise, now, sunrise, now);

    db.prepare(
      `INSERT INTO authorized_pickups (id, school_id, student_id, parent_user_id, person_name, relationship, phone, id_last4, status, created_at)
       VALUES ('pkp-1', ?, 'stu-sun-1', 'usr-sun-par1', 'Bishnu Sharma', 'Father', '+9779841555124', '8812', 'ACTIVE', ?)`
    ).run(sunrise, now);
  }

  // V4.1 Finance Hub Seeds (Bank Accounts, Merchants, Chart of Accounts, Settlements)
  ensureSchoolDefaultAccounts(db, sunrise);
  ensureSchoolDefaultAccounts(db, everest);

  if ((db.prepare(`SELECT COUNT(*) as c FROM school_bank_accounts`).get() as { c: number }).c === 0) {
    db.prepare(
      `INSERT INTO school_bank_accounts (id, school_id, bank_name, branch_name, account_holder_name, account_number_enc, account_number_masked, swift_code, currency, purpose, verification_status, is_primary, settlement_active, verified_by_user_id, verified_at, created_at)
       VALUES
       ('bnk-sun-1', ?, 'Nabil Bank Limited', 'New Baneshwor Branch, Kathmandu', 'Sunrise English School Fee Collection A/C', ?, '••••••4821', 'NARBNPKA', 'NPR', 'TUITION_FEES', 'VERIFIED', 1, 1, 'usr-sun-pri', ?, ?),
       ('bnk-ev-1', ?, 'Global IME Bank', 'Lakeside Pokhara Branch', 'Everest Secondary School Official A/C', ?, '••••••7790', 'GLBBNPKA', 'NPR', 'TUITION_FEES', 'VERIFIED', 1, 1, 'usr-ev-pri', ?, ?)`
    ).run(
      sunrise,
      encryptSensitiveField('01401017504821'),
      now,
      now,
      everest,
      encryptSensitiveField('22010100007790'),
      now,
      now
    );
  }

  if ((db.prepare(`SELECT COUNT(*) as c FROM payment_merchants`).get() as { c: number }).c === 0) {
    db.prepare(
      `INSERT INTO payment_merchants (id, school_id, provider, merchant_code, public_key, secret_key_enc, mode, display_label, is_active, verified_status, created_at, updated_at)
       VALUES
       ('mrc-sun-esewa', ?, 'ESEWA', 'EPAYTEST', 'EPAYTEST', ?, 'TEST', 'Sunrise eSewa Sandbox Pay', 1, 'CONFIGURED', ?, ?),
       ('mrc-sun-khalti', ?, 'KHALTI', 'SUNRISE-KHL-TEST', 'test_public_key_sunrise', ?, 'TEST', 'Sunrise Khalti Test Gateway', 1, 'CONFIGURED', ?, ?)`
    ).run(
      sunrise,
      encryptSensitiveField('8gBm/:&EnhH.1/q'),
      now,
      now,
      sunrise,
      encryptSensitiveField('test_secret_key_sunrise_v4'),
      now,
      now
    );
  }

  if ((db.prepare(`SELECT COUNT(*) as c FROM journal_entries`).get() as { c: number }).c === 0) {
    postDoubleEntryJournal(db, {
      schoolId: sunrise,
      entryDate: today,
      referenceType: 'INVOICE_PAYMENT',
      referenceId: 'inv-sun-2',
      description: 'First Terminal Examination Fee settlement via eSewa (RCP-SUN-2026-019)',
      actorUserId: 'usr-sun-acc',
      lines: [
        { accountId: `coa-${sunrise}-1010`, debit: 1500, credit: 0, memo: 'Cash/eSewa receipt inv-sun-2' },
        { accountId: `coa-${sunrise}-4020`, debit: 0, credit: 1500, memo: 'Exam Fee Revenue' },
      ],
    });
  }

  if ((db.prepare(`SELECT COUNT(*) as c FROM facilities`).get() as { c: number }).c === 0) {
    db.prepare(
      `INSERT INTO facilities (id, school_id, name, facility_type, capacity, status)
       VALUES
       ('fac-1', ?, 'Himalayan Robotics & Physics Lab', 'LABORATORY', 36, 'AVAILABLE'),
       ('fac-2', ?, 'Main Seminar Auditorium', 'AUDITORIUM', 280, 'AVAILABLE')`
    ).run(sunrise, sunrise);
  }

  if ((db.prepare(`SELECT COUNT(*) as c FROM backup_records`).get() as { c: number }).c === 0) {
    db.prepare(
      `INSERT INTO backup_records (id, scope, backup_label, checksum_sha256, verified_restore, created_by_user_id, created_at)
       VALUES ('bkp-1', 'PLATFORM', 'Nightly Snapshot 2026-11-18 UTC', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 1, 'usr-superadmin', ?)`
    ).run(now);
  }
}
