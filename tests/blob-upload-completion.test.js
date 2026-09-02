import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BlobUploadKind, BlobUploadSessionStatus } from '@prisma/client'
import { BlobNotFoundError } from '@vercel/blob'
import sharp from 'sharp'
import {
  BlobUploadCompletionError,
  completePrivateAssetBlobUpload,
  completeRoomPhotoBlobUpload,
} from '../lib/server/blob-upload-completion.js'
import { blobUploadSessionCompleteSchema } from '../lib/server/schemas.js'

// ─── Time fixtures ────────────────────────────────────────────────────────────

const NOW = new Date('2026-08-09T10:00:00.000Z')
const FUTURE = new Date(NOW.getTime() + 3_600_000)
const PAST = new Date(NOW.getTime() - 1000)

// ─── Source-integrity fixtures (STEP 7.15g) ────────────────────────────────────
//
// A real, Sharp-decodable JPEG — every test that reaches the new
// source-validation step needs fetchSourceBuffer to resolve to genuinely
// valid image bytes, or it fails validation exactly as production would.
// DEFAULT_EXPECTED_SIZE is derived FROM this buffer (not the reverse) so the
// default headResult.size/session.expectedSize/actual-buffer-length stay
// mutually consistent everywhere a test doesn't deliberately override them.

const VALID_JPEG_BUFFER = await sharp({
  create: { width: 4, height: 4, channels: 3, background: { r: 120, g: 140, b: 160 } },
})
  .jpeg({ quality: 82 })
  .toBuffer()

const DEFAULT_EXPECTED_SIZE = VALID_JPEG_BUFFER.length

// ─── Blob URL helpers ─────────────────────────────────────────────────────────

