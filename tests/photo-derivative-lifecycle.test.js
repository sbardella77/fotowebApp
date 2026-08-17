import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// STEP 7.15d §33–§36 — lifecycle integration through the real HTTP handlers.
//
// Every path that removes or hides a Photo attempts derivative cleanup,
// best-effort, without altering the existing HTTP contract.
//
// STEP 7.15d.3 UPDATE: the §35/§36 block below used to assert that Event
// deletion passed exactly the presentation-capped `event.photos` (100) to
// deleteEventScopedStoredFile, as SCOPE EVIDENCE that STEP 7.15d had not
// widened source-original deletion. That was deliberate at the time —
// EVENT_DELETE_SOURCE_CLEANUP_TRUNCATION was still OPEN. STEP 7.15d.3 fixes
// it: Event deletion now uses the authoritative, uncapped
// `listPhotoSourcesByEventId` inventory instead of `event.photos`, so those
// assertions are UPDATED below from 100 to 186 — the historical scope proof
// is intentionally invalidated, not accidentally broken. The full behavior
// matrix for the new pre-commit/post-commit cutover lives in
// tests/event-delete-source-cleanup.test.js.

vi.mock('@upstash/redis', () => ({ Redis: vi.fn() }))
vi.mock('@vercel/blob', () => ({
  head: vi.fn(),
  BlobError: class BlobError extends Error {},
}))

vi.mock('@/lib/server/derivative-cleanup', () => ({
  deletePhotoDerivatives: vi.fn().mockResolvedValue({ deleted: 2, failed: 0 }),
  deletePhotoDerivativesBatch: vi.fn().mockResolvedValue({ deleted: 0, failed: 0 }),
}))

vi.mock('@/lib/server/storage', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, deleteStoredFile: vi.fn().mockResolvedValue(undefined) }
})

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

import { DELETE, PATCH } from '@/app/api/[[...path]]/route'
import { deletePhotoDerivatives, deletePhotoDerivativesBatch } from '@/lib/server/derivative-cleanup'
import { deleteStoredFile } from '@/lib/server/storage'
import { getGalleryRepository } from '@/lib/server/gallery-repository'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { buildDerivativePath } from '@/lib/server/download-derivative'
import { buildDisplayDerivativePath } from '@/lib/server/display-derivative'

const ALLOWED_ORIGIN = 'https://snaprooms.app'
const OWNER_EMAIL = 'owner@example.com'
const SLUG = 'wedding-2026'
const EVENT_ID = 'event-1'
const PHOTO_ID = '11111111-1111-4111-8111-111111111111'
const MANAGEMENT_TOKEN = 'mgmt-token-value'

const ORIGINAL_ENV = { ...process.env }

const photoRecord = (overrides = {}) => ({
  id: PHOTO_ID,
  eventId: EVENT_ID,
  status: 'VISIBLE',
  url: `https://store.public.blob.vercel-storage.com/events/${SLUG}/${PHOTO_ID}-photo.jpg`,
  ...overrides,
})

/** Presentation-capped photo list, exactly as the repository returns it. */
const cappedPhotos = (count) =>
  Array.from({ length: count }, (_, i) => ({
    id: `capped-${i}`,
    eventId: EVENT_ID,
    status: 'VISIBLE',
    url: `https://store.public.blob.vercel-storage.com/events/${SLUG}/capped-${i}.jpg`,
  }))

