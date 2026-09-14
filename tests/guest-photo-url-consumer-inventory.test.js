import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Guest EXIF Safe Delivery Cutover — machine-verifiable inventory of every
// consumer of Photo.url (the original asset URL), per the cutover's
// Section B delivery map. Originally written in TASK-03 Phase 1A as a
// snapshot of the PRE-cutover state (deliberately asserting the leak paths
// were still open, so this file itself proved nothing was cut over early).
// This revision flips those assertions to the POST-cutover state: the
// gallery grid, lightbox, and OG fallback are now closed, same as the
// download flow already was.
//
// This is a STRUCTURAL/source-level guard, not a behavioral test: its job
// is to make scope creep visible. If a new file starts reading `.url` off
// a photo object and rendering/returning it unconditionally to a guest, this
// test either needs a deliberate, reviewed update, or it catches an
// accidental new leak path. See tests/repository-mappers.test.js and
// tests/event-social-image.test.js for the corresponding BEHAVIORAL proofs
// (real function calls, real return values) that back these structural
// assertions.

const read = (relPath) => readFileSync(resolve(import.meta.dirname, '..', relPath), 'utf8')

describe('download flow no longer requires the original Photo.url (TASK-03 Phase 1A target)', () => {
  it('app/api/download/photo/route.js accepts photoId, not photoUrl/eventSlug, from the client', () => {
    const src = read('app/api/download/photo/route.js')

    expect(src).toMatch(/searchParams\.get\('photoId'\)/)
    expect(src).not.toMatch(/searchParams\.get\('photoUrl'\)/)
    expect(src).not.toMatch(/searchParams\.get\('eventSlug'\)/)
  })

  it('the photo lookup filters by id + status only — no client-supplied url or eventSlug in the WHERE clause', () => {
    const src = read('app/api/download/photo/route.js')
    const findFirst = /prisma\.photo\.findFirst\(\{[\s\S]*?\n\s*\}\)/.exec(src)

    expect(findFirst).not.toBeNull()
    expect(findFirst[0]).toMatch(/where:\s*\{\s*id:\s*photoId,\s*status:\s*'VISIBLE',?\s*\}/)
  })

  it('components/photo-lightbox.jsx constructs the download request from photo.id, not photo.url', () => {
    const src = read('components/photo-lightbox.jsx')

    expect(src).toMatch(/photoId=\$\{encodeURIComponent\(photo\.id\)\}/)
    expect(src).not.toMatch(/photoUrl=\$\{encodeURIComponent\(photo\.url\)\}/)
  })
})

