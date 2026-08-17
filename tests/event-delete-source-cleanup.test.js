import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * STEP 7.15d.3 — Event delete source-cleanup route cutover.
 *
 * This closes two live defects together:
 *
 *   1. EVENT_DELETE_SOURCE_CLEANUP_TRUNCATION — source cleanup used to
 *      iterate the 100-capped presentation list (`event.photos`), silently
 *      stranding originals on any event past that cap (Production holds one
 *      with 186). Cleanup now uses the authoritative, uncapped
 *      `listPhotoSourcesByEventId` inventory instead.
 *
 *   2. EVENT_DELETE_PRECOMMIT_BLOB_DELETION_ORDERING — source/cover/private
 *      asset blobs used to be deleted BEFORE `repository.deleteEvent`, so a
 *      DB failure after those deletes could leave live rows pointing at
 *      permanently destroyed originals. All destructive Blob IO now happens
 *      strictly AFTER a successful DB delete; everything it needs is
 *      captured in PRE-COMMIT snapshots taken while the rows still exist.
 *
 * `deleteEventScopedStoredFile` (the per-source event-scoped guard) is used
 * REAL, not mocked, in every test here — only the underlying
 * `deleteStoredFile` Blob primitive is mocked. The guard is the thing
 * standing between "this event's originals" and "some other event's
 * originals", so its real validation logic must be what's actually
 * exercised, not a stand-in.
 *
 * A note on how a hard-abort actually manifests: every route in this
 * catch-all dispatcher is invoked as `return handler(request, ...)` — NOT
 * `return await handler(...)` — inside `handleRoute`'s try/catch. That means
 * a rejected handler promise is NOT caught and converted to a JSON 500; it
 * propagates as a rejected promise out of `handleRoute` itself. This is
 * pre-existing behavior across the whole file, not something this STEP
 * introduces — it is simply what "the request fails safely using existing
 * server error semantics" (STEP §3) means in this codebase. Tests that
 * expect a hard-required snapshot or a DB-delete failure to abort therefore
 * assert `.rejects.toThrow(...)`, matching every pre-existing test for this
 * same failure shape.
 */

vi.mock('@upstash/redis', () => ({ Redis: vi.fn() }))
vi.mock('@vercel/blob', () => ({
  head: vi.fn(),
  BlobError: class BlobError extends Error {},
}))

vi.mock('@/lib/server/derivative-cleanup', () => ({
  deletePhotoDerivatives: vi.fn().mockResolvedValue({ deleted: 0, failed: 0 }),
  deletePhotoDerivativesBatch: vi.fn().mockResolvedValue({ deleted: 0, failed: 0 }),
}))

vi.mock('@/lib/server/storage', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, deleteStoredFile: vi.fn().mockResolvedValue(undefined) }
})

vi.mock('@/lib/server/ops-alerts', () => ({ sendOpsAlert: vi.fn().mockResolvedValue({ sent: false }) }))

vi.mock('@/lib/server/prisma-client', () => ({
  getPrismaClient: vi.fn(),
  getAdminAuthDriver: vi.fn().mockReturnValue('env'),
  getDataAccessDriver: vi.fn().mockReturnValue('local'),
}))

vi.mock('@/lib/server/management-token', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, verifyManagementToken: vi.fn().mockReturnValue(true) }
})

vi.mock('@/lib/server/gallery-repository', () => ({
  getGalleryRepository: vi.fn(),
  getGalleryRepositoryMode: vi.fn().mockResolvedValue('local'),
}))

import { DELETE } from '@/app/api/[[...path]]/route'
import { deletePhotoDerivativesBatch } from '@/lib/server/derivative-cleanup'
import { deleteStoredFile } from '@/lib/server/storage'
import { sendOpsAlert } from '@/lib/server/ops-alerts'
import { getGalleryRepository } from '@/lib/server/gallery-repository'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { verifyManagementToken } from '@/lib/server/management-token'

