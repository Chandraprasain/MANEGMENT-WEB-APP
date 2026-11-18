# ShikshyaPlus

Multi-tenant School Management ERP, Global Education Social Network, Private My School Community, AI Homework Scanner, and Safeguarding & Moderation Platform (Nepal-first, globally expandable).

## Implemented Capabilities
- **Authentication & Multi-Tenant Identity**:
  - Dual sign-in (`School ID + User ID + Password` and `Global Email + Password`).
  - Self-registration for Schools (`PENDING` approval queue), Parents (with verified invitation code linking), and Students (marked `PROVISIONAL` pending Technical Dept verification).
  - Password hashing via Node `crypto.scryptSync` + `timingSafeEqual`, HMAC-signed HTTP-only `sp_session` cookie backed by `user_sessions`, active session revocation, log-out all devices, and forced temporary password changes (`mustChangePassword`).
- **Role-Based Dashboards & Operations**:
  - Platform Super Admin, Principal/School Org, Teacher/Class Teacher, Technical Dept, Departmental Staff (Accountant, Librarian, Transport, Admin), Student, and Parent/Guardian.
  - Strict school tenant isolation enforced on all `/api/v1` endpoints.
  - Student enrollment, printable Login Cards, bulk CSV import preview & duplicate validation, parent invitation codes, homework/submissions, attendance, exams & GPA calculation, daily diary, notices, events, library, transport, admissions, support tickets, and audit logs.
- **Social Network & Real-Time Messaging**:
  - Public **Global Feed**, **Verified School Directory**, **Educational Groups**, **Facebook-style Profile**, and private **My School** community.
  - Real-time authenticated WebSocket (`/ws`) messaging with child-safeguarding rules and 3-strike moderation + appeals workflow.
- **AI Homework Scanner & Safety Screening**:
  - Server-side `@google/genai` integration (`gemini-4-hydrogen`) via `/api/v1/ai/homework-scan`. Returns honest `503` status when `GEMINI_API_KEY` is not set.
- **Offline PWA Support**:
  - `vite-plugin-pwa` Service Worker + Web App Manifest + IndexedDB (`query_cache` and `sync_queue`) for cached reads and automatic offline mutation replay.

## Seeded Local Demo Accounts
- **Sunrise Valley Secondary School** (`SUNRISE-2026`)
  - Principal: `PRI-001` (`principal@sunrise.edu.np`) · Teacher: `TCH-001` · Tech Dept: `TEC-001` · Accounts: `STF-001` · Student: `STU-001` — Password: `School@2026!`
  - Parent: `parent@sunrise.edu.np` — Password: `Parent@2026!` · Unused Parent Invite Code: `INV-SUN-102`
- **Everest Horizon Academy** (`EVEREST-2026`)
  - Principal: `PRI-001` (`principal@everest.edu.np`) — Password: `School@2026!`
- **Platform Super Admin**: `superadmin@shikshyaplus.edu.np` — Password: `Admin@2026!`

## Running & Testing Locally
```bash
npm install
npm test          # Domain logic unit tests
npx tsx --test server/api.test.ts  # API security & tenant isolation tests
npm run lint      # TypeScript check
npm run build     # Production Vite + PWA bundle
npm run dev       # Full-stack server on port 3000
```