function makeRepository(overrides = {}) {
  return {
    getPhotoById: vi.fn().mockResolvedValue(photoRecord()),
    createPhoto: vi.fn(),
    deletePhoto: vi.fn().mockResolvedValue(photoRecord()),
    deletePhotoByOwner: vi.fn().mockResolvedValue(photoRecord()),
    setPhotoStatus: vi.fn(),
    setPhotoStatusByOwner: vi.fn(),
    getEventById: vi.fn().mockResolvedValue({ id: EVENT_ID, slug: SLUG }),
    getEventBySlug: vi.fn(),
    getEventBySlugAndOwner: vi.fn(),
    listPhotoIdsByEventId: vi.fn().mockResolvedValue([]),
    listPhotoSourcesByEventId: vi.fn().mockResolvedValue([]),
    listPrivateAssetsByEventId: vi.fn().mockResolvedValue([]),
    deleteEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

// ─── Request builders ───────────────────────────────────────────────────────

async function adminRequest(path, method) {
  const { createAdminSessionToken, ADMIN_COOKIE_NAME } = await import('@/lib/server/admin-auth')
  const { createCsrfToken } = await import('@/lib/server/csrf')
  const cookieValue = await createAdminSessionToken()
  // requireAdminWithCsrf derives the subject from the verified session, which
  // is a boolean here, so the subject is the literal 'admin:session'.
  const csrfToken = createCsrfToken('admin:session')

  return {
    method,
    headers: {
      get: (name) => {
        const key = name.toLowerCase()
        if (key === 'origin') return ALLOWED_ORIGIN
        if (key === 'x-csrf-token') return csrfToken
        return null
      },
    },
    cookies: { get: (name) => (name === ADMIN_COOKIE_NAME ? { value: cookieValue } : undefined) },
    json: async () => ({ action: 'reject' }),
    nextUrl: { searchParams: new URLSearchParams() },
    __path: path,
  }
}

async function ownerRequest(path, method, body = { action: 'reject' }) {
  const { createOwnerSessionToken, OWNER_COOKIE_NAME } = await import('@/lib/server/owner-auth')
  const { createCsrfToken } = await import('@/lib/server/csrf')
  const cookieValue = await createOwnerSessionToken({ email: OWNER_EMAIL, sessionVersion: 0 })
  const csrfToken = createCsrfToken(OWNER_EMAIL)

  return {
    method,
    headers: {
      get: (name) => {
        const key = name.toLowerCase()
        if (key === 'origin') return ALLOWED_ORIGIN
        if (key === 'x-csrf-token') return csrfToken
        return null
      },
    },
    cookies: { get: (name) => (name === OWNER_COOKIE_NAME ? { value: cookieValue } : undefined) },
    json: async () => body,
    nextUrl: { searchParams: new URLSearchParams() },
    __path: path,
  }
}

function managementRequest(path) {
  return {
    method: 'DELETE',
    headers: {
      get: (name) => {
        const key = name.toLowerCase()
        if (key === 'origin') return ALLOWED_ORIGIN
        if (key === 'x-management-token') return MANAGEMENT_TOKEN
        return null
      },
    },
    cookies: { get: () => undefined },
    json: async () => ({}),
    nextUrl: { searchParams: new URLSearchParams() },
    __path: path,
  }
}

const invoke = (handler, request) =>
  handler(request, { params: { path: request.__path.split('/').filter(Boolean) } })

/**
 * Minimal Prisma double. Owner session verification validates sessionVersion
 * against the database and fails CLOSED without it, and admin photo delete
 * resolves the event slug through Prisma for its audit log.
 */
const makePrisma = () => ({
  owner: {
    findUnique: vi.fn().mockResolvedValue({ id: 'owner-1', email: OWNER_EMAIL, sessionVersion: 0 }),
  },
  event: { findUnique: vi.fn().mockResolvedValue({ id: EVENT_ID, slug: SLUG }) },
  deletionLog: { create: vi.fn().mockResolvedValue({}) },
})

beforeEach(async () => {
  vi.clearAllMocks()
  getPrismaClient.mockResolvedValue(makePrisma())
  process.env.ADMIN_SESSION_SECRET = 'test-admin-session-secret'
  process.env.OWNER_SESSION_SECRET = 'test-owner-session-secret'
  process.env.CSRF_SECRET = 'test-csrf-secret'
  process.env.APP_URL = ALLOWED_ORIGIN
  deletePhotoDerivatives.mockResolvedValue({ deleted: 2, failed: 0 })
  deletePhotoDerivativesBatch.mockResolvedValue({ deleted: 0, failed: 0 })
})

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
})

// ─── §33 Photo delete ───────────────────────────────────────────────────────

