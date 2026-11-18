# Security Controls

- **Password Hashing**: `crypto.scryptSync` with random 16-byte salts and `crypto.timingSafeEqual`.
- **Sessions**: HTTP-only `sp_session` cookie signed with HMAC-SHA256 (`SESSION_SECRET`) and backed by revocable `user_sessions` rows.
- **Tenant Isolation**: `requireSchoolTenant` and per-route `school_id` predicates block cross-school reads/writes and return HTTP `403`.
- **Confidential Safeguarding Isolation**: `/api/v1/safeguarding/cases` restricts school-wide confidential safeguarding case visibility strictly to `PRINCIPAL`, `VICE_PRINCIPAL`, `PLATFORM_SUPER_ADMIN`, or `PLATFORM_SUPPORT` — teachers, parents, students, and technical staff can file reports and view only their own authored submissions.
- **AES-256-GCM Bank & Merchant Credential Protection**: `server/services/encryption.ts` encrypts full bank account numbers and payment merchant secret keys at rest using `FINANCE_ENCRYPTION_KEY` (AES-256-GCM with 12-byte random IV and auth tag). List/read APIs return only masked last-4 account displays (`••••••4821`) and `hasSecret: true`, never raw credentials.
- **Server-Side Payment Verification & Double-Entry Integrity**: Parent/student payment settlements never trust client-submitted success status alone; webhook and callback verification records idempotent settlement keys, rejects over-refunds (`validateRefundAmount`), and posts strictly balanced debit/credit journal entries (`validateDoubleEntryJournal`).
- **Automation Loop Guard & Human Approvals**: Workflow execution enforces a hard recursion depth ceiling (`<= 3`), per-event idempotency keys, and human approval queueing for sensitive broadcasts/fee actions.
- **AI Governance & Privacy**: Role-scoped AI agents enforce strict per-role prompt scopes, configurable governance policies, prompt audit logs, and mark AI-generated academic/disciplinary communications as drafts requiring human review.
- **Child Safeguarding & File Uploads**: `canInitiateConversation` blocks unsolicited adult-to-student DMs; `multer` enforces 5 MB limits and MIME validation outside the static root; rate limiters guard auth, scanner, and checkout routes.
