# Prisma / PostgreSQL Switch Plan

## Current mode
- UI and API stay unchanged
- Local event/photo data uses `/app/data/mock-db.json`
- Local admin credential bootstrap uses `/app/data/admin-auth.json`
- Storage remains local filesystem under `/app/public/uploads/events`
- Data access driver defaults to `local`
- Admin auth driver defaults to `local` unless `ADMIN_PASSWORD` is set

## Prisma-ready mapping
- `Event` model maps to public/admin event create/list/detail flows
- `Photo` model maps to upload completion, gallery rendering, moderation, and deletion flows
- `Photo.status` maps directly to moderation state (`VISIBLE`, `HIDDEN`)
- `AdminCredential` model maps to optional DB-backed admin password storage
- Cookie session stays stateless for MVP; no DB session table is required

## Environment variables
Required for PostgreSQL switch:
- `DATABASE_URL=postgresql://...`

Recommended for production stability:
- `DATA_ACCESS_DRIVER=prisma`
- `ADMIN_AUTH_DRIVER=local` or `prisma`
- `ADMIN_SESSION_SECRET=strong-random-secret`

Optional:
- `ADMIN_PASSWORD=...` (if you prefer env-backed admin auth instead of DB/local file auth)

## Low-risk switch path
1. Add `DATABASE_URL`
2. Run `yarn prisma:generate`
3. Run `yarn prisma:migrate:dev --name init_event_gallery` (or your preferred migration command)
4. Keep `DATA_ACCESS_DRIVER=local` for one smoke-test cycle if you want zero-risk rollout
5. When ready, set `DATA_ACCESS_DRIVER=prisma`
6. Keep `ADMIN_AUTH_DRIVER=local` initially to avoid auth regression
7. Optionally migrate admin auth later by setting `ADMIN_AUTH_DRIVER=prisma` and creating a row in `AdminCredential`

## Data migration notes
### Events and photos
You can migrate local JSON data by reading:
- `/app/data/mock-db.json`

And inserting into Prisma tables in this order:
1. `Event`
2. `Photo`
3. Recompute `coverPhotoId` based on newest visible photo per event

### Admin credential
If you want DB-backed admin auth later:
- read `/app/data/admin-auth.json`
- create one `AdminCredential` row with:
  - `key = "primary"`
  - `passwordSalt = local.salt`
  - `passwordHash = local.hash`

## Risks during switch
- Turning on `DATA_ACCESS_DRIVER=prisma` before running Prisma generate/migrations will break event/photo reads and writes
- Switching `ADMIN_AUTH_DRIVER=prisma` before seeding `AdminCredential` will lock out admin login
- Leaving `ADMIN_SESSION_SECRET` unset is okay for MVP, but a dedicated secret is safer than deriving it indirectly
- File storage remains local; DB switch does not migrate image binaries
- Existing local JSON data is not auto-imported into PostgreSQL
