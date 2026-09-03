import { describe, it, expect } from 'vitest'
import { BlobUploadKind, BlobUploadSessionStatus } from '@prisma/client'
import {
  createBlobUploadSession,
  getBlobUploadSession,
  claimBlobUploadSessionForToken,
  markBlobUploadSessionUploaded,
  claimBlobUploadSessionForCompletion,
  finalizeBlobUploadSession,
  BlobUploadSessionInvariantError,
  DEFAULT_TTL_SECONDS,
} from '../lib/server/blob-upload-session.js'

// Deterministic fixed point in time — no Date.now() calls in tests
const NOW = new Date('2026-08-08T12:00:00.000Z')
const FUTURE = new Date(NOW.getTime() + DEFAULT_TTL_SECONDS * 1000)
const PAST = new Date(NOW.getTime() - 1000)

// Session default expectedPathname: events/wedding-2026/photo-uuid.jpg
// All blob URLs below must carry exactly that path component to pass
// validateBlobUrlForExpectedPathname, except where a mismatch is the
// subject of the test.

/** Canonical URL for the default session's expectedPathname */
const VALID_BLOB_URL =
  'https://abc123.public.blob.vercel-storage.com/events/wedding-2026/photo-uuid.jpg'

/** Same path, different Vercel Blob host — valid URL, different identity */
const VALID_BLOB_URL_ALT_HOST =
  'https://xyz456.public.blob.vercel-storage.com/events/wedding-2026/photo-uuid.jpg'

/** Valid Vercel Blob host, but path does NOT match expectedPathname */
const WRONG_PATH_BLOB_URL =
  'https://abc123.public.blob.vercel-storage.com/events/wedding-2026/wrong-uuid.jpg'

// ─── In-memory fake Prisma delegate ─────────────────────────────────────────

/**
 * Evaluates a Prisma-style WHERE clause against a session object.
 * Supports: direct equality, null equality, { not }, { gt }, { in }, OR.
 */
