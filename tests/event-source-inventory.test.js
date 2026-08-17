/**
 * STEP 7.15d.2 — authoritative event photo-source inventory primitive.
 *
 * `listPhotoSourcesByEventId` is the uncapped inventory that a later,
 * separately-reviewed step will use to delete ORIGINAL user files on event
 * deletion. Nothing calls it yet; these tests pin the contract before it can
 * ever drive a destructive path.
 *
 * Two properties matter more than the rest:
 *
 *   1. It must never truncate. The live defect being fixed is that
 *      `getEventBySlug` / `getEventBySlugAndOwner` expose at most 100 photos
 *      to event deletion while Production holds an event with 186.
 *
 *   2. A query failure must NOT look like an empty event. Once the event row
 *      cascades away, `Photo.url` is the only mapping to the original
 *      objects — so "we could not find out" and "there is nothing here" must
 *      stay distinguishable, or a transient DB error silently becomes
 *      permanent orphaning of user originals.
 *
 * All fixtures are synthetic; no real storage reference appears here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock fs/promises BEFORE importing mock-db (vi.mock is hoisted)
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockResolvedValue({ size: 0 }),
  appendFile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/server/prisma-client', () => ({
  getPrismaClient: vi.fn(),
  getDataAccessDriver: vi.fn().mockReturnValue('prisma'),
}))

import { readFile } from 'fs/promises'
import { mockGalleryRepository } from '@/lib/server/mock-db'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { prismaGalleryRepository } from '@/lib/server/prisma-gallery-repository'

// ─── Fixtures (synthetic only) ───────────────────────────────────────────────

const EVENT_A = 'event-a'
const EVENT_B = 'event-b'
const HOST = 'https://store.public.blob.vercel-storage.com'

const photoRow = (eventId, n, status = 'VISIBLE') => ({
  id: `${eventId}-photo-${n}`,
  eventId,
  status,
  url: `${HOST}/events/${eventId}-slug/${n}-synthetic.jpg`,
  storedName: `${n}-synthetic.jpg`,
  originalName: `holiday-${n}.jpg`,
  caption: `caption ${n}`,
  uploaderName: `uploader ${n}`,
  mimeType: 'image/jpeg',
  size: 1000 + n,
})

const rowsFor = (eventId, count, status = 'VISIBLE') =>
  Array.from({ length: count }, (_, i) => photoRow(eventId, i, status))

/** Prisma double that honours `where.eventId` and `select`. */
function makePrisma(rows, { onFindMany, fail } = {}) {
  return {
    photo: {
      findMany: vi.fn(async (args) => {
        if (onFindMany) onFindMany(args)
        if (fail) throw fail
        const matched = rows.filter((r) => r.eventId === args.where.eventId)
        const fields = Object.keys(args.select || {}).filter((k) => args.select[k])
        return matched.map((r) => Object.fromEntries(fields.map((f) => [f, r[f]])))
      }),
    },
  }
}

const makeLocalDatabase = (photos = []) => JSON.stringify({ events: [], photos })

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── §8 no presentation cap ──────────────────────────────────────────────────

describe('prismaGalleryRepository.listPhotoSourcesByEventId — uncapped', () => {
  it('returns all 186 sources for the largest Production-scale event', async () => {
    // 186 is the real Production maximum; the presentation readers stop at 100.
    getPrismaClient.mockResolvedValue(makePrisma(rowsFor(EVENT_A, 186)))

    const sources = await prismaGalleryRepository.listPhotoSourcesByEventId(EVENT_A)

    expect(sources).toHaveLength(186)
  })

  it('issues no take, skip or cursor that could reintroduce truncation', async () => {
    let captured
    getPrismaClient.mockResolvedValue(makePrisma(rowsFor(EVENT_A, 186), { onFindMany: (a) => { captured = a } }))

    await prismaGalleryRepository.listPhotoSourcesByEventId(EVENT_A)

    expect(captured).not.toHaveProperty('take')
    expect(captured).not.toHaveProperty('skip')
    expect(captured).not.toHaveProperty('cursor')
  })

  it('does not go through getEventBySlug / event.photos', async () => {
    // A single findMany and nothing else: no event lookup, no include.
    const prisma = makePrisma(rowsFor(EVENT_A, 5))
    getPrismaClient.mockResolvedValue(prisma)

    await prismaGalleryRepository.listPhotoSourcesByEventId(EVENT_A)

    expect(prisma.photo.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.event).toBeUndefined()
  })
})

