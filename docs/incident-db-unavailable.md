# Runbook: Database Unavailable Incident

## Symptoms

- Users see "Service temporarily unavailable" or "Login temporarily unavailable"
- Vercel function logs show `PrismaClientKnownRequestError P1001`
- `/api/health/db` returns `503` with `"status": "unavailable"`
- Build or deploy may fail at `prisma migrate deploy`
- Background repair logs show redacted connection failures: `[db-unavailable] route=... code=P1001 ...`

## Immediate Checks

### 1. Check Neon Status

- [Neon Status Page](https://neonstatus.com/)
- Check for incidents in your region (`us-east-1` for `c-6` clusters)

### 2. Test Health Endpoint

```bash
curl -s https://snaprooms.app/api/health/db | jq .
```

Expected if DB is OK:
```json
{ "status": "ok", "durationMs": 12 }
```

Expected if DB is down:
```json
{ "status": "unavailable", "error": "Database unreachable" }
```

### 3. Run Local DB Connectivity Check

```bash
# From project root
cd fotowebApp
export DATABASE_URL="your-connection-string"
npm run db:health
```

### 4. Verify Environment Variables

In Vercel Dashboard → Project Settings → Environment Variables:

| Variable | What to check |
|---|---|
| `DATABASE_URL` | Must point to **pooled** connection (`*.pooler.*`) |
| `DIRECT_URL` | Must point to **direct** connection (no pooler) for migrations |

**Do NOT log these values in public channels.**

### 5. Verify Connection String Format

Pooled (for app runtime):
```
postgresql://user:pass@ep-....pooler....neon.tech:5432/db?sslmode=require
```

Direct (for migrations):
```
postgresql://user:pass@ep-....us-east-1.aws.neon.tech:5432/db?sslmode=require
```

## If `migrate deploy` Fails

### During Deploy

1. **Do NOT block the build** on migration failure
2. Vercel build command should be:
   ```
   npm run build
   ```
   (NOT `prisma migrate deploy && npm run build`)
3. Run migrations separately after DB is back:
   ```bash
   npx vercel env pull .env.production
   npm run db:migrate:deploy
   ```
   Or via Vercel CLI in a one-off command:
   ```bash
   vercel --prod
   # Then run migration manually via a secure environment
   ```

### Manual Migration

```bash
# Ensure DIRECT_URL is set for migrations
export DIRECT_URL="your-direct-connection-string"
npx prisma migrate deploy
```

## Recovery Steps

### 1. Confirm DB is back

```bash
npm run db:health
# or
curl https://snaprooms.app/api/health/db
```

### 2. If DB is back but app still shows 503

- Vercel functions may still be using cold-start instances with stale connections
- Trigger a **redeploy** (even without code changes) to recycle functions:
  ```bash
  vercel --prod
  ```

### 3. If build failed because of migration

- Fix the DB connectivity issue first
- Re-run the failed deployment from Vercel Dashboard
- Or push an empty commit to trigger a new deploy:
  ```bash
  git commit --allow-empty -m "chore: trigger redeploy after DB recovery"
  git push
  ```

### 4. If the incident persists > 15 minutes

1. Open a ticket with Neon support
2. Include your project ID and the exact time range
3. Do NOT include connection strings or passwords

## Monitoring Setup

### Option A: Better Stack (Recommended)

1. Create a Heartbeat or Uptime Monitor
2. URL: `https://snaprooms.app/api/health/db`
3. Expected status: `200`
4. Alert channel: Slack / Email / PagerDuty
5. Interval: 60 seconds

### Option B: UptimeRobot

1. Add New Monitor → HTTP(s)
2. URL: `https://snaprooms.app/api/health/db`
3. Monitoring Interval: 1 minute
4. Alert Contact: Email / Slack webhook

### Option C: Checkly

1. Create API Check
2. URL: `https://snaprooms.app/api/health/db`
3. Assert: status code `200`, JSON body `status` equals `"ok"`
4. Run locations: US East, EU West

### Option D: Cronitor

1. Create an Uptime Monitor
2. URL: `https://snaprooms.app/api/health/db`
3. Assert: status code `200`
4. Schedule: every 1 minute

### Alert Thresholds

| Metric | Warning | Critical |
|---|---|---|
| `/api/health/db` status | 1 failure | 3 consecutive failures |
| Response time | > 2s | > 5s |
| P1001 errors in logs | Any occurrence | > 10 in 5 minutes |

## Vercel Build Configuration

### Recommended Build Command

In Vercel Dashboard → Project Settings → Build & Development Settings:

```
Build Command: npm run build
```

**Do NOT include `prisma migrate deploy` in the build command.**

### Post-Deploy Migration (Manual)

After a successful deploy, run migrations from a secure environment:

```bash
# Using Vercel CLI
vercel env pull .env.production
npm run db:migrate:deploy
```

Or use a GitHub Action (see below).

## GitHub Actions: Post-Deploy Migration

Create `.github/workflows/db-migrate.yml`:

```yaml
name: Database Migration

on:
  push:
    branches: [main]

jobs:
  migrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx prisma migrate deploy
        env:
          DIRECT_URL: ${{ secrets.DIRECT_URL }}
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

**Important**: Set `DIRECT_URL` and `DATABASE_URL` as repository secrets.

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

---

## Checklist Before Closing Incident

- [ ] Neon status page shows all green
- [ ] `/api/health/db` returns 200 consistently
- [ ] `npm run db:health` passes locally with production credentials
- [ ] No new P1001 errors in Vercel logs (last 10 minutes)
- [ ] Core user flows work (create event, upload photo, login)
- [ ] Migration is up to date (`npx prisma migrate status`)
- [ ] Monitoring alerts are acknowledged

## Contacts

- **Neon Support**: https://neon.tech/docs/introduction/support
- **Vercel Support**: https://vercel.com/help
- **Internal On-call**: [add your on-call rotation link]
