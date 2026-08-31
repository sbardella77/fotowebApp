import { describe, it, expect, vi, beforeEach } from 'vitest'

// STEP 7.15d — public derivative lifecycle cleanup.
//
// Two mechanisms are covered here: the synchronous best-effort delete used by
// the photo/event lifecycle, and the reconciliation sweep that is the actual
// consistency guarantee (a producer can always re-create a derivative after
// the synchronous delete, and there is no Postgres/Blob transaction).
//
// The dominant risk in this module is not "fails to delete" — it is "deletes
// something it should not". Most of the assertions below are therefore
// negative: source namespaces, retired versions and malformed pathnames must
// survive every code path.

vi.mock('@vercel/blob', () => ({ del: vi.fn(), list: vi.fn() }))
vi.mock('@/lib/server/prisma-client', () => ({ getPrismaClient: vi.fn() }))
vi.mock('@/lib/server/storage', () => ({ getStorageMode: vi.fn(() => 'vercel-blob') }))

import { del, list } from '@vercel/blob'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { getStorageMode } from '@/lib/server/storage'
import {
  deletePhotoDerivatives,
  deletePhotoDerivativesBatch,
  parseDerivativePathname,
  cleanupPhotoDerivatives,
  DERIVATIVE_CLEANUP_KINDS,
  DERIVATIVE_DELETE_BATCH_SIZE,
  DERIVATIVE_LIST_PAGE_SIZE,
} from '@/lib/server/derivative-cleanup'
import { buildDerivativePath } from '@/lib/server/download-derivative'
import { buildDisplayDerivativePath } from '@/lib/server/display-derivative'

// ─── Helpers ────────────────────────────────────────────────────────────────

const uuid = (n) => `0000000${n % 10}-0000-4000-8000-${String(n).padStart(12, '0')}`
const PHOTO_A = uuid(1)
const PHOTO_B = uuid(2)

const wm = (id) => `derivatives/wm-v2/${id}.jpg`
const display = (id) => `derivatives/display-v1/${id}.jpg`

const blob = (pathname) => ({ pathname, url: `https://store.public.blob.vercel-storage.com/${pathname}` })

/** A prisma double whose photo.findMany answers from a plain id→status map. */
function fakePrisma(statusById, { onFindMany } = {}) {
  return {
    photo: {
      findMany: vi.fn(async ({ where, select }) => {
        if (onFindMany) onFindMany({ where, select })
        return where.id.in
          .filter((id) => statusById.has(id))
          .map((id) => ({ id, status: statusById.get(id) }))
      }),
    },
  }
}

/** Queue of list() pages, consumed in order. */
function queueListPages(pages) {
  let call = 0
  list.mockImplementation(async () => pages[call++] ?? { blobs: [], hasMore: false })
}

const deletedPaths = () => del.mock.calls.flatMap(([arg]) => (Array.isArray(arg) ? arg : [arg]))

const silentLogger = { warn: vi.fn(), error: vi.fn(), log: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  del.mockResolvedValue(undefined)
  getStorageMode.mockReturnValue('vercel-blob')
})

// ─── §3 one source of truth for derivative identity ─────────────────────────

describe('derivative identity is derived from the real builders', () => {
  it('exposes exactly the two current kinds', () => {
    expect(DERIVATIVE_CLEANUP_KINDS.map((k) => k.name)).toEqual(['wm', 'display'])
  })

  it('derives each prefix from the production path builder, not a literal', () => {
    const [wmKind, displayKind] = DERIVATIVE_CLEANUP_KINDS

    // If a builder ever changes shape, these fail rather than the sweep
    // silently scanning a prefix nothing writes to.
    expect(wmKind.prefix).toBe('derivatives/wm-v2/')
    expect(displayKind.prefix).toBe('derivatives/display-v1/')
    expect(buildDerivativePath(PHOTO_A)).toBe(`${wmKind.prefix}${PHOTO_A}.jpg`)
    expect(buildDisplayDerivativePath(PHOTO_A)).toBe(`${displayKind.prefix}${PHOTO_A}.jpg`)
  })
})

// ─── §6 / §40 strict parsing ────────────────────────────────────────────────

