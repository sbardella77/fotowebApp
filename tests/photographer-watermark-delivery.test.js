import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Delivery contract of the photographer watermark: guests never receive the
// clean rendition while a watermark is active; the owner's own session does.
const verifyOwnerSessionTokenMock = vi.fn()
vi.mock('@/lib/server/owner-auth', () => ({
  OWNER_COOKIE_NAME: 'snaprooms_owner_session',
  verifyOwnerSessionToken: (...args) => verifyOwnerSessionTokenMock(...args),
}))

const { resolveGuestPhotoUrl, buildLazyWatermarkDisplayUrl } = await import('@/lib/server/guest-photo-url')
const { PWM_DISPLAY_KIND, PWM_ORIGINAL_KIND, buildPwmDisplayPath, buildPwmPhotoPrefix } = await import('@/lib/server/photographer-watermark-derivative')
const { buildDerivativePath, buildTransformLockKey } = await import('@/lib/server/download-derivative')
const { buildDisplayDerivativePath } = await import('@/lib/server/display-derivative')
const { resolveDownloadRepresentation, OriginalDownloadForbiddenError } = await import('@/lib/server/download-representation')
const { getDownloadWatermark } = await import('@/lib/server/photographer-watermark-delivery')
const { resolveEventSocialImageSafe } = await import('@/lib/server/event-social-image')
const { normalizePhotoRecord } = await import('@/lib/server/repository-mappers')
const { computeWatermarkRevision } = await import('@/lib/server/photographer-watermark-config')

const ORIGIN = 'https://store123.public.blob.vercel-storage.com'
const PHOTO_ID = '0b7c6a52-1f3e-4f5a-9d8e-2c1b0a9f8e7d'
const SPEC = Object.freeze({ revision: '0123456789abcdef', type: 'text', text: 'Studio', logoUrl: null, logoSha256: null, position: 'bottom-right', opacity: 0.6, sizePercent: 20 })

beforeEach(() => {
  process.env.DISPLAY_DERIVATIVE_BLOB_ORIGIN = ORIGIN
  verifyOwnerSessionTokenMock.mockReset()
})

afterEach(() => {
  delete process.env.DISPLAY_DERIVATIVE_BLOB_ORIGIN
})

describe('resolveGuestPhotoUrl with a watermark', () => {
  it('confirmed revision → absolute pwm display URL', () => {
    const url = resolveGuestPhotoUrl({ id: PHOTO_ID, displayDerivativeStatus: 'READY', watermarkDisplayRevision: SPEC.revision }, { watermark: SPEC })
    expect(url).toBe(`${ORIGIN}/derivatives/pwm-v1/${PHOTO_ID}/display-${SPEC.revision}.jpg`)
  })

  it.each([null, 'ffffffffffffffff'])('unconfirmed revision (%s) → same-origin lazy route', (watermarkDisplayRevision) => {
    const url = resolveGuestPhotoUrl({ id: PHOTO_ID, displayDerivativeStatus: 'READY', watermarkDisplayRevision }, { watermark: SPEC })
    expect(url).toBe(`/api/media/photos/${PHOTO_ID}/display?r=${SPEC.revision}`)
  })

  it('never returns the clean display-v1 rendition, whatever the status', () => {
    for (const displayDerivativeStatus of ['READY', 'PENDING', 'FAILED', 'LEGACY_UNVERIFIED']) {
      for (const watermarkDisplayRevision of [null, SPEC.revision, 'ffffffffffffffff']) {
        const url = resolveGuestPhotoUrl({ id: PHOTO_ID, displayDerivativeStatus, watermarkDisplayRevision }, { watermark: SPEC })
        expect(url ?? '').not.toContain('display-v1')
      }
    }
  })

  it('not READY → null, as without a watermark', () => {
    expect(resolveGuestPhotoUrl({ id: PHOTO_ID, displayDerivativeStatus: 'PENDING', watermarkDisplayRevision: SPEC.revision }, { watermark: SPEC })).toBeNull()
  })

  it('malformed revision or id → null, never a fallback', () => {
    expect(resolveGuestPhotoUrl({ id: PHOTO_ID, displayDerivativeStatus: 'READY' }, { watermark: { ...SPEC, revision: '../../x' } })).toBeNull()
    expect(resolveGuestPhotoUrl({ id: 'a/b', displayDerivativeStatus: 'READY' }, { watermark: SPEC })).toBeNull()
  })

  it('no watermark → unchanged display-v1', () => {
    expect(resolveGuestPhotoUrl({ id: PHOTO_ID, displayDerivativeStatus: 'READY' })).toBe(`${ORIGIN}/${buildDisplayDerivativePath(PHOTO_ID)}`)
  })

  it('buildLazyWatermarkDisplayUrl validates its inputs', () => {
    expect(() => buildLazyWatermarkDisplayUrl('a b', SPEC)).toThrow()
    expect(() => buildLazyWatermarkDisplayUrl(PHOTO_ID, { revision: 'nope' })).toThrow()
  })
})