const EXPECTED_PATHNAME = 'events/wedding-2026/uuid-photo.jpg'
const VALID_BLOB_URL =
  'https://abc123.public.blob.vercel-storage.com/events/wedding-2026/uuid-photo.jpg'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeSession(overrides = {}) {
  return {
    id: 'session-1',
    eventId: 'event-1',
    eventSlug: 'wedding-2026',
    uploadKind: BlobUploadKind.ROOM_PHOTO,
    status: BlobUploadSessionStatus.TOKEN_ISSUED,
    expectedPathname: EXPECTED_PATHNAME,
    originalName: 'photo.jpg',
    mimeType: 'image/jpeg',
    expectedSize: DEFAULT_EXPECTED_SIZE,
    uploaderName: null,
    caption: null,
    momentId: null,
    blobUrl: null,
    resultId: null,
    tokenIssuedAt: NOW,
    uploadedAt: null,
    consumedAt: null,
    expiresAt: FUTURE,
    cleanupAttempts: 0,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeEvent(overrides = {}) {
  return {
    id: 'event-1',
    slug: 'wedding-2026',
    name: 'Wedding 2026',
    ownerId: 'owner-1',
    coverPhotoId: null,
    billingTier: null,
    updatedAt: NOW,
    createdAt: NOW,
    ...overrides,
  }
}

function makePhoto(overrides = {}) {
  return {
    id: 'photo-1',
    eventId: 'event-1',
    originalName: 'photo.jpg',
    storedName: 'uuid-photo.jpg',
    mimeType: 'image/jpeg',
    size: 204800,
    url: VALID_BLOB_URL,
    uploaderName: null,
    caption: null,
    status: 'VISIBLE',
    momentId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeHeadResult(session = {}, overrides = {}) {
  const pathname = session.expectedPathname ?? EXPECTED_PATHNAME
  const url = `https://abc123.public.blob.vercel-storage.com/${pathname}`
  return {
    url,
    pathname,
    size: session.expectedSize ?? DEFAULT_EXPECTED_SIZE,
    contentType: session.mimeType ?? 'image/jpeg',
    ...overrides,
  }
}

// ─── Fake Prisma ──────────────────────────────────────────────────────────────

function matchesWhere(record, where) {
  for (const [key, condition] of Object.entries(where)) {
    if (key === 'OR') {
      if (!condition.some((sub) => matchesWhere(record, sub))) return false
      continue
    }
    const val = record[key]
    if (condition === null) {
      if (val !== null && val !== undefined) return false
      continue
    }
    if (typeof condition === 'object' && condition !== null) {
      if ('not' in condition) {
        if (val === condition.not) return false
      } else if ('gt' in condition) {
        if (!(val > condition.gt)) return false
      } else if ('in' in condition) {
        if (!condition.in.includes(val)) return false
      }
    } else {
      if (val !== condition) return false
    }
  }
  return true
}

function applyData(record, data) {
  for (const [key, value] of Object.entries(data)) {
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      'increment' in value
    ) {
      record[key] = ((record[key] ?? 0) + value.increment)
    } else {
      record[key] = value
    }
  }
}

function cloneMap(map) {
  const clone = new Map()
  for (const [k, v] of map) clone.set(k, { ...v })
  return clone
}

function restoreMap(map, snapshot) {
  map.clear()
  for (const [k, v] of snapshot) map.set(k, { ...v })
}

function makeFakePrisma({
  sessions = [],
  photos = [],
  events = [],
  moments = [],
  privateAssets = [],
} = {}) {
  const sessionsStore = new Map(sessions.map((s) => [s.id, { ...s }]))
  const photosStore = new Map(photos.map((p) => [p.id, { ...p }]))
  const eventsStore = new Map(events.map((e) => [e.id, { ...e }]))
  const momentsStore = new Map(moments.map((m) => [m.id, { ...m }]))
  const privateAssetsStore = new Map(privateAssets.map((a) => [a.id, { ...a }]))
  let photoCounter = photos.length + 1
  let assetCounter = privateAssets.length + 1

  function makeSessionDelegate(store) {
    return {
      async findUnique({ where }) {
        const r = store.get(where.id)
        return r ? { ...r } : null
      },
      async updateMany({ where, data }) {
        let count = 0
        for (const [, r] of store) {
          if (matchesWhere(r, where)) {
            applyData(r, data)
            count++
          }
        }
        return { count }
      },
      async create({ data }) {
        const r = { id: `session-auto-${store.size + 1}`, ...data }
        store.set(r.id, { ...r })
        return { ...r }
      },
    }
  }

  function makePhotoDelegate(store) {
    return {
      async findUnique({ where }) {
        const r = store.get(where.id)
        return r ? { ...r } : null
      },
      async create({ data }) {
        const id = `photo-${photoCounter++}`
        const r = { id, createdAt: NOW, updatedAt: NOW, ...data }
        store.set(id, { ...r })
        return { ...r }
      },
      async count({ where }) {
        let c = 0
        for (const [, r] of store) {
          if (matchesWhere(r, where)) c++
        }
        return c
      },
    }
  }

  function makeEventDelegate(store) {
    return {
      async update({ where, data }) {
        const r = store.get(where.id)
        if (!r) {
          const err = new Error('Record not found')
          err.code = 'P2025'
          throw err
        }
        applyData(r, data)
        return { ...r }
      },
      async findUnique({ where }) {
        const r = store.get(where.id)
        return r ? { ...r } : null
      },
    }
  }

  function makeMomentDelegate(store) {
    return {
      async findFirst({ where }) {
        for (const [, r] of store) {
          if (matchesWhere(r, where)) return { ...r }
        }
        return null
      },
    }
  }

  function makePrivateAssetDelegate(store) {
    return {
      async findUnique({ where }) {
        const r = store.get(where.id)
        return r ? { ...r } : null
      },
      async create({ data }) {
        const id = `asset-${assetCounter++}`
        const r = { id, createdAt: NOW, updatedAt: NOW, ...data }
        store.set(id, { ...r })
        return { ...r }
      },
    }
  }

  const blobUploadSession = makeSessionDelegate(sessionsStore)
  const photo = makePhotoDelegate(photosStore)
  const event = makeEventDelegate(eventsStore)
  const eventMoment = makeMomentDelegate(momentsStore)
  const privateAsset = makePrivateAssetDelegate(privateAssetsStore)

  const $transaction = async (fn) => {
    const snapSessions = cloneMap(sessionsStore)
    const snapPhotos = cloneMap(photosStore)
    const snapEvents = cloneMap(eventsStore)
    const snapAssets = cloneMap(privateAssetsStore)
    const tx = {
      blobUploadSession: makeSessionDelegate(sessionsStore),
      photo: makePhotoDelegate(photosStore),
      event: makeEventDelegate(eventsStore),
      eventMoment: makeMomentDelegate(momentsStore),
      privateAsset: makePrivateAssetDelegate(privateAssetsStore),
    }
    try {
      return await fn(tx)
    } catch (error) {
      restoreMap(sessionsStore, snapSessions)
      restoreMap(photosStore, snapPhotos)
      restoreMap(eventsStore, snapEvents)
      restoreMap(privateAssetsStore, snapAssets)
      throw error
    }
  }

  return {
    blobUploadSession,
    photo,
    event,
    eventMoment,
    privateAsset,
    $transaction,
    _sessions: sessionsStore,
    _photos: photosStore,
    _events: eventsStore,
    _assets: privateAssetsStore,
  }
}

// ─── Default helpers ──────────────────────────────────────────────────────────

function makeDefaultArgs(overrides = {}) {
  const session = makeSession()
  const event = makeEvent()
  const prisma = makeFakePrisma({ sessions: [session], events: [event] })
  return {
    prisma,
    sessionId: session.id,
    headBlob: vi.fn(async () => makeHeadResult(session)),
    deleteBlob: vi.fn(async () => {}),
    fetchSourceBuffer: vi.fn(async () => VALID_JPEG_BUFFER),
    checkEntitlement: vi.fn(async () => ({
      allowed: true,
      current: 0,
      max: Infinity,
      upgradePath: null,
    })),
    now: () => NOW,
    ...overrides,
  }
}

// ─── Preflight tests ──────────────────────────────────────────────────────────

describe('preflight', () => {
  it('1. sessione inesistente → session_not_found (404)', async () => {
    const prisma = makeFakePrisma({ events: [makeEvent()] })
    await expect(
      completeRoomPhotoBlobUpload({
        ...makeDefaultArgs(),
        prisma,
        sessionId: 'no-such-session',
      }),
    ).rejects.toMatchObject({ code: 'session_not_found', status: 404 })
  })

  it('2. uploadKind non ROOM_PHOTO → invalid_upload_kind (409)', async () => {
    const session = makeSession({ uploadKind: BlobUploadKind.PRIVATE_DELIVERY })
    const prisma = makeFakePrisma({ sessions: [session], events: [makeEvent()] })
    await expect(
      completeRoomPhotoBlobUpload({ ...makeDefaultArgs(), prisma }),
    ).rejects.toMatchObject({ code: 'invalid_upload_kind', status: 409 })
  })

  it('3. PENDING → token_not_issued (409)', async () => {
    const session = makeSession({ status: BlobUploadSessionStatus.PENDING })
    const prisma = makeFakePrisma({ sessions: [session], events: [makeEvent()] })
    await expect(
      completeRoomPhotoBlobUpload({ ...makeDefaultArgs(), prisma }),
    ).rejects.toMatchObject({ code: 'token_not_issued', status: 409 })
  })

  it('4. sessione scaduta → session_expired (410)', async () => {
    const session = makeSession({ expiresAt: PAST })
    const prisma = makeFakePrisma({ sessions: [session], events: [makeEvent()] })
    await expect(
      completeRoomPhotoBlobUpload({ ...makeDefaultArgs(), prisma }),
    ).rejects.toMatchObject({ code: 'session_expired', status: 410 })
  })

  it('5. eventId null → event_deleted (410)', async () => {
    const session = makeSession({ eventId: null })
    const prisma = makeFakePrisma({ sessions: [session] })
    await expect(
      completeRoomPhotoBlobUpload({ ...makeDefaultArgs(), prisma }),
    ).rejects.toMatchObject({ code: 'event_deleted', status: 410 })
  })

  it('6. COMPLETED restituisce stessa Photo senza chiamare headBlob', async () => {
    const photo = makePhoto()
    const session = makeSession({
      status: BlobUploadSessionStatus.COMPLETED,
      resultId: photo.id,
    })
    const headBlob = vi.fn()
    const prisma = makeFakePrisma({ sessions: [session], photos: [photo], events: [makeEvent()] })
    const result = await completeRoomPhotoBlobUpload({
      ...makeDefaultArgs(),
      prisma,
      headBlob,
    })
    expect(result.idempotent).toBe(true)
    expect(result.photo.id).toBe(photo.id)
    expect(headBlob).not.toHaveBeenCalled()
  })

  it('7. COMPLETED senza resultId → result_missing (500)', async () => {
    const session = makeSession({
      status: BlobUploadSessionStatus.COMPLETED,
      resultId: null,
    })
    const prisma = makeFakePrisma({ sessions: [session], events: [makeEvent()] })
    await expect(
      completeRoomPhotoBlobUpload({ ...makeDefaultArgs(), prisma }),
    ).rejects.toMatchObject({ code: 'result_missing', status: 500 })
  })

  it('8. COMPLETED con Photo mancante nel DB → result_missing (500)', async () => {
    const session = makeSession({
      status: BlobUploadSessionStatus.COMPLETED,
      resultId: 'ghost-photo-id',
    })
    const prisma = makeFakePrisma({ sessions: [session], events: [makeEvent()] })
    await expect(
      completeRoomPhotoBlobUpload({ ...makeDefaultArgs(), prisma }),
    ).rejects.toMatchObject({ code: 'result_missing', status: 500 })
  })
})

// ─── Head verification tests ──────────────────────────────────────────────────

describe('head verification', () => {
  it('9. headBlob viene chiamato con session.expectedPathname esatto', async () => {
    const args = makeDefaultArgs()
    await completeRoomPhotoBlobUpload(args)
    expect(args.headBlob).toHaveBeenCalledWith(EXPECTED_PATHNAME)
  })

  it('10. BlobNotFoundError → blob_not_found (409)', async () => {
    const headBlob = vi.fn(async () => {
      throw new BlobNotFoundError()
    })
    await expect(
      completeRoomPhotoBlobUpload({ ...makeDefaultArgs(), headBlob }),
    ).rejects.toMatchObject({ code: 'blob_not_found', status: 409 })
  })

  it('11. headResult.pathname diverso da expectedPathname → blob_metadata_invalid (502), nessun delete', async () => {
    const session = makeSession()
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const headBlob = vi.fn(async () => ({
      url: 'https://abc123.public.blob.vercel-storage.com/events/wedding-2026/different.jpg',
      pathname: 'events/wedding-2026/different.jpg',
      size: 204800,
      contentType: 'image/jpeg',
    }))
    const deleteBlob = vi.fn()
    await expect(
      completeRoomPhotoBlobUpload({
        ...makeDefaultArgs(),
        prisma,
        headBlob,
        deleteBlob,
      }),
    ).rejects.toMatchObject({ code: 'blob_metadata_invalid', status: 502 })
    expect(deleteBlob).not.toHaveBeenCalled()
  })

  it('12. headResult.size > expectedSize → blob_too_large (413) + delete', async () => {
    const session = makeSession({ expectedSize: 100 })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const headBlob = vi.fn(async () =>
      makeHeadResult(session, { size: 200 }),
    )
    const deleteBlob = vi.fn()
    await expect(
      completeRoomPhotoBlobUpload({
        ...makeDefaultArgs(),
        prisma,
        headBlob,
        deleteBlob,
      }),
    ).rejects.toMatchObject({ code: 'blob_too_large', status: 413 })
    expect(deleteBlob).toHaveBeenCalled()
  })

  it('13. MIME diverso → blob_mime_mismatch (415) + delete', async () => {
    const session = makeSession({ mimeType: 'image/jpeg' })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const headBlob = vi.fn(async () =>
      makeHeadResult(session, { contentType: 'image/png' }),
    )
    const deleteBlob = vi.fn()
    await expect(
      completeRoomPhotoBlobUpload({
        ...makeDefaultArgs(),
        prisma,
        headBlob,
        deleteBlob,
      }),
    ).rejects.toMatchObject({ code: 'blob_mime_mismatch', status: 415 })
    expect(deleteBlob).toHaveBeenCalled()
  })

  it('14. contentType con parametro viene normalizzato correttamente', async () => {
    const session = makeSession({ mimeType: 'image/jpeg' })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const headBlob = vi.fn(async () =>
      makeHeadResult(session, { contentType: 'image/jpeg; charset=utf-8' }),
    )
    const result = await completeRoomPhotoBlobUpload({
      ...makeDefaultArgs(),
      prisma,
      headBlob,
    })
    expect(result.photo.mimeType).toBe('image/jpeg')
  })

  it('15. URL e size del record Photo provengono da headResult/buffer validato, non dalla sessione', async () => {
    // headSize must equal the actually-fetched buffer's length (STEP 7.15g
    // consistency gate), but still deliberately differs from the session's
    // own expectedSize (204800) to prove Photo.size is not an echo of it.
    const session = makeSession({ expectedSize: 204800 })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const headUrl = `https://abc123.public.blob.vercel-storage.com/${EXPECTED_PATHNAME}`
    const headSize = VALID_JPEG_BUFFER.length
    const headBlob = vi.fn(async () => ({
      url: headUrl,
      pathname: EXPECTED_PATHNAME,
      size: headSize,
      contentType: 'image/jpeg',
    }))
    const result = await completeRoomPhotoBlobUpload({
      ...makeDefaultArgs(),
      prisma,
      headBlob,
    })
    expect(result.photo.url).toBe(headUrl)
    expect(result.photo.size).toBe(headSize)
    expect(headSize).not.toBe(204800)
  })
})

// ─── Source-integrity validation tests (STEP 7.15g) ────────────────────────────

const PLAIN_TEXT_BUFFER = Buffer.from(
  'This is not an image, just plain text content declared as a JPEG for testing.',
  'utf8',
)

// Truncated deep inside the IDAT stream (not right after IHDR): metadata
// still parses correctly, but not enough compressed pixel data survives for
// a real decode — empirically verified to reproduce metadata-succeeds/
// pixel-decode-fails, the exact split STEP 7.15f.3-b found in the 5 legacy
// corrupt PNGs. Fully synthetic, no Production bytes.
async function makeTruncatedPngBuffer() {
  const full = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toBuffer()
  return full.subarray(0, Math.floor(full.length * 0.9))
}

async function makeValidPngBuffer() {
  return sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 50, b: 50 } },
  })
    .png()
    .toBuffer()
}