const ALLOWED_ORIGIN = 'https://snaprooms.app'
const OWNER_EMAIL = 'owner@example.com'
const SLUG = 'wedding-2026'
const OTHER_SLUG = 'other-event'
const EVENT_ID = 'event-1'
const MANAGEMENT_TOKEN = 'mgmt-token-value'
const HOST = 'https://store.public.blob.vercel-storage.com'

const ORIGINAL_ENV = { ...process.env }

// ─── Synthetic URL fixtures ─────────────────────────────────────────────────

const roomPhotoUrl = (slug, name) => `${HOST}/events/${slug}/${name}.jpg`
const privateAssetUrl = (slug, name) => `${HOST}/private-delivery/${slug}/${name}.zip`
const coverUrl = (slug, name) => `${HOST}/covers/${slug}/${name}.jpg`

const sourceUrls = (count, slug = SLUG) => Array.from({ length: count }, (_, i) => roomPhotoUrl(slug, `photo-${i}`))
const privateAssets = (count, slug = SLUG) =>
  Array.from({ length: count }, (_, i) => ({ id: `asset-${i}`, url: privateAssetUrl(slug, `asset-${i}`) }))

const baseEvent = (overrides = {}) => ({
  id: EVENT_ID,
  slug: SLUG,
  coverUrl: null,
  managementTokenHash: 'hash',
  photos: [],
  ...overrides,
})

function makeRepository(overrides = {}) {
  return {
    getEventBySlug: vi.fn().mockResolvedValue(baseEvent()),
    getEventBySlugAndOwner: vi.fn().mockResolvedValue(baseEvent()),
    listPhotoSourcesByEventId: vi.fn().mockResolvedValue([]),
    listPrivateAssetsByEventId: vi.fn().mockResolvedValue([]),
    listPhotoIdsByEventId: vi.fn().mockResolvedValue([]),
    deleteEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

// ─── Request builders ───────────────────────────────────────────────────────

async function ownerRequest(path, { withAuth = true } = {}) {
  const { createOwnerSessionToken, OWNER_COOKIE_NAME } = await import('@/lib/server/owner-auth')
  const { createCsrfToken } = await import('@/lib/server/csrf')
  const cookieValue = withAuth ? await createOwnerSessionToken({ email: OWNER_EMAIL, sessionVersion: 0 }) : null
  const csrfToken = withAuth ? createCsrfToken(OWNER_EMAIL) : 'invalid-csrf-token'

  return {
    method: 'DELETE',
    headers: {
      get: (name) => {
        const key = name.toLowerCase()
        if (key === 'origin') return ALLOWED_ORIGIN
        if (key === 'x-csrf-token') return csrfToken
        return null
      },
    },
    cookies: { get: (name) => (withAuth && name === OWNER_COOKIE_NAME ? { value: cookieValue } : undefined) },
    json: async () => ({}),
    nextUrl: { searchParams: new URLSearchParams() },
    __path: path,
  }
}

function managementRequest(path, { token = MANAGEMENT_TOKEN } = {}) {
  return {
    method: 'DELETE',
    headers: {
      get: (name) => {
        const key = name.toLowerCase()
        if (key === 'origin') return ALLOWED_ORIGIN
        if (key === 'x-management-token') return token
        return null
      },
    },
    cookies: { get: () => undefined },
    json: async () => ({}),
    nextUrl: { searchParams: new URLSearchParams() },
    __path: path,
  }
}

const invoke = (request) => DELETE(request, { params: { path: request.__path.split('/').filter(Boolean) } })

/** Minimal Prisma double — owner session verification needs sessionVersion. */
const makePrisma = () => ({
  owner: { findUnique: vi.fn().mockResolvedValue({ id: 'owner-1', email: OWNER_EMAIL, sessionVersion: 0 }) },
  event: { findUnique: vi.fn().mockResolvedValue({ id: EVENT_ID, slug: SLUG }) },
})

/** Call-order tracer shared across mocks for the destructive-order test. */
function makeTracer() {
  const order = []
  return { order, push: (label) => order.push(label) }
}

beforeEach(async () => {
  vi.clearAllMocks()
  getPrismaClient.mockResolvedValue(makePrisma())
  verifyManagementToken.mockReturnValue(true)
  process.env.OWNER_SESSION_SECRET = 'test-owner-session-secret'
  process.env.CSRF_SECRET = 'test-csrf-secret'
  process.env.APP_URL = ALLOWED_ORIGIN
  deletePhotoDerivativesBatch.mockResolvedValue({ deleted: 0, failed: 0 })
  sendOpsAlert.mockResolvedValue({ sent: false })
})

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
})

