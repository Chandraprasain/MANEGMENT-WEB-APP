# Database Schema & Multi-Tenancy

- **Primary Local Engine**: `node:sqlite` (`data/shikshyaplus.sqlite`) with foreign keys enabled (`PRAGMA foreign_keys = ON`).
- **Core Identity & Tenant Tables**: `schools`, `global_users`, `school_memberships`, `user_sessions`, `password_reset_tokens`.
- **Academic & ERP Tables**: `classes`, `students`, `student_guardians`, `parent_invitations`, `homework`, `homework_submissions`, `attendance_records`, `examinations`, `exam_marks`, `daily_diary`, `timetable_slots`, `school_notices`, `school_events`, `fee_invoices`, `library_books`, `book_issues`, `transport_routes`, `admissions`, `support_tickets`, `school_contacts`, `audit_logs`.
- **Social & Safety Tables**: `social_posts`, `post_reactions`, `post_comments`, `post_saves`, `school_follows`, `social_connections`, `global_groups`, `group_members`, `conversations`, `conversation_members`, `messages`, `notifications`, `moderation_cases`, `moderation_strikes`, `moderation_appeals`, `uploaded_files`, `ai_requests`.
- **V4.0 Automation, AI, Curriculum & Trust Tables** (`server/dbV4Migrations.ts`):
  - Automation & AI: `workflow_definitions`, `workflow_executions`, `approval_requests`, `ai_governance_policies`, `ai_agent_runs`.
  - Curriculum & Assessments: `curriculum_frameworks`, `learning_objectives`, `question_bank`, `assessments`, `assessment_attempts`, `individual_learning_plans`.
  - Open Badges & Global Exchange: `open_badges_issued`, `marketplace_items`, `marketplace_orders`, `school_partnerships`, `global_competitions`.
  - Safeguarding, Wellbeing & Consents: `safeguarding_reports`, `counseling_appointments`, `consent_records`, `authorized_pickups`.
  - Facilities, HR & Developer Ops: `staff_leave_requests`, `facility_bookings`, `api_keys_meta`, `webhook_endpoints`, `backup_verification_logs`.
- **V4.1 Finance Hub & Payment Tables**:
  - Banking & Gateways: `school_bank_accounts` (AES-256-GCM encrypted account numbers + masked display), `payment_gateway_configs` (sandbox/production keys encrypted).
  - Checkout & Settlement: `payment_transactions` (server-side signature/reference verification + webhook idempotency), `payment_refunds`.
  - Double-Entry General Ledger: `chart_of_accounts`, `ledger_journals`, `ledger_entries` (enforcing `SUM(debit) == SUM(credit)`).
  - Procurement & Platform SaaS Billing: `vendors`, `purchase_orders`, `platform_subscriptions` (explicitly isolated from school tuition fee ledgers).
- **Supabase / PostgreSQL Parity**: See `supabase/migrations/001_initial_schema.sql` and `supabase/migrations/002_v4_global_education_and_finance_hub.sql` (including strict RLS policies).
