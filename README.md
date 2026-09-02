# SnapRooms

SnapRooms is a SaaS photo-sharing platform for events. An organizer creates
an event, shares a QR code or link, and guests upload photos from their
phones in a browser — no app install, no guest account. Uploads land in a
shared gallery the organizer manages from a dashboard.

This README is a developer-facing map of the repository: architecture,
environments, local setup, and the operational rules that keep Production
safe. It documents only what is verifiable in this repository — where the
repository and this document disagree, the repository wins.

## What SnapRooms Does

```
Organizer creates event
  → shares QR code / link
  → guest opens the Guest Room (no app, no account)
  → guest uploads photo(s)
  → photo appears in the shared gallery
  → organizer manages the event and its photos from the dashboard
```

Primary use cases (verified against the product's marketing pages and
copy): weddings, birthdays, private parties, graduations, baptisms /
communions / confirmations, and corporate events — serving both individual
hosts and professionals (photographers, wedding/event planners, venues)
who run these events for clients.

## Architecture

- **Next.js (App Router)** application, deployed to **Vercel**.
- Most of the guest- and owner-facing API surface is served by a single
  catch-all handler, [`app/api/[[...path]]/route.js`](app/api/%5B%5B...path%5D%5D/route.js)
  (events, uploads, owner/admin auth, moments, gallery downloads, private
  delivery). Newer subsystems — Stripe, CSRF, cron jobs, health checks,
  analytics logging — are implemented as discrete `app/api/*/route.js`
  handlers (see [Repository Structure](#repository-structure)).
- **Prisma** ORM against **PostgreSQL** (Neon) is the Production
  persistence layer. A repository abstraction (`lib/server/gallery-repository.js`)
  can also run against a local JSON fixture (`data/mock-db.json`) when no
  database is configured — see [Local Development](#local-development).
- **Vercel Blob** stores uploaded photos; **Sharp** generates watermark
  and download derivatives server-side.
- **Stripe** Checkout + webhooks handle billing (event-level and
  account-level upgrades, Original Quality unlocks).
- `middleware.js` handles locale detection/redirects for public marketing
  pages and leaves the app, API, and dashboard routes untouched.

## Technology Stack

| Area | Technology |
|---|---|
| Framework | Next.js 14 (App Router), React 18 |
| Language | JavaScript (`.js`/`.jsx`); `tsconfig.json` enables Next.js type-checking at build time |
| Styling / UI | Tailwind CSS, shadcn/ui (Radix UI primitives) |
| Database / ORM | PostgreSQL (Neon), Prisma |
| Object storage | Vercel Blob |
| Payments | Stripe (Checkout + webhooks) |
| Rate limiting | Upstash Redis, with an in-memory fallback |
| Transactional email | Resend |
| Analytics | PostHog (client + server) |
| Testing | Vitest |
| Deployment | Vercel (Git integration); GitHub Actions for CI |

## Repository Structure

```
app/            Next.js App Router: pages, dashboard, API route handlers
  api/          Route handlers — see Architecture
  [locale]/     Localized public marketing pages (en/de/it/fr/es)
  dashboard/    Owner dashboard (login, analytics, password setup/reset)
components/     UI components (marketing/, ui/ = shadcn primitives)
lib/            Application logic
  server/       Server-only modules (auth, billing, storage, Stripe, rate limiting, CSRF)
  analytics/    PostHog + internal event tracking
  i18n/         Locale config and dictionaries
hooks/          Shared React hooks
prisma/         schema.prisma, active migrations, and an archived legacy migration history
public/         Static assets, brand assets, marketing placeholder images
scripts/        Operational/maintenance scripts (see Operational Tooling)
tests/          Vitest test suite
docs/           Operational runbooks and design docs (see Additional Documentation)
middleware.js   Locale detection/redirect for public marketing routes
```

## Environments

SnapRooms runs in three distinct environments. They are never
interchangeable:

| Environment | Where | Database | Notes |
|---|---|---|---|
| Development | Local machine | Local JSON fixture, or a developer's own Postgres instance | `npm run dev` |
| Preview | Vercel Preview deployments | Isolated from Production | Created per branch/PR by Vercel's Git integration |
| Production | `https://snaprooms.app` | Production Postgres (Neon) | Deployed from `main` |

**Never assume Preview and Production share interchangeable credentials or
signing secrets.** In particular, Stripe webhook signing secrets
(`STRIPE_WEBHOOK_SECRET`) are environment-specific: a Sandbox/test-mode
Stripe webhook destination must never be configured to sign against a
Production secret, or vice versa. Each environment's Stripe webhook
endpoint (Production: `POST /api/stripe/webhook` on `snaprooms.app`) must
use the signing secret issued for that exact destination.

## Local Development

```bash
git clone <repository-url>
cd fotowebApp   # or your clone directory — avoid iCloud-synced Desktop/Documents paths (see below)

npm install

# Provision environment variables (see Environment Configuration).
# No .env.example is committed to this repository — obtain values for
# the variables you need from your team's secret storage.

npm run dev     # starts the dev server on http://localhost:3000
npm test        # Vitest suite
npm run build   # production build
```

Notes:

- With no database configured, the app falls back to a local JSON data
  driver (`data/mock-db.json`) so the UI is usable with zero setup. Set
  `DATABASE_URL` (and `DATA_ACCESS_DRIVER=prisma` to force it) to develop
  against a real Postgres instance.
- `postinstall` runs `prisma generate` automatically.
- Repositories that undergo frequent automated/editor writes (this one
  included) should not live inside a cloud-synchronized Desktop/Documents
  folder (e.g. iCloud Drive) — filesystem reconciliation there can create
  conflicting duplicate files. `~/Developer/fotowebApp` is a reasonable
  local location.

## Environment Configuration

Variable **names** only — no values are included here or should ever be
committed to the repository.

**Database**

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Required |
| `DIRECT_URL` | Required by Prisma migrations |
| `DATA_ACCESS_DRIVER` | Optional (`local` \| `prisma`); auto-detects if unset |

**Storage**

| Variable | Notes |
|---|---|
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob |

**Stripe**

| Variable | Notes |
|---|---|
| `STRIPE_SECRET_KEY` | |
| `STRIPE_WEBHOOK_SECRET` | Environment-specific — see [Environments](#environments) |
| `STRIPE_PRICE_ID_PRO_EVENT` | |
| `STRIPE_PRICE_ID_WEDDING_PRO` | |
| `STRIPE_PRICE_ID_PROFESSIONAL` | |
| `STRIPE_PRICE_ID_PROFESSIONAL_ANNUAL` | |
| `STRIPE_PRICE_ID_EXTRA_EVENT` | |
| `STRIPE_PRICE_ID_HIGH_QUALITY_DOWNLOAD` | Original Quality unlock |
| `STRIPE_ORDERING_GUARD_ENABLED` | Optional flag |
| `NEXT_PUBLIC_EXTRA_EVENT_PRICE_LABEL` | Display label |

**Rate limiting**

| Variable | Notes |
|---|---|
| `UPSTASH_REDIS_REST_URL` | Recommended in Production; falls back to in-memory without it |
| `UPSTASH_REDIS_REST_TOKEN` | Recommended in Production |

**Email**

| Variable | Notes |
|---|---|
| `RESEND_API_KEY` | |
| `RESEND_FROM_EMAIL` | |
| `OPS_ALERT_EMAIL` | |

**Analytics**

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_POSTHOG_KEY` | |
| `NEXT_PUBLIC_POSTHOG_HOST` | Optional, has a default |

**Auth / security**

| Variable | Notes |
|---|---|
| `CSRF_SECRET` | Required in Production; app fails closed if missing |
| `ALLOWED_ORIGINS` | |
| `CORS_ORIGINS` | |
| `ADMIN_AUTH_DRIVER` | |
| `ADMIN_PASSWORD` | Optional |
| `ADMIN_SESSION_SECRET` | |
| `OWNER_SESSION_SECRET` | |
| `CRON_SECRET` | Protects `/api/cron/*` |

**App URLs**

| Variable | Notes |
|---|---|
| `APP_URL` | Used by operational scripts (e.g. the incident tool) |
| `NEXT_PUBLIC_APP_URL` | |
| `NEXT_PUBLIC_BASE_URL` | |
| `VERCEL`, `VERCEL_URL` | Provided by the Vercel runtime |

**Operational tooling**

| Variable | Notes |
|---|---|
| `DB_HEALTH_TIMEOUT_MS` | Optional, `scripts/check-db-connection.js` |
| `INCIDENT_TEST_ENV` | Required by `scripts/incident-test-reset-flow.mjs`; must be `development` or `preview` |

## Database & Prisma

- Schema: [`prisma/schema.prisma`](prisma/schema.prisma).
- Active migration history: `prisma/migrations/` (a single squashed
  baseline plus incremental migrations going forward).
- `prisma/migrations-legacy/` is an **archive only** — historical
  pre-squash migrations kept for audit. Prisma must never be pointed at
  it; see [`prisma/migrations-legacy/README.md`](prisma/migrations-legacy/README.md).

```bash
npm run prisma:generate        # generate the Prisma client
npm run prisma:migrate:dev     # create/apply a migration locally
npm run db:migrate:deploy      # apply pending migrations (Production workflow)
npm run db:health              # scripts/check-db-connection.js — connectivity check
```

Production migrations require a controlled, explicit workflow — never a
casual `prisma db push` against Production. Follow
[`docs/production-deploy-checklist.md`](docs/production-deploy-checklist.md)
and the schema-change checklist in
[`docs/testing.md`](docs/testing.md#prisma-schema-changes): a migration
file must exist for every `schema.prisma` change, `prisma migrate deploy`
must be run and verified with `prisma migrate status`, and critical flows
(`/api/health/db`, dashboard login) must be smoke-tested afterward. Avoid
destructive schema operations unless explicitly reviewed and justified —
Production data is preserved by default.

## Photo Upload & Storage

Guest and photographer uploads are validated, stored in **Vercel Blob**,
and persisted as `Photo` records (Prisma) referencing the owning `Event`.
The gallery reads from that same store. On the Free plan, downloaded
photos are watermarked (`lib/server/watermark.js`); paid tiers and the
Original Quality unlock serve unwatermarked, full-resolution derivatives
(`lib/server/download-derivative.js`, `lib/server/display-derivative.js`).
Gallery-wide downloads are produced asynchronously as a `GalleryDownloadJob`
and cleaned up by a scheduled cron job.

## Billing & Stripe

Billing is two-dimensional and enforced server-side:

- **Account-level plan** (`Owner`): `free`, `professional`, `business`,
  or the legacy `pro`.
- **Event-level tier** (`Event.billingTier`): `null` (Free), `pro_event`,
  or `wedding_pro`.
- **Extra Free Event** credits and a one-off **Original Quality**
  download unlock exist alongside the recurring tiers.

Checkout is created via `POST /api/stripe/checkout-session`; fulfillment
happens in the `POST /api/stripe/webhook` handler, verified by Stripe's
signature. Transactional billing emails are documented in
[`docs/billing.md`](docs/billing.md).

This README intentionally does not list prices or plan copy — those
change independently of the code. Treat `docs/billing.md`, `lib/pricing-config.js`,
and the live `/pricing` page as the source of truth.

## Security

Summarized from [`docs/security.md`](docs/security.md) (authoritative):

- **CSRF**: owner/admin cookie-authenticated mutating endpoints require an
  `Origin`/`Referer` check plus a stateless, HMAC-signed `X-CSRF-Token`
  (2-hour TTL), fetched from `GET /api/csrf`. The Stripe webhook and
  public guest-upload endpoints are explicitly excluded (verified by
  other means).
- **Rate limiting**: category-based limits (`lib/server/rate-limiter.js`)
  backed by Upstash Redis in Production, with an in-memory fallback.
- **Security headers**: HSTS, `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, a restrictive `Content-Security-Policy`,
  and `Permissions-Policy` are set globally in `next.config.js`.
- **Session/auth**: separate owner and admin cookie-session mechanisms
  (`lib/server/owner-auth.js`, `lib/server/admin-auth.js`).
- **Environment isolation**: see [Environments](#environments).

## Testing

```bash
npm test        # Vitest — full suite
npm run build   # production build (also type-checks via tsconfig.json)
```

The suite is pure/unit and contract-style — no live database or network
calls. Stripe checkout and webhook fulfillment are covered with mocked
Prisma/Stripe clients. See [`docs/testing.md`](docs/testing.md) for what
is covered and when tests must be updated (pricing/entitlement changes,
retention rules, checkout/webhook validation).

## Development Workflow

The workflow this repository follows for non-trivial changes:

```
audit → plan → implementation → targeted tests → full test suite → build
  → diff audit → Preview deployment → QA → controlled Production release
```

In practice: verify the current repository state before changing
anything, keep diffs scoped to what was planned, run the specific tests
for the change before the full suite, confirm `npm run build` succeeds,
review the actual diff against what was intended, and let Preview/QA
precede any Production-affecting release.

## Deployment

- Vercel's Git integration deploys automatically: pushes to `main`
  deploy to Production; branches/PRs get isolated Preview deployments.
- GitHub Actions CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml))
  runs on push/PR: install, `prisma generate`, `npm test`, `npm run build`.
  It does not deploy.
- Scheduled jobs are defined in [`vercel.json`](vercel.json) (Vercel Cron):
  gallery-download cleanup, blob-upload cleanup, photo-derivative
  cleanup, and a billing-health check.
- Release verification: check out or confirm the exact commit SHA being
  deployed, wait for CI to pass, then confirm the Vercel deployment
  status for that SHA before treating a release as complete.

## Health & Observability

- `GET /api/health/db` — Prisma connectivity check, `{"status":"ok"}` or
  `503`. See the incident runbook:
  [`docs/incident-db-unavailable.md`](docs/incident-db-unavailable.md).
- `scripts/check-db-connection.js` (`npm run db:health`) — the same
  check, runnable locally/manually.
- PostHog captures client- and server-side product analytics
  (`lib/analytics/`).
- `OPS_ALERT_EMAIL` receives operational alerts via
  `lib/server/ops-alerts.js`.

## Operational Tooling

`scripts/` holds maintenance and diagnostic scripts, not application code:

| Script | Purpose |
|---|---|
| `scripts/check-db-connection.js` | Database connectivity check (`npm run db:health`) |
| `scripts/migrate-local-json-to-prisma.js` | One-time local-JSON → Prisma import (dry-run by default; `--execute` to write) |
| `scripts/backfill-display-derivatives.cjs` | Backfills display derivatives for existing photos |
| `scripts/incident-test-reset-flow.mjs` | Exercises the owner password setup/reset flow against a disposable test identity |

`scripts/incident-test-reset-flow.mjs` is Development/Preview-only by
design: it requires an explicit `APP_URL` (no default), refuses any
Production-looking host or `NODE_ENV`, requires `INCIDENT_TEST_ENV` to be
explicitly `development` or `preview`, only mutates data with `--execute`,
and only ever touches a single dedicated test identity. Full details:
[`docs/incident-test-reset-flow.md`](docs/incident-test-reset-flow.md).

## Localization

Public marketing pages are localized for five locales, configured in
[`lib/i18n/config.js`](lib/i18n/config.js):

`en` (default), `de`, `it`, `fr`, `es`

`middleware.js` detects and redirects unprefixed public marketing paths
to a locale-prefixed URL and persists the choice in a cookie; the API,
dashboard, admin, and event/guest routes are explicitly excluded from
locale redirection.

## Production Safety Rules

- Never run destructive or data-mutating tests against Production.
- Never complete a real Stripe payment against Production as part of a
  routine smoke test.
- Never commit or print secrets, credentials, or connection strings.
- Never force-push to `main`.
- Every Prisma schema change requires an explicit, reviewed migration —
  no ad hoc `prisma db push` against Production.
- Functional changes go through a Preview deployment before Production.
- Verify the exact commit SHA behind any release before and after
  deploying it.
- After any Production deploy, confirm health with a read-only check
  (`GET /api/health/db`) — never a mutating one.
- Keep Development, Preview, and Production credentials and signing
  secrets strictly separate (see [Environments](#environments)).

## Additional Documentation

| Doc | Covers |
|---|---|
| [`docs/security.md`](docs/security.md) | CSRF, rate limiting, protected/excluded endpoints |
| [`docs/testing.md`](docs/testing.md) | Test coverage map, schema-change checklist |
| [`docs/production-deploy-checklist.md`](docs/production-deploy-checklist.md) | Pre/post-deploy checklist |
| [`docs/billing.md`](docs/billing.md) | Transactional billing emails and triggers |
| [`docs/incident-db-unavailable.md`](docs/incident-db-unavailable.md) | Database-unavailable incident runbook |
| [`docs/incident-test-reset-flow.md`](docs/incident-test-reset-flow.md) | Incident reset-flow tool: safety contract and usage |
| [`docs/retention-policy.md`](docs/retention-policy.md) | Event/photo retention rules |
| [`docs/event-cover-policy.md`](docs/event-cover-policy.md) | Event cover image policy |
| [`docs/effective-event-access-state.md`](docs/effective-event-access-state.md) | Event access-state resolution logic |
| [`docs/legal-commerce-readiness.md`](docs/legal-commerce-readiness.md) | EU/Germany legal & commerce readiness |
| [`docs/cookie-policy.md`](docs/cookie-policy.md) | Cookie policy |
| [`docs/vercel-blob-upload-migration.md`](docs/vercel-blob-upload-migration.md) | Vercel Blob upload migration notes |
| [`docs/local-json-to-prisma-migration.md`](docs/local-json-to-prisma-migration.md) | Local-JSON → Prisma migration runbook |
| [`docs/postgres-switch-plan.md`](docs/postgres-switch-plan.md) | Historical: Prisma/Postgres switch plan |
| [`docs/postgres-cutover-checklist.md`](docs/postgres-cutover-checklist.md) | Historical: first Postgres cutover checklist |
| [`docs/snaprooms-vault.md`](docs/snaprooms-vault.md) | Product spec for a **planned, not-yet-built** retention add-on |
| [`docs/audit-tecnico-operativo-2026-05-20.md`](docs/audit-tecnico-operativo-2026-05-20.md) | Historical technical/operational audit |

## License / Status

Private repository (`package.json` `"private": true`). No open-source
license is published in this repository.
