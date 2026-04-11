# AI Coding Agent Instructions

## Project Overview
**FotoWebApp** is a Next.js 14 event photo gallery with admin moderation. It's a full-stack MVP supporting photo uploads, galleries, and admin workflows with pluggable storage and database drivers.

## Architecture & Key Patterns

### Driver-Based Architecture (Critical)
The system uses **driver selection pattern** for extensibility:
- **Data Access**: `LOCAL` (JSON file `/data/mock-db.json`) or `PRISMA` (PostgreSQL)
- **Admin Auth**: `LOCAL` (JSON file `/data/admin-auth.json`) or `PRISMA` (DB)
- **Storage**: `LOCAL` (filesystem `/public/uploads/events`) or `VERCEL_BLOB`

**Environment variables control routing:**
```env
DATA_ACCESS_DRIVER=local|prisma  # Default: auto-detect (Prisma if DATABASE_URL exists)
ADMIN_AUTH_DRIVER=local|prisma   # Default: local
ADMIN_PASSWORD=...               # Triggers local password setup if set
DATABASE_URL=postgresql://...    # Enables Prisma driver
```

**Repository pattern:** See `/lib/server/gallery-repository.js` which delegates to `mockGalleryRepository` or `prismaGalleryRepository` based on driver. Both implement identical interface: `createEvent()`, `listEvents()`, `getEventBySlug()`, `uploadPhoto()`, etc.

### Data Models
**Prisma schema** (`/prisma/schema.prisma`):
- `Event`: Contains photo galleries with auto-slugified names, cover photo tracking
- `Photo`: Includes `status` (VISIBLE/HIDDEN) for moderation, `uploadSource` (mobile/web), blob/file references
- `AdminCredential`: Optional DB-backed admin auth with password salt/hash

**JSON equivalents** (`/data/mock-db.json`):
- `events[]` and `photos[]` with identical shape to Prisma models
- Both driver implementations normalize to same output via `/lib/server/repository-mappers.js`

### Request/Response Flow
**API endpoint:** `/app/api/[[...path]]/route.js` handles dynamic routing
- All responses wrapped in `json()` helper with CORS headers
- Zod schemas validate all inputs (`/lib/server/schemas.js`)
- Admin routes require cookie-based session token (HMAC-SHA256)
- Storage driver abstraction hides upload mechanics (local vs Vercel Blob)

**Key routes:**
- `GET /api` → status/config metadata
- `POST /api/events` → create event
- `GET /api/events/{slug}` → fetch event with photos
- `POST /api/upload/init` → initialize chunked upload session
- `POST /api/upload/chunk` → upload chunk
- `POST /api/upload/complete` → finalize upload
- `PATCH /api/photos/{id}/status` → admin moderation

### Upload Pipeline
1. **Init**: Client calls `POST /api/upload/init` with event slug → server returns `sessionId`, storage driver allocates temporary dir
2. **Chunked upload**: Client loops `POST /api/upload/chunk` with 1MB chunks (configurable)
3. **Complete**: Client calls `POST /api/upload/complete` with metadata → storage driver moves temp→permanent, Photo record created
4. Storage driver choice affects path structure:
   - **Local**: `/public/uploads/events/{eventId}/{photoId}.{ext}`
   - **Vercel Blob**: Blob pathname managed by @vercel/blob SDK

### Authentication
**Admin session:** Stateless JWT-like token (base64url payload + HMAC signature)
- Secret seed from `/data/admin-auth.json` or DB
- Stored in `event_gallery_admin_session` cookie (httpOnly, 7-day expiry)
- Verified via `/lib/server/admin-auth.js:verifyAdminSessionToken()`
- Password setup path:
  1. If `ADMIN_PASSWORD` env set: auto-setup on first init
  2. Otherwise: `POST /api/admin/auth/setup` with password

## Development Workflows

### Local Development
```bash
npm run dev                      # Hot-reload on port 3000
NODE_OPTIONS='--max-old-space-size=512' next dev  # Memory optimization (already in script)
```

