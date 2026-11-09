# Photographer Watermark

> Last updated: 2026-11-05
> Scope: custom watermark for Professional/Business owners. Covers configuration, rendering, guest delivery, downloads, regeneration and cleanup.

---

## 1. What it does

An owner on the Professional, Business or legacy `pro` plan, with an active subscription, configures **one** watermark at account level (Dashboard → Account settings). It is either:
- a transparent PNG logo, or
- a text, rendered with the bundled Noto Sans font.

The owner also sets the position (four corners or center), the opacity (10–100%) and the size (5–50% of the photo width).

The watermark applies to **every image of every event** of that owner, whoever uploaded it:

| Who / what | Gets |
|---|---|
| Guests viewing the gallery | 1600px watermarked rendition |
| Guest standard download (single photo or ZIP) | 1600px watermarked rendition |
| Guest original-quality download (when entitled) | Full-resolution watermarked render |
| The event owner's own authenticated downloads | Clean files, unchanged behavior |
| Private Delivery assets, photographer upload links | Untouched: these are `PrivateAsset`s, not `Photo`s |
| Videos | Not watermarked (rendered by Mux) |
| Social preview (Open Graph) | A watermarked rendition, never a clean one |

It replaces the SnapRooms-branded download watermark wherever that would otherwise apply.

**Plan lapse.** When the subscription lapses (canceled, grace period over, or a scheduled cancellation past its period end), the watermark is **paused**: guests get the plan's normal output again. The saved configuration is kept, and the dashboard shows it as paused.

**Kill switch.** `PHOTOGRAPHER_WATERMARK_DELIVERY=off` disables delivery everywhere without a deploy.

---

## 2. Data model

- `OwnerWatermark` (one per owner) holds:
  - the configuration;
  - `revision`, a 16-hex hash;
  - `revisionChangedAt`;
  - the regeneration state (`regenState` IDLE/PENDING).
- `Photo.watermarkDisplayRevision` records the revision whose display derivative is confirmed written for that photo. NULL means none. It is internal and never appears in any API response.

## 3. Revision and cache keys

`computeWatermarkRevision` (`lib/server/photographer-watermark-config.js`) hashes every input to the rendered bytes:
- the renderer version and font id;
- the type;
- the text, or the logo's SHA-256;
- the position, opacity and size.

`enabled` is deliberately excluded, so turning the watermark off and on reuses existing renders.

Derivative path: `derivatives/pwm-v1/{photoId}/{display|original}-{revision}.jpg`

| Part | Covers |
|---|---|
| `photoId` | source bytes (immutable) |
| `pwm-v1` | pipeline constants (1600px edge, JPEG quality); bump `PWM_DERIVATIVE_VERSION` if they change |
| variant | display or full-resolution original |
| `revision` | everything about the watermark |

`createWatermarkVariantKind` (`lib/server/download-derivative.js`) builds the path, the lock key and the transform from the **same** spec object. A caller therefore cannot pair a revision with different render inputs. Orchestration (probe, lock, single-flight, put race) is the shared one every derivative uses.

If you change the renderer's output for the same config, bump `WATERMARK_RENDERER_VERSION`. If you change the font file, bump `WATERMARK_FONT_ID`.

## 4. Rendering

Rendering lives in `lib/server/photographer-watermark-render.js`:
- Text becomes glyph outlines through opentype.js. The SVG handed to Sharp contains only numeric path data, so the user's string never reaches a markup parser, and no system fonts or fontconfig are needed on Vercel.
- Logos are fetched from the Blob store and verified against the configured SHA-256 before use.
- The output is JPEG, with EXIF orientation applied and all metadata, including GPS, dropped.

The font file is `public/watermark/fonts/` (OFL). It reaches the function bundles through `outputFileTracingIncludes` in `next.config.js`.

## 5. Guest delivery

`resolveGuestPhotoUrl(photo, { watermark })` never returns the clean `display-v1` rendition while a watermark is active:
- If the column matches the current revision, it returns the absolute pwm Blob URL.
- Otherwise it returns `/api/media/photos/{id}/display?r={revision}`. That route renders once (single-flight), records the column, and redirects with a long immutable cache. A stale revision is redirected `no-store` to the current URL.

Failures never fall back to a clean image:
- If the watermark lookup fails, the request fails, or the URL is withheld.
- If the social image has no confirmed watermarked photo, no image is used.

New uploads get their watermarked rendition eagerly, from the in-memory buffer.

## 6. Regeneration

Saving a new revision, or switching the watermark on, sets `regenState = PENDING`. The cron `/api/cron/regenerate-watermark-derivatives` runs every 10 minutes:
- It renders the newest photos first, within a 240-second budget per run and at most 1500 photos.
- It sets the owner back to IDLE only when nothing is left and nothing failed. Failed photos are retried on the next run.

Until a photo is done, guests get it through the lazy route.

## 7. Cleanup

- **Lifecycle** (photo hidden or deleted, event deleted): each photo's pwm folder is listed and every pathname that parses strictly and round-trips through the builder is deleted. The photo's column is reset.
- **Sweep** (`cleanup-photo-derivatives` cron) deletes pwm objects in these cases:
  - the photo is absent or hidden;
  - the owner has no watermark;
  - the revision is not current and the change is older than 24 hours. This grace period lets in-flight ZIPs and open pages finish.

  When it deletes the object a photo's column points at, it resets the column first.
- **Logos**: `watermarks/{ownerId}/{sha16}.png` objects that no `OwnerWatermark` references are deleted after 24 hours. That includes logos uploaded for a preview and never saved.

## 8. Known limits

- The clean `display-v1` rendition still exists at a predictable path (`derivatives/display-v1/{photoId}.jpg`) for watermarked owners. It is EXIF-free and 1600px, but someone who knows the scheme can fetch it. Closing this would mean deleting `display-v1` while a watermark is active and changing what `READY` means. That is deferred.
- Text supports Latin script only (the bundled font's coverage). Other characters are rejected at validation.
- Legacy events that have only an `ownerEmail` and no `ownerId` get no watermark, consistent with entitlements.
