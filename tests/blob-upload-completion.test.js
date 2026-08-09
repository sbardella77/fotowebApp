import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BlobUploadKind, BlobUploadSessionStatus } from '@prisma/client'
import { BlobNotFoundError } from '@vercel/blob'
import {
  BlobUploadCompletionError,
  completeRoomPhotoBlobUpload,
} from '../lib/server/blob-upload-completion.js'
import { blobUploadSessionCompleteSchema } from '../lib/server/schemas.js'

// ─── Time fixtures ────────────────────────────────────────────────────────────

const NOW = new Date('2026-08-09T10:00:00.000Z')
const FUTURE = new Date(NOW.getTime() + 3_600_000)
const PAST = new Date(NOW.getTime() - 1000)

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
    expectedSize: 204800,
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
    size: session.expectedSize ?? 204800,
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
} = {}) {
  const sessionsStore = new Map(sessions.map((s) => [s.id, { ...s }]))
  const photosStore = new Map(photos.map((p) => [p.id, { ...p }]))
  const eventsStore = new Map(events.map((e) => [e.id, { ...e }]))
  const momentsStore = new Map(moments.map((m) => [m.id, { ...m }]))
  let photoCounter = photos.length + 1

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

  const blobUploadSession = makeSessionDelegate(sessionsStore)
  const photo = makePhotoDelegate(photosStore)
  const event = makeEventDelegate(eventsStore)
  const eventMoment = makeMomentDelegate(momentsStore)

  const $transaction = async (fn) => {
    const snapSessions = cloneMap(sessionsStore)
    const snapPhotos = cloneMap(photosStore)
    const snapEvents = cloneMap(eventsStore)
    const tx = {
      blobUploadSession: makeSessionDelegate(sessionsStore),
      photo: makePhotoDelegate(photosStore),
      event: makeEventDelegate(eventsStore),
      eventMoment: makeMomentDelegate(momentsStore),
    }
    try {
      return await fn(tx)
    } catch (error) {
      restoreMap(sessionsStore, snapSessions)
      restoreMap(photosStore, snapPhotos)
      restoreMap(eventsStore, snapEvents)
      throw error
    }
  }

  return {
    blobUploadSession,
    photo,
    event,
    eventMoment,
    $transaction,
    _sessions: sessionsStore,
    _photos: photosStore,
    _events: eventsStore,
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

  it('15. URL e size del record Photo provengono da headResult, non dalla sessione', async () => {
    const session = makeSession({ expectedSize: 204800 })
    const event = makeEvent()
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const headUrl = `https://abc123.public.blob.vercel-storage.com/${EXPECTED_PATHNAME}`
    const headSize = 98765
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
