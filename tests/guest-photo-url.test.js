import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// TASK-03 (Phase 1A) — guest-safe photo URL resolution.
//
// This module is NOT wired into the public Photo DTO yet — these tests
// prove the resolver's own contract in isolation, ahead of that cutover.
// The single privacy-critical property is: resolveGuestPhotoUrl() can
// NEVER return anything other than a derivative URL or null — there is no
// code path, valid or misconfigured, that yields an original asset URL,
// because the function is never given one to return in the first place.

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
})

afterEach(() => {
  restoreEnv()
})

describe('getDisplayDerivativeOrigin', () => {
  it('returns the configured origin when it matches the expected shape', async () => {
    process.env.DISPLAY_DERIVATIVE_BLOB_ORIGIN = VALID_ORIGIN
    const { getDisplayDerivativeOrigin } = await import('@/lib/server/guest-photo-url')

    expect(getDisplayDerivativeOrigin()).toBe(VALID_ORIGIN)
  })

  it('throws when the env var is missing', async () => {
    delete process.env.DISPLAY_DERIVATIVE_BLOB_ORIGIN
    const { getDisplayDerivativeOrigin } = await import('@/lib/server/guest-photo-url')

    expect(() => getDisplayDerivativeOrigin()).toThrow()
  })

  it.each([
    ['http (not https)', 'http://store123.public.blob.vercel-storage.com'],
    ['wrong host suffix', 'https://store123.example.com'],
    ['trailing slash', 'https://store123.public.blob.vercel-storage.com/'],
    ['with a path', 'https://store123.public.blob.vercel-storage.com/derivatives'],
    ['with credentials', 'https://user:pass@store123.public.blob.vercel-storage.com'],
    ['with a port', 'https://store123.public.blob.vercel-storage.com:8080'],
    ['with a query string', 'https://store123.public.blob.vercel-storage.com?x=1'],
    ['empty string', ''],
  ])('throws for an invalid origin shape: %s', async (_label, value) => {
    process.env.DISPLAY_DERIVATIVE_BLOB_ORIGIN = value
    const { getDisplayDerivativeOrigin } = await import('@/lib/server/guest-photo-url')

    expect(() => getDisplayDerivativeOrigin()).toThrow()
  })
})

describe('isDisplayDerivativeOriginConfigured', () => {
  it('true when configured validly', async () => {
    process.env.DISPLAY_DERIVATIVE_BLOB_ORIGIN = VALID_ORIGIN
    const { isDisplayDerivativeOriginConfigured } = await import('@/lib/server/guest-photo-url')

    expect(isDisplayDerivativeOriginConfigured()).toBe(true)
  })

  it('false when missing, and never throws', async () => {
    delete process.env.DISPLAY_DERIVATIVE_BLOB_ORIGIN
    const { isDisplayDerivativeOriginConfigured } = await import('@/lib/server/guest-photo-url')

    expect(() => isDisplayDerivativeOriginConfigured()).not.toThrow()
    expect(isDisplayDerivativeOriginConfigured()).toBe(false)
  })
})