describe('parseDerivativePathname — accepts only exact current-version objects', () => {
  it('parses a wm-v2 object', () => {
    expect(parseDerivativePathname(wm(PHOTO_A))).toEqual({ photoId: PHOTO_A, kind: 'wm' })
  })

  it('parses a display-v1 object', () => {
    expect(parseDerivativePathname(display(PHOTO_A))).toEqual({ photoId: PHOTO_A, kind: 'display' })
  })

  it.each([
    ['non-uuid filename', 'derivatives/wm-v2/not-a-uuid.jpg'],
    ['wrong extension', `derivatives/wm-v2/${PHOTO_A}.png`],
    ['no extension', `derivatives/display-v1/${PHOTO_A}`],
    ['nested path', `derivatives/wm-v2/nested/${PHOTO_A}.jpg`],
    ['garbage', 'derivatives/display-v1/garbage'],
    ['bare prefix', 'derivatives/wm-v2/'],
    ['empty filename extension only', 'derivatives/wm-v2/.jpg'],
    ['uuid with suffix', `derivatives/wm-v2/${PHOTO_A}-extra.jpg`],
    ['leading slash', `/derivatives/wm-v2/${PHOTO_A}.jpg`],
    ['full URL not a pathname', `https://x.blob.vercel-storage.com/derivatives/wm-v2/${PHOTO_A}.jpg`],
    ['trailing whitespace', `derivatives/wm-v2/${PHOTO_A}.jpg `],
  ])('rejects %s', (_label, pathname) => {
    expect(parseDerivativePathname(pathname)).toBeNull()
  })

  it.each([
    ['source originals', `events/my-event/${PHOTO_A}-photo.jpg`],
    ['private delivery', `private-delivery/my-event/${PHOTO_A}-album.zip`],
    ['covers', `covers/my-event/${PHOTO_A}.jpg`],
    ['gallery downloads', `gallery-downloads/my-event/${PHOTO_A}.zip`],
  ])('rejects the %s namespace', (_label, pathname) => {
    expect(parseDerivativePathname(pathname)).toBeNull()
  })

  it.each([
    // v1 is the now-retired watermark version (bumped to v2 when the
    // legacy gold badge asset was replaced) — exactly the real-world case
    // this guards: old wm-v1 objects must never be swept.
    ['wm-v1', `derivatives/wm-v1/${PHOTO_A}.jpg`],
    ['display-v2', `derivatives/display-v2/${PHOTO_A}.jpg`],
    ['unknown kind', `derivatives/thumb-v1/${PHOTO_A}.jpg`],
    ['bare derivatives root', `derivatives/${PHOTO_A}.jpg`],
  ])('rejects retired/future/unknown version %s (§32)', (_label, pathname) => {
    expect(parseDerivativePathname(pathname)).toBeNull()
  })

  it.each([null, undefined, 42, {}, []])('rejects non-string input %s', (value) => {
    expect(parseDerivativePathname(value)).toBeNull()
  })
})

// ─── §5 deletePhotoDerivatives contract ─────────────────────────────────────

describe('deletePhotoDerivatives — exact deterministic pathnames', () => {
  it('deletes both current kinds in ONE bounded del() call', async () => {
    const result = await deletePhotoDerivatives(PHOTO_A, { logger: silentLogger })

    expect(del).toHaveBeenCalledTimes(1)
    expect(del).toHaveBeenCalledWith([wm(PHOTO_A), display(PHOTO_A)])
    expect(result).toMatchObject({ photos: 1, attempted: 2, deleted: 2, failed: 0, skipped: false })
  })

  it('passes pathnames only — never a URL, storedName or Photo.url', async () => {
    await deletePhotoDerivatives(PHOTO_A, { logger: silentLogger })

    for (const path of deletedPaths()) {
      expect(path.startsWith('derivatives/')).toBe(true)
      expect(path).not.toMatch(/^https?:/)
    }
  })

  it('never issues a wildcard or prefix deletion', async () => {
    await deletePhotoDerivatives(PHOTO_A, { logger: silentLogger })

    for (const path of deletedPaths()) {
      expect(path).not.toMatch(/\*/)
      expect(path.endsWith('/')).toBe(false)
      expect(parseDerivativePathname(path)).not.toBeNull()
    }
  })

  it('is best-effort: a provider failure resolves instead of throwing (§7)', async () => {
    del.mockRejectedValue(new Error('blob unavailable'))

    const result = await deletePhotoDerivatives(PHOTO_A, { logger: silentLogger })

    expect(result).toMatchObject({ deleted: 0, failed: 2 })
    expect(silentLogger.warn).toHaveBeenCalledTimes(1)
  })

  it('logs only object count and error class — never ids, paths or credentials (§8)', async () => {
    del.mockRejectedValue(new Error('token vercel_blob_rw_SECRET rejected for events/x/y.jpg'))

    await deletePhotoDerivatives(PHOTO_A, { logger: silentLogger })

    const logged = silentLogger.warn.mock.calls.flat().join(' ')
    expect(logged).not.toContain(PHOTO_A)
    expect(logged).not.toContain('vercel_blob_rw')
    expect(logged).not.toContain('events/')
    expect(logged).toContain('count=2')
  })

  it.each([['', 'empty'], [null, 'null'], [undefined, 'undefined'], ['a/b', 'path separator'], ['../events', 'traversal'], ['id with space', 'whitespace']])(
    'refuses to build a pathname from an unsafe id (%s — %s)',
    async (badId) => {
      const result = await deletePhotoDerivatives(badId, { logger: silentLogger })

      expect(del).not.toHaveBeenCalled()
      expect(result.attempted).toBe(0)
    },
  )

  it('skips the provider entirely in local storage mode', async () => {
    getStorageMode.mockReturnValue('local')

    const result = await deletePhotoDerivatives(PHOTO_A, { logger: silentLogger })

    expect(del).not.toHaveBeenCalled()
    expect(result.skipped).toBe(true)
  })
})

