# SnapRooms — Testing Notes

## Core Entitlement & Retention Tests

Two critical pure-function layers have minimal but solid test coverage:

- `tests/event-access.test.js` — 12 tests covering Free, Pro Event, Wedding Pro, Professional, Business, legacy `pro`, and `originalDownloadUnlocked` only.
- `tests/event-retention.test.js` — 11 tests covering Free 90 days, Pro Event 12 months, Wedding Pro 24 months, Professional active, Professional cancelled grace period, vault extension, and archive lock.

### Running tests

```bash
npm test
```

Uses **Vitest** (dev dependency). No DB, no Prisma, no fetch — tests are pure, fast, and timezone-safe.

### When to update

- Any change to pricing plans or entitlement rules → update `event-access` tests.
- Any change to retention durations or grace-period logic → update `event-retention` tests.
- Adding a new plan tier? Add a matching scenario in both files before shipping.

## Prisma schema changes

If a PR modifies `prisma/schema.prisma`, production deployment is not complete until:

1. a Prisma migration exists in `prisma/migrations/`
2. `npm run db:health` passes against production
3. `npm run db:migrate:deploy` has been executed successfully
4. `npx prisma migrate status` reports the production database as up to date
5. critical production flows are smoke-tested:
   - `/api/health/db`
   - dashboard login
   - affected feature/page

> **Internal note (IT):** Se una PR modifica `prisma/schema.prisma`, la migration production è obbligatoria prima di considerare il deploy completato.

### Schema / Migration checklist

```txt
Schema / Migration checklist

[ ] Questa PR modifica prisma/schema.prisma?
[ ] Se sì, esiste una nuova migration in prisma/migrations/?
[ ] npm run db:health eseguito su production
[ ] npm run db:migrate:deploy eseguito su production
[ ] npx prisma migrate status conferma DB up to date
[ ] /api/health/db ritorna status ok
[ ] Login dashboard testato
[ ] Feature collegata alla migration testata
```