describe('source-integrity validation (STEP 7.15g)', () => {
  it('valid upload: source fetched exactly once, before the transaction, buffer reused', async () => {
    const args = makeDefaultArgs()
    const result = await completeRoomPhotoBlobUpload(args)
    expect(args.fetchSourceBuffer).toHaveBeenCalledTimes(1)
    expect(args.fetchSourceBuffer).toHaveBeenCalledWith(expect.stringContaining(EXPECTED_PATHNAME))
    expect(result.sourceBuffer).toBe(VALID_JPEG_BUFFER)
    expect(result.photo.mimeType).toBe('image/jpeg')
    expect(result.idempotent).toBe(false)
  })

  it('plain text declared image/jpeg → invalid_image_content (422), Photo not created, cleanup runs', async () => {
    const session = makeSession()
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const headBlob = vi.fn(async () => makeHeadResult(session, { size: PLAIN_TEXT_BUFFER.length }))
    const deleteBlob = vi.fn(async () => {})
    await expect(
      completeRoomPhotoBlobUpload({
        ...makeDefaultArgs(),
        prisma,
        headBlob,
        deleteBlob,
        fetchSourceBuffer: vi.fn(async () => PLAIN_TEXT_BUFFER),
      }),
    ).rejects.toMatchObject({ code: 'invalid_image_content', status: 422 })
    expect(prisma._photos.size).toBe(0)
    expect(deleteBlob).toHaveBeenCalled()
    const finalSession = await prisma.blobUploadSession.findUnique({ where: { id: session.id } })
    expect(finalSession.status).toBe(BlobUploadSessionStatus.REJECTED)
  })

  it('truncated PNG (valid signature+metadata, pixel decode fails) → invalid_image_content (422), cleanup runs', async () => {
    const session = makeSession({ mimeType: 'image/png' })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const truncatedPng = await makeTruncatedPngBuffer()
    const headBlob = vi.fn(async () => makeHeadResult(session, { contentType: 'image/png', size: truncatedPng.length }))
    const deleteBlob = vi.fn(async () => {})
    await expect(
      completeRoomPhotoBlobUpload({
        ...makeDefaultArgs(),
        prisma,
        headBlob,
        deleteBlob,
        fetchSourceBuffer: vi.fn(async () => truncatedPng),
      }),
    ).rejects.toMatchObject({ code: 'invalid_image_content', status: 422 })
    expect(prisma._photos.size).toBe(0)
    expect(deleteBlob).toHaveBeenCalled()
  })

  it('declared/provider agree on image/jpeg but real bytes are a valid PNG → image_content_type_mismatch (422)', async () => {
    const session = makeSession({ mimeType: 'image/jpeg' })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const realPng = await makeValidPngBuffer()
    // headBlob's contentType still says image/jpeg — passes the EXISTING
    // blob_mime_mismatch check — only the new pixel-derived validator can
    // catch that the actual bytes are a real PNG.
    const headBlob = vi.fn(async () => makeHeadResult(session, { contentType: 'image/jpeg', size: realPng.length }))
    const deleteBlob = vi.fn(async () => {})
    await expect(
      completeRoomPhotoBlobUpload({
        ...makeDefaultArgs(),
        prisma,
        headBlob,
        deleteBlob,
        fetchSourceBuffer: vi.fn(async () => realPng),
      }),
    ).rejects.toMatchObject({ code: 'image_content_type_mismatch', status: 422 })
    expect(prisma._photos.size).toBe(0)
    expect(deleteBlob).toHaveBeenCalled()
  })

  it('source fetch fails → image_validation_unavailable (503), no cleanup, session stays retryable', async () => {
    const session = makeSession()
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const deleteBlob = vi.fn(async () => {})
    await expect(
      completeRoomPhotoBlobUpload({
        ...makeDefaultArgs(),
        prisma,
        deleteBlob,
        fetchSourceBuffer: vi.fn(async () => {
          throw new Error('network blip')
        }),
      }),
    ).rejects.toMatchObject({ code: 'image_validation_unavailable', status: 503 })
    expect(prisma._photos.size).toBe(0)
    expect(deleteBlob).not.toHaveBeenCalled()
    const finalSession = await prisma.blobUploadSession.findUnique({ where: { id: session.id } })
    expect(finalSession.status).not.toBe(BlobUploadSessionStatus.REJECTED)
  })

  it('fetched buffer length disagrees with trusted headResult.size → image_validation_unavailable (503), no cleanup', async () => {
    const session = makeSession()
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const deleteBlob = vi.fn(async () => {})
    await expect(
      completeRoomPhotoBlobUpload({
        ...makeDefaultArgs(),
        prisma,
        deleteBlob,
        // headResult.size (from makeHeadResult/session default) will not
        // match this buffer's length.
        fetchSourceBuffer: vi.fn(async () => Buffer.from('short')),
      }),
    ).rejects.toMatchObject({ code: 'image_validation_unavailable', status: 503 })
    expect(prisma._photos.size).toBe(0)
    expect(deleteBlob).not.toHaveBeenCalled()
  })

  it('idempotent COMPLETED session: fetchSourceBuffer is never called', async () => {
    const existingPhoto = makePhoto()
    const session = makeSession({
      status: BlobUploadSessionStatus.COMPLETED,
      resultId: existingPhoto.id,
    })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event], photos: [existingPhoto] })
    const fetchSourceBuffer = vi.fn(async () => VALID_JPEG_BUFFER)
    const result = await completeRoomPhotoBlobUpload({
      ...makeDefaultArgs(),
      prisma,
      fetchSourceBuffer,
    })
    expect(fetchSourceBuffer).not.toHaveBeenCalled()
    expect(result.idempotent).toBe(true)
    expect(result.sourceBuffer).toBeUndefined()
  })

  it('valid clean synthetic PNG passes end to end (regression against over-broad rejection)', async () => {
    const session = makeSession({ mimeType: 'image/png' })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const validPng = await makeValidPngBuffer()
    const headBlob = vi.fn(async () =>
      makeHeadResult(session, { contentType: 'image/png', size: validPng.length }),
    )
    const result = await completeRoomPhotoBlobUpload({
      ...makeDefaultArgs(),
      prisma,
      headBlob,
      fetchSourceBuffer: vi.fn(async () => validPng),
    })
    expect(result.photo.mimeType).toBe('image/png')
    expect(result.photo.size).toBe(validPng.length)
  })

  it('throws before the transaction: no Photo row exists on invalid content', async () => {
    const session = makeSession()
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const transactionSpy = vi.spyOn(prisma, '$transaction')
    const headBlob = vi.fn(async () => makeHeadResult(session, { size: PLAIN_TEXT_BUFFER.length }))
    await expect(
      completeRoomPhotoBlobUpload({
        ...makeDefaultArgs(),
        prisma,
        headBlob,
        fetchSourceBuffer: vi.fn(async () => PLAIN_TEXT_BUFFER),
      }),
    ).rejects.toMatchObject({ code: 'invalid_image_content' })
    expect(transactionSpy).not.toHaveBeenCalled()
  })
})

