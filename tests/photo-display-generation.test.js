import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import sharp from 'sharp'

// STEP 7.15e — eager, best-effort display-v1 generation for new Photos, and
// regeneration when a Photo returns to VISIBLE.
//
// This file covers the route-level wiring: does the right generation call
// happen, with the right photo, strictly after the right DB commit, without
// ever being able to turn a successful Photo write into a failed response.
// The derivative engine itself (probe/lock/waiter/single-flight/put-race,
// including ensure-mode's HIT/MISS/created semantics) is covered exhaustively
// in tests/display-derivative.test.js — not re-proven here.

const ALLOWED_ORIGIN = 'https://snaprooms.app'
const EVENT_ID = 'event-guest-1'
const SLUG = 'wedding-2026'
const PHOTO_ID = 'photo-1'
const PHOTO_URL = 'https://store.public.blob.vercel-storage.com/events/wedding-2026/photo-1.jpg'

vi.mock('@upstash/redis', () => ({ Redis: vi.fn() }))

vi.mock('@vercel/blob', () => ({
  head: vi.fn(),
  BlobError: class BlobError extends Error {},
}))

// `blobUploadSession.findUnique` is the pre-resolution rate-limiter lookup
// that runs BEFORE completeRoomPhotoBlobUpload (which is mocked wholesale
// below and never touches this client for real) — it just needs to resolve
// a plausible ROOM_PHOTO session so that pre-check passes.
//
// vi.hoisted is required here (not a plain top-level const): vi.mock
// factories are hoisted above all other module code, so a factory that
// references an ordinary top-level variable would run before that
// variable is initialized.
const { photoUpdateManyMock } = vi.hoisted(() => ({ photoUpdateManyMock: vi.fn().mockResolvedValue({ count: 1 }) }))

vi.mock('@/lib/server/prisma-client', () => ({
  getPrismaClient: vi.fn().mockResolvedValue({
    blobUploadSession: {
      findUnique: vi.fn().mockResolvedValue({ eventId: 'event-guest-1', uploadKind: 'ROOM_PHOTO' }),
    },
    photo: {
      updateMany: photoUpdateManyMock,
    },
  }),
  getAdminAuthDriver: vi.fn().mockReturnValue('env'),
  getDataAccessDriver: vi.fn().mockReturnValue('local'),
}))

vi.mock('@/lib/server/gallery-repository', () => ({
  getGalleryRepository: vi.fn(),
  getGalleryRepositoryMode: vi.fn().mockResolvedValue('local'),
}))

vi.mock('@/lib/server/storage', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    getStorageDriver: vi.fn().mockReturnValue({ mode: 'vercel-blob' }),
    localStorageDriver: { ...actual.localStorageDriver, completeUploadSession: vi.fn() },
  }
})

vi.mock('@/lib/server/blob-upload-completion', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, completeRoomPhotoBlobUpload: vi.fn() }
})

vi.mock('@/lib/server/display-derivative', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, ensureDisplayDerivative: vi.fn() }
})

vi.mock('@/lib/server/download-utils', () => ({
  getPhotoBuffer: vi.fn().mockResolvedValue(Buffer.from('source-bytes')),
}))

import { POST } from '@/app/api/[[...path]]/route'
import { getGalleryRepository } from '@/lib/server/gallery-repository'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { getStorageDriver, localStorageDriver } from '@/lib/server/storage'
import { completeRoomPhotoBlobUpload } from '@/lib/server/blob-upload-completion'
import { ensureDisplayDerivative } from '@/lib/server/display-derivative'
import { getPhotoBuffer } from '@/lib/server/download-utils'

// A real, Sharp-decodable JPEG (STEP 7.15g) — the local path's
// source-integrity validation is real code here (unlike the Blob path,
// whose completeRoomPhotoBlobUpload — and therefore its own internal
// validation call — is wholesale-mocked above), so getPhotoBuffer's default
// resolved value must be a genuinely valid image for local-path tests that
// expect completion to succeed.
const VALID_JPEG_BUFFER = await sharp({
  create: { width: 4, height: 4, channels: 3, background: { r: 90, g: 90, b: 90 } },
})
  .jpeg({ quality: 82 })
  .toBuffer()

