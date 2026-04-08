# PostgreSQL Cutover Checklist (First Safe Production-Style Switch)

This runbook is for the **first** cutover from local JSON mode to Prisma/PostgreSQL.

## Goal
- Keep current MVP behavior unchanged
- Move `Event` and `Photo` metadata from local JSON to PostgreSQL
- Keep admin auth on `local` for the first cutover
- Avoid downtime, broken uploads, and admin lockout

---

## 1) Pre-cutover checklist

### Environment readiness
- [ ] You have a valid `DATABASE_URL`
- [ ] You are **not** changing UI or API routes
- [ ] `DATA_ACCESS_DRIVER` is still `local`
- [ ] `ADMIN_AUTH_DRIVER` is still `local`
- [ ] `ADMIN_PASSWORD` is not being introduced as part of this cutover unless intentionally desired
- [ ] `ADMIN_SESSION_SECRET` is set to a strong dedicated value for production-style stability

### Data readiness
- [ ] Confirm local metadata files exist:
  - `/app/data/mock-db.json`
  - `/app/data/admin-auth.json`
- [ ] Confirm uploaded image files exist under:
  - `/app/public/uploads/events`
- [ ] Confirm local app behavior is currently healthy before cutover:
  - public event create/list/detail works
  - upload flow works
  - admin login works
  - moderation works

### Safety rules
- [ ] Do **not** switch `DATA_ACCESS_DRIVER=prisma` yet
- [ ] Do **not** switch `ADMIN_AUTH_DRIVER=prisma` yet
- [ ] Do **not** run the import script before Prisma schema/migrations are ready
- [ ] Do **not** delete local JSON files during the first cutover

---

## 2) Exact cutover steps

### Step A — add database env only
Add:
```bash
DATABASE_URL=postgresql://...
```
Recommended for first DB-backed run:
```bash
DATA_ACCESS_DRIVER=local
ADMIN_AUTH_DRIVER=local
ADMIN_SESSION_SECRET=<strong-random-secret>
```

### Step B — generate Prisma client
```bash
yarn prisma:generate
```

### Step C — apply schema to PostgreSQL
Use your preferred migration flow. Safe first option:
```bash
yarn prisma:migrate:dev --name init_event_gallery
```

### Step D — dry-run the data import
```bash
yarn migrate:local-to-prisma:dry-run
```
Expected result:
- script reads local JSON
- script reports event/photo counts
- script does **not** write to DB
- script confirms admin auth is excluded by default

### Step E — execute the event/photo import
```bash
yarn migrate:local-to-prisma
```
Important:
- this imports `Event` and `Photo`
- this recomputes `coverPhotoId`
- this does **not** migrate admin auth by default

### Step F — verify imported data before switching drivers
Keep runtime unchanged:
```bash
DATA_ACCESS_DRIVER=local
ADMIN_AUTH_DRIVER=local
```
Do **not** switch yet.

Perform verification checks first.

### Step G — switch only event/photo reads+writes to Prisma
After verification passes, change:
```bash
DATA_ACCESS_DRIVER=prisma
```
Keep:
```bash
ADMIN_AUTH_DRIVER=local
```

### Step H — restart app services
```bash
sudo supervisorctl restart nextjs
```
If broader restart is needed:
```bash
sudo supervisorctl restart all
```

---

## 3) Verification checklist

### After schema creation, before import
- [ ] Prisma client generates successfully
- [ ] Migration completes successfully
- [ ] No schema errors in logs

### After import, before driver switch
Verify in PostgreSQL:
- [ ] `Event` row count matches local JSON event count
- [ ] `Photo` row count matches valid local JSON photo count
- [ ] `Photo.status` values look correct
- [ ] `Event.coverPhotoId` is populated correctly for events with visible photos
- [ ] no unexpected null `slug` / `eventId` / `url` values

Functional verification while still on local mode:
- [ ] homepage loads
- [ ] public event list loads
- [ ] one known event exists in DB and local JSON counts match
- [ ] local mode still works unchanged

