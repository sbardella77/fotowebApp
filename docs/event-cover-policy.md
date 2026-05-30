# Event Cover Policy

> Last updated: 2026-05-29
> Scope: SnapRooms event cover storage, UI fallback chain, and social preview architecture.

---

## 1. What is an event cover?

An **event cover** is the primary visual representation of a room/event. It is displayed in:
- Dashboard event cards
- Event detail panel hero
- Future social sharing previews

### Three kinds of cover

| Kind | Description | Source |
|------|-------------|--------|
| **Manual cover** | Owner-uploaded image via cover editor | `event.coverUrl` |
| **Photo fallback** | Most recent visible guest photo | `photos[0]` (VISIBLE only) |
| **Social cover** *(future)* | Dedicated Open Graph image (different crop) | `event.socialCoverUrl` (not yet in schema) |

---

## 2. Fallback chain

### Dashboard / Card / Detail Panel

```
event.coverUrl
  → first VISIBLE photo (by createdAt desc)
  → placeholder gradient
```

### Social Preview / Open Graph *(future-ready)*

```
event.socialCoverUrl   (field reserved for future migration)
  → event.coverUrl
  → first VISIBLE photo
  → default OG image
```

**Never use:**
- Hidden or rejected photos
- Private delivery assets
- Photographer upload files
- External unmanaged URLs

---

## 3. Storage safety rule

### Delete only what you own

A cover file must **only** be deleted from storage when **all** of these are true:
1. The URL is a string and not empty
2. The URL contains the exact path pattern: `/covers/{slug}/`
3. The slug matches the event being modified

### When to delete

| Action | Cleanup? |
|--------|----------|
| Replace cover (upload new) | ✅ Delete old managed cover **after** DB update succeeds |
| Remove cover (set `coverUrl = null`) | ✅ Delete managed cover before DB update |
| Delete event | ✅ Delete managed cover alongside photos & private assets |

### When NOT to delete

| URL type | Reason |
|----------|--------|
| Guest photo URL (`/photos/...`) | Not a cover; belongs to guest content |
| Private delivery asset | Separate lifecycle |
| Photographer upload asset | Separate lifecycle |
| External URL (e.g. CDN) | Not owned by SnapRooms storage |
| `null` / `undefined` | Nothing to delete |

### Failure handling

Storage delete failures are **logged** and **ignored**. They must never:
- Block a DB update
- Return an error to the user
- Roll back a successful operation

Use `deleteManagedEventCover(url, slug)` from `lib/server/event-cover-storage.js` which enforces the safety rule.

---

## 4. Cover optimization

### Dashboard / Card target

- **Ratio:** 16:9
- **Resolution:** 1200 × 675
- **Format:** WebP
- **Quality:** 80
- **Path:** `covers/{slug}/{timestamp}-cover.webp`

The server-side upload pipeline (`uploadEventCover`) runs the buffer through `sharp` when available. If `sharp` is unavailable or the optimization fails, the original buffer is uploaded unchanged so the user flow never breaks.

### Open Graph target *(future)*

- **Ratio:** 1.91:1
- **Resolution:** 1200 × 630
- **Format:** WebP or JPEG
- **Path:** `covers/{slug}/{timestamp}-social.webp` *(future)*

For now, the social preview helper (`resolveEventSocialImage`) reuses the optimized dashboard cover. A dedicated social cover can be introduced later without breaking existing URLs.

---

## 5. Implementation references

| File | Responsibility |
|------|----------------|
| `lib/server/event-cover-storage.js` | `isManagedEventCoverUrl`, `deleteManagedEventCover`, `getCoverStoragePath`, `optimizeCoverBuffer` |
| `lib/server/event-social-image.js` | `resolveEventSocialImage(event, visiblePhotos)` — future-proof fallback chain |
| `app/api/[[...path]]/route.js` | Upload, replace, remove, delete-event cover flows |
| `app/dashboard/components/event-card.jsx` | Card cover rendering + photo fallback |
| `app/dashboard/components/event-detail-panel.jsx` | Hero cover rendering + visible-photo fallback |
| `app/event/[slug]/page.js` | Server-side Open Graph metadata generation |

---

## 6. Checklist for future cover changes

Before modifying any cover-related code, verify:

- [ ] Does the change respect the storage safety rule (`/covers/{slug}/`)?
- [ ] Are storage delete failures caught and logged without blocking the user?
- [ ] Does the UI fallback chain still prefer `coverUrl` → VISIBLE photo → placeholder?
- [ ] If adding a new cover variant, does it reuse `getCoverStoragePath`?
- [ ] If changing image dimensions, are both dashboard (16:9) and social (1.91:1) targets documented?
- [ ] Does `resolveEventSocialImage` still return a valid fallback chain?
- [ ] Are hidden/rejected photos excluded from all cover fallbacks?

---

## 7. Limits & notes

- **Sharp availability:** Optimization is best-effort. The system works without `sharp` (falls back to original buffer).
- **Vercel Blob:** Cover storage relies on Vercel Blob (`put` + `deleteStoredFile`). Local development falls back to local storage driver automatically.
- **No schema migration yet:** `socialCoverUrl` is not in the Prisma schema. The helper is already future-proofed for it.
