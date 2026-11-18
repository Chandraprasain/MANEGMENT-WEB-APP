# Testing & Verification

- **Domain Logic Unit Tests**: `npm test` runs `tsx --test src/lib/domainRules.test.ts src/lib/v4Rules.test.ts` (13 unit tests) covering:
  - RBAC `+ Add` action filtering, tenant isolation helpers, Nepal NEB/SEE GPA calculation, 3-strike moderation escalation & appeal restoration, Bikram Sambat (BS) date conversion, and phone validation.
  - Bank account masking (`••••••4821`), double-entry balanced debit/credit validation, refund ceiling validation (`validateRefundAmount`), workflow depth `<= 3` & human approval gates, OneRoster 1.2 CSV escaping, and QTI 3.0 XML output.
- **API Security & Multi-Tenant Integration Tests**: `npx tsx --test server/api.test.ts` spins up isolated in-memory SQLite databases via `createApp(':memory:')` and verifies:
  - School ID + Global auth, cross-tenant rejection (`403`), parent invitation verification, teacher creation + forced password change, exam result publishing, moderation strikes/appeals, and private file isolation.
  - V4.0 + V4.1 end-to-end flows: AES-256-GCM bank account masking (no raw number leak), payment initiation + idempotent verification + invoice settlement + balanced double-entry journal posting, over-refund rejection (`400`), confidential safeguarding visibility restriction (teacher denied `403`/filtered on parent report), and workflow attendance trigger creating a human approval request.
- **TypeScript & Build Verification**: `npm run lint` (`tsc --noEmit`) and `npm run build` (`vite build` with PWA generation).