// ─── §39 auth gates the whole inventory ─────────────────────────────────────

describe('§39 auth failure — zero inventory exposure, zero destructive IO', () => {
  it('admin: an invalid management token blocks every snapshot and delete', async () => {
    verifyManagementToken.mockReturnValue(false)
    const repository = makeRepository({ getEventBySlug: vi.fn().mockResolvedValue(baseEvent()) })
    getGalleryRepository.mockResolvedValue(repository)

    const response = await invoke(managementRequest(`/events/${SLUG}`, { token: 'wrong-token' }))

    expect(response.status).toBe(403)
    expect(repository.listPhotoSourcesByEventId).not.toHaveBeenCalled()
    expect(repository.listPrivateAssetsByEventId).not.toHaveBeenCalled()
    expect(repository.deleteEvent).not.toHaveBeenCalled()
    expect(deleteStoredFile).not.toHaveBeenCalled()
  })

  it('owner: an unauthenticated request blocks every snapshot and delete', async () => {
    const repository = makeRepository()
    getGalleryRepository.mockResolvedValue(repository)

    const response = await invoke(await ownerRequest(`/owner/events/${SLUG}`, { withAuth: false }))

    expect(response.status).toBe(401)
    expect(repository.getEventBySlugAndOwner).not.toHaveBeenCalled()
    expect(repository.listPhotoSourcesByEventId).not.toHaveBeenCalled()
    expect(repository.listPrivateAssetsByEventId).not.toHaveBeenCalled()
    expect(repository.deleteEvent).not.toHaveBeenCalled()
    expect(deleteStoredFile).not.toHaveBeenCalled()
  })
})

// ─── §27 hard-required source-snapshot failure ──────────────────────────────

describe('§27 photo source snapshot failure aborts BEFORE any destructive IO', () => {
  it('admin: listPhotoSourcesByEventId throws → nothing destructive runs', async () => {
    const repository = makeRepository({
      listPhotoSourcesByEventId: vi.fn().mockRejectedValue(new Error('connection reset')),
    })
    getGalleryRepository.mockResolvedValue(repository)

    await expect(invoke(managementRequest(`/events/${SLUG}`))).rejects.toThrow('connection reset')

    expect(repository.deleteEvent).not.toHaveBeenCalled()
    expect(deleteStoredFile).not.toHaveBeenCalled()
    expect(deletePhotoDerivativesBatch).not.toHaveBeenCalled()
  })

  it('owner: listPhotoSourcesByEventId throws → nothing destructive runs', async () => {
    const repository = makeRepository({
      listPhotoSourcesByEventId: vi.fn().mockRejectedValue(new Error('connection reset')),
    })
    getGalleryRepository.mockResolvedValue(repository)

    await expect(invoke(await ownerRequest(`/owner/events/${SLUG}`))).rejects.toThrow('connection reset')

    expect(repository.deleteEvent).not.toHaveBeenCalled()
    expect(deleteStoredFile).not.toHaveBeenCalled()
    expect(deletePhotoDerivativesBatch).not.toHaveBeenCalled()
  })
})

// ─── §28 an empty snapshot is a VALID inventory, not a failure ──────────────