// ─── §17 event batching ─────────────────────────────────────────────────────

describe('deletePhotoDerivativesBatch — bounded, sequential batching', () => {
  it('deduplicates repeated ids', async () => {
    await deletePhotoDerivativesBatch([PHOTO_A, PHOTO_A, PHOTO_B], { logger: silentLogger })

    expect(deletedPaths()).toEqual([wm(PHOTO_A), display(PHOTO_A), wm(PHOTO_B), display(PHOTO_B)])
  })

  it('drops unsafe ids but still processes the safe ones', async () => {
    await deletePhotoDerivativesBatch([PHOTO_A, '../escape', '', PHOTO_B], { logger: silentLogger })

    expect(deletedPaths()).toEqual([wm(PHOTO_A), display(PHOTO_A), wm(PHOTO_B), display(PHOTO_B)])
  })

  it(`never exceeds ${DERIVATIVE_DELETE_BATCH_SIZE} pathnames per del() call`, async () => {
    const ids = Array.from({ length: 186 }, (_, i) => uuid(i))

    await deletePhotoDerivativesBatch(ids, { logger: silentLogger })

    for (const [arg] of del.mock.calls) {
      expect(Array.isArray(arg)).toBe(true)
      expect(arg.length).toBeLessThanOrEqual(DERIVATIVE_DELETE_BATCH_SIZE)
    }
  })

  it('covers the largest Production event (186 photos) in exact bounded batches', async () => {
    const ids = Array.from({ length: 186 }, (_, i) => uuid(i))

    const result = await deletePhotoDerivativesBatch(ids, { logger: silentLogger })

    // 186 photos x 2 kinds = 372 pathnames -> ceil(372/50) = 8 calls
    expect(result.attempted).toBe(372)
    expect(del).toHaveBeenCalledTimes(8)
    expect(result.deleted).toBe(372)
    expect(deletedPaths()).toHaveLength(372)
  })

  it('exercises the batch boundary exactly (one full batch, then one)', async () => {
    const ids = Array.from({ length: DERIVATIVE_DELETE_BATCH_SIZE / 2 + 1 }, (_, i) => uuid(i))

    await deletePhotoDerivativesBatch(ids, { logger: silentLogger })

    expect(del).toHaveBeenCalledTimes(2)
    expect(del.mock.calls[0][0]).toHaveLength(DERIVATIVE_DELETE_BATCH_SIZE)
    expect(del.mock.calls[1][0]).toHaveLength(2)
  })

  it('issues batches sequentially, never as an unbounded Promise.all', async () => {
    const ids = Array.from({ length: 186 }, (_, i) => uuid(i))
    let inFlight = 0
    let maxInFlight = 0
    del.mockImplementation(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await Promise.resolve()
      inFlight -= 1
    })

    await deletePhotoDerivativesBatch(ids, { logger: silentLogger })

    expect(maxInFlight).toBe(1)
  })

  it('one failing batch does not abort the remaining batches', async () => {
    const ids = Array.from({ length: 186 }, (_, i) => uuid(i))
    let call = 0
    del.mockImplementation(async () => {
      call += 1
      if (call === 2) throw new Error('transient')
    })

    const result = await deletePhotoDerivativesBatch(ids, { logger: silentLogger })

    expect(del).toHaveBeenCalledTimes(8)
    expect(result.failed).toBe(DERIVATIVE_DELETE_BATCH_SIZE)
    expect(result.deleted).toBe(372 - DERIVATIVE_DELETE_BATCH_SIZE)
  })

  it('an empty or non-array input touches nothing', async () => {
    expect(await deletePhotoDerivativesBatch([])).toMatchObject({ attempted: 0 })
    expect(await deletePhotoDerivativesBatch(null)).toMatchObject({ attempted: 0 })
    expect(del).not.toHaveBeenCalled()
  })
})

