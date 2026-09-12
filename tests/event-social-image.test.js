import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// TASK-03 (Phase 1A) — no test file existed for this module before.
// Covers both the existing resolveEventSocialImage (unchanged behavior —
// this locks it down as a regression guard) and the new
// resolveEventSocialImageSafe (future policy, not yet wired into any page).

const VALID_ORIGIN = 'https://store123.public.blob.vercel-storage.com'
const ORIGINAL_ENV = { ...process.env }
const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

beforeEach(() => {
  restoreEnv()
  process.env.DISPLAY_DERIVATIVE_BLOB_ORIGIN = VALID_ORIGIN
})

afterEach(() => {
  restoreEnv()
})

const ORIGINAL_PHOTO_URL = 'https://store123.public.blob.vercel-storage.com/events/wedding/uuid-photo.jpg'

describe('resolveEventSocialImage (existing, unchanged — regression lock)', () => {
  it('null event → null', async () => {
    const { resolveEventSocialImage } = await import('@/lib/server/event-social-image')
    expect(resolveEventSocialImage(null, [])).toBeNull()
  })

  it('prefers event.socialCoverUrl over everything else', async () => {
    const { resolveEventSocialImage } = await import('@/lib/server/event-social-image')
    const event = { socialCoverUrl: 'https://example.com/social.jpg', coverUrl: 'https://example.com/cover.jpg' }
    expect(resolveEventSocialImage(event, [{ status: 'VISIBLE', url: ORIGINAL_PHOTO_URL }])).toBe('https://example.com/social.jpg')
  })

  it('falls back to event.coverUrl when no socialCoverUrl', async () => {
    const { resolveEventSocialImage } = await import('@/lib/server/event-social-image')
    const event = { coverUrl: 'https://example.com/cover.jpg' }
    expect(resolveEventSocialImage(event, [{ status: 'VISIBLE', url: ORIGINAL_PHOTO_URL }])).toBe('https://example.com/cover.jpg')
  })

  it('falls back to the first VISIBLE photo\'s ORIGINAL url when no cover exists (documented current behavior)', async () => {
    const { resolveEventSocialImage } = await import('@/lib/server/event-social-image')
    const event = {}
    const photos = [
      { status: 'HIDDEN', url: 'https://example.com/hidden.jpg' },
      { status: 'VISIBLE', url: ORIGINAL_PHOTO_URL },
    ]
    expect(resolveEventSocialImage(event, photos)).toBe(ORIGINAL_PHOTO_URL)
  })

  it('no cover and no visible photo → null', async () => {
    const { resolveEventSocialImage } = await import('@/lib/server/event-social-image')
    expect(resolveEventSocialImage({}, [{ status: 'HIDDEN', url: ORIGINAL_PHOTO_URL }])).toBeNull()
  })
})

describe('resolveEventSocialImageSafe (new — future policy, not wired into any page)', () => {
  it('null event → null', async () => {
    const { resolveEventSocialImageSafe } = await import('@/lib/server/event-social-image')
    expect(resolveEventSocialImageSafe(null, [])).toBeNull()
  })

  it('prefers event.socialCoverUrl, same as the existing resolver', async () => {
    const { resolveEventSocialImageSafe } = await import('@/lib/server/event-social-image')
    const event = { socialCoverUrl: 'https://example.com/social.jpg' }
    expect(resolveEventSocialImageSafe(event, [])).toBe('https://example.com/social.jpg')
  })

  it('falls back to event.coverUrl, same as the existing resolver', async () => {
    const { resolveEventSocialImageSafe } = await import('@/lib/server/event-social-image')
    const event = { coverUrl: 'https://example.com/cover.jpg' }
    expect(resolveEventSocialImageSafe(event, [])).toBe('https://example.com/cover.jpg')
  })

  it('a visible READY photo resolves to its derivative URL, never the original', async () => {
    const { resolveEventSocialImageSafe } = await import('@/lib/server/event-social-image')
    const event = {}
    const photos = [{ id: 'photo-1', status: 'VISIBLE', displayDerivativeStatus: 'READY', url: ORIGINAL_PHOTO_URL }]

    const result = resolveEventSocialImageSafe(event, photos)

    expect(result).toBe(`${VALID_ORIGIN}/derivatives/display-v1/photo-1.jpg`)
    expect(result).not.toBe(ORIGINAL_PHOTO_URL)
  })

  it('skips a visible photo that is not READY and moves to the next visible photo', async () => {
    const { resolveEventSocialImageSafe } = await import('@/lib/server/event-social-image')
    const event = {}
    const photos = [
      { id: 'photo-pending', status: 'VISIBLE', displayDerivativeStatus: 'PENDING', url: ORIGINAL_PHOTO_URL },
      { id: 'photo-ready', status: 'VISIBLE', displayDerivativeStatus: 'READY', url: ORIGINAL_PHOTO_URL },
    ]

    expect(resolveEventSocialImageSafe(event, photos)).toBe(`${VALID_ORIGIN}/derivatives/display-v1/photo-ready.jpg`)
  })

  it('skips HIDDEN photos even if their status happens to be READY', async () => {
    const { resolveEventSocialImageSafe } = await import('@/lib/server/event-social-image')
    const event = {}
    const photos = [{ id: 'photo-1', status: 'HIDDEN', displayDerivativeStatus: 'READY', url: ORIGINAL_PHOTO_URL }]

    expect(resolveEventSocialImageSafe(event, photos)).toBeNull()
  })

  it.each(['PENDING', 'FAILED', 'LEGACY_UNVERIFIED'])(
    'no cover, only a visible %s photo, no READY photo anywhere → null (never the original)',
    async (status) => {
      const { resolveEventSocialImageSafe } = await import('@/lib/server/event-social-image')
      const event = {}
      const photos = [{ id: 'photo-1', status: 'VISIBLE', displayDerivativeStatus: status, url: ORIGINAL_PHOTO_URL }]

      expect(resolveEventSocialImageSafe(event, photos)).toBeNull()
    },
  )

  it('never returns an original Photo.url under any combination of inputs (exhaustive sweep)', async () => {
    const { resolveEventSocialImageSafe } = await import('@/lib/server/event-social-image')
    const statuses = ['LEGACY_UNVERIFIED', 'PENDING', 'READY', 'FAILED']
    const visibilities = ['VISIBLE', 'HIDDEN']

    for (const status of statuses) {
      for (const visibility of visibilities) {
        const result = resolveEventSocialImageSafe({}, [
          { id: 'photo-1', status: visibility, displayDerivativeStatus: status, url: ORIGINAL_PHOTO_URL },
        ])
        expect(result).not.toBe(ORIGINAL_PHOTO_URL)
      }
    }
  })

  it('a misconfigured derivative origin degrades to null, not to the original photo', async () => {
    delete process.env.DISPLAY_DERIVATIVE_BLOB_ORIGIN
    const { resolveEventSocialImageSafe } = await import('@/lib/server/event-social-image')
    const photos = [{ id: 'photo-1', status: 'VISIBLE', displayDerivativeStatus: 'READY', url: ORIGINAL_PHOTO_URL }]

    expect(resolveEventSocialImageSafe({}, photos)).toBeNull()
  })
})