const ORIGINAL_ENV = { ...process.env }
const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

function makeRequest(body, { path = ['uploads', 'complete'] } = {}) {
  return {
    request: {
      method: 'POST',
      headers: {
        get: (name) => {
          if (name === 'origin') return ALLOWED_ORIGIN
          if (name === 'x-forwarded-for') return '198.51.100.30'
          return null
        },
      },
      cookies: { get: () => undefined },
      json: async () => body,
    },
    params: { path },
  }
}

const doComplete = (body, opts) => {
  const { request, params } = makeRequest(body, opts)
  return POST(request, { params })
}

function makePhotoRepository(overrides = {}) {
  return {
    getEventBySlug: vi.fn().mockResolvedValue({ id: EVENT_ID, slug: SLUG }),
    createPhoto: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  restoreEnv()
  process.env.ALLOWED_ORIGINS = ALLOWED_ORIGIN
  getStorageDriver.mockReturnValue({ mode: 'vercel-blob' })
  ensureDisplayDerivative.mockResolvedValue({ created: true })
  getGalleryRepository.mockResolvedValue(makePhotoRepository())
})

afterEach(() => {
  restoreEnv()
})

// ─── §44 New Photo eager test — Blob ROOM_PHOTO completion ─────────────────

describe('§44 Blob ROOM_PHOTO completion: eager generation ordering and count', () => {
  it('Photo transaction commit happens BEFORE ensureDisplayDerivative, exactly one attempt, response contract unchanged', async () => {
    const order = []
    completeRoomPhotoBlobUpload.mockImplementation(async () => {
      order.push('commit')
      return { photo: { id: PHOTO_ID, url: PHOTO_URL }, eventSlug: SLUG, idempotent: false }
    })
    ensureDisplayDerivative.mockImplementation(async () => {
      order.push('ensure')
      return { created: true }
    })

    const response = await doComplete({ sessionId: 'session-abc12345' })
    const body = await response.json()

    expect(order).toEqual(['commit', 'ensure'])
    expect(ensureDisplayDerivative).toHaveBeenCalledTimes(1)
    expect(ensureDisplayDerivative.mock.calls[0][0].photoId).toBe(PHOTO_ID)
    expect(response.status).toBe(201)
    expect(body.photo.id).toBe(PHOTO_ID)
    expect(body.idempotent).toBe(false)
  })

  it('STEP 7.15g: result.sourceBuffer is reused for ensure and never leaks into the HTTP response', async () => {
    const validatedBuffer = Buffer.from('already-fetched-and-validated-pixel-bytes')
    completeRoomPhotoBlobUpload.mockResolvedValue({
      photo: { id: PHOTO_ID, url: PHOTO_URL },
      eventSlug: SLUG,
      idempotent: false,
      sourceBuffer: validatedBuffer,
    })
    let capturedGetSourceBuffer
    ensureDisplayDerivative.mockImplementation(async ({ getSourceBuffer }) => {
      capturedGetSourceBuffer = getSourceBuffer
      return { created: true }
    })

    const response = await doComplete({ sessionId: 'session-abc12345' })
    const rawBody = await response.text()

    // Reused, not re-fetched.
    expect(getPhotoBuffer).not.toHaveBeenCalled()
    expect(await capturedGetSourceBuffer()).toBe(validatedBuffer)

    // Never serialized into the response, in any shape.
    expect(rawBody).not.toContain('already-fetched-and-validated-pixel-bytes')
    const body = JSON.parse(rawBody)
    expect(body.sourceBuffer).toBeUndefined()
    expect(Object.keys(body)).toEqual(['photo', 'event', 'idempotent'])
  })
})

// ─── §46 Photo creation failure ──────────────────────────────────────────────

