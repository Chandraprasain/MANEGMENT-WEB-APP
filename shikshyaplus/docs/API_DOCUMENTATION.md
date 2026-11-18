# API Documentation (`/api/v1`)

All endpoints return `{ success, message?, data?, error? }` JSON envelopes and enforce HTTP-only cookie authentication (`sp_session`) + school tenant checks.

- **Auth**: `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`, `POST /auth/logout-all`, `POST /auth/switch-membership`, `POST /auth/register-school`, `POST /auth/register-parent`, `POST /auth/register-student`, `POST /auth/change-password`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `GET/DELETE /auth/sessions`, `PATCH /auth/profile`, `GET /auth/export-data`.
- **Dashboard & School Admin**: `GET /dashboard`, `GET /schools/discover`, `GET /schools/:id/public`, `POST /schools/:id/follow`, `POST /schools/:id/verify`, `GET /schools/:id/members`, `POST /schools/:id/staff`, `PATCH /schools/:id/members/:membershipId`.
- **Students & Guardians**: `GET/POST /students`, `POST /students/import/preview`, `POST /students/import/confirm`, `PATCH /students/:id`, `POST /students/:id/parent-invitation`, `GET /parents/children`, `POST /parents/link-child`, `GET/POST /parents/requests`.
- **Academics & Social/Ops**: `GET/POST /academics/*`, `/social/*`, `/communications/*`, `/operations/*`, `/ai/status`, `/ai/homework-scan`, `/moderation/*`, `/files/upload`, `/files/:fileId`.
- **V4.0 Automation & Role-Scoped AI (`/api/v1/workflows`, `/api/v1/approvals`, `/api/v1/ai`)**:
  - `GET/POST /workflows`, `PATCH /workflows/:id/status`, `POST /workflows/:id/test`
  - `POST /approvals/:id/review`
  - `GET/PATCH /ai/governance`, `POST /ai/agents/run`
- **V4.0 Learning, CBT & Interoperability (`/api/v1/curriculum`, `/api/v1/question-bank`, `/api/v1/assessments`, `/api/v1/interoperability`)**:
  - `GET /curriculum`, `POST /curriculum/frameworks`, `POST /curriculum/objectives`, `POST /curriculum/progress`, `POST /curriculum/ilps`
  - `GET/POST /question-bank`
  - `GET/POST /assessments`, `POST /assessments/:id/submit`
  - `GET/POST /interoperability/badges`, `GET /interoperability/badges/verify/:code`, `GET /interoperability/oneroster/users`, `GET /interoperability/qti/:assessmentId`
- **V4.1 Finance Hub & eSewa-Inspired Payment Gateway (`/api/v1/payments`, `/api/v1/finance`)**:
  - `GET /payments/overview`, `POST /payments/orders/initiate`, `POST /payments/orders/:orderUuid/submit-bank-proof`, `POST /payments/orders/:orderUuid/review-bank-proof`, `POST /payments/verify`
  - `GET/POST /finance/bank-accounts`, `POST /finance/bank-accounts/:id/verify`
  - `POST /finance/merchants`, `POST /finance/refunds`
  - `GET /finance/accounting/ledger`, `POST /finance/accounting/journals`
  - `POST /finance/vendors`, `POST /finance/purchase-orders`, `GET/POST /finance/platform-subscriptions`
- **V4.0 Trust, Safeguarding, Community & Governance (`/api/v1/safeguarding`, `/wellbeing`, `/consent`, `/pickups`, `/marketplace`, `/hr`, `/facilities`, `/developer`, `/dr`)**:
  - `GET/POST /safeguarding/cases`, `PATCH /safeguarding/cases/:id/status`
  - `POST /wellbeing/appointments`, `GET/POST /consent`, `POST /pickups`
  - `GET /marketplace`, `POST /marketplace/resources`
  - `GET /hr/leaves-and-facilities`, `POST /hr/leaves`, `POST /facilities/book`
  - `GET /developer-security/overview`, `POST /developer/api-keys`, `POST /developer/webhooks`, `POST /dr/backups/verify`