// ─── §21 / §22 / §24 reconciliation sweep ───────────────────────────────────

describe('cleanupPhotoDerivatives — scanned prefixes', () => {
  it('scans ONLY the two current version prefixes (§21, §32)', async () => {
    getPrismaClient.mockResolvedValue(fakePrisma(new Map()))
    queueListPages([{ blobs: [], hasMore: false }, { blobs: [], hasMore: false }])

    await cleanupPhotoDerivatives({ logger: silentLogger })

    expect(list).toHaveBeenCalledTimes(2)
    expect(list.mock.calls.map(([o]) => o.prefix)).toEqual(['derivatives/wm-v2/', 'derivatives/display-v1/'])
    for (const [options] of list.mock.calls) {
      expect(options.prefix).not.toBe('derivatives/')
      expect(options.limit).toBe(DERIVATIVE_LIST_PAGE_SIZE)
      expect(options.limit).toBeLessThanOrEqual(100)
    }
  })

  it('throws when the database is unavailable, before any listing', async () => {
    getPrismaClient.mockResolvedValue(null)

    await expect(cleanupPhotoDerivatives({ logger: silentLogger })).rejects.toThrow('Database unavailable')
    expect(list).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
  })
})

describe('cleanupPhotoDerivatives — stale eligibility (§24)', () => {
  it('§37 VISIBLE photo: derivative is KEPT for both kinds', async () => {
    getPrismaClient.mockResolvedValue(fakePrisma(new Map([[PHOTO_A, 'VISIBLE']])))
    queueListPages([
      { blobs: [blob(wm(PHOTO_A))], hasMore: false },
      { blobs: [blob(display(PHOTO_A))], hasMore: false },
    ])

    const stats = await cleanupPhotoDerivatives({ logger: silentLogger })

    expect(del).not.toHaveBeenCalled()
    expect(stats).toMatchObject({ scanned: 2, valid: 2, visibleKept: 2, hiddenDeleted: 0, absentDeleted: 0 })
  })

  it('§38 / §30 HIDDEN photo: the existing wm-v2 object is deleted', async () => {
    // This is the live privacy gap: today a hidden photo keeps a publicly
    // readable branded derivative forever. Closing it does not depend on
    // display generation existing.
    getPrismaClient.mockResolvedValue(fakePrisma(new Map([[PHOTO_A, 'HIDDEN']])))
    queueListPages([{ blobs: [blob(wm(PHOTO_A))], hasMore: false }, { blobs: [], hasMore: false }])

    const stats = await cleanupPhotoDerivatives({ logger: silentLogger })

    expect(del).toHaveBeenCalledWith([wm(PHOTO_A)])
    expect(stats).toMatchObject({ hiddenDeleted: 1, visibleKept: 0, absentDeleted: 0 })
  })

  it('§31 HIDDEN photo: a display-v1 object would be deleted too', async () => {
    getPrismaClient.mockResolvedValue(fakePrisma(new Map([[PHOTO_A, 'HIDDEN']])))
    queueListPages([{ blobs: [], hasMore: false }, { blobs: [blob(display(PHOTO_A))], hasMore: false }])

    const stats = await cleanupPhotoDerivatives({ logger: silentLogger })

    expect(del).toHaveBeenCalledWith([display(PHOTO_A)])
    expect(stats.hiddenDeleted).toBe(1)
  })

  it('§39 absent Photo row: the orphan is deleted', async () => {
    getPrismaClient.mockResolvedValue(fakePrisma(new Map()))
    queueListPages([{ blobs: [blob(wm(PHOTO_A))], hasMore: false }, { blobs: [blob(display(PHOTO_A))], hasMore: false }])

    const stats = await cleanupPhotoDerivatives({ logger: silentLogger })

    expect(deletedPaths()).toEqual([wm(PHOTO_A), display(PHOTO_A)])
    expect(stats).toMatchObject({ absentDeleted: 2, visibleKept: 0, hiddenDeleted: 0 })
  })

  it('applies eligibility independently per kind on a mixed page', async () => {
    getPrismaClient.mockResolvedValue(fakePrisma(new Map([[PHOTO_A, 'VISIBLE'], [PHOTO_B, 'HIDDEN']])))
    queueListPages([
      { blobs: [blob(wm(PHOTO_A)), blob(wm(PHOTO_B)), blob(wm(uuid(9)))], hasMore: false },
      { blobs: [], hasMore: false },
    ])

    const stats = await cleanupPhotoDerivatives({ logger: silentLogger })

    expect(deletedPaths()).toEqual([wm(PHOTO_B), wm(uuid(9))])
    expect(stats).toMatchObject({ visibleKept: 1, hiddenDeleted: 1, absentDeleted: 1 })
  })
})