// ─── Transaction tests ────────────────────────────────────────────────────────

describe('transaction', () => {
  it('16. Event viene lockato prima del check entitlement', async () => {
    const callOrder = []
    const session = makeSession()
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })

    const original$tx = prisma.$transaction.bind(prisma)
    prisma.$transaction = async (fn) =>
      original$tx(async (tx) => {
        const origUpdate = tx.event.update.bind(tx.event)
        tx.event.update = async (...args) => {
          callOrder.push('event.update')
          return origUpdate(...args)
        }
        return fn(tx)
      })

    await completeRoomPhotoBlobUpload({
      ...makeDefaultArgs(),
      prisma,
      checkEntitlement: async (tx, ev) => {
        callOrder.push('checkEntitlement')
        return { allowed: true, current: 0, max: Infinity, upgradePath: null }
      },
    })

    expect(callOrder.indexOf('event.update')).toBeLessThan(
      callOrder.indexOf('checkEntitlement'),
    )
  })

  it('17. dopo completamento, consumedAt e resultId sono entrambi impostati', async () => {
    const args = makeDefaultArgs()
    await completeRoomPhotoBlobUpload(args)
    const session = args.prisma._sessions.get('session-1')
    expect(session.consumedAt).not.toBeNull()
    expect(session.resultId).not.toBeNull()
    expect(session.status).toBe(BlobUploadSessionStatus.COMPLETED)
  })

  it('18. crea esattamente una Photo', async () => {
    const args = makeDefaultArgs()
    await completeRoomPhotoBlobUpload(args)
    expect(args.prisma._photos.size).toBe(1)
  })

  it('19. Photo usa originalName, uploaderName e caption dalla sessione', async () => {
    const session = makeSession({
      originalName: 'my-shot.jpg',
      uploaderName: 'Alice',
      caption: 'First dance',
    })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    await completeRoomPhotoBlobUpload({ ...makeDefaultArgs(), prisma })
    const [photo] = [...prisma._photos.values()]
    expect(photo.originalName).toBe('my-shot.jpg')
    expect(photo.uploaderName).toBe('Alice')
    expect(photo.caption).toBe('First dance')
  })

  it("19b. Photo usa contributorId dalla sessione (mai da un eventuale body client)", async () => {
    const session = makeSession({ contributorId: '33333333-3333-4333-8333-333333333333' })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    await completeRoomPhotoBlobUpload({ ...makeDefaultArgs(), prisma })
    const [photo] = [...prisma._photos.values()]
    expect(photo.contributorId).toBe('33333333-3333-4333-8333-333333333333')
  })

  it('19c. Photo.contributorId è null quando la sessione (legacy) non lo ha', async () => {
    // Legacy BlobUploadSession rows created before this field existed have
    // contributorId === undefined, not null — completion must still succeed.
    const session = makeSession()
    delete session.contributorId
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const result = await completeRoomPhotoBlobUpload({ ...makeDefaultArgs(), prisma })
    expect(result.photo.contributorId).toBeNull()
  })

  it('19d. Photo.uploadActorType usa il valore risolto server-side nella sessione (mai dal body client)', async () => {
    const session = makeSession({ uploadActorType: 'owner' })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const result = await completeRoomPhotoBlobUpload({ ...makeDefaultArgs(), prisma })

    // Persisted to the database...
    const [photo] = [...prisma._photos.values()]
    expect(photo.uploadActorType).toBe('owner')
    // ...but normalizePhotoRecord strips it from the response (Phase 14
    // privacy rule: server-only attribution metadata, never public API surface).
    expect(result.photo.uploadActorType).toBeUndefined()
  })

  it('19e. Photo.uploadActorType è null in database quando la sessione (legacy o guest anonimo) non lo ha', async () => {
    const session = makeSession()
    delete session.uploadActorType
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const result = await completeRoomPhotoBlobUpload({ ...makeDefaultArgs(), prisma })

    const [photo] = [...prisma._photos.values()]
    expect(photo.uploadActorType).toBeNull()
    expect(result.photo.uploadActorType).toBeUndefined()
  })

  it('20. storedName deriva da expectedPathname della sessione', async () => {
    const args = makeDefaultArgs()
    await completeRoomPhotoBlobUpload(args)
    const [photo] = [...args.prisma._photos.values()]
    expect(photo.storedName).toBe('uuid-photo.jpg')
  })

  it('21. coverPhotoId dell\'event viene aggiornato con la nuova Photo', async () => {
    const args = makeDefaultArgs()
    const result = await completeRoomPhotoBlobUpload(args)
    const event = args.prisma._events.get('event-1')
    expect(event.coverPhotoId).toBe(result.photo.id)
  })

  it('22. sessione diventa COMPLETED con resultId corretto', async () => {
    const args = makeDefaultArgs()
    const result = await completeRoomPhotoBlobUpload(args)
    const session = args.prisma._sessions.get('session-1')
    expect(session.status).toBe(BlobUploadSessionStatus.COMPLETED)
    expect(session.resultId).toBe(result.photo.id)
  })

  it('23. momentId di altro evento → invalid_moment (409)', async () => {
    const moment = { id: 'moment-other-event', eventId: 'other-event-id' }
    const session = makeSession({ momentId: 'moment-other-event' })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event], moments: [moment] })
    await expect(
      completeRoomPhotoBlobUpload({ ...makeDefaultArgs(), prisma }),
    ).rejects.toMatchObject({ code: 'invalid_moment', status: 409 })
  })

  it('24. final entitlement fallito → nessuna Photo creata', async () => {
    const session = makeSession()
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const checkEntitlement = vi.fn(async () => ({
      allowed: false,
      current: 30,
      max: 30,
      upgradePath: 'pro_event',
    }))
    await expect(
      completeRoomPhotoBlobUpload({ ...makeDefaultArgs(), prisma, checkEntitlement }),
    ).rejects.toMatchObject({ code: 'photo_limit', status: 403 })
    expect(prisma._photos.size).toBe(0)
  })

  it('25. entitlement fallito → Blob viene eliminato', async () => {
    const session = makeSession()
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const deleteBlob = vi.fn()
    const checkEntitlement = vi.fn(async () => ({
      allowed: false,
      current: 30,
      max: 30,
      upgradePath: 'pro_event',
    }))
    await expect(
      completeRoomPhotoBlobUpload({ ...makeDefaultArgs(), prisma, deleteBlob, checkEntitlement }),
    ).rejects.toMatchObject({ code: 'photo_limit' })
    expect(deleteBlob).toHaveBeenCalledWith(VALID_BLOB_URL)
  })

  it('26. entitlement.error → database_unavailable (503), Blob non eliminato', async () => {
    const session = makeSession()
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const deleteBlob = vi.fn()
    const checkEntitlement = vi.fn(async () => ({
      allowed: false,
      error: 'Service temporarily unavailable, please retry',
    }))
    await expect(
      completeRoomPhotoBlobUpload({ ...makeDefaultArgs(), prisma, deleteBlob, checkEntitlement }),
    ).rejects.toMatchObject({ code: 'database_unavailable', status: 503 })
    expect(deleteBlob).not.toHaveBeenCalled()
  })

  it('27. errore photo.create → rollback consumedAt, nessun delete', async () => {
    const session = makeSession()
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const dbError = new Error('DB write failed')
    const original$tx = prisma.$transaction.bind(prisma)
    prisma.$transaction = async (fn) =>
      original$tx(async (tx) => {
        const origCreate = tx.photo.create.bind(tx.photo)
        tx.photo.create = async () => { throw dbError }
        return fn(tx)
      })
    const deleteBlob = vi.fn()
    await expect(
      completeRoomPhotoBlobUpload({ ...makeDefaultArgs(), prisma, deleteBlob }),
    ).rejects.toThrow('DB write failed')
    const s = prisma._sessions.get('session-1')
    expect(s.consumedAt).toBeNull()
    expect(deleteBlob).not.toHaveBeenCalled()
  })

  it('28. blobUrl già salvato uguale a headResult.url → riesce (blobUrl pre-set)', async () => {
    const session = makeSession({
      status: BlobUploadSessionStatus.TOKEN_ISSUED,
      blobUrl: VALID_BLOB_URL,
    })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const result = await completeRoomPhotoBlobUpload({ ...makeDefaultArgs(), prisma })
    expect(result.idempotent).toBe(false)
    expect(prisma._photos.size).toBe(1)
  })

  it('29. blobUrl differente → blob_url_conflict (409)', async () => {
    const differentUrl =
      'https://xyz999.public.blob.vercel-storage.com/events/wedding-2026/uuid-photo.jpg'
    const session = makeSession({
      status: BlobUploadSessionStatus.TOKEN_ISSUED,
      blobUrl: differentUrl,
    })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    await expect(
      completeRoomPhotoBlobUpload({ ...makeDefaultArgs(), prisma }),
    ).rejects.toMatchObject({ code: 'blob_url_conflict', status: 409 })
  })

  it('30. retry dopo COMPLETED → stessa Photo, nessun duplicato', async () => {
    const args = makeDefaultArgs()
    const first = await completeRoomPhotoBlobUpload(args)
    const second = await completeRoomPhotoBlobUpload(args)
    expect(first.idempotent).toBe(false)
    expect(second.idempotent).toBe(true)
    expect(second.photo.id).toBe(first.photo.id)
    expect(args.prisma._photos.size).toBe(1)
  })

  it('31. due completamenti serializzati producono un solo record', async () => {
    const args = makeDefaultArgs()
    const r1 = await completeRoomPhotoBlobUpload(args)
    const r2 = await completeRoomPhotoBlobUpload(args)
    expect(r1.idempotent).toBe(false)
    expect(r2.idempotent).toBe(true)
    expect(args.prisma._photos.size).toBe(1)
  })
})