describe('§28 empty source snapshot is valid — deletion proceeds normally', () => {
  it('[] photo sources still lets the event delete, with normal post-commit cleanup for the rest', async () => {
    const repository = makeRepository({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue(baseEvent({ coverUrl: coverUrl(SLUG, 'cover') })),
      listPhotoSourcesByEventId: vi.fn().mockResolvedValue([]),
      listPrivateAssetsByEventId: vi.fn().mockResolvedValue(privateAssets(2)),
    })
    getGalleryRepository.mockResolvedValue(repository)

    const response = await invoke(await ownerRequest(`/owner/events/${SLUG}`))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.deleted).toBe(true)
    expect(repository.deleteEvent).toHaveBeenCalledWith(SLUG)
    // Photo-source calls: zero. Cover + private-asset calls: proceed normally.
    const photoCalls = deleteStoredFile.mock.calls.filter(([url]) => url.includes('/events/'))
    expect(photoCalls).toHaveLength(0)
    expect(deleteStoredFile.mock.calls.some(([url]) => url.includes('/covers/'))).toBe(true)
    expect(deleteStoredFile.mock.calls.some(([url]) => url.includes('/private-delivery/'))).toBe(true)
  })
})

// ─── §29 hard-required PrivateAsset snapshot failure ────────────────────────

describe('§29 PrivateAsset snapshot failure aborts BEFORE any destructive IO', () => {
  it('admin: listPrivateAssetsByEventId throws → nothing destructive runs, DB delete never called', async () => {
    const repository = makeRepository({
      listPhotoSourcesByEventId: vi.fn().mockResolvedValue(sourceUrls(3)),
      listPrivateAssetsByEventId: vi.fn().mockRejectedValue(new Error('db hiccup')),
    })
    getGalleryRepository.mockResolvedValue(repository)

    await expect(invoke(managementRequest(`/events/${SLUG}`))).rejects.toThrow('db hiccup')

    // The photo source snapshot ran (it's independent), but losing the DB
    // mapping needed for PrivateAsset cleanup must still block the delete —
    // proceeding would destroy the only mapping that inventory depends on.
    expect(repository.deleteEvent).not.toHaveBeenCalled()
    expect(deleteStoredFile).not.toHaveBeenCalled()
    expect(deletePhotoDerivativesBatch).not.toHaveBeenCalled()
  })

  it('owner: listPrivateAssetsByEventId throws → nothing destructive runs, DB delete never called', async () => {
    const repository = makeRepository({
      listPhotoSourcesByEventId: vi.fn().mockResolvedValue(sourceUrls(3)),
      listPrivateAssetsByEventId: vi.fn().mockRejectedValue(new Error('db hiccup')),
    })
    getGalleryRepository.mockResolvedValue(repository)

    await expect(invoke(await ownerRequest(`/owner/events/${SLUG}`))).rejects.toThrow('db hiccup')

    expect(repository.deleteEvent).not.toHaveBeenCalled()
    expect(deleteStoredFile).not.toHaveBeenCalled()
    expect(deletePhotoDerivativesBatch).not.toHaveBeenCalled()
  })
})

// ─── §30 DB-delete failure — the ordering-bug regression ────────────────────

describe('§30 DB delete failure leaves EVERY source untouched (merge-blocking)', () => {
  it('admin: snapshots succeed, deleteEvent throws → photo/cover/private/derivative deletes are ALL zero', async () => {
    const repository = makeRepository({
      getEventBySlug: vi.fn().mockResolvedValue(baseEvent({ coverUrl: coverUrl(SLUG, 'cover') })),
      listPhotoSourcesByEventId: vi.fn().mockResolvedValue(sourceUrls(5)),
      listPrivateAssetsByEventId: vi.fn().mockResolvedValue(privateAssets(2)),
      listPhotoIdsByEventId: vi.fn().mockResolvedValue(['id-a', 'id-b']),
      deleteEvent: vi.fn().mockRejectedValue(new Error('constraint violation')),
    })
    getGalleryRepository.mockResolvedValue(repository)

    await expect(invoke(managementRequest(`/events/${SLUG}`))).rejects.toThrow('constraint violation')

    // Every pre-commit snapshot DID run — that is expected and safe, they
    // are read-only. Nothing destructive may have run because the event is
    // still alive.
    expect(repository.listPhotoSourcesByEventId).toHaveBeenCalled()
    expect(repository.listPrivateAssetsByEventId).toHaveBeenCalled()
    expect(deleteStoredFile).not.toHaveBeenCalled()
    expect(deletePhotoDerivativesBatch).not.toHaveBeenCalled()
  })

  it('owner: snapshots succeed, deleteEvent throws → photo/cover/private/derivative deletes are ALL zero', async () => {
    const repository = makeRepository({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue(baseEvent({ coverUrl: coverUrl(SLUG, 'cover') })),
      listPhotoSourcesByEventId: vi.fn().mockResolvedValue(sourceUrls(5)),
      listPrivateAssetsByEventId: vi.fn().mockResolvedValue(privateAssets(2)),
      listPhotoIdsByEventId: vi.fn().mockResolvedValue(['id-a', 'id-b']),
      deleteEvent: vi.fn().mockRejectedValue(new Error('constraint violation')),
    })
    getGalleryRepository.mockResolvedValue(repository)

    await expect(invoke(await ownerRequest(`/owner/events/${SLUG}`))).rejects.toThrow('constraint violation')

    expect(repository.listPhotoSourcesByEventId).toHaveBeenCalled()
    expect(repository.listPrivateAssetsByEventId).toHaveBeenCalled()
    expect(deleteStoredFile).not.toHaveBeenCalled()
    expect(deletePhotoDerivativesBatch).not.toHaveBeenCalled()
  })
})