describe('pwm derivative keys', () => {
  it('path and lock carry photo, variant and revision', () => {
    expect(PWM_DISPLAY_KIND.buildPath(PHOTO_ID, SPEC)).toBe(`derivatives/pwm-v1/${PHOTO_ID}/display-${SPEC.revision}.jpg`)
    expect(PWM_ORIGINAL_KIND.buildPath(PHOTO_ID, SPEC)).toBe(`derivatives/pwm-v1/${PHOTO_ID}/original-${SPEC.revision}.jpg`)
    expect(PWM_DISPLAY_KIND.buildLockKey(PHOTO_ID, SPEC)).toBe(`pwm-transform:v1:display:${SPEC.revision}:${PHOTO_ID}`)
    expect(buildPwmDisplayPath(PHOTO_ID, SPEC).startsWith(buildPwmPhotoPrefix(PHOTO_ID))).toBe(true)
  })

  it('different revisions never share a key', () => {
    const other = { ...SPEC, revision: 'fedcba9876543210' }
    expect(PWM_DISPLAY_KIND.buildPath(PHOTO_ID, other)).not.toBe(PWM_DISPLAY_KIND.buildPath(PHOTO_ID, SPEC))
    expect(PWM_DISPLAY_KIND.buildLockKey(PHOTO_ID, other)).not.toBe(PWM_DISPLAY_KIND.buildLockKey(PHOTO_ID, SPEC))
  })

  it.each([['path traversal id', '../x', SPEC], ['empty id', '', SPEC], ['bad revision', PHOTO_ID, { revision: 'ABC' }], ['missing spec', PHOTO_ID, null]])('rejects %s', (_label, id, spec) => {
    expect(() => PWM_DISPLAY_KIND.buildPath(id, spec)).toThrow()
  })

  it('existing kinds keep their exact paths and locks', () => {
    expect(buildDerivativePath(PHOTO_ID)).toBe(`derivatives/wm-v2/${PHOTO_ID}.jpg`)
    expect(buildTransformLockKey(PHOTO_ID)).toBe(`download-photo-transform:v2:${PHOTO_ID}`)
    expect(buildDisplayDerivativePath(PHOTO_ID)).toBe(`derivatives/display-v1/${PHOTO_ID}.jpg`)
  })
})

describe('resolveDownloadRepresentation with a watermark', () => {
  const photo = { id: PHOTO_ID, url: `${ORIGIN}/events/e/x.jpg`, mimeType: 'image/jpeg' }
  const resolvers = () => ({
    sourceLoader: vi.fn().mockResolvedValue(Buffer.from('source')),
    standardResolver: vi.fn().mockResolvedValue(Buffer.from('display-v1')),
    brandedResolver: vi.fn().mockResolvedValue(Buffer.from('branded')),
    watermarkDisplayResolver: vi.fn().mockResolvedValue(Buffer.from('pwm-display')),
    watermarkOriginalResolver: vi.fn().mockResolvedValue(Buffer.from('pwm-original')),
  })

  it.each([
    ['free access', { hasUnbrandedDownloads: false, canDownloadOriginal: false }],
    ['premium access', { hasUnbrandedDownloads: true, canDownloadOriginal: true }],
  ])('standard → pwm-display only (%s)', async (_label, access) => {
    const r = resolvers()
    const result = await resolveDownloadRepresentation({ photo, requestedQuality: 'standard', access, watermark: SPEC, ...r })
    expect(result).toMatchObject({ representation: 'pwm-display', contentType: 'image/jpeg', extension: '.jpg' })
    expect(result.buffer.toString()).toBe('pwm-display')
    expect(r.watermarkDisplayResolver).toHaveBeenCalledWith(expect.objectContaining({ photoId: PHOTO_ID, spec: SPEC }))
    expect(r.standardResolver).not.toHaveBeenCalled()
    expect(r.brandedResolver).not.toHaveBeenCalled()
  })

  it('original → full-resolution pwm-original, never the source bytes', async () => {
    const r = resolvers()
    const result = await resolveDownloadRepresentation({ photo, requestedQuality: 'original', access: { canDownloadOriginal: true }, watermark: SPEC, ...r })
    expect(result.representation).toBe('pwm-original')
    expect(result.buffer.toString()).toBe('pwm-original')
    expect(r.sourceLoader).not.toHaveBeenCalled()
  })

  it('original still requires entitlement', async () => {
    const r = resolvers()
    await expect(resolveDownloadRepresentation({ photo, requestedQuality: 'original', access: { canDownloadOriginal: false }, watermark: SPEC, ...r })).rejects.toBeInstanceOf(OriginalDownloadForbiddenError)
    expect(r.watermarkOriginalResolver).not.toHaveBeenCalled()
  })

  it('no watermark → unchanged behavior', async () => {
    const r = resolvers()
    const result = await resolveDownloadRepresentation({ photo, requestedQuality: 'standard', access: { hasUnbrandedDownloads: true }, ...r })
    expect(result.representation).toBe('display-v1')
    expect(r.watermarkDisplayResolver).not.toHaveBeenCalled()
  })
})

