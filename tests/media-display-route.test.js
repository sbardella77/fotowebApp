import { describe, it, expect, beforeEach, vi } from 'vitest'

const getPrismaClientMock = vi.fn()
const checkRateLimitMock = vi.fn()
const getActiveWatermarkForOwnerIdMock = vi.fn()
const ensurePhotoWatermarkDisplayMock = vi.fn()

vi.mock('@/lib/server/prisma-client', () => ({ getPrismaClient: (...a) => getPrismaClientMock(...a) }))
vi.mock('@/lib/server/rate-limiter', () => ({
  checkRateLimit: (...a) => checkRateLimitMock(...a),
  getClientIp: () => '192.0.2.1',
  hashIdentifier: (v) => `h:${v}`,
  RATE_LIMITS: { mediaDisplayBroad: { ip: { max: 3000, window: 600000 } } },
}))
vi.mock('@/lib/server/photographer-watermark-delivery', () => ({
  getActiveWatermarkForOwnerId: (...a) => getActiveWatermarkForOwnerIdMock(...a),
}))
vi.mock('@/lib/server/photographer-watermark-derivative', async (importOriginal) => ({
  ...(await importOriginal()),
  ensurePhotoWatermarkDisplay: (...a) => ensurePhotoWatermarkDisplayMock(...a),
}))

const { GET } = await import('@/app/api/media/photos/[photoId]/display/route')

const ORIGIN = 'https://store123.public.blob.vercel-storage.com'
const PHOTO_ID = '0b7c6a52-1f3e-4f5a-9d8e-2c1b0a9f8e7d'
const REV = '0123456789abcdef'
const SPEC = { revision: REV, type: 'text', text: 'Studio', position: 'bottom-right', opacity: 0.6, sizePercent: 20 }
const PHOTO = { id: PHOTO_ID, url: `${ORIGIN}/events/e/a.jpg`, mediaType: 'IMAGE', displayDerivativeStatus: 'READY', watermarkDisplayRevision: null, event: { ownerId: 'o1' } }

let findFirst

function call(photoId = PHOTO_ID, r = REV) {
  const url = `https://snaprooms.app/api/media/photos/${photoId}/display${r === null ? '' : `?r=${r}`}`
  return GET({ url, headers: { get: () => null } }, { params: { photoId } })
}

beforeEach(() => {
  process.env.DISPLAY_DERIVATIVE_BLOB_ORIGIN = ORIGIN
  findFirst = vi.fn().mockResolvedValue(PHOTO)
  getPrismaClientMock.mockResolvedValue({ photo: { findFirst } })
  checkRateLimitMock.mockResolvedValue({ limited: false })
  getActiveWatermarkForOwnerIdMock.mockResolvedValue(SPEC)
  ensurePhotoWatermarkDisplayMock.mockReset().mockResolvedValue({ ok: true, created: true })
})

describe('GET /api/media/photos/[photoId]/display', () => {
  it('renders (or finds) the derivative and redirects to it with a long immutable cache', async () => {
    const response = await call()
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(`${ORIGIN}/derivatives/pwm-v1/${PHOTO_ID}/display-${REV}.jpg`)
    expect(response.headers.get('cache-control')).toContain('immutable')
    expect(ensurePhotoWatermarkDisplayMock).toHaveBeenCalledWith(expect.objectContaining({ spec: SPEC, photo: PHOTO }))
  })

  it('only looks up visible, READY images', async () => {
    await call()
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: PHOTO_ID, status: 'VISIBLE', mediaType: 'IMAGE', displayDerivativeStatus: 'READY' })
  })

  it.each([
    ['missing revision', PHOTO_ID, null],
    ['malformed revision', PHOTO_ID, 'XYZ'],
    ['unsafe photo id', 'a.b', REV],
  ])('400 on %s', async (_label, id, r) => {
    expect((await call(id, r)).status).toBe(400)
    expect(findFirst).not.toHaveBeenCalled()
  })

  it('404 when the photo is not eligible', async () => {
    findFirst.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
  })

  it('429 when rate limited', async () => {
    checkRateLimitMock.mockResolvedValue({ limited: true })
    expect((await call()).status).toBe(429)
  })

  it('stale revision → no-store redirect to the current URL, no rendering', async () => {
    getActiveWatermarkForOwnerIdMock.mockResolvedValue({ ...SPEC, revision: 'fedcba9876543210' })
    findFirst.mockResolvedValue({ ...PHOTO, watermarkDisplayRevision: 'fedcba9876543210' })
    const response = await call()
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(`${ORIGIN}/derivatives/pwm-v1/${PHOTO_ID}/display-fedcba9876543210.jpg`)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(ensurePhotoWatermarkDisplayMock).not.toHaveBeenCalled()
  })

  it('stale revision whose current derivative is not ready yet → 404, never a redirect loop', async () => {
    getActiveWatermarkForOwnerIdMock.mockResolvedValue({ ...SPEC, revision: 'fedcba9876543210' })
    expect((await call()).status).toBe(404)
  })

  it('watermark turned off → no-store redirect to the clean display rendition', async () => {
    getActiveWatermarkForOwnerIdMock.mockResolvedValue(null)
    const response = await call()
    expect(response.headers.get('location')).toBe(`${ORIGIN}/derivatives/display-v1/${PHOTO_ID}.jpg`)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('generation failure → retryable 503, never a clean image', async () => {
    ensurePhotoWatermarkDisplayMock.mockResolvedValue({ ok: false, created: false })
    const response = await call()
    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe('2')
    expect(response.headers.get('location')).toBeNull()
  })
})