// ─── §31 destructive order ───────────────────────────────────────────────────

describe('§31 destructive order — every snapshot before the gate, every delete after', () => {
  it('admin: instrumented ordering proves the invariant', async () => {
    const tracer = makeTracer()
    const repository = makeRepository({
      getEventBySlug: vi.fn().mockResolvedValue(baseEvent({ coverUrl: coverUrl(SLUG, 'cover') })),
      listPhotoSourcesByEventId: vi.fn(async () => {
        tracer.push('snapshot:photoSources')
        return sourceUrls(2)
      }),
      listPrivateAssetsByEventId: vi.fn(async () => {
        tracer.push('snapshot:privateAssets')
        return privateAssets(1)
      }),
      listPhotoIdsByEventId: vi.fn(async () => {
        tracer.push('snapshot:derivativeIds')
        return ['id-a']
      }),
      deleteEvent: vi.fn(async () => {
        tracer.push('COMMIT:deleteEvent')
      }),
    })
    getGalleryRepository.mockResolvedValue(repository)

    deleteStoredFile.mockImplementation(async (url) => {
      tracer.push(`destructive:deleteStoredFile:${url.includes('/covers/') ? 'cover' : url.includes('/private-delivery/') ? 'private' : 'photo'}`)
    })
    deletePhotoDerivativesBatch.mockImplementation(async () => {
      tracer.push('destructive:deletePhotoDerivativesBatch')
      return { deleted: 0, failed: 0 }
    })

    await invoke(managementRequest(`/events/${SLUG}`))

    const commitIndex = tracer.order.indexOf('COMMIT:deleteEvent')
    expect(commitIndex).toBeGreaterThan(-1)

    const snapshotIndices = tracer.order
      .map((label, i) => (label.startsWith('snapshot:') ? i : -1))
      .filter((i) => i !== -1)
    const destructiveIndices = tracer.order
      .map((label, i) => (label.startsWith('destructive:') ? i : -1))
      .filter((i) => i !== -1)

    expect(snapshotIndices.length).toBe(3)
    expect(destructiveIndices.length).toBeGreaterThan(0)
    for (const i of snapshotIndices) expect(i).toBeLessThan(commitIndex)
    for (const i of destructiveIndices) expect(i).toBeGreaterThan(commitIndex)
  })
})

// ─── §32 wrong-event URL ─────────────────────────────────────────────────────