describe('getDownloadWatermark', () => {
  const owner = {
    email: 'Photo@Studio.it',
    plan: 'professional',
    subscriptionStatus: 'active',
    watermark: { enabled: true, type: 'text', text: 'Studio', logoUrl: null, logoSha256: null, position: 'bottom-right', opacityPercent: 60, sizePercent: 20 },
  }
  owner.watermark.revision = computeWatermarkRevision(owner.watermark)
  const prisma = { owner: { findUnique: vi.fn().mockResolvedValue(owner) } }
  const requestWithCookie = (value) => ({ cookies: { get: (name) => (name === 'snaprooms_owner_session' && value ? { value } : undefined) } })

  it('guest without a session → watermark', async () => {
    const spec = await getDownloadWatermark(prisma, { ownerId: 'o1' }, requestWithCookie(null))
    expect(spec?.revision).toBe(owner.watermark.revision)
    expect(verifyOwnerSessionTokenMock).not.toHaveBeenCalled()
  })

  it('the event owner (case-insensitive email) → clean', async () => {
    verifyOwnerSessionTokenMock.mockResolvedValue('photo@studio.it')
    expect(await getDownloadWatermark(prisma, { ownerId: 'o1' }, requestWithCookie('token'))).toBeNull()
  })

  it('another owner\'s session → watermark', async () => {
    verifyOwnerSessionTokenMock.mockResolvedValue('someone@else.it')
    expect(await getDownloadWatermark(prisma, { ownerId: 'o1' }, requestWithCookie('token'))).not.toBeNull()
  })

  it('invalid session → watermark', async () => {
    verifyOwnerSessionTokenMock.mockResolvedValue(null)
    expect(await getDownloadWatermark(prisma, { ownerId: 'o1' }, requestWithCookie('forged'))).not.toBeNull()
  })

  it('legacy event without ownerId → no watermark', async () => {
    expect(await getDownloadWatermark(prisma, { ownerId: null }, requestWithCookie(null))).toBeNull()
  })

  it('lookup failure propagates (the route fails instead of serving clean)', async () => {
    const failing = { owner: { findUnique: vi.fn().mockRejectedValue(new Error('db down')) } }
    await expect(getDownloadWatermark(failing, { ownerId: 'o1' }, requestWithCookie(null))).rejects.toThrow('db down')
  })
})

describe('resolveEventSocialImageSafe with a watermark', () => {
  const event = { id: 'e1' }

  it('picks only a photo with a confirmed watermarked derivative, as an absolute URL', () => {
    const photos = [
      { id: 'p1', status: 'VISIBLE', displayDerivativeStatus: 'READY', watermarkDisplayRevision: null },
      { id: 'p2', status: 'VISIBLE', displayDerivativeStatus: 'READY', watermarkDisplayRevision: SPEC.revision },
    ]
    expect(resolveEventSocialImageSafe(event, photos, { watermark: SPEC })).toBe(`${ORIGIN}/derivatives/pwm-v1/p2/display-${SPEC.revision}.jpg`)
  })

  it('no confirmed photo → null, never display-v1 or the lazy route', () => {
    const photos = [{ id: 'p1', status: 'VISIBLE', displayDerivativeStatus: 'READY', watermarkDisplayRevision: null }]
    expect(resolveEventSocialImageSafe(event, photos, { watermark: SPEC })).toBeNull()
  })
})

describe('guest DTO', () => {
  it('never exposes watermarkDisplayRevision', () => {
    const raw = { id: PHOTO_ID, url: 'x', displayDerivativeStatus: 'READY', watermarkDisplayRevision: SPEC.revision, createdAt: new Date(), updatedAt: new Date() }
    expect(normalizePhotoRecord(raw, { watermark: SPEC })).not.toHaveProperty('watermarkDisplayRevision')
    expect(normalizePhotoRecord(raw, { guestSafe: false })).not.toHaveProperty('watermarkDisplayRevision')
  })

  it('applies the watermark to the photo url', () => {
    const raw = { id: PHOTO_ID, url: 'x', displayDerivativeStatus: 'READY', watermarkDisplayRevision: SPEC.revision, createdAt: new Date(), updatedAt: new Date() }
    expect(normalizePhotoRecord(raw, { watermark: SPEC }).url).toBe(`${ORIGIN}/derivatives/pwm-v1/${PHOTO_ID}/display-${SPEC.revision}.jpg`)
  })
})