function matchesWhere(session, where) {
  for (const [key, condition] of Object.entries(where)) {
    if (key === 'OR') {
      // At least one sub-clause must match
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

// ─── Session builder ──────────────────────────────────────────────────────────

function makeSession(overrides = {}) {
  return {
    id: 'session-1',
    eventId: 'event-1',
    eventSlug: 'wedding-2026',
    uploadKind: BlobUploadKind.ROOM_PHOTO,
    status: BlobUploadSessionStatus.PENDING,
    expectedPathname: 'events/wedding-2026/photo-uuid.jpg',
    originalName: 'photo.jpg',
    mimeType: 'image/jpeg',
    expectedSize: 1024,
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

const BASE_CREATE_INPUT = {
  eventId: 'event-1',
  eventSlug: 'wedding-2026',
  uploadKind: BlobUploadKind.ROOM_PHOTO,
  expectedPathname: 'events/wedding-2026/photo-uuid.jpg',
  originalName: 'photo.jpg',
  mimeType: 'image/jpeg',
  expectedSize: 1024,
  now: NOW,
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('createBlobUploadSession', () => {
  it('1. creates a PENDING session with TTL of 3600 seconds', async () => {
    const prisma = makeFakePrisma()
    const session = await createBlobUploadSession(prisma, BASE_CREATE_INPUT)

    expect(session.status).toBe(BlobUploadSessionStatus.PENDING)
    expect(session.expiresAt).toEqual(new Date(NOW.getTime() + DEFAULT_TTL_SECONDS * 1000))
    expect(session.eventId).toBe('event-1')
    expect(session.eventSlug).toBe('wedding-2026')
  })

  it('2. normalizes mimeType to lowercase', async () => {
    const prisma = makeFakePrisma()
    const session = await createBlobUploadSession(prisma, {
      ...BASE_CREATE_INPUT,
      mimeType: 'IMAGE/JPEG',
    })
    expect(session.mimeType).toBe('image/jpeg')
  })

  it('3. rejects TTL below 60', async () => {
    const prisma = makeFakePrisma()
    await expect(
      createBlobUploadSession(prisma, { ...BASE_CREATE_INPUT, ttlSeconds: 59 }),
    ).rejects.toThrow(BlobUploadSessionInvariantError)
  })

  it('4. rejects TTL above 3600', async () => {
    const prisma = makeFakePrisma()
    await expect(
      createBlobUploadSession(prisma, { ...BASE_CREATE_INPUT, ttlSeconds: 3601 }),
    ).rejects.toThrow(BlobUploadSessionInvariantError)
  })

  it('5. rejects non-positive expectedSize', async () => {
    const prisma = makeFakePrisma()
    await expect(
      createBlobUploadSession(prisma, { ...BASE_CREATE_INPUT, expectedSize: 0 }),
    ).rejects.toThrow(BlobUploadSessionInvariantError)
    await expect(
      createBlobUploadSession(prisma, { ...BASE_CREATE_INPUT, expectedSize: -1 }),
    ).rejects.toThrow(BlobUploadSessionInvariantError)
  })

  it('6. rejects namespace incompatible with uploadKind', async () => {
    const prisma = makeFakePrisma()
    // ROOM_PHOTO requires 'events/', not 'private-delivery/'
    await expect(
      createBlobUploadSession(prisma, {
        ...BASE_CREATE_INPUT,
        uploadKind: BlobUploadKind.ROOM_PHOTO,
        expectedPathname: 'private-delivery/wedding-2026/photo.jpg',
      }),
    ).rejects.toThrow(BlobUploadSessionInvariantError)

    // PRIVATE_DELIVERY requires 'private-delivery/', not 'events/'
    await expect(
      createBlobUploadSession(prisma, {
        ...BASE_CREATE_INPUT,
        uploadKind: BlobUploadKind.PRIVATE_DELIVERY,
        expectedPathname: 'events/wedding-2026/album.zip',
      }),
    ).rejects.toThrow(BlobUploadSessionInvariantError)
  })

  it('7. rejects eventSlug different from pathname slug segment', async () => {
    const prisma = makeFakePrisma()
    await expect(
      createBlobUploadSession(prisma, {
        ...BASE_CREATE_INPUT,
        expectedPathname: 'events/other-event/photo.jpg',
      }),
    ).rejects.toThrow(BlobUploadSessionInvariantError)
  })

  it('9. persists a provided contributorId', async () => {
    const prisma = makeFakePrisma()
    const session = await createBlobUploadSession(prisma, {
      ...BASE_CREATE_INPUT,
      contributorId: '11111111-1111-4111-8111-111111111111',
    })
    expect(session.contributorId).toBe('11111111-1111-4111-8111-111111111111')
  })

  it('10. defaults contributorId to null when omitted (legacy call sites)', async () => {
    const prisma = makeFakePrisma()
    const session = await createBlobUploadSession(prisma, BASE_CREATE_INPUT)
    expect(session.contributorId).toBeNull()
  })

  it('persists a provided uploadActorType (server-resolved, analytics attribution only)', async () => {
    const prisma = makeFakePrisma()
    const session = await createBlobUploadSession(prisma, {
      ...BASE_CREATE_INPUT,
      uploadActorType: 'guest',
    })
    expect(session.uploadActorType).toBe('guest')
  })

  it('defaults uploadActorType to null when omitted (PRIVATE_DELIVERY/PHOTOGRAPHER_UPLOAD callers, and anonymous guest uploads)', async () => {
    const prisma = makeFakePrisma()
    const session = await createBlobUploadSession(prisma, BASE_CREATE_INPUT)
    expect(session.uploadActorType).toBeNull()
  })

  it('8. rejects path traversal, backslash, and percent-encoding', async () => {
    const prisma = makeFakePrisma()
    const bad = [
      '/events/wedding-2026/photo.jpg', // leading slash
      'events/wedding-2026/../photo.jpg', // dot-dot segment
      'events/wedding-2026/./photo.jpg', // dot segment
      'events\\wedding-2026\\photo.jpg', // backslash
      'events/wedding-2026/%2e%2e', // percent-encoded dot-dot
      'events/wedding-2026/sub/photo.jpg', // four segments
      'events/wedding-2026/', // empty fileName
      'events//wedding-2026/photo.jpg', // double slash
    ]
    for (const expectedPathname of bad) {
      await expect(
        createBlobUploadSession(prisma, { ...BASE_CREATE_INPUT, expectedPathname }),
        `expected rejection for: ${expectedPathname}`,
      ).rejects.toThrow(BlobUploadSessionInvariantError)
    }
  })
})

describe('claimBlobUploadSessionForToken', () => {
  it('9. transitions PENDING to TOKEN_ISSUED', async () => {
    const session = makeSession()
    const prisma = makeFakePrisma([session])

    const result = await claimBlobUploadSessionForToken(prisma, {
      sessionId: session.id,
      pathname: session.expectedPathname,
      now: NOW,
    })

    expect(result.ok).toBe(true)
    expect(result.session.status).toBe(BlobUploadSessionStatus.TOKEN_ISSUED)
    expect(result.reissued).toBe(false)
  })

  it('10. sets tokenIssuedAt', async () => {
    const session = makeSession()
    const prisma = makeFakePrisma([session])

    const result = await claimBlobUploadSessionForToken(prisma, {
      sessionId: session.id,
      pathname: session.expectedPathname,
      now: NOW,
    })

    expect(result.ok).toBe(true)
    expect(result.session.tokenIssuedAt).toEqual(NOW)
  })

  it('11. second claim on TOKEN_ISSUED is idempotent', async () => {
    const session = makeSession({
      status: BlobUploadSessionStatus.TOKEN_ISSUED,
      tokenIssuedAt: NOW,
    })
    const prisma = makeFakePrisma([session])

    const result = await claimBlobUploadSessionForToken(prisma, {
      sessionId: session.id,
      pathname: session.expectedPathname,
      now: NOW,
    })

    expect(result.ok).toBe(true)
    expect(result.reissued).toBe(true)
  })

  it('12. pathname mismatch does not modify the session', async () => {
    const session = makeSession()
    const prisma = makeFakePrisma([session])

    const result = await claimBlobUploadSessionForToken(prisma, {
      sessionId: session.id,
      pathname: 'events/wedding-2026/wrong-uuid.jpg',
      now: NOW,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('pathname_mismatch')
    // Session status must be unchanged
    expect(prisma._store.get(session.id).status).toBe(BlobUploadSessionStatus.PENDING)
  })

  it('13. expired session does not issue a token', async () => {
    const session = makeSession({ expiresAt: PAST })
    const prisma = makeFakePrisma([session])

    const result = await claimBlobUploadSessionForToken(prisma, {
      sessionId: session.id,
      pathname: session.expectedPathname,
      now: NOW,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('expired')
  })

  it('14. null eventId produces event_deleted', async () => {
    const session = makeSession({ eventId: null })
    const prisma = makeFakePrisma([session])

    const result = await claimBlobUploadSessionForToken(prisma, {
      sessionId: session.id,
      pathname: session.expectedPathname,
      now: NOW,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('event_deleted')
  })
})

describe('markBlobUploadSessionUploaded', () => {
  it('15. transitions TOKEN_ISSUED to UPLOADED', async () => {
    const session = makeSession({ status: BlobUploadSessionStatus.TOKEN_ISSUED })
    const prisma = makeFakePrisma([session])

    const result = await markBlobUploadSessionUploaded(prisma, {
      sessionId: session.id,
      pathname: session.expectedPathname,
      blobUrl: VALID_BLOB_URL,
      uploadedAt: NOW,
    })

    expect(result.ok).toBe(true)
    expect(result.idempotent).toBe(false)
    expect(result.session.status).toBe(BlobUploadSessionStatus.UPLOADED)
    expect(result.session.blobUrl).toBe(VALID_BLOB_URL)
  })

  it('16. duplicate callback with same URL is idempotent', async () => {
    const session = makeSession({
      status: BlobUploadSessionStatus.UPLOADED,
      blobUrl: VALID_BLOB_URL,
    })
    const prisma = makeFakePrisma([session])

    const result = await markBlobUploadSessionUploaded(prisma, {
      sessionId: session.id,
      pathname: session.expectedPathname,
      blobUrl: VALID_BLOB_URL,
      uploadedAt: NOW,
    })

    expect(result.ok).toBe(true)
    expect(result.idempotent).toBe(true)
  })

  it('17. duplicate callback with different URL produces blob_url_conflict', async () => {
    // VALID_BLOB_URL_ALT_HOST has the same path as VALID_BLOB_URL so it passes
    // validateBlobUrlForExpectedPathname, but differs in host → conflict
    const session = makeSession({
      status: BlobUploadSessionStatus.UPLOADED,
      blobUrl: VALID_BLOB_URL,
    })
    const prisma = makeFakePrisma([session])

    const result = await markBlobUploadSessionUploaded(prisma, {
      sessionId: session.id,
      pathname: session.expectedPathname,
      blobUrl: VALID_BLOB_URL_ALT_HOST,
      uploadedAt: NOW,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('blob_url_conflict')
  })

  it('18. pathname mismatch is rejected', async () => {
    // WRONG_PATH_BLOB_URL matches the `pathname` argument but not the session's
    // expectedPathname, so updateMany fails and the service returns pathname_mismatch
    const session = makeSession({ status: BlobUploadSessionStatus.TOKEN_ISSUED })
    const prisma = makeFakePrisma([session])

    const result = await markBlobUploadSessionUploaded(prisma, {
      sessionId: session.id,
      pathname: 'events/wedding-2026/wrong-uuid.jpg',
      blobUrl: WRONG_PATH_BLOB_URL,
      uploadedAt: NOW,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('pathname_mismatch')
  })
})

describe('markBlobUploadSessionUploaded — blobUrl validation', () => {
  const SESSION = makeSession({ status: BlobUploadSessionStatus.TOKEN_ISSUED })

  it('new-1. rejects HTTP URL', async () => {
    const prisma = makeFakePrisma([SESSION])
    await expect(
      markBlobUploadSessionUploaded(prisma, {
        sessionId: SESSION.id,
        pathname: SESSION.expectedPathname,
        blobUrl: 'http://abc123.public.blob.vercel-storage.com/events/wedding-2026/photo-uuid.jpg',
        uploadedAt: NOW,
      }),
    ).rejects.toThrow(BlobUploadSessionInvariantError)
  })

  it('new-2. rejects non-Vercel-Blob hostname', async () => {
    const prisma = makeFakePrisma([SESSION])
    await expect(
      markBlobUploadSessionUploaded(prisma, {
        sessionId: SESSION.id,
        pathname: SESSION.expectedPathname,
        blobUrl: 'https://malicious.example.com/events/wedding-2026/photo-uuid.jpg',
        uploadedAt: NOW,
      }),
    ).rejects.toThrow(BlobUploadSessionInvariantError)
  })

  it('new-3. rejects hostname suffix spoofing', async () => {
    // Does NOT end with .blob.vercel-storage.com
    const prisma = makeFakePrisma([SESSION])
    await expect(
      markBlobUploadSessionUploaded(prisma, {
        sessionId: SESSION.id,
        pathname: SESSION.expectedPathname,
        blobUrl:
          'https://store.blob.vercel-storage.com.evil.test/events/wedding-2026/photo-uuid.jpg',
        uploadedAt: NOW,
      }),
    ).rejects.toThrow(BlobUploadSessionInvariantError)
  })

  it('new-3b. rejects blobUrl with query parameters', async () => {
    const prisma = makeFakePrisma([SESSION])
    await expect(
      markBlobUploadSessionUploaded(prisma, {
        sessionId: SESSION.id,
        pathname: SESSION.expectedPathname,
        blobUrl:
          'https://abc123.public.blob.vercel-storage.com/events/wedding-2026/photo-uuid.jpg?download=1',
        uploadedAt: NOW,
      }),
    ).rejects.toThrow(BlobUploadSessionInvariantError)
  })

  it('new-4. rejects blobUrl whose pathname does not match expectedPathname', async () => {
    const prisma = makeFakePrisma([SESSION])
    await expect(
      markBlobUploadSessionUploaded(prisma, {
        sessionId: SESSION.id,
        pathname: SESSION.expectedPathname,
        // Valid host, but path is DIFFERENT.jpg, not photo-uuid.jpg
        blobUrl:
          'https://abc123.public.blob.vercel-storage.com/events/wedding-2026/DIFFERENT.jpg',
        uploadedAt: NOW,
      }),
    ).rejects.toThrow(BlobUploadSessionInvariantError)
  })

  it('new-5. callback on COMPLETED with same blobUrl is idempotent', async () => {
    const session = makeSession({
      status: BlobUploadSessionStatus.COMPLETED,
      blobUrl: VALID_BLOB_URL,
      consumedAt: NOW,
      resultId: 'photo-id-1',
    })
    const prisma = makeFakePrisma([session])

    const result = await markBlobUploadSessionUploaded(prisma, {
      sessionId: session.id,
      pathname: session.expectedPathname,
      blobUrl: VALID_BLOB_URL,
      uploadedAt: NOW,
    })

    expect(result.ok).toBe(true)
    expect(result.idempotent).toBe(true)
  })

  it('new-6. callback on COMPLETED with different blobUrl produces blob_url_conflict', async () => {
    const session = makeSession({
      status: BlobUploadSessionStatus.COMPLETED,
      blobUrl: VALID_BLOB_URL,
      consumedAt: NOW,
      resultId: 'photo-id-1',
    })
    const prisma = makeFakePrisma([session])

    const result = await markBlobUploadSessionUploaded(prisma, {
      sessionId: session.id,
      pathname: session.expectedPathname,
      blobUrl: VALID_BLOB_URL_ALT_HOST,
      uploadedAt: NOW,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('blob_url_conflict')
  })
})

describe('claimBlobUploadSessionForCompletion', () => {
  it('19. sets consumedAt', async () => {
    const session = makeSession({ status: BlobUploadSessionStatus.TOKEN_ISSUED })
    const prisma = makeFakePrisma([session])

    const result = await claimBlobUploadSessionForCompletion(prisma, {
      sessionId: session.id,
      blobUrl: VALID_BLOB_URL,
      now: NOW,
    })

    expect(result.ok).toBe(true)
    expect(result.idempotent).toBe(false)
    expect(result.session.consumedAt).toEqual(NOW)
  })

  it('20. second claim after COMPLETED returns resultId idempotently', async () => {
    const session = makeSession({
      status: BlobUploadSessionStatus.COMPLETED,
      consumedAt: NOW,
      blobUrl: VALID_BLOB_URL,
      resultId: 'photo-id-1',
    })
    const prisma = makeFakePrisma([session])

    const result = await claimBlobUploadSessionForCompletion(prisma, {
      sessionId: session.id,
      blobUrl: VALID_BLOB_URL,
      now: NOW,
    })

    expect(result.ok).toBe(true)
    expect(result.idempotent).toBe(true)
    expect(result.session.resultId).toBe('photo-id-1')
  })

  it('24. PENDING session cannot be completed (token_not_issued)', async () => {
    const session = makeSession({ status: BlobUploadSessionStatus.PENDING })
    const prisma = makeFakePrisma([session])

    const result = await claimBlobUploadSessionForCompletion(prisma, {
      sessionId: session.id,
      blobUrl: VALID_BLOB_URL,
      now: NOW,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('token_not_issued')
  })

  it('25. expired session cannot be completed', async () => {
    const session = makeSession({
      status: BlobUploadSessionStatus.TOKEN_ISSUED,
      expiresAt: PAST,
    })
    const prisma = makeFakePrisma([session])

    const result = await claimBlobUploadSessionForCompletion(prisma, {
      sessionId: session.id,
      blobUrl: VALID_BLOB_URL,
      now: NOW,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('expired')
  })

  it('new-7. completion claim with same stored blobUrl succeeds', async () => {
    // UPLOADED session already has blobUrl from onUploadCompleted callback
    const session = makeSession({
      status: BlobUploadSessionStatus.UPLOADED,
      blobUrl: VALID_BLOB_URL,
      consumedAt: null,
    })
    const prisma = makeFakePrisma([session])

    const result = await claimBlobUploadSessionForCompletion(prisma, {
      sessionId: session.id,
      blobUrl: VALID_BLOB_URL,
      now: NOW,
    })

    expect(result.ok).toBe(true)
    expect(result.idempotent).toBe(false)
    expect(result.session.consumedAt).toEqual(NOW)
  })

  it('new-8. completion claim with different stored blobUrl does not modify session and produces blob_url_conflict', async () => {
    // VALID_BLOB_URL_ALT_HOST passes pathname validation (same path) but
    // conflicts with the already-stored VALID_BLOB_URL (different host)
    const session = makeSession({
      status: BlobUploadSessionStatus.UPLOADED,
      blobUrl: VALID_BLOB_URL,
      consumedAt: null,
    })
    const prisma = makeFakePrisma([session])

    const result = await claimBlobUploadSessionForCompletion(prisma, {
      sessionId: session.id,
      blobUrl: VALID_BLOB_URL_ALT_HOST,
      now: NOW,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('blob_url_conflict')
    // Stored blobUrl must not have been overwritten
    expect(prisma._store.get(session.id).blobUrl).toBe(VALID_BLOB_URL)
  })

  it('new-9. COMPLETED with resultId but different blobUrl is not treated as idempotent', async () => {
    const session = makeSession({
      status: BlobUploadSessionStatus.COMPLETED,
      consumedAt: NOW,
      blobUrl: VALID_BLOB_URL,
      resultId: 'photo-id-1',
    })
    const prisma = makeFakePrisma([session])

    const result = await claimBlobUploadSessionForCompletion(prisma, {
      sessionId: session.id,
      blobUrl: VALID_BLOB_URL_ALT_HOST,
      now: NOW,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('blob_url_conflict')
  })

  it('new-10. consumedAt set with TOKEN_ISSUED/UPLOADED status produces in_progress', async () => {
    // Represents the window between claimForCompletion and finalize
    const session = makeSession({
      status: BlobUploadSessionStatus.TOKEN_ISSUED,
      consumedAt: NOW,
    })
    const prisma = makeFakePrisma([session])

    const result = await claimBlobUploadSessionForCompletion(prisma, {
      sessionId: session.id,
      blobUrl: VALID_BLOB_URL,
      now: NOW,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('in_progress')
  })

  it('new-11. successive token claims produce one first issuance and one idempotent reissuance', async () => {
    const session = makeSession()
    const prisma = makeFakePrisma([session])

    // Simulate two concurrent callers sequentially via the in-memory fake
    const first = await claimBlobUploadSessionForToken(prisma, {
      sessionId: session.id,
      pathname: session.expectedPathname,
      now: NOW,
    })
    // Second caller sees TOKEN_ISSUED (set by first) and gets an idempotent reissue
    const second = await claimBlobUploadSessionForToken(prisma, {
      sessionId: session.id,
      pathname: session.expectedPathname,
      now: NOW,
    })

    expect(first.ok).toBe(true)
    expect(first.reissued).toBe(false)
    expect(second.ok).toBe(true)
    expect(second.reissued).toBe(true)
    // Both callers see TOKEN_ISSUED; the session was not transitioned twice
    expect(first.session.status).toBe(BlobUploadSessionStatus.TOKEN_ISSUED)
    expect(second.session.status).toBe(BlobUploadSessionStatus.TOKEN_ISSUED)
  })
})

describe('claimBlobUploadSessionForCompletion — COMPLETED race condition', () => {
  /**
   * Simulates the race where another transaction finalizes the session
   * between the initial prefetch (TOKEN_ISSUED) and the refetch after
   * updateMany returns count=0.
   *
   * Without the COMPLETED-first check in the fallback, the refetched session
   * has consumedAt set and would incorrectly return 'in_progress'.
   */
  function makeRaceFakePrisma(prefetchState, postUpdateState) {
    let findCallCount = 0

    const delegate = {
      async findUnique() {
        findCallCount++
        if (findCallCount === 1) return { ...prefetchState }
        return postUpdateState ? { ...postUpdateState } : null
      },
      async updateMany() {
        // Simulate the session being claimed by a concurrent transaction
        return { count: 0 }
      },
      async create() {
        throw new Error('create not expected in race test')
      },
    }

    return { blobUploadSession: delegate }
  }

  it('race-1. fallback sees COMPLETED (same blobUrl) → idempotent:true, not in_progress', async () => {
    const prefetch = makeSession({ status: BlobUploadSessionStatus.TOKEN_ISSUED })
    const postUpdate = makeSession({
      status: BlobUploadSessionStatus.COMPLETED,
      consumedAt: NOW,
      blobUrl: VALID_BLOB_URL,
      resultId: 'photo-id-race',
    })
    const prisma = makeRaceFakePrisma(prefetch, postUpdate)

    const result = await claimBlobUploadSessionForCompletion(prisma, {
      sessionId: prefetch.id,
      blobUrl: VALID_BLOB_URL,
      now: NOW,
    })

    // Must NOT return in_progress even though consumedAt is set on postUpdate
    expect(result.ok).toBe(true)
    expect(result.idempotent).toBe(true)
    expect(result.session.resultId).toBe('photo-id-race')
  })

  it('race-2. fallback sees COMPLETED (different blobUrl) → blob_url_conflict, not in_progress', async () => {
    const prefetch = makeSession({ status: BlobUploadSessionStatus.TOKEN_ISSUED })
    const postUpdate = makeSession({
      status: BlobUploadSessionStatus.COMPLETED,
      consumedAt: NOW,
      blobUrl: VALID_BLOB_URL,
      resultId: 'photo-id-race',
    })
    const prisma = makeRaceFakePrisma(prefetch, postUpdate)

    const result = await claimBlobUploadSessionForCompletion(prisma, {
      sessionId: prefetch.id,
      blobUrl: VALID_BLOB_URL_ALT_HOST,
      now: NOW,
    })

    // Must NOT return in_progress; must detect the blobUrl conflict
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('blob_url_conflict')
  })
})

describe('finalizeBlobUploadSession', () => {
  it('21. finalizes session to COMPLETED', async () => {
    const session = makeSession({
      status: BlobUploadSessionStatus.UPLOADED,
      blobUrl: VALID_BLOB_URL,
      consumedAt: NOW,
      resultId: null,
    })
    const prisma = makeFakePrisma([session])

    const result = await finalizeBlobUploadSession(prisma, {
      sessionId: session.id,
      resultId: 'photo-id-1',
    })

    expect(result.status).toBe(BlobUploadSessionStatus.COMPLETED)
    expect(result.resultId).toBe('photo-id-1')
  })

  it('22. duplicate finalize with same resultId is idempotent', async () => {
    const session = makeSession({
      status: BlobUploadSessionStatus.COMPLETED,
      blobUrl: VALID_BLOB_URL,
      consumedAt: NOW,
      resultId: 'photo-id-1',
    })
    const prisma = makeFakePrisma([session])

    const result = await finalizeBlobUploadSession(prisma, {
      sessionId: session.id,
      resultId: 'photo-id-1',
    })

    expect(result.status).toBe(BlobUploadSessionStatus.COMPLETED)
    expect(result.resultId).toBe('photo-id-1')
  })

  it('23. finalize with different resultId throws invariant error', async () => {
    const session = makeSession({
      status: BlobUploadSessionStatus.COMPLETED,
      blobUrl: VALID_BLOB_URL,
      consumedAt: NOW,
      resultId: 'photo-id-1',
    })
    const prisma = makeFakePrisma([session])

    await expect(
      finalizeBlobUploadSession(prisma, {
        sessionId: session.id,
        resultId: 'photo-id-2',
      }),
    ).rejects.toThrow(BlobUploadSessionInvariantError)
  })
})

describe('getBlobUploadSession', () => {
  it('returns the session when it exists', async () => {
    const session = makeSession()
    const prisma = makeFakePrisma([session])
    const result = await getBlobUploadSession(prisma, session.id)
    expect(result).not.toBeNull()
    expect(result.id).toBe(session.id)
  })

  it('returns null without throwing when session does not exist', async () => {
    const prisma = makeFakePrisma()
    const result = await getBlobUploadSession(prisma, 'nonexistent')
    expect(result).toBeNull()
  })
})

describe('no real credentials or tokens in test values', () => {
  it('blob URL constants do not contain secrets', () => {
    for (const url of [VALID_BLOB_URL, VALID_BLOB_URL_ALT_HOST, WRONG_PATH_BLOB_URL]) {
      expect(url).toMatch(/^https:\/\/[^/]+\.blob\.vercel-storage\.com\//)
      expect(url).not.toMatch(/Bearer|token=|secret|password/i)
    }
  })
})
