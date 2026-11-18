# Environment Variables

Configure environment secrets in `.env` or deployment secret managers. Never expose server-side secrets via `VITE_*` client variables.

| Variable | Required | Purpose |
| :--- | :--- | :--- |
| `PORT` | Optional (default `3000`) | HTTP and WebSocket server listen port (`server.ts`). |
| `APP_URL` | Optional | Public URL used for self-referential callback links and origin metadata. |
| `SESSION_SECRET` | Recommended in production | HMAC key used to sign session tokens (`HttpOnly` cookies). Falls back to an ephemeral cryptographic secret if unset. |
| `FINANCE_ENCRYPTION_KEY` | Recommended in production | 32-byte key/passphrase for AES-256-GCM encryption of bank account numbers & payment merchant secrets at rest. |
| `OPEN_BADGES_SIGNING_SECRET` | Recommended in production | HMAC-SHA256 signing key for Open Badges 3.0 verifiable credentials & outbound webhook signatures. |
| `GEMINI_API_KEY` | Required for AI Homework Scanner & Role AI Agents | Server-side key for `@google/genai` (`gemini-4-hydrogen`). Returns honest HTTP `503` when unset/placeholder. |
| `OPENAI_API_KEY` | Optional | Fallback AI provider key when `provider: "OPENAI"` is selected in AI Homework Scanner. |
| `ESEWA_MERCHANT_CODE` | Optional | Nepal eSewa gateway merchant verification code. Sandbox/production gateway config is also manageable per school via `/api/v1/finance/merchants`. |
| `KHALTI_SECRET_KEY` | Optional | Nepal Khalti secret verification key. |
| `TURN_SERVER_URL` | Optional | External STUN/TURN relay endpoint returned to WebRTC clients when configured. |
| `SUPABASE_URL` | Optional (Postgres migration target) | Supabase project URL matching `supabase/migrations/001_initial_schema.sql` and `002_v4_global_education_and_finance_hub.sql`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional (Postgres migration target) | Server-side Supabase service role key (never shipped to client bundle). |