describe('§32 a source scoped to a DIFFERENT event is skipped, never deleted', () => {
  it('owner: Event B url mixed into Event A cleanup is skipped, Event A urls still processed, 200 preserved, one alert', async () => {
    const wrongEventUrl = roomPhotoUrl(OTHER_SLUG, 'stray')
    const repository = makeRepository({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue(baseEvent()),
      listPhotoSourcesByEventId: vi.fn().mockResolvedValue([roomPhotoUrl(SLUG, 'a'), wrongEventUrl, roomPhotoUrl(SLUG, 'b')]),
    })
    getGalleryRepository.mockResolvedValue(repository)

    const response = await invoke(await ownerRequest(`/owner/events/${SLUG}`))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.deleted).toBe(true)

    // The real guard must have rejected the cross-event url before it ever
    // reached the storage primitive.
    const deletedUrls = deleteStoredFile.mock.calls.map(([url]) => url)
    expect(deletedUrls).not.toContain(wrongEventUrl)
    expect(deletedUrls).toContain(roomPhotoUrl(SLUG, 'a'))
    expect(deletedUrls).toContain(roomPhotoUrl(SLUG, 'b'))

    // skippedCount > 0 makes this a PARTIAL cleanup, not a clean one.
    expect(sendOpsAlert).toHaveBeenCalledTimes(1)
    const alert = sendOpsAlert.mock.calls[0][0]
    expect(alert.context.photoSkippedCount).toBe(1)
    expect(alert.context.photoFailureCount).toBe(0)
  })
})

// ─── §33 malformed sources — never delete through a fallback ────────────────

describe('§33 malformed/unsafe source urls are skipped, never deleted, sibling candidates continue', () => {
  const cases = [
    ['external host', 'https://evil.example.com/events/wedding-2026/x.jpg'],
    ['wrong namespace', `${HOST}/private-delivery/${SLUG}/x.jpg`],
    ['nested path', `${HOST}/events/${SLUG}/nested/x.jpg`],
    ['wrong event slug', roomPhotoUrl('someone-elses-event', 'x')],
    ['malformed (not a URL)', 'not-a-url-at-all'],
  ]

  it.each(cases)('%s is skipped and does not block the rest', async (_label, badUrl) => {
    const repository = makeRepository({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue(baseEvent()),
      listPhotoSourcesByEventId: vi.fn().mockResolvedValue([badUrl, roomPhotoUrl(SLUG, 'valid')]),
    })
    getGalleryRepository.mockResolvedValue(repository)

    const response = await invoke(await ownerRequest(`/owner/events/${SLUG}`))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.deleted).toBe(true)

    const deletedUrls = deleteStoredFile.mock.calls.map(([url]) => url)
    expect(deletedUrls).not.toContain(badUrl)
    expect(deletedUrls).toContain(roomPhotoUrl(SLUG, 'valid'))
    expect(sendOpsAlert).toHaveBeenCalledTimes(1)
  })
})

// ─── §34 partial photo delete failure at Production scale ──────────────────

describe('§34 partial photo delete failures at scale (186 candidates)', () => {
  it('all 186 are attempted sequentially, DB delete stays committed, 200 preserved, exactly one alert', async () => {
    const urls = sourceUrls(186)
    const repository = makeRepository({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue(baseEvent()),
      listPhotoSourcesByEventId: vi.fn().mockResolvedValue(urls),
    })
    getGalleryRepository.mockResolvedValue(repository)

    const failAt = new Set([10, 50, 100])
    let call = 0
    deleteStoredFile.mockImplementation(async () => {
      const i = call++
      if (failAt.has(i)) throw new Error(`transient failure at ${i}`)
    })

    const response = await invoke(await ownerRequest(`/owner/events/${SLUG}`))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.deleted).toBe(true)
    expect(repository.deleteEvent).toHaveBeenCalledTimes(1)
    expect(deleteStoredFile).toHaveBeenCalledTimes(186)

    expect(sendOpsAlert).toHaveBeenCalledTimes(1)
    const alert = sendOpsAlert.mock.calls[0][0]
    expect(alert.context.photoCandidateCount).toBe(186)
    expect(alert.context.photoFailureCount).toBe(3)
    expect(alert.context.photoSkippedCount).toBe(0)

    // No wildcard/prefix retry — no url ever appears in the alert context.
    expect(JSON.stringify(alert.context)).not.toMatch(/https?:\/\//)
  })
})

// ─── §35 cover failure ───────────────────────────────────────────────────────