describe('§46 Photo creation failure: zero generation attempts', () => {
  it('completeRoomPhotoBlobUpload rejecting means ensureDisplayDerivative is never called', async () => {
    completeRoomPhotoBlobUpload.mockRejectedValue(new Error('transaction failed'))

    await expect(doComplete({ sessionId: 'session-abc12345' })).rejects.toThrow('transaction failed')

    expect(ensureDisplayDerivative).not.toHaveBeenCalled()
  })
})

// ─── §47 Generation failure isolation ────────────────────────────────────────

describe('§47 generation failure does not affect upload completion success', () => {
  it('Photo commit succeeds, ensureDisplayDerivative throws, completion still returns success with the photo', async () => {
    completeRoomPhotoBlobUpload.mockResolvedValue({
      photo: { id: PHOTO_ID, url: PHOTO_URL },
      eventSlug: SLUG,
      idempotent: false,
    })
    ensureDisplayDerivative.mockRejectedValue(new Error('blob boom'))

    // ensurePhotoDisplayDerivative (the route-local helper) catches this
    // internally — it must never propagate.
    const response = await doComplete({ sessionId: 'session-abc12345' })
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.photo.id).toBe(PHOTO_ID)
  })
})

// ─── §49 TASK-02: displayDerivativeStatus recording (Blob path) ────────────

describe('§49 TASK-02: successful generation records displayDerivativeStatus = READY', () => {
  it('a fresh (created:true) generation records READY for exactly this photo id', async () => {
    completeRoomPhotoBlobUpload.mockResolvedValue({
      photo: { id: PHOTO_ID, url: PHOTO_URL },
      eventSlug: SLUG,
      idempotent: false,
    })
    ensureDisplayDerivative.mockResolvedValue({ created: true })

    const response = await doComplete({ sessionId: 'session-abc12345' })

    expect(response.status).toBe(201)
    expect(photoUpdateManyMock).toHaveBeenCalledTimes(1)
    expect(photoUpdateManyMock).toHaveBeenCalledWith({
      where: { id: PHOTO_ID },
      data: { displayDerivativeStatus: 'READY' },
    })
  })

  it('a cache-HIT (created:false, no error) ALSO records READY — a HIT means the derivative genuinely exists', async () => {
    completeRoomPhotoBlobUpload.mockResolvedValue({
      photo: { id: PHOTO_ID, url: PHOTO_URL },
      eventSlug: SLUG,
      idempotent: false,
    })
    ensureDisplayDerivative.mockResolvedValue({ created: false })

    await doComplete({ sessionId: 'session-abc12345' })

    expect(photoUpdateManyMock).toHaveBeenCalledWith({
      where: { id: PHOTO_ID },
      data: { displayDerivativeStatus: 'READY' },
    })
  })
})

describe('§49 TASK-02: generation failure records displayDerivativeStatus = FAILED, never READY', () => {
  it('ensureDisplayDerivative throwing records FAILED, and READY is never written for this photo', async () => {
    completeRoomPhotoBlobUpload.mockResolvedValue({
      photo: { id: PHOTO_ID, url: PHOTO_URL },
      eventSlug: SLUG,
      idempotent: false,
    })
    ensureDisplayDerivative.mockRejectedValue(new Error('blob boom'))

    const response = await doComplete({ sessionId: 'session-abc12345' })

    // The HTTP contract is unaffected (§47) — re-asserted here alongside the
    // status-recording proof so the two are never allowed to drift apart.
    expect(response.status).toBe(201)
    expect(photoUpdateManyMock).toHaveBeenCalledTimes(1)
    expect(photoUpdateManyMock).toHaveBeenCalledWith({
      where: { id: PHOTO_ID },
      data: { displayDerivativeStatus: 'FAILED' },
    })
    expect(photoUpdateManyMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { displayDerivativeStatus: 'READY' } }),
    )
  })

  it('a status-recording DB failure itself never propagates into the HTTP response', async () => {
    completeRoomPhotoBlobUpload.mockResolvedValue({
      photo: { id: PHOTO_ID, url: PHOTO_URL },
      eventSlug: SLUG,
      idempotent: false,
    })
    ensureDisplayDerivative.mockResolvedValue({ created: true })
    photoUpdateManyMock.mockRejectedValueOnce(new Error('db unavailable'))

    const response = await doComplete({ sessionId: 'session-abc12345' })
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.photo.id).toBe(PHOTO_ID)
  })
})