describe('resolveGuestPhotoUrl — status-based behavior', () => {
  beforeEach(() => {
    process.env.DISPLAY_DERIVATIVE_BLOB_ORIGIN = VALID_ORIGIN
  })

  it('READY → a deterministic derivative URL under the configured origin', async () => {
    const { resolveGuestPhotoUrl } = await import('@/lib/server/guest-photo-url')

    const url = resolveGuestPhotoUrl({ id: 'photo-abc', displayDerivativeStatus: 'READY' })

    expect(url).toBe(`${VALID_ORIGIN}/derivatives/display-v1/photo-abc.jpg`)
  })

  it('is deterministic — the same photo id always resolves to the same URL', async () => {
    const { resolveGuestPhotoUrl } = await import('@/lib/server/guest-photo-url')

    const first = resolveGuestPhotoUrl({ id: 'photo-abc', displayDerivativeStatus: 'READY' })
    const second = resolveGuestPhotoUrl({ id: 'photo-abc', displayDerivativeStatus: 'READY' })

    expect(first).toBe(second)
  })

  it.each(['PENDING', 'FAILED', 'LEGACY_UNVERIFIED'])('%s → null', async (status) => {
    const { resolveGuestPhotoUrl } = await import('@/lib/server/guest-photo-url')

    expect(resolveGuestPhotoUrl({ id: 'photo-abc', displayDerivativeStatus: status })).toBeNull()
  })

  it('an unrecognized/garbage status → null (fail closed, not fail open)', async () => {
    const { resolveGuestPhotoUrl } = await import('@/lib/server/guest-photo-url')

    expect(resolveGuestPhotoUrl({ id: 'photo-abc', displayDerivativeStatus: 'SOMETHING_UNEXPECTED' })).toBeNull()
  })

  it('null/undefined photo → null, does not throw', async () => {
    const { resolveGuestPhotoUrl } = await import('@/lib/server/guest-photo-url')

    expect(() => resolveGuestPhotoUrl(null)).not.toThrow()
    expect(resolveGuestPhotoUrl(null)).toBeNull()
    expect(resolveGuestPhotoUrl(undefined)).toBeNull()
  })
})

describe('resolveGuestPhotoUrl — fail-closed on misconfiguration', () => {
  it('READY with a missing origin config → null, not a thrown error', async () => {
    delete process.env.DISPLAY_DERIVATIVE_BLOB_ORIGIN
    const { resolveGuestPhotoUrl } = await import('@/lib/server/guest-photo-url')

    expect(() => resolveGuestPhotoUrl({ id: 'photo-abc', displayDerivativeStatus: 'READY' })).not.toThrow()
    expect(resolveGuestPhotoUrl({ id: 'photo-abc', displayDerivativeStatus: 'READY' })).toBeNull()
  })

  it('READY with an invalid origin config → null, not a thrown error', async () => {
    process.env.DISPLAY_DERIVATIVE_BLOB_ORIGIN = 'not-a-valid-origin'
    const { resolveGuestPhotoUrl } = await import('@/lib/server/guest-photo-url')

    expect(resolveGuestPhotoUrl({ id: 'photo-abc', displayDerivativeStatus: 'READY' })).toBeNull()
  })
})

describe('resolveGuestPhotoUrl — cannot return an original asset URL under any input', () => {
  beforeEach(() => {
    process.env.DISPLAY_DERIVATIVE_BLOB_ORIGIN = VALID_ORIGIN
  })

  it('the function signature never accepts photo.url — passing one has zero effect on the result', async () => {
    const { resolveGuestPhotoUrl } = await import('@/lib/server/guest-photo-url')
    const originalUrl = 'https://store123.public.blob.vercel-storage.com/events/wedding/uuid-photo.jpg'

    // Even if a caller mistakenly spreads a full Photo row (url included)
    // into this function, the result must still only ever be the
    // deterministic derivative URL or null — url is simply never read.
    const withUrl = resolveGuestPhotoUrl({ id: 'photo-abc', url: originalUrl, displayDerivativeStatus: 'READY' })
    const withoutUrl = resolveGuestPhotoUrl({ id: 'photo-abc', displayDerivativeStatus: 'READY' })

    expect(withUrl).toBe(withoutUrl)
    expect(withUrl).not.toBe(originalUrl)
    expect(withUrl).not.toContain('/events/')
  })

  it('exhaustive: across every status value, the result is never the literal string of an original-looking URL', async () => {
    const { resolveGuestPhotoUrl } = await import('@/lib/server/guest-photo-url')
    const originalUrl = 'https://store123.public.blob.vercel-storage.com/events/wedding/uuid-photo.jpg'

    for (const status of ['LEGACY_UNVERIFIED', 'PENDING', 'READY', 'FAILED', 'ANYTHING_ELSE']) {
      const result = resolveGuestPhotoUrl({ id: 'photo-abc', url: originalUrl, displayDerivativeStatus: status })
      expect(result).not.toBe(originalUrl)
      if (result !== null) {
        expect(result).toContain('/derivatives/display-v1/')
      }
    }
  })
})