describe('§35 cover cleanup failure does not block the rest', () => {
  it('cover fails, private-asset and derivative cleanup still run, 200 preserved, alert emitted', async () => {
    const failingCover = coverUrl(SLUG, 'cover')
    const repository = makeRepository({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue(baseEvent({ coverUrl: failingCover })),
      listPrivateAssetsByEventId: vi.fn().mockResolvedValue(privateAssets(2)),
      listPhotoIdsByEventId: vi.fn().mockResolvedValue(['id-a']),
    })
    getGalleryRepository.mockResolvedValue(repository)

    deleteStoredFile.mockImplementation(async (url) => {
      if (url === failingCover) throw new Error('cover blob boom')
    })

    const response = await invoke(await ownerRequest(`/owner/events/${SLUG}`))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.deleted).toBe(true)

    // Private assets still attempted despite the earlier cover failure.
    const privateCalls = deleteStoredFile.mock.calls.filter(([url]) => url.includes('/private-delivery/'))
    expect(privateCalls).toHaveLength(2)
    expect(deletePhotoDerivativesBatch).toHaveBeenCalledWith(['id-a'], expect.anything())

    expect(sendOpsAlert).toHaveBeenCalledTimes(1)
    expect(sendOpsAlert.mock.calls[0][0].context.coverFailure).toBe(true)
  })
})

// ─── §36 PrivateAsset failure ────────────────────────────────────────────────

describe('§36 a PrivateAsset delete failure does not block the rest', () => {
  it('one private asset fails, remaining continue, derivative cleanup still runs, 200 preserved, no URL leakage', async () => {
    const assets = privateAssets(3)
    const failingUrl = assets[1].url
    const repository = makeRepository({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue(baseEvent()),
      listPrivateAssetsByEventId: vi.fn().mockResolvedValue(assets),
      listPhotoIdsByEventId: vi.fn().mockResolvedValue(['id-a']),
    })
    getGalleryRepository.mockResolvedValue(repository)

    deleteStoredFile.mockImplementation(async (url) => {
      if (url === failingUrl) throw new Error('private asset blob boom')
    })

    const response = await invoke(await ownerRequest(`/owner/events/${SLUG}`))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.deleted).toBe(true)

    const privateCalls = deleteStoredFile.mock.calls.filter(([url]) => url.includes('/private-delivery/'))
    expect(privateCalls).toHaveLength(3)
    expect(deletePhotoDerivativesBatch).toHaveBeenCalledWith(['id-a'], expect.anything())

    expect(sendOpsAlert).toHaveBeenCalledTimes(1)
    const alert = sendOpsAlert.mock.calls[0][0]
    expect(alert.context.privateAssetFailureCount).toBe(1)
    expect(JSON.stringify(alert)).not.toMatch(/https?:\/\//)
  })
})

// ─── §37 derivative snapshot failure asymmetry ──────────────────────────────

describe('§37 derivative snapshot failure is the ONLY best-effort one — event delete still proceeds fully', () => {
  it('listPhotoIdsByEventId throws, but source + private-asset snapshots succeeded → deletion proceeds normally', async () => {
    const repository = makeRepository({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue(baseEvent({ coverUrl: coverUrl(SLUG, 'cover') })),
      listPhotoSourcesByEventId: vi.fn().mockResolvedValue(sourceUrls(2)),
      listPrivateAssetsByEventId: vi.fn().mockResolvedValue(privateAssets(1)),
      listPhotoIdsByEventId: vi.fn().mockRejectedValue(new Error('redis down')),
    })
    getGalleryRepository.mockResolvedValue(repository)

    const response = await invoke(await ownerRequest(`/owner/events/${SLUG}`))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.deleted).toBe(true)
    expect(repository.deleteEvent).toHaveBeenCalledWith(SLUG)

    const photoCalls = deleteStoredFile.mock.calls.filter(([url]) => url.includes('/events/'))
    const privateCalls = deleteStoredFile.mock.calls.filter(([url]) => url.includes('/private-delivery/'))
    const coverCalls = deleteStoredFile.mock.calls.filter(([url]) => url.includes('/covers/'))
    expect(photoCalls).toHaveLength(2)
    expect(privateCalls).toHaveLength(1)
    expect(coverCalls).toHaveLength(1)

    // No derivative ids were available — the batch call gets an empty array.
    expect(deletePhotoDerivativesBatch).toHaveBeenCalledWith([], expect.anything())
  })
})