describe('cleanupPhotoDerivatives — parsing safety in the sweep', () => {
  it('§40 malformed objects are counted and never deleted', async () => {
    getPrismaClient.mockResolvedValue(fakePrisma(new Map()))
    queueListPages([
      {
        blobs: [
          blob('derivatives/wm-v2/not-a-uuid.jpg'),
          blob(`derivatives/wm-v2/${PHOTO_A}.png`),
          blob(`derivatives/wm-v2/nested/${PHOTO_B}.jpg`),
          blob('derivatives/display-v1/garbage'),
        ],
        hasMore: false,
      },
      { blobs: [], hasMore: false },
    ])

    const stats = await cleanupPhotoDerivatives({ logger: silentLogger })

    expect(del).not.toHaveBeenCalled()
    expect(stats).toMatchObject({ scanned: 4, valid: 0, malformedIgnored: 4 })
  })

  it('§41 never deletes source or other namespaces even if the provider returns them', async () => {
    getPrismaClient.mockResolvedValue(fakePrisma(new Map()))
    queueListPages([
      {
        blobs: [
          blob(`events/my-event/${PHOTO_A}-photo.jpg`),
          blob(`private-delivery/my-event/${PHOTO_A}-album.zip`),
          blob(`covers/my-event/${PHOTO_A}.jpg`),
          blob(`gallery-downloads/my-event/${PHOTO_A}.zip`),
          // wm-v1 is the now-retired watermark version — same real-world case as §32 above.
          blob(`derivatives/wm-v1/${PHOTO_A}.jpg`),
          blob(`derivatives/display-v2/${PHOTO_A}.jpg`),
        ],
        hasMore: false,
      },
      { blobs: [], hasMore: false },
    ])

    const stats = await cleanupPhotoDerivatives({ logger: silentLogger })

    expect(del).not.toHaveBeenCalled()
    expect(stats.malformedIgnored).toBe(6)
  })

  it('never "best guesses" an id out of a malformed name that contains one', async () => {
    getPrismaClient.mockResolvedValue(fakePrisma(new Map()))
    queueListPages([
      { blobs: [blob(`derivatives/wm-v2/${PHOTO_A}-copy.jpg`)], hasMore: false },
      { blobs: [], hasMore: false },
    ])

    await cleanupPhotoDerivatives({ logger: silentLogger })

    expect(del).not.toHaveBeenCalled()
  })
})