describe('guest-facing consumers now render/resolve through resolveGuestPhotoUrl — never the original (post-cutover state)', () => {
  it('components/photo-gallery-grid.jsx only renders photo.url inside an explicit truthiness-gated branch, with a non-original placeholder for the else case', () => {
    const src = read('components/photo-gallery-grid.jsx')
    expect(src).toMatch(/\{photo\.url \? \(/)
    expect(src).toMatch(/src=\{photo\.url\}/)
    // Anchor on the unique `{photo.url ? (` opener so this only inspects
    // OUR new conditional, not the component's pre-existing, unrelated
    // ImageWithLazyLoad onError placeholder (which also uses <ImageOff>).
    const conditional = /\{photo\.url \? \([\s\S]*?<ImageOff[\s\S]*?\)\}/.exec(src)
    expect(conditional).not.toBeNull()
    // The else branch (after the `) : (`) must not read any other
    // url-shaped field as a fallback source.
    const elseBranch = conditional[0].slice(conditional[0].indexOf(') : ('))
    expect(elseBranch).not.toMatch(/\.url/)
  })

  it('components/photo-lightbox.jsx only renders photo.url inside an explicit truthiness-gated branch, with a non-original "unavailable" state for the else case', () => {
    const src = read('components/photo-lightbox.jsx')
    expect(src).toMatch(/\{photo\.url \? \(/)
    expect(src).toMatch(/src=\{photo\.url\}/)
    const conditional = /\{photo\.url \? \([\s\S]*?<ImageOff[\s\S]*?\)\}/.exec(src)
    expect(conditional).not.toBeNull()
    const elseBranch = conditional[0].slice(conditional[0].indexOf(') : ('))
    expect(elseBranch).not.toMatch(/\.url/)
  })

  it('neither component contains an original-fallback pattern (|| photo.url, ?? photo.url, or any *Url fallback chain)', () => {
    for (const file of ['components/photo-gallery-grid.jsx', 'components/photo-lightbox.jsx']) {
      const src = read(file)
      expect(src).not.toMatch(/\|\|\s*photo\.url/)
      expect(src).not.toMatch(/\?\?\s*photo\.url/)
      expect(src).not.toMatch(/photo\.originalUrl/)
      expect(src).not.toMatch(/photo\.sourceUrl/)
    }
  })

  it('the live OG resolver (app/event/[slug]/page.js) uses resolveEventSocialImageSafe, not the old unsafe resolveEventSocialImage', () => {
    const src = read('app/event/[slug]/page.js')
    expect(src).toMatch(/resolveEventSocialImageSafe/)
    expect(src).not.toMatch(/\bresolveEventSocialImage\(/) // old unsafe call — not this app's wiring
    expect(src).not.toMatch(/getVisiblePhotosForSocialImage[\s\S]*?event\.photos\b/) // must not feed the already-normalized DTO shape back in
  })

  it('the old resolveEventSocialImage (firstVisible?.url fallback) still exists but has zero live callers outside its own module and its own regression test', () => {
    // Deliberately NOT deleted: TASK-03 Phase 1A kept it, with its own
    // dedicated regression-lock tests, as a documented historical record of
    // the pre-cutover behavior. Its ONLY job now is to prove it is well
    // and truly disconnected from any real request path.
    const socialImageSrc = read('lib/server/event-social-image.js')
    expect(socialImageSrc).toMatch(/export function resolveEventSocialImage\(/)

    const callers = [
      'app/event/[slug]/page.js',
      'components/room-page-client.jsx',
      'app/api/[[...path]]/route.js',
    ]
    for (const file of callers) {
      expect(read(file)).not.toMatch(/resolveEventSocialImage\(/)
    }
  })

  it('admin moderation queue (internal, staff-only, separately authenticated) still legitimately reads photo.url unconditionally — out of scope for guest cutover', () => {
    const src = read('app/admin/page.js')
    expect(src).toMatch(/src=\{photo\.url\}/)
  })

  it('the public DTO mapper is now repointed: normalizePhotoRecord imports and uses resolveGuestPhotoUrl, defaulting to guestSafe: true', () => {
    const src = read('lib/server/repository-mappers.js')
    expect(src).toMatch(/import \{ resolveGuestPhotoUrl \} from ['"]@\/lib\/server\/guest-photo-url['"]/)

    const fn = /export const normalizePhotoRecord[\s\S]*?\n\}\n/.exec(src)
    expect(fn).not.toBeNull()
    expect(fn[0]).toMatch(/guestSafe = true/)
    expect(fn[0]).toMatch(/resolveGuestPhotoUrl\(/)
  })

  it('the paginated guest photo feed (getEventPhotosPaginated) maps url through resolveGuestPhotoUrl, not a raw select passthrough', () => {
    const src = read('lib/server/prisma-gallery-repository.js')
    const fn = /async getEventPhotosPaginated[\s\S]*?\n  \},/.exec(src)
    expect(fn).not.toBeNull()
    expect(fn[0]).toMatch(/displayDerivativeStatus: true/) // fetched so it CAN be resolved
    expect(fn[0]).toMatch(/resolveGuestPhotoUrl\(/)
  })

  it('the public event-listing latestPhotoUrl fields (listEvents, getEventBySlug public path) resolve through resolveGuestPhotoUrl, never a raw passthrough', () => {
    const src = read('lib/server/prisma-gallery-repository.js')
    const listEventsFn = /async listEvents\(\)[\s\S]*?\n  \},/.exec(src)
    expect(listEventsFn).not.toBeNull()
    expect(listEventsFn[0]).toMatch(/resolveGuestPhotoUrl\(/)
    expect(listEventsFn[0]).not.toMatch(/event\.photos\[0\]\?\.url \|\| null/)

    const getEventBySlugFn = /async getEventBySlug\(slug, options[\s\S]*?\n  \},/.exec(src)
    expect(getEventBySlugFn).not.toBeNull()
    expect(getEventBySlugFn[0]).toMatch(/resolveGuestPhotoUrl\(/)
  })

  it('owner-authenticated paths (getEventBySlugAndOwner, listEventsByOwnerEmail) explicitly opt out with guestSafe: false, preserving their real-original-url contract', () => {
    const src = read('lib/server/prisma-gallery-repository.js')
    const ownerFn = /async getEventBySlugAndOwner[\s\S]*?\n  \},/.exec(src)
    expect(ownerFn).not.toBeNull()
    expect(ownerFn[0]).toMatch(/guestSafe: false/)

    const listByOwnerFn = /async listEventsByOwnerEmail[\s\S]*?\n  \},/.exec(src)
    expect(listByOwnerFn).not.toBeNull()
    expect(listByOwnerFn[0]).toMatch(/guestSafe: false/)
  })
})
