# Production Deploy Checklist

Use this checklist before and after every production deployment, especially when the change touches authentication, payments, storage, or the Prisma schema.

## Pre-deploy

- [ ] `npm run build` passes locally.
- [ ] `npm test` passes locally.
- [ ] If `prisma/schema.prisma` changed, a migration file exists under `prisma/migrations/`.
- [ ] Migration SQL has been reviewed for production safety (no destructive changes, `IF NOT EXISTS` / `DROP COLUMN` justified).
- [ ] `CSRF_SECRET` is set in production environment variables.
- [ ] `ALLOWED_ORIGINS` includes the production domain (e.g. `https://snaprooms.app`).
- [ ] `NEXT_PUBLIC_BASE_URL` is set to the production domain (e.g. `https://snaprooms.app`).
- [ ] `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are set if sending dunning/payment-failed emails.
- [ ] Stripe Customer Portal is configured in the Stripe Dashboard (return URL, payment-method update, invoice history, subscription cancellation).
- [ ] Upstash Redis is configured (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) for production rate limiting.

## Deploy

- [ ] Deploy via the project's Vercel/Git workflow (do **not** use `prisma db push` in production).
- [ ] Wait for the Vercel build to complete successfully.

## Post-deploy (mandatory for Prisma/auth changes)

- [ ] Run `npx prisma migrate status` and confirm `Database schema is up to date!`.
- [ ] Run `npx prisma migrate deploy` only if migrations are pending.
- [ ] Run `/api/health/db` and confirm `{"status":"ok"}`.
- [ ] Run `/api/owner/session` and confirm no `P2022` / schema-mismatch errors.
- [ ] Run `/api/owner/forgot-password` with a non-existing email and confirm generic `200` response.
- [ ] Run `/api/owner/login` with a valid account and confirm successful login.
- [ ] For password-reset changes: request a reset, use the link once, reuse the link, and confirm it fails with "invalid or expired".
- [ ] `GET /api/csrf` returns a token for an authenticated owner/admin.
- [ ] `POST /api/stripe/checkout-session` without `X-CSRF-Token` returns `403`.
- [ ] `POST /api/stripe/checkout-session` from a foreign `Origin` returns `403`.
- [ ] `POST /api/stripe/customer-portal` without `X-CSRF-Token` returns `403`.
- [ ] `POST /api/stripe/customer-portal` from a foreign `Origin` returns `403`.
- [ ] `POST /api/stripe/customer-portal` for an owner without a Professional subscription returns `404`.
- [ ] Rapid repeated checkouts trigger `429` and do not create Stripe sessions.
- [ ] Rapid repeated Customer Portal requests trigger `429` and do not create Stripe portal sessions.
- [ ] Stripe webhook continues to work without CSRF headers.
- [ ] Stripe webhook handles `invoice.payment_failed` by setting `subscriptionStatus=past_due` and a 7-day grace period.
- [ ] Stripe webhook handles `invoice.payment_succeeded` by restoring `subscriptionStatus=active` and clearing the grace period.
- [ ] `customer.subscription.updated` with `past_due` keeps the owner on Professional during the grace window.
- [ ] Dashboard shows a payment-failed warning with a CTA to update the payment method.
- [ ] Guest upload still works from the public event page.
- [ ] Professional owner sees "Manage subscription" in the dashboard sidebar and the button opens Stripe Billing Portal.
- [ ] Returning from the portal to `/dashboard?billing=portal_return` shows the return message and cleans the URL.
- [ ] Cancelling Professional via the portal triggers `customer.subscription.deleted` and downgrades the owner to `free`.

## Emergency rollback note

- Do **not** run `prisma migrate reset` or drop tables to fix schema errors.
- If a deploy introduces a schema mismatch, apply pending migrations with `npx prisma migrate deploy`.
- If a code bug is exposed, revert the deployment and keep the schema migrations applied; do not roll back the database unless a destructive migration was deployed.