// ─── Cleanup tests ────────────────────────────────────────────────────────────

describe('cleanup', () => {
  it('32. cleanup riuscito → sessione REJECTED', async () => {
    const session = makeSession()
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const checkEntitlement = vi.fn(async () => ({
      allowed: false,
      current: 30,
      max: 30,
      upgradePath: 'pro_event',
    }))
    await expect(
      completeRoomPhotoBlobUpload({ ...makeDefaultArgs(), prisma, checkEntitlement }),
    ).rejects.toMatchObject({ code: 'photo_limit' })
    const s = prisma._sessions.get('session-1')
    expect(s.status).toBe(BlobUploadSessionStatus.REJECTED)
  })

  it('33. deleteBlob fallisce → sessione CLEANUP_FAILED', async () => {
    const session = makeSession()
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const deleteBlob = vi.fn(async () => { throw new Error('network error') })
    const checkEntitlement = vi.fn(async () => ({
      allowed: false,
      current: 30,
      max: 30,
      upgradePath: 'pro_event',
    }))
    await expect(
      completeRoomPhotoBlobUpload({ ...makeDefaultArgs(), prisma, deleteBlob, checkEntitlement }),
    ).rejects.toMatchObject({ code: 'photo_limit' })
    const s = prisma._sessions.get('session-1')
    expect(s.status).toBe(BlobUploadSessionStatus.CLEANUP_FAILED)
  })

  it('34. deleteBlob fallisce → cleanupAttempts viene incrementato', async () => {
    const session = makeSession({ cleanupAttempts: 2 })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const deleteBlob = vi.fn(async () => { throw new Error('network error') })
    const checkEntitlement = vi.fn(async () => ({
      allowed: false,
      current: 30,
      max: 30,
      upgradePath: 'pro_event',
    }))
    await expect(
      completeRoomPhotoBlobUpload({ ...makeDefaultArgs(), prisma, deleteBlob, checkEntitlement }),
    ).rejects.toMatchObject({ code: 'photo_limit' })
    const s = prisma._sessions.get('session-1')
    expect(s.cleanupAttempts).toBe(3)
  })

  it('35. cleanup failure conserva lo status HTTP originale (photo_limit → 403)', async () => {
    const session = makeSession()
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const deleteBlob = vi.fn(async () => { throw new Error('network error') })
    const checkEntitlement = vi.fn(async () => ({
      allowed: false,
      current: 30,
      max: 30,
      upgradePath: 'pro_event',
    }))
    let caughtError
    try {
      await completeRoomPhotoBlobUpload({ ...makeDefaultArgs(), prisma, deleteBlob, checkEntitlement })
    } catch (e) {
      caughtError = e
    }
    expect(caughtError).toBeInstanceOf(BlobUploadCompletionError)
    expect(caughtError.code).toBe('photo_limit')
    expect(caughtError.status).toBe(403)
  })

  it('36. sessione COMPLETED prima del cleanup → deleteBlob non chiamato', async () => {
    const session = makeSession()
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const deleteBlob = vi.fn()
    const checkEntitlement = vi.fn(async () => ({
      allowed: false,
      current: 30,
      max: 30,
      upgradePath: 'pro_event',
    }))

    // Simulate: by the time cleanup's updateMany runs, session is already COMPLETED
    let cleanupUpdateCallCount = 0
    const origUpdateMany = prisma.blobUploadSession.updateMany.bind(prisma.blobUploadSession)
    prisma.blobUploadSession.updateMany = async (args) => {
      if (args.data?.status === BlobUploadSessionStatus.CLEANUP_PENDING) {
        cleanupUpdateCallCount++
        return { count: 0 } // Session slipped to COMPLETED concurrently
      }
      return origUpdateMany(args)
    }

    const origFindUnique = prisma.blobUploadSession.findUnique.bind(prisma.blobUploadSession)
    prisma.blobUploadSession.findUnique = async (args) => {
      if (cleanupUpdateCallCount > 0) {
        return makeSession({
          status: BlobUploadSessionStatus.COMPLETED,
          resultId: 'photo-concurrent',
        })
      }
      return origFindUnique(args)
    }

    await expect(
      completeRoomPhotoBlobUpload({ ...makeDefaultArgs(), prisma, deleteBlob, checkEntitlement }),
    ).rejects.toMatchObject({ code: 'photo_limit' })
    expect(deleteBlob).not.toHaveBeenCalled()
  })
})