describe('§33 admin photo delete', () => {
  it('attempts derivative cleanup with the deleted photo id', async () => {
    const repository = makeRepository()
    getGalleryRepository.mockResolvedValue(repository)

    const response = await invoke(DELETE, await adminRequest(`/admin/photos/${PHOTO_ID}`, 'DELETE'))

    expect(response.status).toBe(200)
    expect(deletePhotoDerivatives).toHaveBeenCalledTimes(1)
    expect(deletePhotoDerivatives.mock.calls[0][0]).toBe(PHOTO_ID)
  })

  it('the id it passes resolves to exactly the wm-v1 and display-v1 pathnames', async () => {
    getGalleryRepository.mockResolvedValue(makeRepository())

    await invoke(DELETE, await adminRequest(`/admin/photos/${PHOTO_ID}`, 'DELETE'))

    const id = deletePhotoDerivatives.mock.calls[0][0]
    expect(buildDerivativePath(id)).toBe(`derivatives/wm-v1/${PHOTO_ID}.jpg`)
    expect(buildDisplayDerivativePath(id)).toBe(`derivatives/display-v1/${PHOTO_ID}.jpg`)
  })

  it('runs cleanup only AFTER the DB delete has succeeded', async () => {
    const order = []
    const repository = makeRepository({
      deletePhoto: vi.fn(async () => {
        order.push('db-delete')
        return photoRecord()
      }),
    })
    getGalleryRepository.mockResolvedValue(repository)
    deletePhotoDerivatives.mockImplementation(async () => {
      order.push('derivative-cleanup')
      return { deleted: 2, failed: 0 }
    })

    await invoke(DELETE, await adminRequest(`/admin/photos/${PHOTO_ID}`, 'DELETE'))

    expect(order).toEqual(['db-delete', 'derivative-cleanup'])
  })

  it('does not attempt cleanup when the photo does not exist', async () => {
    getGalleryRepository.mockResolvedValue(makeRepository({ getPhotoById: vi.fn().mockResolvedValue(null) }))

    const response = await invoke(DELETE, await adminRequest(`/admin/photos/${PHOTO_ID}`, 'DELETE'))

    expect(response.status).toBe(404)
    expect(deletePhotoDerivatives).not.toHaveBeenCalled()
  })

  it('preserves the existing source-blob cleanup call exactly', async () => {
    const photo = photoRecord()
    getGalleryRepository.mockResolvedValue(makeRepository())

    await invoke(DELETE, await adminRequest(`/admin/photos/${PHOTO_ID}`, 'DELETE'))

    expect(deleteStoredFile).toHaveBeenCalledTimes(1)
    expect(deleteStoredFile).toHaveBeenCalledWith(photo.url)
  })
})

describe('§33 owner photo delete', () => {
  it('attempts derivative cleanup with the deleted photo id', async () => {
    getGalleryRepository.mockResolvedValue(makeRepository())

    const response = await invoke(DELETE, await ownerRequest(`/owner/photos/${PHOTO_ID}`, 'DELETE'))

    expect(response.status).toBe(200)
    expect(deletePhotoDerivatives).toHaveBeenCalledTimes(1)
    expect(deletePhotoDerivatives.mock.calls[0][0]).toBe(PHOTO_ID)
  })

  it('uses the same shared helper as the admin path — no duplicated path logic', async () => {
    getGalleryRepository.mockResolvedValue(makeRepository())
    await invoke(DELETE, await ownerRequest(`/owner/photos/${PHOTO_ID}`, 'DELETE'))
    const ownerCallId = deletePhotoDerivatives.mock.calls[0][0]

    vi.clearAllMocks()
    getGalleryRepository.mockResolvedValue(makeRepository())
    deletePhotoDerivatives.mockResolvedValue({ deleted: 2, failed: 0 })
    await invoke(DELETE, await adminRequest(`/admin/photos/${PHOTO_ID}`, 'DELETE'))

    expect(deletePhotoDerivatives.mock.calls[0][0]).toBe(ownerCallId)
  })

  it('does not attempt cleanup when the owner does not own the photo', async () => {
    getGalleryRepository.mockResolvedValue(
      makeRepository({ deletePhotoByOwner: vi.fn().mockResolvedValue(null) }),
    )

    const response = await invoke(DELETE, await ownerRequest(`/owner/photos/${PHOTO_ID}`, 'DELETE'))

    expect(response.status).toBe(404)
    expect(deletePhotoDerivatives).not.toHaveBeenCalled()
  })
})