// ─── §9 status inclusion ─────────────────────────────────────────────────────

describe('listPhotoSourcesByEventId — status is not filtered', () => {
  it('includes HIDDEN alongside VISIBLE', async () => {
    const rows = [...rowsFor(EVENT_A, 2, 'VISIBLE'), photoRow(EVENT_A, 99, 'HIDDEN')]
    getPrismaClient.mockResolvedValue(makePrisma(rows))

    const sources = await prismaGalleryRepository.listPhotoSourcesByEventId(EVENT_A)

    expect(sources).toHaveLength(3)
    expect(sources).toContain(rows[2].url)
  })

  it('never adds a status clause to the query', async () => {
    let captured
    getPrismaClient.mockResolvedValue(makePrisma(rowsFor(EVENT_A, 1), { onFindMany: (a) => { captured = a } }))

    await prismaGalleryRepository.listPhotoSourcesByEventId(EVENT_A)

    expect(captured.where).toEqual({ eventId: EVENT_A })
    expect(captured.where).not.toHaveProperty('status')
  })

  it('returns sources for an event whose photos are ALL hidden', async () => {
    getPrismaClient.mockResolvedValue(makePrisma(rowsFor(EVENT_A, 4, 'HIDDEN')))

    const sources = await prismaGalleryRepository.listPhotoSourcesByEventId(EVENT_A)

    expect(sources).toHaveLength(4)
  })
})

// ─── §10 event isolation ─────────────────────────────────────────────────────

describe('listPhotoSourcesByEventId — event scoping', () => {
  it('returns only the requested event’s sources', async () => {
    const rows = [...rowsFor(EVENT_A, 3), ...rowsFor(EVENT_B, 5)]
    getPrismaClient.mockResolvedValue(makePrisma(rows))

    const sources = await prismaGalleryRepository.listPhotoSourcesByEventId(EVENT_A)

    expect(sources).toHaveLength(3)
    for (const url of sources) {
      expect(url).toContain(`${EVENT_A}-slug`)
      expect(url).not.toContain(`${EVENT_B}-slug`)
    }
  })

  it('scopes by eventId in the query itself, not by post-filtering', async () => {
    let captured
    getPrismaClient.mockResolvedValue(
      makePrisma([...rowsFor(EVENT_A, 2), ...rowsFor(EVENT_B, 2)], { onFindMany: (a) => { captured = a } }),
    )

    await prismaGalleryRepository.listPhotoSourcesByEventId(EVENT_B)

    expect(captured.where.eventId).toBe(EVENT_B)
  })
})

// ─── §11 minimal field selection ─────────────────────────────────────────────

describe('listPhotoSourcesByEventId — data minimisation', () => {
  it('selects exactly { url: true }', async () => {
    let captured
    getPrismaClient.mockResolvedValue(makePrisma(rowsFor(EVENT_A, 3), { onFindMany: (a) => { captured = a } }))

    await prismaGalleryRepository.listPhotoSourcesByEventId(EVENT_A)

    expect(captured.select).toEqual({ url: true })
  })

  it.each(['id', 'storedName', 'originalName', 'caption', 'uploaderName', 'size', 'mimeType', 'status'])(
    'does not request %s',
    async (field) => {
      let captured
      getPrismaClient.mockResolvedValue(makePrisma(rowsFor(EVENT_A, 1), { onFindMany: (a) => { captured = a } }))

      await prismaGalleryRepository.listPhotoSourcesByEventId(EVENT_A)

      expect(captured.select[field]).toBeUndefined()
    },
  )

  it('returns bare url strings, carrying no customer metadata', async () => {
    getPrismaClient.mockResolvedValue(makePrisma(rowsFor(EVENT_A, 3)))

    const sources = await prismaGalleryRepository.listPhotoSourcesByEventId(EVENT_A)

    for (const entry of sources) {
      expect(typeof entry).toBe('string')
    }
    const serialized = JSON.stringify(sources)
    expect(serialized).not.toContain('holiday-')
    expect(serialized).not.toContain('caption')
    expect(serialized).not.toContain('uploader')
  })

  it('adds no orderBy — deletion is order-independent', async () => {
    let captured
    getPrismaClient.mockResolvedValue(makePrisma(rowsFor(EVENT_A, 3), { onFindMany: (a) => { captured = a } }))

    await prismaGalleryRepository.listPhotoSourcesByEventId(EVENT_A)

    expect(captured).not.toHaveProperty('orderBy')
  })
})

