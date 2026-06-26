# SnapRooms Security Strategy

## CSRF protection

- Owner and admin cookie-authenticated mutative endpoints require an `Origin`/`Referer` check and a valid `X-CSRF-Token` header.
- Tokens are stateless HMAC tokens bound to the owner/admin session subject and expire after 2 hours.
- The client fetches a token from `GET /api/csrf` after authentication and `csrfFetch` attaches it automatically to same-origin `POST`/`PATCH`/`PUT`/`DELETE` requests.
- Stripe webhook and public guest upload endpoints are explicitly excluded from CSRF checks.

## Rate limiting

- Production deployments should configure Upstash Redis via `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
- Without Redis, the app falls back to in-memory buckets. This is acceptable for development but not ideal for production multi-instance deployments.
- Limits are defined per endpoint category in `lib/server/rate-limiter.js`:
  - `AUTH_LIMITS` — login, forgot/reset/setup password, resend.
  - `PAYMENT_LIMITS` — checkout session, unlock download.
  - `OWNER_WRITE_LIMITS` — event CRUD, photo actions, moments, private delivery, photographer links, cover upload.
  - `ADMIN_LIMITS` — admin auth and write operations.

## Protected endpoints

- Owner authenticated write endpoints under `/api/owner/*` (event update/delete, photo moderate/delete, moments, private delivery, photographer link, cover, logout).
- Admin authenticated write endpoints under `/api/admin/*`.
- Payment initiation: `POST /api/stripe/checkout-session`, `POST /api/stripe/unlock-download`.

## Excluded endpoints

- `POST /api/stripe/webhook` — verified by Stripe signature only.
- Public guest upload endpoints under `/api/uploads/*` and `/api/photographer-upload/*` — use IP-based rate limits and strong validation.
- Public read endpoints (`GET /api/events/*`, `/api/health/db`, etc.).
- Unauthenticated auth endpoints (`/api/owner/login`, `/api/owner/forgot-password`) — use origin check + rate limit, no CSRF token.

## Required environment variables

- `CSRF_SECRET` — production only; fail-closed if missing.
- `ALLOWED_ORIGINS` — comma-separated list of allowed origins (e.g. `https://snaprooms.app`).
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` — recommended for production rate limiting.

## Error responses

- CSRF/origin failure: `403` with `{ error, code }`.
- Rate limit: `429` with `{ error, code, retryAfter }` and `Retry-After` header.
- No stack traces, secrets, or raw tokens are exposed.
