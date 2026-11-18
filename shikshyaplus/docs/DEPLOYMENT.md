# Deployment & External Service Configuration

## Local / Container Deployment
- Build frontend & PWA service worker: `npm run build`
- Start full-stack server on port 3000: `npm start` (or `docker build -t shikshyaplus . && docker run -p 3000:3000 shikshyaplus`).

## External Production Credentials (Optional / Honest Boundary)
When unconfigured, endpoints return explicit `503` configuration errors rather than fabricating responses:
- `GEMINI_API_KEY`: Enables Gemini homework scanner & AI moderation screening.
- `OPENAI_API_KEY`: Optional secondary AI homework provider.
- `ESEWA_MERCHANT_CODE` & `KHALTI_SECRET_KEY`: Enables live Nepal eSewa/Khalti fee payments (accounts staff cash/bank receipt entry works without gateway keys).
- `EMAIL_PROVIDER_API_KEY`: Enables outbound password reset email delivery.
- `SESSION_SECRET`: Recommended 32+ character secret in production.
