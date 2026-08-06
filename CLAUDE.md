# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev                              # Dev server on port 3000
npm run build                            # Production build
npm test                                 # Run Vitest unit tests
npm run prisma:generate                  # Regenerate Prisma client (required after schema changes)
npm run prisma:migrate:dev               # Create and apply a new migration (dev)
npm run prisma:migrate:deploy            # Apply migrations in production
npm run prisma:push                      # Sync schema without migration (dev only)
npm run db:health                        # Check database connectivity
npm run migrate:local-to-prisma:dry-run  # Preview JSON→Postgres data migration
npm run migrate:local-to-prisma          # Execute JSON→Postgres data migration
```

Run a single Vitest test file:
```bash
npx vitest run tests/<file>.test.js
```

## Architecture

**SnapRooms** is a Next.js 14 (App Router) event photo gallery platform for weddings, parties, and corporate events. Owners create events and share QR-coded links; guests upload photos directly from mobile.

### Driver-based plugin system

The app uses environment variables to select implementations at startup:

| Concern | Env var | Options |
|---------|---------|---------|
| Data access | `DATA_ACCESS_DRIVER` | `local` (JSON file) / `prisma` (PostgreSQL, auto-selected if `DATABASE_URL` exists) |
| Admin auth | `ADMIN_AUTH_DRIVER` | `local` (JSON file) / `prisma` |
| File storage | `BLOB_READ_WRITE_TOKEN` | Vercel Blob (if token present) / local filesystem |

Both `local` and `prisma` repositories implement the same interface (`createEvent`, `listEvents`, `getEventBySlug`, `uploadPhoto`, etc.) defined in `/lib/server/gallery-repository.js`. Output is normalized via `/lib/server/repository-mappers.js`.

### API routing

All API traffic flows through a single dynamic handler: `/app/api/[[...path]]/route.js`. Routes switch on path segments. Responses use a `json()` helper that auto-sets CORS headers. All inputs are validated with Zod schemas from `/lib/server/schemas.js`.

Key API paths:
- `POST /api/events` — create event
- `GET /api/events/{slug}` — fetch event + photos
- `POST /api/upload/init` → `chunk` → `complete` — 3-step chunked upload pipeline
- `PATCH /api/photos/{id}/status` — admin moderation (VISIBLE/HIDDEN)
- `POST /api/admin/auth/*` — admin session management
- `POST /api/billing/*` — Stripe checkout and subscription management
- `POST /api/webhooks/stripe` — Stripe webhook handler

### Authentication

- **Owner sessions**: Stateless HMAC-SHA256 signed tokens (base64url payload + signature). Verified in `/lib/server/owner-auth.js`. Invalidated by `sessionVersion` on the Owner model.
- **Admin sessions**: Same mechanism via `/lib/server/admin-auth.js`, stored in `event_gallery_admin_session` cookie.
- **Management tokens**: Per-event tokens for photographer bulk uploads.

### Billing

Stripe powers subscriptions and one-off upsells. The `Owner` model tracks `stripeCustomerId`, `stripeSubscriptionId`, `billingPlan`, and `subscriptionStatus`. Webhook handlers in the API route update these fields on lifecycle events. Grace periods (7 days) apply for `past_due` subscriptions. Promotional free event credits are tracked in `ExtraFreeEventCheckout`.

### Internationalization

`middleware.js` handles locale-prefix routing (`/en`, `/it`, `/de`, `/fr`, `/es`) with geo-based detection and cookie persistence.

### Key file locations

- `/lib/server/` — all server-side logic (repositories, auth, storage drivers, billing)
- `/lib/server/schemas.js` — all Zod validation schemas
- `/lib/server/gallery-repository.js` — repository abstraction entry point
- `/components/ui/` — Radix UI + Tailwind component library (use existing; don't create custom)
- `/prisma/schema.prisma` — PostgreSQL schema (11 models)
- `/data/` — JSON files used by local drivers

### Adding an API route

1. Add handler in `/app/api/[[...path]]/route.js`
2. Add Zod schema in `/lib/server/schemas.js`
3. Use `json()` for responses and `getGalleryRepository()` for data access
4. Protect with `requireAdmin()` or owner token verification as needed

### Adding a database migration

1. Edit `/prisma/schema.prisma`
2. Run `npm run prisma:migrate:dev --name <description>`
3. For production: commit the generated migration file, then run `npm run prisma:migrate:deploy`


## Regole per l’analisi del progetto

- Prima di proporre modifiche, ricostruisci architettura e flussi.
- Durante gli audit non modificare file senza approvazione esplicita.
- Ogni problema deve indicare file e righe coinvolte.
- Separa fatti verificati, ipotesi e informazioni mancanti.
- Non mostrare mai valori di password, token, API key o altri segreti.
- Ignora osservazioni puramente stilistiche senza impatto concreto.
- Verifica ogni finding seguendo il percorso reale del codice.
- Prima di eseguire comandi potenzialmente distruttivi, chiedi autorizzazione.