// ─── §22/§23 idempotent completion retry ─────────────────────────────────────

describe('§22/§23 idempotent completion retry gets a fresh (cheap) ensure attempt', () => {
  it('an idempotent retry (Photo already committed) still calls ensureDisplayDerivative once', async () => {
    completeRoomPhotoBlobUpload.mockResolvedValue({
      photo: { id: PHOTO_ID, url: PHOTO_URL },
      eventSlug: SLUG,
      idempotent: true,
    })

    const response = await doComplete({ sessionId: 'session-abc12345' })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.idempotent).toBe(true)
    expect(ensureDisplayDerivative).toHaveBeenCalledTimes(1)
    expect(ensureDisplayDerivative.mock.calls[0][0].photoId).toBe(PHOTO_ID)
  })
})

// ─── §11 source-reader chokepoint ────────────────────────────────────────────

describe('§11 the getSourceBuffer passed to ensureDisplayDerivative resolves via getPhotoBuffer(photo.url)', () => {
  it('never fetches photo.url directly — always through the getPhotoBuffer chokepoint', async () => {
    completeRoomPhotoBlobUpload.mockResolvedValue({
      photo: { id: PHOTO_ID, url: PHOTO_URL },
      eventSlug: SLUG,
      idempotent: false,
    })
    ensureDisplayDerivative.mockImplementation(async ({ getSourceBuffer }) => {
      await getSourceBuffer()
      return { created: true }
    })

    await doComplete({ sessionId: 'session-abc12345' })

    expect(getPhotoBuffer).toHaveBeenCalledTimes(1)
    expect(getPhotoBuffer).toHaveBeenCalledWith(PHOTO_URL)
  })
})

// ─── §45 Local fallback eager test ───────────────────────────────────────────

