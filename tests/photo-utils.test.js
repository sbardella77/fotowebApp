import { describe, it, expect } from 'vitest'
import { getRenderablePhotos, normalizePublicPhoto } from '@/lib/photo-utils'

// Guest EXIF Safe Delivery Cutover: normalizePublicPhoto must treat
// `url: null` (the guest-safe DTO's explicit "no derivative yet" signal
// for PENDING/FAILED/LEGACY_UNVERIFIED) as a VALID, renderable state — not
// malformed data to drop. This keeps the grid/lightbox's index alignment
// intact (a non-READY photo stays in the list, rendered as a placeholder,
// instead of silently vanishing) and preserves every pre-existing rejection
// rule for genuinely malformed url values.

function makePhoto(overrides = {}) {
  return {
    id: 'photo-1',
    url: 'https://store.public.blob.vercel-storage.com/derivatives/display-v1/photo-1.jpg',
    originalName: 'photo.jpg',
    mimeType: 'image/jpeg',
    status: 'VISIBLE',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('normalizePublicPhoto — explicit null url (no safe derivative yet)', () => {
  it('a null url is kept as a valid, renderable photo with url: null', () => {
    const result = normalizePublicPhoto(makePhoto({ url: null }))
    expect(result).not.toBeNull()
    expect(result.url).toBeNull()
    expect(result.id).toBe('photo-1')
  })

  it('an undefined url is treated the same as null', () => {
    const photo = makePhoto()
    delete photo.url
    const result = normalizePublicPhoto(photo)
    expect(result).not.toBeNull()
    expect(result.url).toBeNull()
  })

  it('a valid string url still resolves to its trimmed value, unchanged', () => {
    const result = normalizePublicPhoto(makePhoto())
    expect(result.url).toBe('https://store.public.blob.vercel-storage.com/derivatives/display-v1/photo-1.jpg')
  })

  it('an empty string url is still rejected (malformed, not the explicit "no derivative" signal)', () => {
    expect(normalizePublicPhoto(makePhoto({ url: '' }))).toBeNull()
  })

  it('a whitespace-only url is still rejected', () => {
    expect(normalizePublicPhoto(makePhoto({ url: '   ' }))).toBeNull()
  })

  it('a non-string, non-null/undefined url (e.g. a number or object) is still rejected', () => {
    expect(normalizePublicPhoto(makePhoto({ url: 12345 }))).toBeNull()
    expect(normalizePublicPhoto(makePhoto({ url: {} }))).toBeNull()
  })

  it('a suspicious url prefix is still rejected, same as before', () => {
    expect(normalizePublicPhoto(makePhoto({ url: 'javascript:alert(1)' }))).toBeNull()
  })
})

describe('getRenderablePhotos — mixed READY/non-READY population stays index-aligned', () => {
  it('keeps non-READY (null url) photos in the list rather than dropping them', () => {
    const photos = [
      makePhoto({ id: 'p1', url: 'https://store.public.blob.vercel-storage.com/derivatives/display-v1/p1.jpg' }),
      makePhoto({ id: 'p2', url: null }),
      makePhoto({ id: 'p3', url: 'https://store.public.blob.vercel-storage.com/derivatives/display-v1/p3.jpg' }),
    ]

    const renderable = getRenderablePhotos(photos)

    expect(renderable).toHaveLength(3)
    expect(renderable.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
    expect(renderable[1].url).toBeNull()
  })

  it('still drops a genuinely malformed photo (missing id) even alongside valid null-url photos', () => {
    const photos = [makePhoto({ id: 'p1', url: null }), { url: null }]
    const renderable = getRenderablePhotos(photos)
    expect(renderable).toHaveLength(1)
    expect(renderable[0].id).toBe('p1')
  })
})