// ─── §38 derivative cleanup failure is uncoupled from the alert ────────────

describe('§38 a derivative-only failure does not affect Event-delete success or the source alert', () => {
  it('deletePhotoDerivativesBatch reports failures, but nothing else failed → no ops alert fires', async () => {
    const repository = makeRepository({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue(baseEvent()),
      listPhotoSourcesByEventId: vi.fn().mockResolvedValue(sourceUrls(3)),
      listPhotoIdsByEventId: vi.fn().mockResolvedValue(['id-a', 'id-b']),
    })
    getGalleryRepository.mockResolvedValue(repository)
    deletePhotoDerivativesBatch.mockResolvedValue({ deleted: 0, failed: 2 })

    const response = await invoke(await ownerRequest(`/owner/events/${SLUG}`))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.deleted).toBe(true)
    // Photo source cleanup was unaffected by the derivative batch's result.
    expect(deleteStoredFile).toHaveBeenCalledTimes(3)
    // Derivative-only failure is recoverable by the reconciliation cron and
    // is deliberately NOT folded into the source-cleanup aggregate alert.
    expect(sendOpsAlert).not.toHaveBeenCalled()
  })
})

// ─── §40 status inclusion — no filtering by the route ───────────────────────

describe('§40 the route never filters the authoritative source inventory', () => {
  it('every url the repository returns is processed, regardless of the Photo status behind it', async () => {
    // The route only ever sees urls, never status — this pins that nothing
    // in the route re-derives or filters by VISIBLE/HIDDEN after the fact.
    const urls = [roomPhotoUrl(SLUG, 'visible-1'), roomPhotoUrl(SLUG, 'hidden-1'), roomPhotoUrl(SLUG, 'visible-2')]
    const repository = makeRepository({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue(baseEvent()),
      listPhotoSourcesByEventId: vi.fn().mockResolvedValue(urls),
    })
    getGalleryRepository.mockResolvedValue(repository)

    await invoke(await ownerRequest(`/owner/events/${SLUG}`))

    const deletedUrls = deleteStoredFile.mock.calls.map(([url]) => url)
    for (const url of urls) expect(deletedUrls).toContain(url)
  })
})

// ─── §5 / §16 cover value comes from the already-fetched Event, no new query ─

describe('cover cleanup uses the pre-fetched Event.coverUrl — no extra query', () => {
  it('a null coverUrl never calls deleteManagedEventCover/deleteStoredFile for a cover', async () => {
    const repository = makeRepository({ getEventBySlugAndOwner: vi.fn().mockResolvedValue(baseEvent({ coverUrl: null })) })
    getGalleryRepository.mockResolvedValue(repository)

    await invoke(await ownerRequest(`/owner/events/${SLUG}`))

    expect(deleteStoredFile.mock.calls.some(([url]) => url.includes('/covers/'))).toBe(false)
  })
})

// ─── §11 / §42 the real guard remains load-bearing (no weakening) ───────────

describe('the event-scoped guard is exercised for real — no direct del(url), no bypass', () => {
  it('deleteStoredFile is only ever called with the exact validated url — never a constructed variant', async () => {
    const url = roomPhotoUrl(SLUG, 'exact')
    const repository = makeRepository({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue(baseEvent()),
      listPhotoSourcesByEventId: vi.fn().mockResolvedValue([url]),
    })
    getGalleryRepository.mockResolvedValue(repository)

    await invoke(await ownerRequest(`/owner/events/${SLUG}`))

    expect(deleteStoredFile).toHaveBeenCalledTimes(1)
    expect(deleteStoredFile).toHaveBeenCalledWith(url)
  })
})