// ─── Schema tests ─────────────────────────────────────────────────────────────

describe('blobUploadSessionCompleteSchema', () => {
  it('37. { sessionId } valido → parse riesce', () => {
    expect(() =>
      blobUploadSessionCompleteSchema.parse({ sessionId: 'sess-abc-1234' }),
    ).not.toThrow()
  })

  it('38. sessionId + blobUrl → schema rifiuta (campi extra)', () => {
    expect(() =>
      blobUploadSessionCompleteSchema.parse({
        sessionId: 'sess-abc-1234',
        blobUrl: 'https://abc.blob.vercel-storage.com/events/e/f.jpg',
      }),
    ).toThrow()
  })

  it('39. solo eventSlug → schema rifiuta', () => {
    expect(() =>
      blobUploadSessionCompleteSchema.parse({ eventSlug: 'wedding-2026' }),
    ).toThrow()
  })

  it('40. payload senza sessionId → schema rifiuta', () => {
    expect(() =>
      blobUploadSessionCompleteSchema.parse({}),
    ).toThrow()
  })
})

// ─── Private Asset fixtures ────────────────────────────────────────────────────

const PRIVATE_PATHNAME = 'private-delivery/event-1/uuid-doc.jpg'
const PRIVATE_BLOB_URL =
  `https://abc123.public.blob.vercel-storage.com/${PRIVATE_PATHNAME}`

function makePrivateSession(overrides = {}) {
  return makeSession({
    uploadKind: BlobUploadKind.PRIVATE_DELIVERY,
    expectedPathname: PRIVATE_PATHNAME,
    mimeType: 'image/jpeg',
    expectedSize: 512000,
    ...overrides,
  })
}