describe('cleanupPhotoDerivatives — pagination and batching (§42, §25, §26)', () => {
  it('follows the cursor across pages and processes every page', async () => {
    getPrismaClient.mockResolvedValue(fakePrisma(new Map()))
    queueListPages([
      { blobs: [blob(wm(uuid(1)))], hasMore: true, cursor: 'c1' },
      { blobs: [blob(wm(uuid(2)))], hasMore: true, cursor: 'c2' },
      { blobs: [blob(wm(uuid(3)))], hasMore: false },
      { blobs: [blob(display(uuid(4)))], hasMore: false },
    ])

    const stats = await cleanupPhotoDerivatives({ logger: silentLogger })

    expect(list).toHaveBeenCalledTimes(4)
    expect(list.mock.calls.map(([o]) => o.cursor)).toEqual([undefined, 'c1', 'c2', undefined])
    expect(stats.pages).toBe(4)
    expect(stats.scanned).toBe(4)
    expect(deletedPaths()).toHaveLength(4)
  })

  it('stops paginating a prefix when hasMore is false even if a cursor is present', async () => {
    getPrismaClient.mockResolvedValue(fakePrisma(new Map()))
    queueListPages([
      { blobs: [], hasMore: false, cursor: 'stale-cursor' },
      { blobs: [], hasMore: false, cursor: 'stale-cursor' },
    ])

    await cleanupPhotoDerivatives({ logger: silentLogger })

    expect(list).toHaveBeenCalledTimes(2)
  })

  it('§25 issues exactly one DB lookup per page, not one per object', async () => {
    const prisma = fakePrisma(new Map())
    getPrismaClient.mockResolvedValue(prisma)
    const blobs = Array.from({ length: 40 }, (_, i) => blob(wm(uuid(i))))
    queueListPages([{ blobs, hasMore: false }, { blobs: [], hasMore: false }])

    await cleanupPhotoDerivatives({ logger: silentLogger })

    expect(prisma.photo.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.photo.findMany.mock.calls[0][0].select).toEqual({ id: true, status: true })
    expect(prisma.photo.findMany.mock.calls[0][0].where.id.in).toHaveLength(40)
  })

  it('does not query the database for a page with no valid objects', async () => {
    const prisma = fakePrisma(new Map())
    getPrismaClient.mockResolvedValue(prisma)
    queueListPages([
      { blobs: [blob('derivatives/wm-v2/garbage')], hasMore: false },
      { blobs: [], hasMore: false },
    ])

    await cleanupPhotoDerivatives({ logger: silentLogger })

    expect(prisma.photo.findMany).not.toHaveBeenCalled()
  })

  it('bounds sweep deletes by the same batch size', async () => {
    getPrismaClient.mockResolvedValue(fakePrisma(new Map()))
    const blobs = Array.from({ length: 90 }, (_, i) => blob(wm(uuid(i))))
    queueListPages([{ blobs, hasMore: false }, { blobs: [], hasMore: false }])

    await cleanupPhotoDerivatives({ logger: silentLogger })

    expect(del).toHaveBeenCalledTimes(2)
    for (const [arg] of del.mock.calls) {
      expect(arg.length).toBeLessThanOrEqual(DERIVATIVE_DELETE_BATCH_SIZE)
    }
  })

  it('§26 the same photo appearing in both prefixes is handled per page, not joined', async () => {
    const prisma = fakePrisma(new Map([[PHOTO_A, 'HIDDEN']]))
    getPrismaClient.mockResolvedValue(prisma)
    queueListPages([
      { blobs: [blob(wm(PHOTO_A))], hasMore: false },
      { blobs: [blob(display(PHOTO_A))], hasMore: false },
    ])

    const stats = await cleanupPhotoDerivatives({ logger: silentLogger })

    expect(prisma.photo.findMany).toHaveBeenCalledTimes(2)
    expect(deletedPaths()).toEqual([wm(PHOTO_A), display(PHOTO_A)])
    expect(stats.hiddenDeleted).toBe(2)
  })
})

// ─── §23 / §43 / §44 fail-safe ordering ─────────────────────────────────────