// ─── §6 empty-result semantics ───────────────────────────────────────────────

describe('listPhotoSourcesByEventId — empty event', () => {
  it('returns [] for an event with no photos', async () => {
    getPrismaClient.mockResolvedValue(makePrisma([]))

    const sources = await prismaGalleryRepository.listPhotoSourcesByEventId(EVENT_A)

    expect(sources).toEqual([])
  })

  it('returns [] rather than null or undefined', async () => {
    getPrismaClient.mockResolvedValue(makePrisma(rowsFor(EVENT_B, 3)))

    const sources = await prismaGalleryRepository.listPhotoSourcesByEventId(EVENT_A)

    expect(sources).not.toBeNull()
    expect(sources).not.toBeUndefined()
    expect(Array.isArray(sources)).toBe(true)
    expect(sources).toHaveLength(0)
  })
})

// ─── §7 failure propagation ──────────────────────────────────────────────────

describe('listPhotoSourcesByEventId — failure is NOT an empty event', () => {
  it('propagates a query error instead of degrading to []', async () => {
    // This is the whole point of the primitive: swallowing here would let a
    // transient DB error be read as "this event has no originals", and the
    // caller would then delete the event with nothing to clean up — orphaning
    // every original permanently.
    const boom = new Error('connection terminated unexpectedly')
    getPrismaClient.mockResolvedValue(makePrisma(rowsFor(EVENT_A, 5), { fail: boom }))

    await expect(prismaGalleryRepository.listPhotoSourcesByEventId(EVENT_A)).rejects.toThrow(
      'connection terminated unexpectedly',
    )
  })

  it('throws when the database client is unavailable', async () => {
    getPrismaClient.mockResolvedValue(null)

    await expect(prismaGalleryRepository.listPhotoSourcesByEventId(EVENT_A)).rejects.toThrow(
      /DATABASE_URL\/client is unavailable/,
    )
  })

  it('a rejected result is distinguishable from a successful empty one', async () => {
    getPrismaClient.mockResolvedValue(makePrisma([]))
    const ok = await prismaGalleryRepository.listPhotoSourcesByEventId(EVENT_A)

    getPrismaClient.mockResolvedValue(makePrisma([], { fail: new Error('db down') }))
    const failed = await prismaGalleryRepository.listPhotoSourcesByEventId(EVENT_A).catch((e) => e)

    expect(ok).toEqual([])
    expect(failed).toBeInstanceOf(Error)
  })
})

// ─── §3 separation from the derivative inventory ─────────────────────────────

describe('separation from listPhotoIdsByEventId', () => {
  it('the derivative inventory still returns ids and requests no url', async () => {
    let captured
    getPrismaClient.mockResolvedValue(makePrisma(rowsFor(EVENT_A, 3), { onFindMany: (a) => { captured = a } }))

    const ids = await prismaGalleryRepository.listPhotoIdsByEventId(EVENT_A)

    expect(captured.select).toEqual({ id: true })
    expect(ids).toEqual(['event-a-photo-0', 'event-a-photo-1', 'event-a-photo-2'])
  })

  it('the two inventories are distinct methods with distinct selects', async () => {
    expect(prismaGalleryRepository.listPhotoIdsByEventId).not.toBe(
      prismaGalleryRepository.listPhotoSourcesByEventId,
    )
    expect(mockGalleryRepository.listPhotoIdsByEventId).not.toBe(
      mockGalleryRepository.listPhotoSourcesByEventId,
    )
  })
})

// ─── §13 / §14 mock repository parity ────────────────────────────────────────