describe('§45 local/chunk fallback: eager generation ordering and count', () => {
  beforeEach(() => {
    getStorageDriver.mockReturnValue({ mode: 'local' })
    // The local path's optional entitlement check only runs `if (prisma)` —
    // skip it here, it is unrelated to display generation.
    getPrismaClient.mockResolvedValue(null)
    // Real source-integrity validation runs on this path (STEP 7.15g) — the
    // outer default (plain text) would fail it, so give it real image bytes.
    getPhotoBuffer.mockResolvedValue(VALID_JPEG_BUFFER)
  })

  it('createPhoto resolves BEFORE ensure, exactly one attempt, response contract unchanged', async () => {
    const order = []
    localStorageDriver.completeUploadSession.mockImplementation(async () => {
      order.push('assembled')
      return {
        eventSlug: SLUG,
        originalName: 'photo.jpg',
        storedName: 'stored-photo.jpg',
        mimeType: 'image/jpeg',
        size: 1234,
        url: '/uploads/stored-photo.jpg',
      }
    })
    const createPhoto = vi.fn().mockImplementation(async () => {
      order.push('commit')
      return { id: PHOTO_ID, url: '/uploads/stored-photo.jpg', eventId: EVENT_ID }
    })
    getGalleryRepository.mockResolvedValue(makePhotoRepository({ createPhoto }))
    ensureDisplayDerivative.mockImplementation(async () => {
      order.push('ensure')
      return { created: true }
    })

    const response = await doComplete({ sessionId: 'session-abc12345' })
    const body = await response.json()

    expect(order).toEqual(['assembled', 'commit', 'ensure'])
    expect(ensureDisplayDerivative).toHaveBeenCalledTimes(1)
    expect(ensureDisplayDerivative.mock.calls[0][0].photoId).toBe(PHOTO_ID)
    expect(response.status).toBe(201)
    expect(body.photo.id).toBe(PHOTO_ID)
  })

  it('createPhoto rejecting means ensureDisplayDerivative is never called', async () => {
    localStorageDriver.completeUploadSession.mockResolvedValue({
      eventSlug: SLUG,
      originalName: 'photo.jpg',
      storedName: 'stored-photo.jpg',
      mimeType: 'image/jpeg',
      size: 1234,
      url: '/uploads/stored-photo.jpg',
    })
    const createPhoto = vi.fn().mockRejectedValue(new Error('db write failed'))
    getGalleryRepository.mockResolvedValue(makePhotoRepository({ createPhoto }))

    await expect(doComplete({ sessionId: 'session-abc12345' })).rejects.toThrow('db write failed')

    expect(ensureDisplayDerivative).not.toHaveBeenCalled()
  })

  it('a generation failure does not affect local-path completion success', async () => {
    localStorageDriver.completeUploadSession.mockResolvedValue({
      eventSlug: SLUG,
      originalName: 'photo.jpg',
      storedName: 'stored-photo.jpg',
      mimeType: 'image/jpeg',
      size: 1234,
      url: '/uploads/stored-photo.jpg',
    })
    const createPhoto = vi.fn().mockResolvedValue({ id: PHOTO_ID, url: '/uploads/stored-photo.jpg', eventId: EVENT_ID })
    getGalleryRepository.mockResolvedValue(makePhotoRepository({ createPhoto }))
    ensureDisplayDerivative.mockRejectedValue(new Error('blob boom'))

    const response = await doComplete({ sessionId: 'session-abc12345' })
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.photo.id).toBe(PHOTO_ID)
  })

  it('STEP 7.15g: invalid source content → createPhoto and ensure are never called', async () => {
    localStorageDriver.completeUploadSession.mockResolvedValue({
      eventSlug: SLUG,
      originalName: 'photo.jpg',
      storedName: 'stored-photo.jpg',
      mimeType: 'image/jpeg',
      size: 1234,
      url: '/uploads/stored-photo.jpg',
    })
    getPhotoBuffer.mockResolvedValue(Buffer.from('not actually an image'))
    const createPhoto = vi.fn()
    getGalleryRepository.mockResolvedValue(makePhotoRepository({ createPhoto }))

    const response = await doComplete({ sessionId: 'session-abc12345' })

    expect(response.status).toBe(422)
    expect(createPhoto).not.toHaveBeenCalled()
    expect(ensureDisplayDerivative).not.toHaveBeenCalled()
  })

  // ─── §49 TASK-02: local path, prisma available ──────────────────────────
  // The rest of this describe block runs with prisma NULL (unrelated to
  // display generation, per the comment on the outer beforeEach) — that
  // already proves the null-prisma case is safe (every test above still
  // gets response.status 201/422 as expected). These two tests instead
  // give this specific test file's local path ONE real assertion that
  // status recording itself works correctly when prisma IS available,
  // matching the Blob-path coverage in §49 above.
  it('TASK-02: local path records READY on successful generation when prisma is available', async () => {
    getPrismaClient.mockResolvedValue({ photo: { updateMany: photoUpdateManyMock, count: vi.fn().mockResolvedValue(0) } })
    localStorageDriver.completeUploadSession.mockResolvedValue({
      eventSlug: SLUG,
      originalName: 'photo.jpg',
      storedName: 'stored-photo.jpg',
      mimeType: 'image/jpeg',
      size: 1234,
      url: '/uploads/stored-photo.jpg',
    })
    const createPhoto = vi.fn().mockResolvedValue({ id: PHOTO_ID, url: '/uploads/stored-photo.jpg', eventId: EVENT_ID })
    getGalleryRepository.mockResolvedValue(makePhotoRepository({ createPhoto }))
    ensureDisplayDerivative.mockResolvedValue({ created: true })

    const response = await doComplete({ sessionId: 'session-abc12345' })

    expect(response.status).toBe(201)
    expect(photoUpdateManyMock).toHaveBeenCalledWith({
      where: { id: PHOTO_ID },
      data: { displayDerivativeStatus: 'READY' },
    })
  })

  it('TASK-02: local path records FAILED (never READY) when generation throws, and the HTTP response is unaffected', async () => {
    getPrismaClient.mockResolvedValue({ photo: { updateMany: photoUpdateManyMock, count: vi.fn().mockResolvedValue(0) } })
    localStorageDriver.completeUploadSession.mockResolvedValue({
      eventSlug: SLUG,
      originalName: 'photo.jpg',
      storedName: 'stored-photo.jpg',
      mimeType: 'image/jpeg',
      size: 1234,
      url: '/uploads/stored-photo.jpg',
    })
    const createPhoto = vi.fn().mockResolvedValue({ id: PHOTO_ID, url: '/uploads/stored-photo.jpg', eventId: EVENT_ID })
    getGalleryRepository.mockResolvedValue(makePhotoRepository({ createPhoto }))
    ensureDisplayDerivative.mockRejectedValue(new Error('blob boom'))

    const response = await doComplete({ sessionId: 'session-abc12345' })
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.photo.id).toBe(PHOTO_ID)
    expect(photoUpdateManyMock).toHaveBeenCalledWith({
      where: { id: PHOTO_ID },
      data: { displayDerivativeStatus: 'FAILED' },
    })
    expect(photoUpdateManyMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { displayDerivativeStatus: 'READY' } }),
    )
  })
})