describe('§33 / §7 cleanup failure preserves the delete contract', () => {
  it('a throwing cleanup never rolls back the photo deletion', async () => {
    // The real helper is total — it never throws (proven in
    // derivative-cleanup.test.js). Even under a contract violation, nothing
    // compensates or restores the deleted row: derivatives are caches.
    const repository = makeRepository()
    getGalleryRepository.mockResolvedValue(repository)
    deletePhotoDerivatives.mockRejectedValue(new Error('blob unavailable'))

    await invoke(DELETE, await adminRequest(`/admin/photos/${PHOTO_ID}`, 'DELETE')).catch(() => {})

    expect(repository.deletePhoto).toHaveBeenCalledTimes(1)
    expect(repository.createPhoto).not.toHaveBeenCalled()
  })

  it('a reported cleanup failure does not change the success response', async () => {
    getGalleryRepository.mockResolvedValue(makeRepository())
    deletePhotoDerivatives.mockResolvedValue({ deleted: 0, failed: 2 })

    const response = await invoke(DELETE, await adminRequest(`/admin/photos/${PHOTO_ID}`, 'DELETE'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.deleted).toBe(true)
  })
})

// ─── §34 status transitions ─────────────────────────────────────────────────

describe('§34 VISIBLE → HIDDEN', () => {
  it('admin reject deletes derivatives for the hidden photo', async () => {
    getGalleryRepository.mockResolvedValue(
      makeRepository({ setPhotoStatus: vi.fn().mockResolvedValue(photoRecord({ status: 'HIDDEN' })) }),
    )

    const response = await invoke(PATCH, await adminRequest(`/admin/photos/${PHOTO_ID}`, 'PATCH'))

    expect(response.status).toBe(200)
    expect(deletePhotoDerivatives).toHaveBeenCalledTimes(1)
    expect(deletePhotoDerivatives.mock.calls[0][0]).toBe(PHOTO_ID)
  })

  it('owner reject deletes derivatives for the hidden photo', async () => {
    getGalleryRepository.mockResolvedValue(
      makeRepository({ setPhotoStatusByOwner: vi.fn().mockResolvedValue(photoRecord({ status: 'HIDDEN' })) }),
    )

    const response = await invoke(PATCH, await ownerRequest(`/owner/photos/${PHOTO_ID}`, 'PATCH'))

    expect(response.status).toBe(200)
    expect(deletePhotoDerivatives).toHaveBeenCalledTimes(1)
  })

  it('cleanup failure does not revert the status or the success response', async () => {
    const setPhotoStatus = vi.fn().mockResolvedValue(photoRecord({ status: 'HIDDEN' }))
    getGalleryRepository.mockResolvedValue(makeRepository({ setPhotoStatus }))
    deletePhotoDerivatives.mockResolvedValue({ deleted: 0, failed: 2 })

    const response = await invoke(PATCH, await adminRequest(`/admin/photos/${PHOTO_ID}`, 'PATCH'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.photo.status).toBe('HIDDEN')
    // Exactly one status write: nothing attempted to restore VISIBLE.
    expect(setPhotoStatus).toHaveBeenCalledTimes(1)
    expect(setPhotoStatus).toHaveBeenCalledWith(PHOTO_ID, 'HIDDEN')
  })

  it('§13 an idempotent re-hide may safely repeat the cleanup', async () => {
    getGalleryRepository.mockResolvedValue(
      makeRepository({ setPhotoStatus: vi.fn().mockResolvedValue(photoRecord({ status: 'HIDDEN' })) }),
    )

    await invoke(PATCH, await adminRequest(`/admin/photos/${PHOTO_ID}`, 'PATCH'))
    await invoke(PATCH, await adminRequest(`/admin/photos/${PHOTO_ID}`, 'PATCH'))

    expect(deletePhotoDerivatives).toHaveBeenCalledTimes(2)
  })
})

describe('§34 / §12 HIDDEN → VISIBLE', () => {
  it('approve deletes nothing', async () => {
    getGalleryRepository.mockResolvedValue(
      makeRepository({ setPhotoStatus: vi.fn().mockResolvedValue(photoRecord({ status: 'VISIBLE' })) }),
    )

    const request = await adminRequest(`/admin/photos/${PHOTO_ID}`, 'PATCH')
    request.json = async () => ({ action: 'approve' })

    const response = await invoke(PATCH, request)

    expect(response.status).toBe(200)
    expect(deletePhotoDerivatives).not.toHaveBeenCalled()
  })

  it('approve generates nothing — display generation is a later workstream', async () => {
    // DISPLAY_REGEN_ON_VISIBLE_TRANSITION is deliberately PENDING: this STEP
    // deletes and reconciles only. If a generation call ever appears on this
    // path, it must arrive with its own step, not by accident here.
    const displayModule = await import('@/lib/server/display-derivative')
    const spy = vi.spyOn(displayModule, 'getDisplayDerivative')

    getGalleryRepository.mockResolvedValue(
      makeRepository({ setPhotoStatus: vi.fn().mockResolvedValue(photoRecord({ status: 'VISIBLE' })) }),
    )
    const request = await adminRequest(`/admin/photos/${PHOTO_ID}`, 'PATCH')
    request.json = async () => ({ action: 'approve' })

    await invoke(PATCH, request)

    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

// ─── §35 the >100 event regression ──────────────────────────────────────────

describe('§35 event delete uses an AUTHORITATIVE, untruncated id snapshot', () => {
  const ids186 = Array.from({ length: 186 }, (_, i) => `photo-${i}`)
  const sourceUrls186 = Array.from(
    { length: 186 },
    (_, i) => `https://store.public.blob.vercel-storage.com/events/${SLUG}/source-${i}.jpg`,
  )

  const eventWith = (photos) => ({
    id: EVENT_ID,
    slug: SLUG,
    coverUrl: null,
    managementTokenHash: 'hash',
    photos,
  })

  it('management-token delete schedules all 186 ids while event.photos exposes only 100', async () => {
    const repository = makeRepository({
      getEventBySlug: vi.fn().mockResolvedValue(eventWith(cappedPhotos(100))),
      listPhotoIdsByEventId: vi.fn().mockResolvedValue(ids186),
      listPhotoSourcesByEventId: vi.fn().mockResolvedValue(sourceUrls186),
    })
    getGalleryRepository.mockResolvedValue(repository)

    const response = await invoke(DELETE, managementRequest(`/events/${SLUG}`))

    expect(response.status).toBe(200)
    expect(repository.listPhotoIdsByEventId).toHaveBeenCalledWith(EVENT_ID)

    const scheduled = deletePhotoDerivativesBatch.mock.calls[0][0]
    expect(scheduled).toHaveLength(186)

    // STEP 7.15d.3: source cleanup now uses the authoritative, uncapped
    // inventory instead of the 100-capped presentation list — all 186 are
    // cleaned up, not just the ones event.photos happened to expose.
    expect(deleteStoredFile).toHaveBeenCalledTimes(186)
  })

  it('owner event delete schedules ALL 186 ids for derivative cleanup', async () => {
    const repository = makeRepository({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue(eventWith(cappedPhotos(100))),
      listPhotoIdsByEventId: vi.fn().mockResolvedValue(ids186),
    })
    getGalleryRepository.mockResolvedValue(repository)

    const response = await invoke(DELETE, await ownerRequest(`/owner/events/${SLUG}`, 'DELETE'))

    expect(response.status).toBe(200)
    expect(repository.listPhotoIdsByEventId).toHaveBeenCalledWith(EVENT_ID)
    expect(deletePhotoDerivativesBatch).toHaveBeenCalledTimes(1)

    const scheduled = deletePhotoDerivativesBatch.mock.calls[0][0]
    expect(scheduled).toHaveLength(186)
    expect(scheduled).toEqual(ids186)
  })

  // STEP 7.15d.3: this test used to be named "SCOPE EVIDENCE: source cleanup
  // is NOT broadened — still exactly the capped 100" and asserted exactly
  // 100 deleteStoredFile calls, proving STEP 7.15d had deliberately NOT
  // fixed EVENT_DELETE_SOURCE_CLEANUP_TRUNCATION. This step fixes it, so the
  // historical proof is intentionally inverted: the assertion below moves
  // from 100 to 186, and the test now proves the opposite of what it used to.
  it('STEP 7.15d.3: source cleanup now uses the complete authoritative inventory (186, not the capped 100)', async () => {
    const repository = makeRepository({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue(eventWith(cappedPhotos(100))),
      listPhotoIdsByEventId: vi.fn().mockResolvedValue(ids186),
      listPhotoSourcesByEventId: vi.fn().mockResolvedValue(sourceUrls186),
    })
    getGalleryRepository.mockResolvedValue(repository)

    await invoke(DELETE, await ownerRequest(`/owner/events/${SLUG}`, 'DELETE'))

    expect(repository.listPhotoSourcesByEventId).toHaveBeenCalledWith(EVENT_ID)
    expect(deleteStoredFile).toHaveBeenCalledTimes(186)
    for (const [url] of deleteStoredFile.mock.calls) {
      expect(url).toContain(`/events/${SLUG}/`)
      expect(url).not.toContain('derivatives/')
    }
  })

  it('the derivative snapshot never carries urls or storedNames', async () => {
    const repository = makeRepository({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue(eventWith(cappedPhotos(100))),
      listPhotoIdsByEventId: vi.fn().mockResolvedValue(ids186),
    })
    getGalleryRepository.mockResolvedValue(repository)

    await invoke(DELETE, await ownerRequest(`/owner/events/${SLUG}`, 'DELETE'))

    for (const entry of deletePhotoDerivativesBatch.mock.calls[0][0]) {
      expect(typeof entry).toBe('string')
      expect(entry).not.toMatch(/^https?:/)
      expect(entry).not.toContain('/')
    }
  })

  it('§18 private assets are never given derivative identities', async () => {
    const repository = makeRepository({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue(eventWith(cappedPhotos(2))),
      listPhotoIdsByEventId: vi.fn().mockResolvedValue(['photo-a']),
      listPrivateAssetsByEventId: vi
        .fn()
        .mockResolvedValue([
          { id: 'asset-1', url: `https://store.public.blob.vercel-storage.com/private-delivery/${SLUG}/a.zip` },
        ]),
    })
    getGalleryRepository.mockResolvedValue(repository)

    await invoke(DELETE, await ownerRequest(`/owner/events/${SLUG}`, 'DELETE'))

    expect(deletePhotoDerivativesBatch.mock.calls[0][0]).toEqual(['photo-a'])
    expect(deletePhotoDerivativesBatch.mock.calls[0][0]).not.toContain('asset-1')
  })

  it('a failing DERIVATIVE id snapshot does not break event deletion (best-effort)', async () => {
    const repository = makeRepository({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue(eventWith(cappedPhotos(3))),
      listPhotoIdsByEventId: vi.fn().mockRejectedValue(new Error('db hiccup')),
    })
    getGalleryRepository.mockResolvedValue(repository)

    const response = await invoke(DELETE, await ownerRequest(`/owner/events/${SLUG}`, 'DELETE'))

    expect(response.status).toBe(200)
    expect(repository.deleteEvent).toHaveBeenCalledWith(SLUG)
    expect(deletePhotoDerivativesBatch).toHaveBeenCalledWith([], expect.anything())
  })
})

// ─── §36 event delete failure ───────────────────────────────────────────────

describe('§36 event DB deletion failure', () => {
  it('does NOT delete ANY source, private-asset or derivative for an event that remains alive', async () => {
    // STEP 7.15d.3: the pre-commit snapshots (source, private-asset,
    // derivative) are all taken before the DB delete is attempted, but NO
    // destructive Blob call may run until that delete has actually
    // succeeded. A rejected repository.deleteEvent must leave every source
    // untouched, not just derivatives.
    const repository = makeRepository({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue({
        id: EVENT_ID,
        slug: SLUG,
        coverUrl: null,
        photos: cappedPhotos(3),
      }),
      listPhotoSourcesByEventId: vi
        .fn()
        .mockResolvedValue([`https://store.public.blob.vercel-storage.com/events/${SLUG}/a.jpg`]),
      listPhotoIdsByEventId: vi.fn().mockResolvedValue(['photo-a', 'photo-b']),
      deleteEvent: vi.fn().mockRejectedValue(new Error('constraint violation')),
    })
    getGalleryRepository.mockResolvedValue(repository)

    await expect(invoke(DELETE, await ownerRequest(`/owner/events/${SLUG}`, 'DELETE'))).rejects.toThrow(
      'constraint violation',
    )

    // The pre-commit snapshots were taken (they run before the gate)...
    expect(repository.listPhotoSourcesByEventId).toHaveBeenCalled()
    expect(repository.listPhotoIdsByEventId).toHaveBeenCalled()
    // ...but the event is still alive, so NOTHING destructive may have run.
    expect(deleteStoredFile).not.toHaveBeenCalled()
    expect(deletePhotoDerivativesBatch).not.toHaveBeenCalled()
  })
})