### After driver switch to Prisma
Check runtime metadata:
- [ ] `GET /api` shows:
  - `repositoryMode=prisma`
  - `configuredDataAccessDriver=prisma`
  - `configuredAdminAuthDriver=local`
  - `databaseConfigured=true`

Functional regression checks:
- [ ] create a new event from public flow
- [ ] open event detail page
- [ ] upload a photo through public flow
- [ ] verify newest photo appears in gallery
- [ ] verify file is still served from local storage URL
- [ ] log into admin
- [ ] view admin event detail
- [ ] reject a photo and confirm it disappears from public gallery
- [ ] approve a photo and confirm it returns
- [ ] delete a photo and confirm metadata removal

### Recommended post-switch API regression order
1. `GET /api`
2. `POST /api/events`
3. `GET /api/events`
4. `GET /api/events/:slug`
5. `POST /api/uploads/init`
6. `POST /api/uploads/chunk`
7. `POST /api/uploads/complete`
8. `POST /api/admin/login`
9. `GET /api/admin/events`
10. `GET /api/admin/events/:slug`
11. `PATCH /api/admin/photos/:id`
12. `DELETE /api/admin/photos/:id`
13. `POST /api/admin/logout`

---

## 4) Rollback plan

## Rollback trigger conditions
Rollback immediately if any of these happen after switching to Prisma:
- event create/list/detail fails
- upload completion fails to save metadata
- admin event detail/moderation fails unexpectedly
- `GET /api` reports Prisma mode but core flows are broken
- DB data shape/count looks wrong

### Fast rollback procedure
1. Revert env to local data mode:
```bash
DATA_ACCESS_DRIVER=local
ADMIN_AUTH_DRIVER=local
```
2. Restart app:
```bash
sudo supervisorctl restart nextjs
```
3. Re-test critical flows:
- public event list/detail
- upload flow
- admin login
- moderation

### Important rollback notes
- Do **not** delete imported PostgreSQL rows during immediate rollback
- Local JSON remains the source of truth for the first cutover
- Because file storage stays local, rollback does not require binary file recovery
- You can inspect/fix Prisma data offline and retry cutover later

### Recovery-after-rollback
- inspect DB rows and migration logs
- re-run dry-run import if needed
- fix identified issue
- repeat verification checks
- attempt switch again only after confidence is restored

---

## 5) Final recommended env configuration for first DB-backed run

Use this for the **first safe cutover**:
```bash
DATABASE_URL=postgresql://...
DATA_ACCESS_DRIVER=prisma
ADMIN_AUTH_DRIVER=local
ADMIN_SESSION_SECRET=<strong-random-secret>
```

### Why this is safest
- Event/photo metadata moves to PostgreSQL
- Admin auth stays on known-good local file mode
- Session signing becomes stable and explicit
- UI and API contracts remain unchanged

---

## 6) Explicitly deferred until after first stable cutover
Do **not** do these in the first switch:
- switch `ADMIN_AUTH_DRIVER=prisma`
- migrate admin credentials into `AdminCredential`
- change storage from local files to S3
- change UI flows
- remove local JSON backups

---

## 7) Minimal operator sequence (short form)
```bash
# 1. Add DATABASE_URL and keep drivers safe
# DATA_ACCESS_DRIVER=local
# ADMIN_AUTH_DRIVER=local

# 2. Generate Prisma client
yarn prisma:generate

# 3. Apply migrations
yarn prisma:migrate:dev --name init_event_gallery

# 4. Preview import
yarn migrate:local-to-prisma:dry-run

# 5. Execute import
yarn migrate:local-to-prisma

# 6. Verify DB contents

# 7. Switch only data driver
# DATA_ACCESS_DRIVER=prisma
# ADMIN_AUTH_DRIVER=local

# 8. Restart app
sudo supervisorctl restart nextjs

# 9. Run regression checks
```