// ─── §48 PrivateAsset exclusion (static — see rationale below) ──────────────

describe('§48 PrivateAsset completion never generates display-v1', () => {
  // A full HTTP round-trip through completePrivateDeliveryUpload/
  // completePhotographerUpload would duplicate the auth/entitlement/session
  // plumbing already covered by tests/private-delivery-completion-route.test.js
  // and friends. The structural guarantee that matters here — these handlers
  // never call the generation helper at all — is proven more precisely and
  // more durably by a source scan of their exact function bodies than by one
  // more mocked HTTP path, matching the dormancy-test convention already
  // established in tests/display-derivative.test.js.
  it('completePrivateDeliveryUpload never references ensureDisplayDerivative/ensurePhotoDisplayDerivative', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const src = readFileSync(resolve(import.meta.dirname, '..', 'app/api/[[...path]]/route.js'), 'utf8')

    const match = /const completePrivateDeliveryUpload = async[\s\S]*?\n}\n/.exec(src)
    expect(match).not.toBeNull()
    expect(match[0]).not.toMatch(/ensureDisplayDerivative|ensurePhotoDisplayDerivative/)
  })

  it('completePhotographerUpload never references ensureDisplayDerivative/ensurePhotoDisplayDerivative', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const src = readFileSync(resolve(import.meta.dirname, '..', 'app/api/[[...path]]/route.js'), 'utf8')

    const match = /const completePhotographerUpload = async[\s\S]*?\n}\n/.exec(src)
    expect(match).not.toBeNull()
    expect(match[0]).not.toMatch(/ensureDisplayDerivative|ensurePhotoDisplayDerivative/)
  })

  it('completePrivateAssetBlobUpload (shared by both PrivateAsset paths) never touches prisma.photo or the display helper', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const src = readFileSync(resolve(import.meta.dirname, '..', 'lib/server/blob-upload-completion.js'), 'utf8')

    const match = /export async function completePrivateAssetBlobUpload[\s\S]*?\n}\n/.exec(src)
    expect(match).not.toBeNull()
    expect(match[0]).not.toMatch(/ensureDisplayDerivative|ensurePhotoDisplayDerivative/)
    expect(match[0]).not.toMatch(/prisma\.photo|tx\.photo/)
  })
})