describe('cleanupPhotoDerivatives — failure never widens deletion', () => {
  it('§43 a DB lookup failure deletes NOTHING and fails the run', async () => {
    getPrismaClient.mockResolvedValue({
      photo: { findMany: vi.fn().mockRejectedValue(new Error('connection lost')) },
    })
    queueListPages([{ blobs: [blob(wm(PHOTO_A)), blob(wm(PHOTO_B))], hasMore: false }])

    await expect(cleanupPhotoDerivatives({ logger: silentLogger })).rejects.toThrow('connection lost')
    expect(del).not.toHaveBeenCalled()
  })

  it('§44 a list failure aborts with nothing deleted and no provider detail in the message', async () => {
    getPrismaClient.mockResolvedValue(fakePrisma(new Map()))
    list.mockRejectedValue(new Error('403 Forbidden: token vercel_blob_rw_SECRET'))

    await expect(cleanupPhotoDerivatives({ logger: silentLogger })).rejects.toThrow(
      'Derivative sweep aborted: derivative listing unavailable',
    )
    expect(del).not.toHaveBeenCalled()

    const thrown = await cleanupPhotoDerivatives({ logger: silentLogger }).catch((e) => e.message)
    expect(thrown).not.toContain('vercel_blob_rw')
  })

  it('a mid-pagination list failure does not delete anything further', async () => {
    getPrismaClient.mockResolvedValue(fakePrisma(new Map([[PHOTO_A, 'VISIBLE']])))
    let call = 0
    list.mockImplementation(async () => {
      call += 1
      if (call === 2) throw new Error('provider down')
      return { blobs: [blob(wm(PHOTO_A))], hasMore: true, cursor: 'c1' }
    })

    await expect(cleanupPhotoDerivatives({ logger: silentLogger })).rejects.toThrow('Derivative sweep aborted')
    expect(del).not.toHaveBeenCalled()
  })

  it('a delete failure is recorded, does not widen deletion, and surfaces as a run failure', async () => {
    getPrismaClient.mockResolvedValue(fakePrisma(new Map()))
    del.mockRejectedValue(new Error('blob 500'))
    queueListPages([{ blobs: [blob(wm(PHOTO_A))], hasMore: false }, { blobs: [], hasMore: false }])

    const error = await cleanupPhotoDerivatives({ logger: silentLogger }).catch((e) => e)

    expect(error.message).toMatch(/1 delete failure/)
    expect(error.stats).toMatchObject({ deleteFailures: 1, absentDeleted: 1 })
    // The failed object is still stale and is simply retried next run.
    expect(deletedPaths()).toEqual([wm(PHOTO_A)])
  })

  it('a provider delete failure is never reinterpreted as proof of staleness', async () => {
    // A VISIBLE photo must not become deletable just because some other
    // delete in the same run failed.
    getPrismaClient.mockResolvedValue(fakePrisma(new Map([[PHOTO_B, 'VISIBLE']])))
    del.mockRejectedValue(new Error('blob 500'))
    queueListPages([
      { blobs: [blob(wm(PHOTO_A)), blob(wm(PHOTO_B))], hasMore: false },
      { blobs: [], hasMore: false },
    ])

    await cleanupPhotoDerivatives({ logger: silentLogger }).catch(() => {})

    expect(deletedPaths()).toEqual([wm(PHOTO_A)])
    expect(deletedPaths()).not.toContain(wm(PHOTO_B))
  })
})

// ─── §28 result shape ───────────────────────────────────────────────────────

describe('cleanupPhotoDerivatives — reports aggregates only (§28)', () => {
  it('returns counters and never photo ids, pathnames or customer metadata', async () => {
    getPrismaClient.mockResolvedValue(fakePrisma(new Map([[PHOTO_A, 'VISIBLE'], [PHOTO_B, 'HIDDEN']])))
    queueListPages([
      { blobs: [blob(wm(PHOTO_A)), blob(wm(PHOTO_B)), blob('derivatives/wm-v2/bad.jpg')], hasMore: false },
      { blobs: [], hasMore: false },
    ])

    const stats = await cleanupPhotoDerivatives({ logger: silentLogger })

    expect(stats).toEqual({
      pages: 2,
      scanned: 3,
      valid: 2,
      malformedIgnored: 1,
      visibleKept: 1,
      hiddenDeleted: 1,
      absentDeleted: 0,
      deleteFailures: 0,
    })

    const serialized = JSON.stringify(stats)
    expect(serialized).not.toContain(PHOTO_A)
    expect(serialized).not.toContain(PHOTO_B)
    expect(serialized).not.toContain('derivatives/')
  })
})

// ─── §29 generation/delete race is documented, not "solved" ─────────────────

describe('generation / delete race (§29)', () => {
  it('a derivative recreated after a synchronous delete is reclaimed by the sweep', async () => {
    // Synchronous delete runs first...
    await deletePhotoDerivatives(PHOTO_A, { logger: silentLogger })
    expect(deletedPaths()).toEqual([wm(PHOTO_A), display(PHOTO_A)])

    // ...then an already-running producer stores the object again. There is no
    // Postgres/Blob transaction that could prevent this, which is exactly why
    // reconciliation is the final consistency mechanism rather than a nicety.
    vi.clearAllMocks()
    del.mockResolvedValue(undefined)
    getPrismaClient.mockResolvedValue(fakePrisma(new Map()))
    queueListPages([{ blobs: [blob(wm(PHOTO_A))], hasMore: false }, { blobs: [], hasMore: false }])

    const stats = await cleanupPhotoDerivatives({ logger: silentLogger })

    expect(stats.absentDeleted).toBe(1)
    expect(deletedPaths()).toEqual([wm(PHOTO_A)])
  })
})
