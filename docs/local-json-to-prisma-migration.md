# Local JSON → Prisma Migration Script

## Purpose
This is a one-time import helper for moving local MVP metadata into Prisma/PostgreSQL.

It imports:
- `Event` rows from `/app/data/mock-db.json`
- `Photo` rows from `/app/data/mock-db.json`

It does **not** migrate file binaries because uploads already live on disk under `/app/public/uploads/events`.

It does **not** migrate admin auth by default.

## Current local source shape
### `/app/data/mock-db.json`
```json
{
  "events": [
    {
      "id": "uuid",
      "slug": "event-slug",
      "name": "Event Name",
      "coverPhotoId": "uuid|null",
      "createdAt": "ISO date",
      "updatedAt": "ISO date"
    }
  ],
  "photos": [
    {
      "id": "uuid",
      "eventId": "uuid",
      "originalName": "file.jpg",
      "storedName": "stored-file.jpg",
      "mimeType": "image/jpeg",
      "size": 12345,
      "url": "/uploads/events/...",
      "uploaderName": "Guest|null",
      "caption": "Optional caption|null",
      "status": "VISIBLE|HIDDEN",
      "uploadSource": "mobile",
      "createdAt": "ISO date",
      "updatedAt": "ISO date"
    }
  ]
}
```

### `/app/data/admin-auth.json`
```json
{
  "salt": "...",
  "hash": "...",
  "updatedAt": "ISO date"
}
```

## Script location
- `/app/scripts/migrate-local-json-to-prisma.js`

## Safety model
- Default mode is **dry-run**
- Writes happen only with `--execute`
- Uses Prisma `upsert()` for events/photos to avoid obvious duplicate imports
- Recomputes `coverPhotoId` from newest visible photo per event after photo import
- Runs inside a single Prisma transaction so a failure should roll back the import batch
- Skips orphan photos whose `eventId` does not exist in the source event list

## Run instructions
### 1. Add DATABASE_URL
Make sure `DATABASE_URL` is present before running anything.

### 2. Prepare Prisma
```bash
yarn prisma:generate
yarn prisma:migrate:dev --name init_event_gallery
```

### 3. Preview the import without writing
```bash
yarn migrate:local-to-prisma:dry-run
```

### 4. Execute the import
```bash
yarn migrate:local-to-prisma
```

## Admin auth recommendation
For the **first** PostgreSQL cutover, keep:
- `ADMIN_AUTH_DRIVER=local`

This is the safer staged approach.

If you later want DB-backed admin auth, you may run:
```bash
node scripts/migrate-local-json-to-prisma.js --execute --include-admin-auth
```

But only do that after validating the basic event/photo cutover.

## Rollback / recovery note
If the import fails partway through:
- The script is wrapped in a Prisma transaction, so partial writes should roll back
- Fix the reported issue
- Re-run the dry-run first
- Re-run the execute command once clean

If the import already succeeded but app behavior looks wrong:
1. Leave `DATA_ACCESS_DRIVER=local`
2. Inspect imported rows in PostgreSQL
3. Re-run the script safely (it uses upserts for events/photos)
4. Only switch `DATA_ACCESS_DRIVER=prisma` after verification
