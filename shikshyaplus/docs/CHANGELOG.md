# Changelog

## 2026-11-17 — Full Multi-Tenant ERP, Community & Persistent Preference Polish

- **Database & Schema Parity (`server/db.ts`, `supabase/migrations/001_initial_schema.sql`)**:
  - Added `school_expenses`, `inventory_assets`, `visitor_logs`, `student_certificates`, and `user_blocks` SQLite tables with `ensureSupplementarySeeds()` backfill for existing local databases.
  - Mirrored all five tables and Row-Level Security tenant isolation policies in `supabase/migrations/001_initial_schema.sql`.
- **Operations & Registrar Modules (`server/routes/socialAndOps.ts`, `server/routes/schoolAdmin.ts`, `src/components/OperationsModule.tsx`, `src/components/StudentsModule.tsx`)**:
  - Added Student Directory CSV export (`/api/v1/students/export`) and Fee Ledger CSV export (`/api/v1/operations/fees/export`) with audit logging.
  - Added School Expenses Ledger (`GET/POST /operations/expenses`) with collected revenue vs. expense net balance KPIs.
  - Added Campus Inventory & Assets (`GET/POST/PATCH /operations/inventory`) with condition tracking (`GOOD`, `FAIR`, `MAINTENANCE`, `RETIRED`).
  - Added Reception Visitor Check-In / Check-Out Log (`GET/POST /operations/visitors`, `PATCH /operations/visitors/:id/checkout`).
  - Added Official Student Certificates (`GET/POST /operations/certificates`) with Parent/Student scoping and a Printable Official Certificate modal.
- **Social Safety & Navigation (`src/components/SocialModule.tsx`, `src/components/UniversalAddModal.tsx`)**:
  - Added Global Directory filtering by District, Province, and Country.
  - Added post Edit & Delete authorization controls, User Blocking (`user_blocks`) across feeds and messaging initiation, and Blocked Users management inside Account Profile Connections.
  - Aligned `UniversalAddModal` action IDs (`add_student`, `add_homework`, `add_invoice`, etc.) with `domainRules.ts` so every quick action routes directly to its target module.
- **Persistent Dismissal Controls (`AuthPortal`, `RoleDashboard`, `PWAInstallButton`, `AccountCenterModal`)**:
  - Added `"Don't show again"` persistent dismissal preferences (`sp_hide_demo_accounts`, `sp_hide_welcome_banner`, `sp_hide_install_prompt`) plus one-click `"Restore Dismissed Tips"` inside Account Center.
