import { describe, it, expect, vi } from 'vitest'
import { BlobUploadKind, BlobUploadSessionStatus } from '@prisma/client'
import {
  BlobUploadTokenRequestError,
  createLazyServerBoundBlobUploadCallbacks,
  createServerBoundBlobUploadCallbacks,
  getBlobUploadRequestKind,
  isBlobUploadCompletedBody,
  validateBlobUploadCallbackUrl,
} from '../lib/server/blob-upload-token.js'

// ─── Deterministic time fixtures ──────────────────────────────────────────────

const NOW = new Date('2026-08-08T12:00:00.000Z')
const FUTURE = new Date(NOW.getTime() + 3600 * 1000)
const PAST = new Date(NOW.getTime() - 1000)

// ─── In-memory fake Prisma (compatible with lifecycle service) ─────────────────

function matchesWhere(session, where) {
  for (const [key, condition] of Object.entries(where)) {
    if (key === 'OR') {
      if (!condition.some((sub) => matchesWhere(session, sub))) return false
      continue
    }

    const val = session[key]

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

function makeFakePrisma(initial = []) {
  const store = new Map(initial.map((s) => [s.id, { ...s }]))
  let counter = 1

  const delegate = {
    async create({ data }) {
      const session = { id: `session-${counter++}`, ...data, createdAt: NOW, updatedAt: NOW }
      store.set(session.id, { ...session })
      return { ...session }
    },
    async findUnique({ where }) {
      const s = store.get(where.id)
      return s ? { ...s } : null
    },
    async updateMany({ where, data }) {
      let count = 0
      for (const [, session] of store) {
        if (matchesWhere(session, where)) {
          Object.assign(session, data)
          count++
        }
      }
      return { count }
    },
  }

  return { blobUploadSession: delegate, _store: store }
}

function makeSession(overrides = {}) {
  return {
    id: 'session-1',
    eventId: 'event-1',
    eventSlug: 'wedding-2026',
    uploadKind: BlobUploadKind.ROOM_PHOTO,
    status: BlobUploadSessionStatus.PENDING,
    expectedPathname: 'events/wedding-2026/uuid-photo.jpg',
    originalName: 'photo.jpg',
    mimeType: 'image/jpeg',
    expectedSize: 204800,
    uploaderName: null,
    caption: null,
    momentId: null,
    blobUrl: null,
    resultId: null,
    tokenIssuedAt: null,
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

const VALID_BLOB_URL =
  'https://abc123.public.blob.vercel-storage.com/events/wedding-2026/uuid-photo.jpg'

// ─── Session payload validation (via onBeforeGenerateToken public surface) ───
//
// parseCanonicalSessionPayload is internal. These tests exercise the same
// validation rules through the public onBeforeGenerateToken callback, which
// calls it internally and surfaces BlobUploadTokenRequestError on failure.

describe('session payload validation via onBeforeGenerateToken', () => {
  function makeCallbacksForPayloadTest() {
    const session = makeSession()
    const prisma = makeFakePrisma([session])
    const { onBeforeGenerateToken } = createServerBoundBlobUploadCallbacks({
      prisma,
      now: () => NOW,
    })
    const call = (clientPayload) =>
      onBeforeGenerateToken('events/wedding-2026/uuid-photo.jpg', clientPayload, false)
    return { call }
  }

  it('1. rifiuta JSON malformato', async () => {
    const { call } = makeCallbacksForPayloadTest()
    await expect(call('not-json')).rejects.toMatchObject({ code: 'invalid_payload' })
  })

  it('2. rifiuta sessionId mancante (empty object)', async () => {
    const { call } = makeCallbacksForPayloadTest()
    await expect(call('{}')).rejects.toMatchObject({ code: 'invalid_payload' })
  })

  it('3. rifiuta campi extra', async () => {
    const { call } = makeCallbacksForPayloadTest()
    await expect(
      call(JSON.stringify({ sessionId: 'valid-id-here', eventSlug: 'room' })),
    ).rejects.toMatchObject({ code: 'invalid_payload' })
  })

  it('4. rifiuta sessionId non stringa', async () => {
    const { call } = makeCallbacksForPayloadTest()
    await expect(
      call(JSON.stringify({ sessionId: 123 })),
    ).rejects.toMatchObject({ code: 'invalid_payload' })
  })

  it('5. accetta esclusivamente { sessionId } con valore valido', async () => {
    // A well-formed payload whose sessionId matches a real session must not throw
    const { call } = makeCallbacksForPayloadTest()
    const opts = await call(JSON.stringify({ sessionId: 'session-1' }))
    expect(opts).toBeDefined()
    expect(opts.tokenPayload).toBeDefined()
    const tp = JSON.parse(opts.tokenPayload)
    expect(Object.keys(tp)).toHaveLength(1)
    expect(tp.sessionId).toBe('session-1')
  })

  it('rifiuta valore null (non stringa)', async () => {
    const { call } = makeCallbacksForPayloadTest()
    await expect(call(null)).rejects.toMatchObject({ code: 'invalid_payload' })
  })

  it('rifiuta array JSON', async () => {
    const { call } = makeCallbacksForPayloadTest()
    await expect(call('[]')).rejects.toMatchObject({ code: 'invalid_payload' })
  })

  it('rifiuta sessionId troppo corto (< 8 caratteri)', async () => {
    const { call } = makeCallbacksForPayloadTest()
    await expect(
      call(JSON.stringify({ sessionId: 'short' })),
    ).rejects.toMatchObject({ code: 'invalid_payload' })
  })

  it('rifiuta sessionId troppo lungo (> 120 caratteri)', async () => {
    const { call } = makeCallbacksForPayloadTest()
    await expect(
      call(JSON.stringify({ sessionId: 'x'.repeat(121) })),
    ).rejects.toMatchObject({ code: 'invalid_payload' })
  })
})

// ─── onBeforeGenerateToken ────────────────────────────────────────────────────

describe('onBeforeGenerateToken', () => {
  function makeCallbacks(initial = [makeSession()]) {
    const prisma = makeFakePrisma(initial)
    const callbacks = createServerBoundBlobUploadCallbacks({ prisma, now: () => NOW })
    return { prisma, callbacks }
  }

  it('6. sessione PENDING → restituisce token options corrette', async () => {
    const { callbacks } = makeCallbacks()
    const payload = JSON.stringify({ sessionId: 'session-1' })
    const opts = await callbacks.onBeforeGenerateToken(
      'events/wedding-2026/uuid-photo.jpg',
      payload,
      false,
    )
    expect(opts.allowedContentTypes).toEqual(['image/jpeg'])
    expect(opts.maximumSizeInBytes).toBe(204800)
    expect(opts.addRandomSuffix).toBe(false)
    expect(opts.allowOverwrite).toBe(false)
  })

  it('7. pathname esattamente uguale a expectedPathname', async () => {
    const { callbacks } = makeCallbacks()
    const payload = JSON.stringify({ sessionId: 'session-1' })
    const opts = await callbacks.onBeforeGenerateToken(
      'events/wedding-2026/uuid-photo.jpg',
      payload,
      false,
    )
    // tokenPayload must contain only sessionId
    const tp = JSON.parse(opts.tokenPayload)
    expect(tp.sessionId).toBe('session-1')
  })

  it('8. attacker pathname diverso → pathname_mismatch', async () => {
    const { callbacks } = makeCallbacks()
    const payload = JSON.stringify({ sessionId: 'session-1' })
    await expect(
      callbacks.onBeforeGenerateToken('events/wedding-2026/attacker.jpg', payload, false),
    ).rejects.toMatchObject({ code: 'pathname_mismatch' })
  })

  it('9. sessione inesistente → session_not_found', async () => {
    const { callbacks } = makeCallbacks([])
    const payload = JSON.stringify({ sessionId: 'session-1' })
    await expect(
      callbacks.onBeforeGenerateToken('events/wedding-2026/uuid-photo.jpg', payload, false),
    ).rejects.toMatchObject({ code: 'session_not_found' })
  })

  it('10. sessione scaduta → session_expired', async () => {
    const session = makeSession({ expiresAt: PAST })
    const { callbacks } = makeCallbacks([session])
    const payload = JSON.stringify({ sessionId: 'session-1' })
    await expect(
      callbacks.onBeforeGenerateToken('events/wedding-2026/uuid-photo.jpg', payload, false),
    ).rejects.toMatchObject({ code: 'session_expired' })
  })

  it('11. eventId null → event_deleted', async () => {
    const session = makeSession({ eventId: null })
    const { callbacks } = makeCallbacks([session])
    const payload = JSON.stringify({ sessionId: 'session-1' })
    await expect(
      callbacks.onBeforeGenerateToken('events/wedding-2026/uuid-photo.jpg', payload, false),
    ).rejects.toMatchObject({ code: 'event_deleted' })
  })

  it('12. stato invalido (UPLOADED) → invalid_status', async () => {
    const session = makeSession({ status: BlobUploadSessionStatus.UPLOADED })
    const { callbacks } = makeCallbacks([session])
    const payload = JSON.stringify({ sessionId: 'session-1' })
    await expect(
      callbacks.onBeforeGenerateToken('events/wedding-2026/uuid-photo.jpg', payload, false),
    ).rejects.toMatchObject({ code: 'invalid_status' })
  })

  it('13. TOKEN_ISSUED può essere riemesso idempotentemente', async () => {
    const session = makeSession({ status: BlobUploadSessionStatus.TOKEN_ISSUED })
    const { callbacks } = makeCallbacks([session])
    const payload = JSON.stringify({ sessionId: 'session-1' })
    const opts = await callbacks.onBeforeGenerateToken(
      'events/wedding-2026/uuid-photo.jpg',
      payload,
      false,
    )
    expect(opts.addRandomSuffix).toBe(false)
  })

  it('14. tokenPayload contiene soltanto sessionId', async () => {
    const { callbacks } = makeCallbacks()
    const payload = JSON.stringify({ sessionId: 'session-1' })
    const opts = await callbacks.onBeforeGenerateToken(
      'events/wedding-2026/uuid-photo.jpg',
      payload,
      false,
    )
    const tp = JSON.parse(opts.tokenPayload)
    expect(Object.keys(tp)).toHaveLength(1)
    expect(tp.sessionId).toBe('session-1')
  })

  it('15. non restituisce la chiave pathname', async () => {
    const { callbacks } = makeCallbacks()
    const payload = JSON.stringify({ sessionId: 'session-1' })
    const opts = await callbacks.onBeforeGenerateToken(
      'events/wedding-2026/uuid-photo.jpg',
      payload,
      false,
    )
    expect(opts).not.toHaveProperty('pathname')
  })

  it('16. addRandomSuffix è false', async () => {
    const { callbacks } = makeCallbacks()
    const payload = JSON.stringify({ sessionId: 'session-1' })
    const opts = await callbacks.onBeforeGenerateToken(
      'events/wedding-2026/uuid-photo.jpg',
      payload,
      false,
    )
    expect(opts.addRandomSuffix).toBe(false)
  })

  it('17. allowOverwrite è false', async () => {
    const { callbacks } = makeCallbacks()
    const payload = JSON.stringify({ sessionId: 'session-1' })
    const opts = await callbacks.onBeforeGenerateToken(
      'events/wedding-2026/uuid-photo.jpg',
      payload,
      false,
    )
    expect(opts.allowOverwrite).toBe(false)
  })

  it('18. allowedContentTypes contiene solo session.mimeType', async () => {
    const { callbacks } = makeCallbacks()
    const payload = JSON.stringify({ sessionId: 'session-1' })
    const opts = await callbacks.onBeforeGenerateToken(
      'events/wedding-2026/uuid-photo.jpg',
      payload,
      false,
    )
    expect(opts.allowedContentTypes).toEqual(['image/jpeg'])
    expect(opts.allowedContentTypes).toHaveLength(1)
  })

  it('19. maximumSizeInBytes è session.expectedSize', async () => {
    const { callbacks } = makeCallbacks()
    const payload = JSON.stringify({ sessionId: 'session-1' })
    const opts = await callbacks.onBeforeGenerateToken(
      'events/wedding-2026/uuid-photo.jpg',
      payload,
      false,
    )
    expect(opts.maximumSizeInBytes).toBe(204800)
  })

  it('20. validUntil corrisponde a expiresAt in millisecondi (number)', async () => {
    const { callbacks } = makeCallbacks()
    const payload = JSON.stringify({ sessionId: 'session-1' })
    const opts = await callbacks.onBeforeGenerateToken(
      'events/wedding-2026/uuid-photo.jpg',
      payload,
      false,
    )
    expect(typeof opts.validUntil).toBe('number')
    expect(opts.validUntil).toBe(FUTURE.getTime())
  })
})

// ─── onUploadCompleted ────────────────────────────────────────────────────────

describe('onUploadCompleted', () => {
  function makeCallbacksWithSession(sessionOverrides = {}) {
    const session = makeSession(sessionOverrides)
    const prisma = makeFakePrisma([session])
    const callbacks = createServerBoundBlobUploadCallbacks({ prisma, now: () => NOW })
    return { prisma, callbacks, session }
  }

  function makeCompletedPayload(overrides = {}) {
    return {
      blob: {
        url: VALID_BLOB_URL,
        pathname: 'events/wedding-2026/uuid-photo.jpg',
        contentType: 'image/jpeg',
        contentDisposition: 'inline',
        downloadUrl: VALID_BLOB_URL,
      },
      tokenPayload: JSON.stringify({ sessionId: 'session-1' }),
      ...overrides,
    }
  }

  it('21. callback valido → transizione TOKEN_ISSUED → UPLOADED', async () => {
    const { callbacks, prisma } = makeCallbacksWithSession({
      status: BlobUploadSessionStatus.TOKEN_ISSUED,
    })
    const result = await callbacks.onUploadCompleted(makeCompletedPayload())
    expect(result.handled).toBe(true)
    const stored = prisma._store.get('session-1')
    expect(stored.status).toBe(BlobUploadSessionStatus.UPLOADED)
    expect(stored.blobUrl).toBe(VALID_BLOB_URL)
  })

  it('22. callback duplicato con stesso URL è idempotente', async () => {
    const { callbacks } = makeCallbacksWithSession({
      status: BlobUploadSessionStatus.UPLOADED,
      blobUrl: VALID_BLOB_URL,
    })
    const result = await callbacks.onUploadCompleted(makeCompletedPayload())
    expect(result.handled).toBe(true)
  })

  it('23. blob.pathname differente da expectedPathname → pathname_mismatch', async () => {
    const { callbacks } = makeCallbacksWithSession({
      status: BlobUploadSessionStatus.TOKEN_ISSUED,
    })
    const result = await callbacks.onUploadCompleted(
      makeCompletedPayload({
        blob: {
          url: 'https://abc123.public.blob.vercel-storage.com/events/wedding-2026/other.jpg',
          pathname: 'events/wedding-2026/other.jpg',
          contentType: 'image/jpeg',
          contentDisposition: 'inline',
          downloadUrl: 'https://abc123.public.blob.vercel-storage.com/events/wedding-2026/other.jpg',
        },
      }),
    )
    expect(result.handled).toBe(false)
    expect(result.reason).toBe('pathname_mismatch')
  })

  it('24. blobUrl conflittuale (stessa sessione, URL diverso) → blob_url_conflict', async () => {
    const { callbacks } = makeCallbacksWithSession({
      status: BlobUploadSessionStatus.UPLOADED,
      blobUrl: 'https://abc123.public.blob.vercel-storage.com/events/wedding-2026/uuid-photo.jpg',
    })
    // stesso pathname ma URL con host diverso
    const altUrl = 'https://xyz999.public.blob.vercel-storage.com/events/wedding-2026/uuid-photo.jpg'
    const result = await callbacks.onUploadCompleted(
      makeCompletedPayload({
        blob: {
          url: altUrl,
          pathname: 'events/wedding-2026/uuid-photo.jpg',
          contentType: 'image/jpeg',
          contentDisposition: 'inline',
          downloadUrl: altUrl,
        },
      }),
    )
    expect(result.handled).toBe(false)
    expect(result.reason).toBe('blob_url_conflict')
  })

  it('25. tokenPayload malformato è permanent no-op', async () => {
    const { callbacks } = makeCallbacksWithSession({
      status: BlobUploadSessionStatus.TOKEN_ISSUED,
    })
    const result = await callbacks.onUploadCompleted(
      makeCompletedPayload({ tokenPayload: 'not-json' }),
    )
    expect(result.handled).toBe(false)
    expect(result.reason).toBe('invalid_payload')
  })

  it('26. tokenPayload con campi extra è permanent no-op', async () => {
    const { callbacks } = makeCallbacksWithSession({
      status: BlobUploadSessionStatus.TOKEN_ISSUED,
    })
    const result = await callbacks.onUploadCompleted(
      makeCompletedPayload({
        tokenPayload: JSON.stringify({ sessionId: 'session-1', extra: 'field' }),
      }),
    )
    expect(result.handled).toBe(false)
    expect(result.reason).toBe('invalid_payload')
  })

  it('27. blob mancante è permanent no-op', async () => {
    const { callbacks } = makeCallbacksWithSession({
      status: BlobUploadSessionStatus.TOKEN_ISSUED,
    })
    const result = await callbacks.onUploadCompleted(
      makeCompletedPayload({ blob: undefined }),
    )
    expect(result.handled).toBe(false)
    expect(result.reason).toBe('malformed_blob')
  })

  it('28. errore invariant URL (non-vercel hostname) è permanent no-op', async () => {
    const { callbacks } = makeCallbacksWithSession({
      status: BlobUploadSessionStatus.TOKEN_ISSUED,
    })
    const result = await callbacks.onUploadCompleted(
      makeCompletedPayload({
        blob: {
          url: 'https://evil.example.com/events/wedding-2026/uuid-photo.jpg',
          pathname: 'events/wedding-2026/uuid-photo.jpg',
          contentType: 'image/jpeg',
          contentDisposition: 'inline',
          downloadUrl: 'https://evil.example.com/events/wedding-2026/uuid-photo.jpg',
        },
      }),
    )
    expect(result.handled).toBe(false)
    expect(result.reason).toBe('invariant_error')
  })

  it('29. errore DB viene rilanciato', async () => {
    const dbError = new Error('DB connection lost')
    const badPrisma = {
      blobUploadSession: {
        async findUnique() { throw dbError },
        async updateMany() { throw dbError },
        async create() { throw dbError },
      },
    }
    const callbacks = createServerBoundBlobUploadCallbacks({ prisma: badPrisma, now: () => NOW })
    const payload = makeCompletedPayload()
    await expect(callbacks.onUploadCompleted(payload)).rejects.toThrow('DB connection lost')
  })

  it('30. non logga URL completo o sessionId', async () => {
    const warnSpy = vi.fn()
    const { callbacks } = makeCallbacksWithSession({
      status: BlobUploadSessionStatus.UPLOADED,
      blobUrl: VALID_BLOB_URL,
    })
    const callbacksWithLogger = createServerBoundBlobUploadCallbacks({
      prisma: makeFakePrisma([makeSession({ status: BlobUploadSessionStatus.UPLOADED, blobUrl: VALID_BLOB_URL })]),
      now: () => NOW,
      logger: { warn: warnSpy },
    })
    // Trigger a permanent no-op path (duplicate with same URL = ok, no warn)
    await callbacksWithLogger.onUploadCompleted(makeCompletedPayload())

    // Trigger a warn path with invalid payload
    const badCallbacks = createServerBoundBlobUploadCallbacks({
      prisma: makeFakePrisma([makeSession({ status: BlobUploadSessionStatus.TOKEN_ISSUED })]),
      now: () => NOW,
      logger: { warn: warnSpy },
    })
    await badCallbacks.onUploadCompleted(makeCompletedPayload({ tokenPayload: 'bad-json' }))

    // Warn messages must not contain sessionId or URL
    for (const call of warnSpy.mock.calls) {
      const msg = String(call[0])
      expect(msg).not.toContain('session-1')
      expect(msg).not.toContain('https://')
    }
  })
})

// ─── isBlobUploadCompletedBody ────────────────────────────────────────────────

describe('isBlobUploadCompletedBody', () => {
  it('31. blob.upload-completed → true', () => {
    expect(isBlobUploadCompletedBody({ type: 'blob.upload-completed', payload: {} })).toBe(true)
  })

  it('32. blob.generate-client-token → false', () => {
    expect(isBlobUploadCompletedBody({ type: 'blob.generate-client-token', payload: {} })).toBe(false)
  })

  it('33. null → false', () => {
    expect(isBlobUploadCompletedBody(null)).toBe(false)
  })

  it('array → false', () => {
    expect(isBlobUploadCompletedBody([{ type: 'blob.upload-completed' }])).toBe(false)
  })

  it('stringa → false', () => {
    expect(isBlobUploadCompletedBody('blob.upload-completed')).toBe(false)
  })

  it('plain object senza type → false', () => {
    expect(isBlobUploadCompletedBody({ data: 'x' })).toBe(false)
  })
})

// ─── Structural: token options must not contain pathname key ─────────────────

describe('token options structural invariants', () => {
  it('il token options object non contiene la chiave pathname', async () => {
    const session = makeSession()
    const prisma = makeFakePrisma([session])
    const { onBeforeGenerateToken } = createServerBoundBlobUploadCallbacks({
      prisma,
      now: () => NOW,
    })

    const opts = await onBeforeGenerateToken(
      'events/wedding-2026/uuid-photo.jpg',
      JSON.stringify({ sessionId: 'session-1' }),
      false,
    )

    expect(Object.prototype.hasOwnProperty.call(opts, 'pathname')).toBe(false)
  })
})

// ─── validateBlobUploadCallbackUrl ───────────────────────────────────────────

const SERVER_URL = 'https://snaprooms.app/api/uploads/blob'
const REQUEST_URL = 'https://snaprooms.app/api/uploads/blob'

function makeGenerateTokenBody(callbackUrl) {
  return {
    type: 'blob.generate-client-token',
    payload: {
      pathname: 'events/wedding-2026/uuid-photo.jpg',
      callbackUrl,
      clientPayload: JSON.stringify({ sessionId: 'session-1' }),
      multipart: false,
    },
  }
}

describe('validateBlobUploadCallbackUrl', () => {
  it('1. callbackUrl same-origin /api/uploads/blob → accettato (no throw)', () => {
    expect(() =>
      validateBlobUploadCallbackUrl(makeGenerateTokenBody(SERVER_URL), REQUEST_URL),
    ).not.toThrow()
  })

  it('2. origine esterna → invalid_callback_url', () => {
    expect(() =>
      validateBlobUploadCallbackUrl(
        makeGenerateTokenBody('https://evil.example.com/api/uploads/blob'),
        REQUEST_URL,
      ),
    ).toThrow(BlobUploadTokenRequestError)

    try {
      validateBlobUploadCallbackUrl(
        makeGenerateTokenBody('https://evil.example.com/api/uploads/blob'),
        REQUEST_URL,
      )
    } catch (e) {
      expect(e.code).toBe('invalid_callback_url')
    }
  })

  it('3. stesso origin ma pathname diverso → rifiutato', () => {
    expect(() =>
      validateBlobUploadCallbackUrl(
        makeGenerateTokenBody('https://snaprooms.app/api/other/path'),
        REQUEST_URL,
      ),
    ).toThrow(BlobUploadTokenRequestError)
  })

  it('4. query string → rifiutata', () => {
    expect(() =>
      validateBlobUploadCallbackUrl(
        makeGenerateTokenBody('https://snaprooms.app/api/uploads/blob?foo=bar'),
        REQUEST_URL,
      ),
    ).toThrow(BlobUploadTokenRequestError)
  })

  it('5. fragment → rifiutato', () => {
    expect(() =>
      validateBlobUploadCallbackUrl(
        makeGenerateTokenBody('https://snaprooms.app/api/uploads/blob#section'),
        REQUEST_URL,
      ),
    ).toThrow(BlobUploadTokenRequestError)
  })

  it('6. username/password nell\'URL → rifiutati', () => {
    expect(() =>
      validateBlobUploadCallbackUrl(
        makeGenerateTokenBody('https://user:pass@snaprooms.app/api/uploads/blob'),
        REQUEST_URL,
      ),
    ).toThrow(BlobUploadTokenRequestError)
  })

  it('7. callbackUrl mancante → rifiutato', () => {
    const body = {
      type: 'blob.generate-client-token',
      payload: {
        pathname: 'events/wedding-2026/uuid-photo.jpg',
        multipart: false,
      },
    }
    expect(() => validateBlobUploadCallbackUrl(body, REQUEST_URL)).toThrow(
      BlobUploadTokenRequestError,
    )
  })

  it('8. body blob.upload-completed non viene sottoposto al controllo', () => {
    const completedBody = { type: 'blob.upload-completed', payload: { blob: {}, tokenPayload: null } }
    expect(() => validateBlobUploadCallbackUrl(completedBody, REQUEST_URL)).not.toThrow()
  })

  it('9. la validazione non modifica body', () => {
    const body = makeGenerateTokenBody(SERVER_URL)
    const originalCallbackUrl = body.payload.callbackUrl
    validateBlobUploadCallbackUrl(body, REQUEST_URL)
    expect(body.payload.callbackUrl).toBe(originalCallbackUrl)
  })

  it('10. l\'errore non contiene l\'URL malevolo nel messaggio pubblico', () => {
    try {
      validateBlobUploadCallbackUrl(
        makeGenerateTokenBody('https://evil.example.com/api/uploads/blob'),
        REQUEST_URL,
      )
    } catch (e) {
      expect(e.publicMessage).not.toContain('evil.example.com')
      expect(e.publicMessage).not.toContain('https://')
    }
  })
})

// ─── getBlobUploadRequestKind ─────────────────────────────────────────────────

describe('getBlobUploadRequestKind', () => {
  it('1. generate-client-token → returns "token"', () => {
    expect(getBlobUploadRequestKind({ type: 'blob.generate-client-token', payload: {} })).toBe('token')
  })

  it('2. upload-completed → returns "callback"', () => {
    expect(getBlobUploadRequestKind({ type: 'blob.upload-completed', payload: {} })).toBe('callback')
  })

  it('3. unknown type string → throws BlobUploadTokenRequestError with invalid_payload', () => {
    let caught
    try { getBlobUploadRequestKind({ type: 'blob.other' }) } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(BlobUploadTokenRequestError)
    expect(caught.code).toBe('invalid_payload')
    expect(caught.status).toBe(400)
  })

  it('4. null → throws invalid_payload', () => {
    expect(() => getBlobUploadRequestKind(null)).toThrow(BlobUploadTokenRequestError)
  })

  it('5. array → throws invalid_payload', () => {
    expect(() => getBlobUploadRequestKind([{ type: 'blob.generate-client-token' }])).toThrow(BlobUploadTokenRequestError)
  })

  it('6. string → throws invalid_payload', () => {
    expect(() => getBlobUploadRequestKind('blob.generate-client-token')).toThrow(BlobUploadTokenRequestError)
  })

  it('7. plain object without type → throws invalid_payload', () => {
    let caught
    try { getBlobUploadRequestKind({}) } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(BlobUploadTokenRequestError)
    expect(caught.code).toBe('invalid_payload')
  })
})

// ─── createLazyServerBoundBlobUploadCallbacks ─────────────────────────────────

describe('createLazyServerBoundBlobUploadCallbacks', () => {
  it('1. getPrisma not called at construction time', () => {
    const getPrisma = vi.fn(async () => makeFakePrisma([makeSession()]))
    createLazyServerBoundBlobUploadCallbacks({ getPrisma })
    expect(getPrisma).not.toHaveBeenCalled()
  })

  it('2. getPrisma called when onBeforeGenerateToken is invoked', async () => {
    const session = makeSession()
    const prisma = makeFakePrisma([session])
    const getPrisma = vi.fn(async () => prisma)
    const { onBeforeGenerateToken } = createLazyServerBoundBlobUploadCallbacks({ getPrisma, now: () => NOW })
    await onBeforeGenerateToken(
      'events/wedding-2026/uuid-photo.jpg',
      JSON.stringify({ sessionId: 'session-1' }),
      false,
    )
    expect(getPrisma).toHaveBeenCalledTimes(1)
  })

  it('3. getPrisma called when onUploadCompleted is invoked', async () => {
    const session = makeSession({ status: BlobUploadSessionStatus.TOKEN_ISSUED })
    const prisma = makeFakePrisma([session])
    const getPrisma = vi.fn(async () => prisma)
    const { onUploadCompleted } = createLazyServerBoundBlobUploadCallbacks({ getPrisma, now: () => NOW })
    await onUploadCompleted({
      blob: {
        url: VALID_BLOB_URL,
        pathname: 'events/wedding-2026/uuid-photo.jpg',
        contentType: 'image/jpeg',
        contentDisposition: 'inline',
        downloadUrl: VALID_BLOB_URL,
      },
      tokenPayload: JSON.stringify({ sessionId: 'session-1' }),
    })
    expect(getPrisma).toHaveBeenCalledTimes(1)
  })

  it('4. getPrisma returning null → throws database_unavailable (503)', async () => {
    const getPrisma = vi.fn(async () => null)
    const { onBeforeGenerateToken } = createLazyServerBoundBlobUploadCallbacks({ getPrisma, now: () => NOW })
    await expect(
      onBeforeGenerateToken(
        'events/wedding-2026/uuid-photo.jpg',
        JSON.stringify({ sessionId: 'session-1' }),
        false,
      ),
    ).rejects.toMatchObject({ code: 'database_unavailable', status: 503 })
  })

  it('5. getPrisma returning object without blobUploadSession → throws database_unavailable', async () => {
    const getPrisma = vi.fn(async () => ({}))
    const { onBeforeGenerateToken } = createLazyServerBoundBlobUploadCallbacks({ getPrisma, now: () => NOW })
    await expect(
      onBeforeGenerateToken(
        'events/wedding-2026/uuid-photo.jpg',
        JSON.stringify({ sessionId: 'session-1' }),
        false,
      ),
    ).rejects.toMatchObject({ code: 'database_unavailable', status: 503 })
  })

  it('6. two callback invocations on the same instance call getPrisma exactly once', async () => {
    const session = makeSession()
    const prisma = makeFakePrisma([session])
    const getPrisma = vi.fn(async () => prisma)
    const { onBeforeGenerateToken } = createLazyServerBoundBlobUploadCallbacks({ getPrisma, now: () => NOW })

    // First call — transitions session to TOKEN_ISSUED
    await onBeforeGenerateToken(
      'events/wedding-2026/uuid-photo.jpg',
      JSON.stringify({ sessionId: 'session-1' }),
      false,
    )
    expect(getPrisma).toHaveBeenCalledTimes(1)

    // Second call on the same instance — TOKEN_ISSUED allows idempotent re-issue
    await onBeforeGenerateToken(
      'events/wedding-2026/uuid-photo.jpg',
      JSON.stringify({ sessionId: 'session-1' }),
      false,
    )
    expect(getPrisma).toHaveBeenCalledTimes(1) // still 1, memoized
  })

  it('does not resolve Prisma until a callback is invoked', () => {
    const getPrisma = vi.fn()
    const { onBeforeGenerateToken, onUploadCompleted } = createLazyServerBoundBlobUploadCallbacks({ getPrisma })
    // Neither callback is invoked — getPrisma must remain uncalled
    void onBeforeGenerateToken // referenced but not called
    void onUploadCompleted
    expect(getPrisma).not.toHaveBeenCalled()
  })

  it('8. unknown body type: getBlobUploadRequestKind throws before getPrisma is ever called', () => {
    const getPrisma = vi.fn()
    createLazyServerBoundBlobUploadCallbacks({ getPrisma })

    expect(() => getBlobUploadRequestKind({ type: 'blob.unknown' })).toThrow(BlobUploadTokenRequestError)
    expect(getPrisma).not.toHaveBeenCalled()
  })
})