describe('mockGalleryRepository.listPhotoSourcesByEventId — parity', () => {
  it('returns all 186 sources without truncation', async () => {
    readFile.mockResolvedValue(makeLocalDatabase(rowsFor(EVENT_A, 186)))

    const sources = await mockGalleryRepository.listPhotoSourcesByEventId(EVENT_A)

    expect(sources).toHaveLength(186)
  })

  it('includes HIDDEN alongside VISIBLE', async () => {
    const rows = [...rowsFor(EVENT_A, 2, 'VISIBLE'), photoRow(EVENT_A, 99, 'HIDDEN')]
    readFile.mockResolvedValue(makeLocalDatabase(rows))

    const sources = await mockGalleryRepository.listPhotoSourcesByEventId(EVENT_A)

    expect(sources).toHaveLength(3)
    expect(sources).toContain(rows[2].url)
  })

  it('scopes to the requested event only', async () => {
    readFile.mockResolvedValue(makeLocalDatabase([...rowsFor(EVENT_A, 3), ...rowsFor(EVENT_B, 4)]))

    const sources = await mockGalleryRepository.listPhotoSourcesByEventId(EVENT_B)

    expect(sources).toHaveLength(4)
    for (const url of sources) expect(url).toContain(`${EVENT_B}-slug`)
  })

  it('returns [] for an event with no photos', async () => {
    readFile.mockResolvedValue(makeLocalDatabase([]))

    expect(await mockGalleryRepository.listPhotoSourcesByEventId(EVENT_A)).toEqual([])
  })

  it('returns bare url strings, matching the Prisma shape', async () => {
    readFile.mockResolvedValue(makeLocalDatabase(rowsFor(EVENT_A, 2)))
    getPrismaClient.mockResolvedValue(makePrisma(rowsFor(EVENT_A, 2)))

    const fromMock = await mockGalleryRepository.listPhotoSourcesByEventId(EVENT_A)
    const fromPrisma = await prismaGalleryRepository.listPhotoSourcesByEventId(EVENT_A)

    expect(fromMock).toEqual(fromPrisma)
    for (const entry of fromMock) expect(typeof entry).toBe('string')
  })
})

// ─── §15 / §19 the primitive is server-only, with ONE reviewed caller ───────

describe('inertness — STEP 7.15d.3 narrows this to "exactly one reviewed caller"', () => {
  // STEP 7.15d.2 shipped this primitive dead: literally nothing called it,
  // and that was the point — the destructive route cutover was a separate,
  // separately-reviewed step. STEP 7.15d.3 IS that step. The invariant this
  // guards now is narrower but still real: `listPhotoSourcesByEventId` may
  // be called from exactly the catch-all route (the reviewed cutover) and
  // nowhere else — no client, no cron, no other server helper reaching for
  // it as a shortcut.
  const productSources = async () => {
    const { readFileSync, readdirSync, statSync } = await import('fs')
    const { join, resolve } = await import('path')

    const roots = ['app', 'lib', 'components', 'hooks'].map((d) => resolve(import.meta.dirname, '..', d))
    const found = []
    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(js|jsx)$/.test(entry)) found.push({ path: p, src: readFileSync(p, 'utf8') })
      }
    }
    roots.forEach(walk)
    return found
  }

  it('the only product caller of listPhotoSourcesByEventId is the catch-all route', async () => {
    const callers = (await productSources())
      .filter(({ path }) => !/prisma-gallery-repository\.js$|mock-db\.js$/.test(path))
      .filter(({ src }) => /listPhotoSourcesByEventId/.test(src))
      .map(({ path }) => path.split('/').slice(-4).join('/'))

    expect(callers).toEqual(['app/api/[[...path]]/route.js'])
  })

  it('neither repository logs a source url', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')

    for (const file of ['lib/server/prisma-gallery-repository.js', 'lib/server/mock-db.js']) {
      const src = readFileSync(resolve(import.meta.dirname, '..', file), 'utf8')
      const body = src.slice(src.indexOf('listPhotoSourcesByEventId'))
      const method = body.slice(0, body.indexOf('\n  },'))
      expect(method).not.toMatch(/console\./)
    }
  })
})