function makePrivateAsset(overrides = {}) {
  return {
    id: 'asset-1',
    eventId: 'event-1',
    originalName: 'photo.jpg',
    storedName: 'uuid-doc.jpg',
    mimeType: 'image/jpeg',
    size: 512000,
    url: PRIVATE_BLOB_URL,
    uploadedByRole: 'owner',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makePrivateHeadResult(session = {}, overrides = {}) {
  const pathname = session.expectedPathname ?? PRIVATE_PATHNAME
  const url = `https://abc123.public.blob.vercel-storage.com/${pathname}`
  return {
    url,
    pathname,
    size: session.expectedSize ?? 512000,
    contentType: session.mimeType ?? 'image/jpeg',
    ...overrides,
  }
}

function makeDefaultPrivateArgs(overrides = {}) {
  const session = makePrivateSession()
  const event = makeEvent()
  const prisma = makeFakePrisma({ sessions: [session], events: [event] })
  return {
    prisma,
    sessionId: session.id,
    expectedEventId: event.id,
    expectedEventSlug: event.slug,
    expectedUploadKind: BlobUploadKind.PRIVATE_DELIVERY,
    headBlob: vi.fn(async () => makePrivateHeadResult(session)),
    deleteBlob: vi.fn(async () => {}),
    checkEntitlement: vi.fn(async () => ({
      allowed: true,
      upgradePath: null,
    })),
    now: () => NOW,
    ...overrides,
  }
}

// ─── Private Delivery tests ───────────────────────────────────────────────────

describe('Private Delivery', () => {
  it('41. PRIVATE_DELIVERY valido → PrivateAsset con uploadedByRole=owner', async () => {
    const result = await completePrivateAssetBlobUpload(makeDefaultPrivateArgs())
    expect(result.asset).toBeDefined()
    expect(result.asset.uploadedByRole).toBe('owner')
    expect(result.idempotent).toBe(false)
  })

  it('42. headBlob viene chiamato con session.expectedPathname', async () => {
    const args = makeDefaultPrivateArgs()
    await completePrivateAssetBlobUpload(args)
    expect(args.headBlob).toHaveBeenCalledWith(PRIVATE_PATHNAME)
  })

  it('43. url del PrivateAsset proviene da headResult, non dalla sessione', async () => {
    const session = makePrivateSession()
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    // URL con stesso pathname (obbligatorio per claim) ma dominio diverso
    const canonicalUrl =
      `https://canonical-domain.public.blob.vercel-storage.com/${PRIVATE_PATHNAME}`
    const headBlob = vi.fn(async () => ({
      url: canonicalUrl,
      pathname: PRIVATE_PATHNAME,
      size: 512000,
      contentType: 'image/jpeg',
    }))
    const result = await completePrivateAssetBlobUpload({
      ...makeDefaultPrivateArgs(),
      prisma,
      headBlob,
    })
    expect(result.asset.url).toBe(canonicalUrl)
  })

  it('44. size del PrivateAsset proviene da headResult', async () => {
    const session = makePrivateSession({ expectedSize: 512000 })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const headBlob = vi.fn(async () =>
      makePrivateHeadResult(session, { size: 123456 }),
    )
    const result = await completePrivateAssetBlobUpload({
      ...makeDefaultPrivateArgs(),
      prisma,
      headBlob,
    })
    expect(result.asset.size).toBe(123456)
  })

  it('45. mimeType del PrivateAsset deriva da contentType normalizzato di headResult', async () => {
    const session = makePrivateSession({ mimeType: 'image/jpeg' })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const headBlob = vi.fn(async () =>
      makePrivateHeadResult(session, { contentType: 'IMAGE/JPEG; charset=utf-8' }),
    )
    const result = await completePrivateAssetBlobUpload({
      ...makeDefaultPrivateArgs(),
      prisma,
      headBlob,
    })
    expect(result.asset.mimeType).toBe('image/jpeg')
  })

  it('46. originalName del PrivateAsset proviene dalla sessione', async () => {
    const session = makePrivateSession({ originalName: 'wedding-shoot.jpg' })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const result = await completePrivateAssetBlobUpload({
      ...makeDefaultPrivateArgs(),
      prisma,
    })
    expect(result.asset.originalName).toBe('wedding-shoot.jpg')
  })

  it('47. storedName deriva da session.expectedPathname', async () => {
    const result = await completePrivateAssetBlobUpload(makeDefaultPrivateArgs())
    expect(result.asset.storedName).toBe('uuid-doc.jpg')
  })

  it('48. PRIVATE_DELIVERY → uploadedByRole scritto in DB è owner', async () => {
    const args = makeDefaultPrivateArgs()
    const result = await completePrivateAssetBlobUpload(args)
    const [asset] = [...args.prisma._assets.values()]
    expect(asset.uploadedByRole).toBe('owner')
  })

  it('49. sessione diventa COMPLETED con resultId corretto', async () => {
    const args = makeDefaultPrivateArgs()
    const result = await completePrivateAssetBlobUpload(args)
    const session = args.prisma._sessions.get('session-1')
    expect(session.status).toBe(BlobUploadSessionStatus.COMPLETED)
    expect(session.resultId).toBe(result.asset.id)
  })

  it('50. retry COMPLETED restituisce stesso PrivateAsset senza chiamare headBlob', async () => {
    const args = makeDefaultPrivateArgs()
    const first = await completePrivateAssetBlobUpload(args)
    const headBlobSpy = vi.fn()
    const second = await completePrivateAssetBlobUpload({
      ...args,
      headBlob: headBlobSpy,
    })
    expect(second.idempotent).toBe(true)
    expect(second.asset.id).toBe(first.asset.id)
    expect(headBlobSpy).not.toHaveBeenCalled()
  })

  it('51. sessione di altro evento → session_event_mismatch (403)', async () => {
    const session = makePrivateSession({
      eventId: 'other-event-id',
      eventSlug: 'other-event',
    })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    await expect(
      completePrivateAssetBlobUpload({ ...makeDefaultPrivateArgs(), prisma }),
    ).rejects.toMatchObject({ code: 'session_event_mismatch', status: 403 })
  })

  it('52. sessione PHOTOGRAPHER_UPLOAD passata come PRIVATE_DELIVERY → invalid_upload_kind (409)', async () => {
    const session = makePrivateSession({
      uploadKind: BlobUploadKind.PHOTOGRAPHER_UPLOAD,
    })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    await expect(
      completePrivateAssetBlobUpload({ ...makeDefaultPrivateArgs(), prisma }),
    ).rejects.toMatchObject({ code: 'invalid_upload_kind', status: 409 })
  })

  it('53. entitlement non consentito → private_delivery_unavailable (403) + delete', async () => {
    const session = makePrivateSession()
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const deleteBlob = vi.fn()
    const checkEntitlement = vi.fn(async () => ({
      allowed: false,
      upgradePath: 'wedding_pro',
    }))
    await expect(
      completePrivateAssetBlobUpload({
        ...makeDefaultPrivateArgs(),
        prisma,
        deleteBlob,
        checkEntitlement,
      }),
    ).rejects.toMatchObject({ code: 'private_delivery_unavailable', status: 403 })
    expect(deleteBlob).toHaveBeenCalled()
  })

  it('54. entitlement.error → database_unavailable (503), Blob non eliminato', async () => {
    const session = makePrivateSession()
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const deleteBlob = vi.fn()
    const checkEntitlement = vi.fn(async () => ({
      allowed: false,
      error: 'DB unavailable',
    }))
    await expect(
      completePrivateAssetBlobUpload({
        ...makeDefaultPrivateArgs(),
        prisma,
        deleteBlob,
        checkEntitlement,
      }),
    ).rejects.toMatchObject({ code: 'database_unavailable', status: 503 })
    expect(deleteBlob).not.toHaveBeenCalled()
  })

  it('55. MIME mismatch → blob_mime_mismatch (415) + delete', async () => {
    const session = makePrivateSession({ mimeType: 'image/jpeg' })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const headBlob = vi.fn(async () =>
      makePrivateHeadResult(session, { contentType: 'image/png' }),
    )
    const deleteBlob = vi.fn()
    await expect(
      completePrivateAssetBlobUpload({
        ...makeDefaultPrivateArgs(),
        prisma,
        headBlob,
        deleteBlob,
      }),
    ).rejects.toMatchObject({ code: 'blob_mime_mismatch', status: 415 })
    expect(deleteBlob).toHaveBeenCalled()
  })

  it('56. size > expectedSize → blob_too_large (413) + delete', async () => {
    const session = makePrivateSession({ expectedSize: 100 })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const headBlob = vi.fn(async () =>
      makePrivateHeadResult(session, { size: 200 }),
    )
    const deleteBlob = vi.fn()
    await expect(
      completePrivateAssetBlobUpload({
        ...makeDefaultPrivateArgs(),
        prisma,
        headBlob,
        deleteBlob,
      }),
    ).rejects.toMatchObject({ code: 'blob_too_large', status: 413 })
    expect(deleteBlob).toHaveBeenCalled()
  })

  it('57. errore privateAsset.create → rollback consumedAt, nessun delete', async () => {
    const session = makePrivateSession()
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const dbError = new Error('DB write failed')
    const original$tx = prisma.$transaction.bind(prisma)
    prisma.$transaction = async (fn) =>
      original$tx(async (tx) => {
        tx.privateAsset.create = async () => { throw dbError }
        return fn(tx)
      })
    const deleteBlob = vi.fn()
    await expect(
      completePrivateAssetBlobUpload({ ...makeDefaultPrivateArgs(), prisma, deleteBlob }),
    ).rejects.toThrow('DB write failed')
    const s = prisma._sessions.get('session-1')
    expect(s.consumedAt).toBeNull()
    expect(deleteBlob).not.toHaveBeenCalled()
  })

  it('58. blob_url_conflict → nessun delete', async () => {
    const differentUrl =
      'https://xyz.public.blob.vercel-storage.com/private-delivery/event-1/other.jpg'
    const session = makePrivateSession({
      status: BlobUploadSessionStatus.TOKEN_ISSUED,
      blobUrl: differentUrl,
    })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const deleteBlob = vi.fn()
    await expect(
      completePrivateAssetBlobUpload({
        ...makeDefaultPrivateArgs(),
        prisma,
        deleteBlob,
      }),
    ).rejects.toMatchObject({ code: 'blob_url_conflict', status: 409 })
    expect(deleteBlob).not.toHaveBeenCalled()
  })
})

// ─── Photographer tests ───────────────────────────────────────────────────────

describe('Photographer', () => {
  it('59. PHOTOGRAPHER_UPLOAD valido → PrivateAsset creato', async () => {
    const session = makePrivateSession({ uploadKind: BlobUploadKind.PHOTOGRAPHER_UPLOAD })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const result = await completePrivateAssetBlobUpload({
      ...makeDefaultPrivateArgs(),
      prisma,
      expectedUploadKind: BlobUploadKind.PHOTOGRAPHER_UPLOAD,
    })
    expect(result.asset).toBeDefined()
    expect(result.idempotent).toBe(false)
  })

  it('60. PHOTOGRAPHER_UPLOAD → uploadedByRole scritto in DB è photographer', async () => {
    const session = makePrivateSession({ uploadKind: BlobUploadKind.PHOTOGRAPHER_UPLOAD })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    await completePrivateAssetBlobUpload({
      ...makeDefaultPrivateArgs(),
      prisma,
      expectedUploadKind: BlobUploadKind.PHOTOGRAPHER_UPLOAD,
    })
    const [asset] = [...prisma._assets.values()]
    expect(asset.uploadedByRole).toBe('photographer')
  })

  it('61. sessione PRIVATE_DELIVERY passata come PHOTOGRAPHER_UPLOAD → invalid_upload_kind (409)', async () => {
    const session = makePrivateSession({ uploadKind: BlobUploadKind.PRIVATE_DELIVERY })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    await expect(
      completePrivateAssetBlobUpload({
        ...makeDefaultPrivateArgs(),
        prisma,
        expectedUploadKind: BlobUploadKind.PHOTOGRAPHER_UPLOAD,
      }),
    ).rejects.toMatchObject({ code: 'invalid_upload_kind', status: 409 })
  })

  it('62. expectedEventId diverso da session.eventId → session_event_mismatch (403)', async () => {
    const session = makePrivateSession({ uploadKind: BlobUploadKind.PHOTOGRAPHER_UPLOAD })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    await expect(
      completePrivateAssetBlobUpload({
        ...makeDefaultPrivateArgs(),
        prisma,
        expectedUploadKind: BlobUploadKind.PHOTOGRAPHER_UPLOAD,
        expectedEventId: 'different-event-id',
      }),
    ).rejects.toMatchObject({ code: 'session_event_mismatch', status: 403 })
  })

  it('63. retry COMPLETED PHOTOGRAPHER_UPLOAD → stesso asset, idempotent=true', async () => {
    const session = makePrivateSession({ uploadKind: BlobUploadKind.PHOTOGRAPHER_UPLOAD })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const args = {
      ...makeDefaultPrivateArgs(),
      prisma,
      expectedUploadKind: BlobUploadKind.PHOTOGRAPHER_UPLOAD,
    }
    const first = await completePrivateAssetBlobUpload(args)
    const second = await completePrivateAssetBlobUpload(args)
    expect(second.idempotent).toBe(true)
    expect(second.asset.id).toBe(first.asset.id)
    expect(prisma._assets.size).toBe(1)
  })

  it('64. asset.id e asset.size provengono dal record server-side, non dal body', async () => {
    const session = makePrivateSession({
      uploadKind: BlobUploadKind.PHOTOGRAPHER_UPLOAD,
      expectedSize: 512000,
    })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const headBlob = vi.fn(async () =>
      makePrivateHeadResult(session, { size: 77777 }),
    )
    const result = await completePrivateAssetBlobUpload({
      ...makeDefaultPrivateArgs(),
      prisma,
      expectedUploadKind: BlobUploadKind.PHOTOGRAPHER_UPLOAD,
      headBlob,
    })
    expect(result.asset.size).toBe(77777)
    expect(result.asset.id).toMatch(/^asset-/)
  })
})

// ─── Concorrenza Private Asset ────────────────────────────────────────────────

describe('Concorrenza Private Asset', () => {
  it('65. due completamenti serializzati producono un solo PrivateAsset', async () => {
    const args = makeDefaultPrivateArgs()
    const r1 = await completePrivateAssetBlobUpload(args)
    const r2 = await completePrivateAssetBlobUpload(args)
    expect(r1.idempotent).toBe(false)
    expect(r2.idempotent).toBe(true)
    expect(args.prisma._assets.size).toBe(1)
  })

  it('66. completion_in_progress → 409, nessun delete', async () => {
    // consumedAt già impostato ma resultId null: claim restituisce in_progress
    const session = makePrivateSession({
      consumedAt: NOW,
      blobUrl: null,
      resultId: null,
    })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const deleteBlob = vi.fn()
    await expect(
      completePrivateAssetBlobUpload({
        ...makeDefaultPrivateArgs(),
        prisma,
        deleteBlob,
      }),
    ).rejects.toMatchObject({ code: 'completion_in_progress', status: 409 })
    expect(deleteBlob).not.toHaveBeenCalled()
  })

  it('67. retry dopo COMPLETED è idempotente e non crea duplicati', async () => {
    const args = makeDefaultPrivateArgs()
    const first = await completePrivateAssetBlobUpload(args)
    const second = await completePrivateAssetBlobUpload(args)
    const third = await completePrivateAssetBlobUpload(args)
    expect(first.idempotent).toBe(false)
    expect(second.idempotent).toBe(true)
    expect(third.idempotent).toBe(true)
    expect(second.asset.id).toBe(first.asset.id)
    expect(third.asset.id).toBe(first.asset.id)
    expect(args.prisma._assets.size).toBe(1)
  })
})

// ─── Regression Room ──────────────────────────────────────────────────────────

describe('Regression Room', () => {
  it('68. completeRoomPhotoBlobUpload funziona invariato dopo l\'aggiunta del service PrivateAsset', async () => {
    const args = makeDefaultArgs()
    const result = await completeRoomPhotoBlobUpload(args)
    expect(result.photo).toBeDefined()
    expect(result.idempotent).toBe(false)
    expect(args.prisma._photos.size).toBe(1)
  })
})

// ─── Route static checks ─────────────────────────────────────────────────────

describe('Route static checks', () => {
  let routeContent

  beforeEach(async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    routeContent = readFileSync(resolve('app/api/[[...path]]/route.js'), 'utf8')
  })

  it('69. ramo Vercel Private Delivery non usa body.blobUrl', () => {
    const fnStart = routeContent.indexOf('const completePrivateDeliveryUpload')
    const fnEnd = routeContent.indexOf('const deletePrivateDeliveryAsset')
    const fn = routeContent.slice(fnStart, fnEnd)
    const vercelStart = fn.indexOf("storageDriver.mode === 'vercel-blob'")
    const vercelEnd = fn.indexOf('// ── Local upload path')
    const vercelBranch = fn.slice(vercelStart, vercelEnd)
    expect(vercelBranch).not.toContain('body.blobUrl')
  })

  it('70. ramo Vercel Photographer non usa body.blobUrl', () => {
    const fnStart = routeContent.indexOf('const completePhotographerUpload')
    const fnEnd = routeContent.indexOf('const listPhotographerAssets')
    const fn = routeContent.slice(fnStart, fnEnd)
    const vercelStart = fn.indexOf("storageDriver.mode === 'vercel-blob'")
    const vercelEnd = fn.indexOf('// ── Local upload path')
    const vercelBranch = fn.slice(vercelStart, vercelEnd)
    expect(vercelBranch).not.toContain('body.blobUrl')
  })

  it('71. entrambi i rami Vercel usano blobUploadSessionCompleteSchema', () => {
    const privFnStart = routeContent.indexOf('const completePrivateDeliveryUpload')
    const privFnEnd = routeContent.indexOf('const deletePrivateDeliveryAsset')
    const privFn = routeContent.slice(privFnStart, privFnEnd)

    const photoFnStart = routeContent.indexOf('const completePhotographerUpload')
    const photoFnEnd = routeContent.indexOf('const listPhotographerAssets')
    const photoFn = routeContent.slice(photoFnStart, photoFnEnd)

    expect(privFn).toContain('blobUploadSessionCompleteSchema')
    expect(photoFn).toContain('blobUploadSessionCompleteSchema')
  })

  it('72. Private Delivery lega il completamento all\'evento autenticato', () => {
    const fnStart = routeContent.indexOf('const completePrivateDeliveryUpload')
    const fnEnd = routeContent.indexOf('const deletePrivateDeliveryAsset')
    const fn = routeContent.slice(fnStart, fnEnd)
    const vercelStart = fn.indexOf("storageDriver.mode === 'vercel-blob'")
    const vercelEnd = fn.indexOf('// ── Local upload path')
    const vercelBranch = fn.slice(vercelStart, vercelEnd)
    // expectedEventId deve derivare dall'evento autenticato, non dal body
    expect(vercelBranch).toContain('expectedEventId: event.id')
    expect(vercelBranch).toContain('expectedEventSlug: event.slug')
    expect(vercelBranch).toContain('expectedUploadKind: BlobUploadKind.PRIVATE_DELIVERY')
  })

  it('73. Photographer lega il completamento all\'evento autenticato via token', () => {
    const fnStart = routeContent.indexOf('const completePhotographerUpload')
    const fnEnd = routeContent.indexOf('const listPhotographerAssets')
    const fn = routeContent.slice(fnStart, fnEnd)
    const vercelStart = fn.indexOf("storageDriver.mode === 'vercel-blob'")
    const vercelEnd = fn.indexOf('// ── Local upload path')
    const vercelBranch = fn.slice(vercelStart, vercelEnd)
    // expectedEventId deve derivare dall'evento autenticato via token fotografo
    expect(vercelBranch).toContain('expectedEventId: event.id')
    expect(vercelBranch).toContain('expectedEventSlug: event.slug')
    expect(vercelBranch).toContain('expectedUploadKind: BlobUploadKind.PHOTOGRAPHER_UPLOAD')
  })
})

// ─── Cross-module namespace contract ─────────────────────────────────────────

describe('Cross-module namespace contract', () => {
  it('74. pathname canonico private-delivery/{slug}/{file} attraversa il completion service senza errori', async () => {
    // Verifica che il namespace realistico accettato da BlobUploadSession
    // sia compatibile con completePrivateAssetBlobUpload end-to-end.
    const realisticPathname = 'private-delivery/event-1/uuid-doc.jpg'
    const session = makePrivateSession({ expectedPathname: realisticPathname })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const headBlob = vi.fn(async () => ({
      url: `https://abc123.public.blob.vercel-storage.com/${realisticPathname}`,
      pathname: realisticPathname,
      size: 512000,
      contentType: 'image/jpeg',
    }))
    const result = await completePrivateAssetBlobUpload({
      ...makeDefaultPrivateArgs(),
      prisma,
      headBlob,
    })
    expect(result.asset.storedName).toBe('uuid-doc.jpg')
    expect(result.asset.url).toContain(realisticPathname)
    expect(result.idempotent).toBe(false)
  })
})
