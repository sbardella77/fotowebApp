# Vercel Blob Upload Migration Notes

## What changed
- Upload storage is now dual-mode:
  - `BLOB_READ_WRITE_TOKEN` present => Vercel Blob public upload path is used
  - token absent => existing local storage fallback is used
- Prisma/Neon data layer is unchanged
- Admin auth remains unchanged
- Existing photo metadata shape is unchanged; only the stored `url` changes for new uploads

## Required environment
- `BLOB_READ_WRITE_TOKEN` on Vercel project
- `DATABASE_URL`
- `DIRECT_URL`
- `DATA_ACCESS_DRIVER=prisma`
- `ADMIN_AUTH_DRIVER=local`
- `ADMIN_SESSION_SECRET`

## Upload behavior
- Production-safe path uses the official Vercel Blob client upload flow via `/api/uploads/blob`
- `/api/uploads/init` now selects the storage strategy
- `/api/uploads/complete` stores Blob URL + stored filename into existing photo metadata flow

## Gallery behavior
- Existing gallery and moderation logic continue reading `photo.url`
- New uploads on Vercel will use public Blob URLs
- Old local URLs remain unchanged in DB until manually migrated

## Old local image URLs
- Existing DB rows with `/uploads/...` URLs are not automatically migrated
- They will keep working only where those local files are actually available
- If you need old images in Vercel production, migrate those files separately into Blob and update `photo.url`

## Redeploy checklist
1. Ensure `BLOB_READ_WRITE_TOKEN` is present in Vercel env
2. Redeploy the app
3. Verify `GET /api` reports `storageMode` as `vercel-blob` in deployed environment
4. Upload a new image from the public flow
5. Confirm the saved `photo.url` is a public Blob URL
6. Confirm gallery render + admin moderation still work