### Database Operations
```bash
npm run prisma:generate         # Required after schema changes
npm run prisma:migrate:dev      # Interactive migration (LOCAL only)
npm run prisma:migrate:deploy   # Production migration
npm run prisma:push             # Quick schema sync (for dev only, non-production)
```

### Data Migration
```bash
npm run migrate:local-to-prisma:dry-run  # Preview migration without changes
npm run migrate:local-to-prisma --execute  # Execute migration (use --include-admin-auth for credentials)
```

See `/docs/local-json-to-prisma-migration.md` for detailed runbook.

### Testing
- **Backend tests:** `backend_test.py`, `admin_moderation_test.py`, `chunked_upload_test.py`
- **Test runner:** Python with `requests` library, expects `NEXT_PUBLIC_BASE_URL` env var
- **Test structure:** Each test file tests complete flow (event creation → upload → moderation)

## Project-Specific Conventions

### Naming & Slugs
- Event slugs auto-generated via `slugify()` from name (lowercase, dash-separated)
- Slug uniqueness enforced with numeric suffix (e.g., `wedding`, `wedding-2`, `wedding-3`)
- Photo IDs are UUIDs (see `/lib/server/schemas.js`)

### Error Handling
- Zod validation errors formatted as comma-separated message strings
- 404s return `{ error: 'Event not found' }` with 404 status
- 401s return `{ error: 'Admin authentication required' }`
- Storage errors propagate as 500s with descriptive messages

### File Organization
- **Client code:** `/app` (Next.js pages), `/components` (React UI components + Radix UI wrappers)
- **Server code:** `/lib/server` (API logic, repositories, auth, storage drivers)
- **Data:** `/data` (JSON files for local dev), `/public/uploads` (file storage root)
- **Migrations:** `/prisma/migrations` (auto-generated by Prisma)

### UI Components
All UI components in `/components/ui/` are Radix UI + Tailwind CSS with custom styling. Use existing button/dialog/input patterns—don't create custom components. Example: `Button`, `Dialog`, `Card`, `Badge`.

## Integration Points & Dependencies

### External Services
- **@vercel/blob:** Cloud storage (optional, enabled via `BLOB_READ_WRITE_TOKEN`)
- **PostgreSQL:** DB backend (optional, enabled via `DATABASE_URL`)
- Fallback to local storage/JSON if not configured

### Critical Dependencies
- **Next.js 14** with React 18 (client components via `'use client'`)
- **Prisma 6.9** (ORM, required if using PostgreSQL)
- **Zod** (schema validation, all API inputs validated)
- **Radix UI** (headless UI components)
- **Tailwind CSS** (styling)

### Schema Validation
All POST/PATCH requests validated via Zod schemas in `/lib/server/schemas.js`:
- `uploadInitSchema`, `uploadChunkSchema`, `uploadCompleteSchema` for uploads
- `adminModerationSchema` for status updates
- `createEventSchema`, `adminPasswordSchema` for admin operations

## Common Tasks

### Adding an API Route
1. Add handler to `/app/api/[[...path]]/route.js` in the routing switch
2. Create Zod schema in `/lib/server/schemas.js`
3. Use `json()` helper for responses (auto-sets CORS headers)
4. Check admin status via `requireAdmin()` if needed
5. Use `getGalleryRepository()` for data access (works with both drivers)

### Adding a Database Migration
1. Update `/prisma/schema.prisma`
2. Run `npm run prisma:migrate:dev --name your_migration_name`
3. Migration files auto-generated in `/prisma/migrations/`
4. For production: commit migration file, run `npm run prisma:migrate:deploy`

### Switching to PostgreSQL
1. Set `DATABASE_URL` environment variable
2. Run `npm run prisma:generate`
3. Run `npm run prisma:migrate:dev` (or `deploy` if migrations exist)
4. Optionally migrate data: `npm run migrate:local-to-prisma --execute`
5. Set `DATA_ACCESS_DRIVER=prisma` (or leave unset to auto-detect)

### Debugging Storage Issues
Check `/lib/server/storage/index.js` for driver selection logic:
- `isVercelBlobStorageConfigured()` checks `BLOB_READ_WRITE_TOKEN`
- Falls back to local storage automatically
- Storage mode displayed in `GET /api` metadata endpoint
