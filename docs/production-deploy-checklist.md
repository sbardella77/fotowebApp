# Production Deploy Checklist

Use this checklist before and after every production deployment, especially when the change touches authentication, payments, storage, or the Prisma schema.

## Pre-deploy

- [ ] `npm run build` passes locally.
- [ ] `npm test` passes locally.
- [ ] If `prisma/schema.prisma` changed, a migration file exists under `prisma/migrations/`.
- [ ] Migration `20260701120000_add_subscription_cancellation_schedule` has been created for scheduled-cancellation fields.
- [ ] Migration `20260701130000_add_subscription_billing_interval` has been created for the `subscriptionBillingInterval` field.
- [ ] Migration `20260701174300_extra_free_event_credit_only` has been applied to make `ExtraFreeEventCheckout.eventName` nullable.
- [ ] `STRIPE_PRICE_ID_EXTRA_EVENT` is set in production environment variables.
- [ ] `STRIPE_PRICE_ID_PROFESSIONAL_ANNUAL` is set in production environment variables.
- [ ] Migration SQL has been reviewed for production safety (no destructive changes, `IF NOT EXISTS` / `DROP COLUMN` justified).
- [ ] `CSRF_SECRET` is set in production environment variables.
- [ ] `ALLOWED_ORIGINS` includes the production domain (e.g. `https://snaprooms.app`).
- [ ] `NEXT_PUBLIC_BASE_URL` is set to the production domain (e.g. `https://snaprooms.app`).
- [ ] `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are set for transactional billing emails (dunning, checkout confirmations, cancellation).
- [ ] Stripe Customer Portal is configured in the Stripe Dashboard (return URL, payment-method update, invoice history, subscription cancellation).
- [ ] Upstash Redis is configured (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) for production rate limiting.

## Deploy

- [ ] Deploy via the project's Vercel/Git workflow (do **not** use `prisma db push` in production).
- [ ] Wait for the Vercel build to complete successfully.

## Post-deploy (mandatory for Prisma/auth changes)

**If a migration is pending, apply it only through the guarded sequence below.**
Never invoke `prisma migrate deploy` (or `npm run prisma:migrate:deploy` /
`npm run db:migrate:deploy`) directly against Preview or Production.

Mandatory migration sequence:

1. **ENV VERIFY** — decide the target explicitly: `preview` or `production`. Never let a tool infer it.
2. **PRE-FLIGHT** — run `npm run db:migrate:preview` or `npm run db:migrate:production` (see [`scripts/run-migration-safe.sh`](../scripts/run-migration-safe.sh)). This prompts for `DIRECT_URL` (via `read -s`, never echoed, never written to a file) and runs [`scripts/db-migration-preflight.cjs`](../scripts/db-migration-preflight.cjs) first. The pre-flight fails closed — and the migration does **not** run — unless it proves: the connection is the expected environment's Neon endpoint, is non-pooled, is authenticated as the expected owner-capable role (`neondb_owner`, not a least-privilege runtime role), and actually owns every ordinary table in `public` (including `_prisma_migrations`, `Photo`, `BlobUploadSession`).
3. **MIGRATE DEPLOY** — runs automatically, only if step 2 passed.
4. **MIGRATION STATUS** — runs automatically; confirm `Database schema is up to date!`.
5. **SCHEMA VERIFY** — manually confirm the specific columns/tables this migration was meant to add (e.g. via `information_schema.columns`) match what the migration SQL declares.

Do **not**:
- run `prisma migrate deploy` directly — always go through `npm run db:migrate:preview` / `npm run db:migrate:production`.
- use the runtime `DATABASE_URL` (the least-privilege pooled connection) for any DDL/migration — migrations must use `DIRECT_URL` only, authenticated as the owner-capable role.
- reach for `prisma migrate resolve` as the first response to a `P3018` failure. `migrate resolve` marks a migration as applied/rolled-back in bookkeeping only — it does not fix an ownership or environment-binding problem, and using it to "get past" an unexplained P3018 can mask a credential misconfiguration instead of fixing it. Run the pre-flight first; if it reports `REASON=UNEXPECTED_ROLE`, `REASON=UNEXPECTED_HOST`, or `REASON=OWNERSHIP_MISMATCH`, fix the credential/environment binding, don't paper over it with `migrate resolve`.

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
- [ ] **Scheduled cancellation** via Customer Portal:
  - [ ] `customer.subscription.updated` with `cancel_at_period_end: true` keeps `plan=professional`.
  - [ ] `subscriptionCurrentPeriodEnd` is stored and exposed by `/api/owner/plan`.
  - [ ] Dashboard shows informative banner "Professional remains active until {date}".
  - [ ] `sendProfessionalCancellationScheduledEmail` is received.
  - [ ] Retention offer email includes yearly-plan CTA for monthly subscribers.
  - [ ] Annual subscribers receive scheduled-cancellation email without retention offer.
  - [ ] Webhook retry with the same `current_period_end` does not resend the email.
  - [ ] Removing the schedule (cancel_at_period_end: false) clears dashboard banner.
  - [ ] At period end `customer.subscription.deleted` downgrades to free without duplicate email.
- [ ] **Professional Annual Plan**:
  - [ ] Stripe test-mode checkout for `billingInterval=annual` creates a subscription with the annual price.
  - [ ] Webhook `checkout.session.completed` stores `subscriptionBillingInterval=annual`.
  - [ ] Pricing page `/pricing?plan=professional&billing=annual` shows €790/year and "save €158" badge.
  - [ ] Dashboard scheduled-cancellation banner shows "View yearly plan" CTA for monthly subscribers.
- [ ] **Wedding Pro & Extra Free Event hardening** (Stripe test mode):
  - [ ] Free event → Pro Event checkout succeeds.
  - [ ] Pro Event → Wedding Pro upgrade checkout succeeds.
  - [ ] Wedding Pro → Wedding Pro checkout returns `409 event_already_wedding_pro`.
  - [ ] Pro Event → Wedding Pro webhook fulfillment updates `billingTier` to `wedding_pro`.
  - [ ] Webhook retry of the same `checkout.session.completed` event does not double-fulfill or resend email.
  - [ ] `pro_event` webhook on an already-`wedding_pro` event is silently skipped (no downgrade).
  - [ ] Extra Free Event auto-create succeeds and creates exactly one event.
  - [ ] Extra Free Event credit-only checkout creates an `ExtraFreeEventCheckout` row and grants exactly one credit.
  - [ ] Retry of the same Extra Free Event credit-only session does not double-grant credits.
  - [ ] Extra Free Event fallback credit (auto-create failure) grants exactly one credit and sends one email.
  - [ ] Retry of Extra Free Event fallback credit does not double-grant credits.
- [ ] **Billing emails** are verified in Stripe test mode:
  - [ ] Extra Free Event auto-created → creation email received
  - [ ] Extra Free Event fallback credit → credit email received
  - [ ] Pro Event purchase → Pro Event activation email received
  - [ ] Wedding Pro purchase → Wedding Pro activation email received
  - [ ] Professional subscription → Professional activation email received
  - [ ] `invoice.payment_failed` → payment failed email with grace period
  - [ ] `invoice.payment_succeeded` after failure → payment recovered email received
  - [ ] `customer.subscription.deleted` (immediate) → cancellation email received
  - [ ] Webhook retry of the same event does not send duplicate emails

## Emergency rollback note

- Do **not** run `prisma migrate reset` or drop tables to fix schema errors.
- Do **not** run `prisma migrate resolve` as a first response to a failed migration (e.g. Postgres `42501` / Prisma `P3018` "must be owner of table ..."). That error means the migration connection is not the expected owner-capable role — fix the credential/environment binding (see pre-flight guardrail above), don't mark the migration resolved around it.
- If a deploy introduces a schema mismatch, apply pending migrations with `npm run db:migrate:preview` or `npm run db:migrate:production` (never `npx prisma migrate deploy` directly) — see the mandatory migration sequence above.
- If a code bug is exposed, revert the deployment and keep the schema migrations applied; do not roll back the database unless a destructive migration was deployed.
