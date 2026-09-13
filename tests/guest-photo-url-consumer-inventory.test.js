import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// TASK-03 (Phase 1A) — machine-verifiable inventory of every legitimate
// consumer of Photo.url (the original asset URL), per the Guest EXIF
// Cutover design doc's Section B delivery map.
//
// This is a STRUCTURAL/source-level guard, not a behavioral test: its job
// is to make scope creep visible. If a new file starts reading `.url` off
// a photo object, this test either needs a deliberate update (a real,
// reviewed new consumer) or it catches an accidental new leak path before
// the eventual guest DTO cutover.
//
// Target before that cutover ships: the download flow's dependency on the
// original URL is CLOSED (this file proves it, below) — the gallery
// grid/lightbox rendering dependency and the OG fallback are NOT closed
// yet (that is the cutover itself, Phase 1B+, tracked separately).

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

describe('known, audited consumers of Photo.url today (Section B of the cutover design doc)', () => {
  // Each entry: [description, file, pattern that must still match]. This
  // is an inventory, not an endorsement — several of these are exactly
  // what the eventual cutover (Phase 1B+) will change. Listing them here
  // means that change is deliberate, not accidental.
  const knownConsumers = [
    ['guest thumbnail grid', 'components/photo-gallery-grid.jsx', /src=\{photo\.url\}/],
    ['guest lightbox full view', 'components/photo-lightbox.jsx', /src=\{photo\.url\}/],
    ['OG/social preview fallback (resolveEventSocialImage, unchanged in this phase)', 'lib/server/event-social-image.js', /firstVisible\?\.url/],
    ['admin moderation queue (internal, staff-only — out of scope for guest cutover)', 'app/admin/page.js', /src=\{photo\.url\}/],
  ]

  it.each(knownConsumers)('%s (%s) still reads photo.url as expected', (_label, file, pattern) => {
    expect(read(file)).toMatch(pattern)
  })

  it('the public DTO mapper has not been repointed yet — url still passes through unchanged (explicitly NOT done in this phase)', () => {
    const src = read('lib/server/repository-mappers.js')
    // Only uploadActorType and displayDerivativeStatus are excluded;
    // url is part of ...publicPhoto, untouched.
    const fn = /export const normalizePhotoRecord[\s\S]*?\n\}\n/.exec(src)
    expect(fn).not.toBeNull()
    expect(fn[0]).toMatch(/const \{ uploadActorType, displayDerivativeStatus, \.\.\.publicPhoto \} = photo/)
    expect(fn[0]).not.toMatch(/url:/) // no manual override/repoint of url exists
  })
})

describe('the new resolver exists but is not yet wired into the public DTO (plumbing-only invariant)', () => {
  it('resolveGuestPhotoUrl is defined and exported', () => {
    const src = read('lib/server/guest-photo-url.js')
    expect(src).toMatch(/export function resolveGuestPhotoUrl/)
  })

  it('repository-mappers.js does not yet import resolveGuestPhotoUrl (confirms no premature cutover)', () => {
    const src = read('lib/server/repository-mappers.js')
    expect(src).not.toMatch(/resolveGuestPhotoUrl/)
  })
})
