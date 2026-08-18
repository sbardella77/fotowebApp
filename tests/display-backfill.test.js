import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// STEP 7.15f.1-c — display-v1 backfill operator core.
//
// display-backfill.js is a pure function of (argv, dependencies): it never
// reads process.env and never imports Vite/CLI plumbing, so every test here
// uses fully synthetic, injected dependencies and touches zero Production
// credentials. The native .cjs bootstrap (env policy, Vite resolution,
// non-listening ModuleRunner) is covered separately in
// tests/backfill-display-cli.test.js.

vi.mock('@upstash/redis', () => ({ Redis: vi.fn() }))
vi.mock('@vercel/blob', () => ({
  list: vi.fn(),
  head: vi.fn(),
  put: vi.fn(),
  BlobNotFoundError: class BlobNotFoundError extends Error {},
}))
vi.mock('@/lib/server/prisma-client', () => ({
  getPrismaClient: vi.fn(),
}))

const { parseArgs, computeInventory, main, createRealDependencies, BACKFILL_APPLY_CONCURRENCY } = await import(
  '@/lib/server/display-backfill'
)

function makePrisma({ total = 0, visibleCount = 0, hiddenCount = 0, rows = [], findUniqueImpl } = {}) {
  return {
    photo: {
      count: vi.fn(async ({ where } = {}) => {
        if (!where) return total
        if (where.status === 'HIDDEN') return hiddenCount
        return total
      }),
      aggregate: vi.fn(async () => ({ _count: { _all: visibleCount } })),
      findMany: vi.fn(async () => rows),
      findUnique: vi.fn(findUniqueImpl || (async () => null)),
    },
  }
}

function makeListBlobs(pathnames) {
  const blobs = pathnames.map((pathname) => ({ pathname, url: `https://blob.test/${pathname}`, size: 1, uploadedAt: new Date() }))
  return vi.fn(async () => ({ blobs, cursor: undefined, hasMore: false }))
}

const VISIBLE_PATH = (id) => `derivatives/display-v1/${id}.jpg`

describe('parseArgs', () => {
  it('no args -> dry run (apply=false)', () => {
    expect(parseArgs([])).toEqual({ apply: false, confirmProduction: false, expectedVisible: null, expectedMissing: null })
  })

  it('rejects unknown flags', () => {
    expect(parseArgs(['--yes'])).toHaveProperty('error')
    expect(parseArgs(['--force'])).toHaveProperty('error')
    expect(parseArgs(['--delete'])).toHaveProperty('error')
    expect(parseArgs(['--cleanup'])).toHaveProperty('error')
    expect(parseArgs(['--prune'])).toHaveProperty('error')
  })

  it('rejects non-integer/negative/decimal expected counters', () => {
    expect(parseArgs(['--expected-visible=abc'])).toHaveProperty('error')
    expect(parseArgs(['--expected-visible=-5'])).toHaveProperty('error')
    expect(parseArgs(['--expected-visible=3.5'])).toHaveProperty('error')
  })

  it('--apply alone (no confirm/counters) is an error', () => {
    expect(parseArgs(['--apply'])).toHaveProperty('error')
  })

  it('--apply + --confirm-production without counters is an error', () => {
    expect(parseArgs(['--apply', '--confirm-production'])).toHaveProperty('error')
  })

  it('full valid apply invocation parses cleanly', () => {
    const result = parseArgs(['--apply', '--confirm-production', '--expected-visible=10', '--expected-missing=3'])
    expect(result).toEqual({ apply: true, confirmProduction: true, expectedVisible: 10, expectedMissing: 3 })
  })
})

describe('computeInventory — target algorithm', () => {
  it('targets VISIBLE-missing only; never HIDDEN', async () => {
    const rows = [
      { id: 'visible-missing', status: 'VISIBLE', url: 'https://x/a.jpg', size: 10, mimeType: 'image/jpeg' },
      { id: 'visible-present', status: 'VISIBLE', url: 'https://x/b.jpg', size: 10, mimeType: 'image/jpeg' },
      { id: 'hidden-missing', status: 'HIDDEN', url: 'https://x/c.jpg', size: 10, mimeType: 'image/jpeg' },
      { id: 'hidden-present', status: 'HIDDEN', url: 'https://x/d.jpg', size: 10, mimeType: 'image/jpeg' },
    ]
    const prisma = makePrisma({ total: 4, visibleCount: 2, hiddenCount: 2, rows })
    const listBlobs = makeListBlobs([VISIBLE_PATH('visible-present'), VISIBLE_PATH('hidden-present')])

    const inventory = await computeInventory({ prisma, listBlobs })

    expect(inventory.targets.map((t) => t.id)).toEqual(['visible-missing'])
    expect(inventory.visibleDisplayMissing).toBe(1)
    expect(inventory.visibleDisplayPresent).toBe(1)
    expect(inventory.hiddenDisplayPresent).toBe(1)
  })

  it('computes extra-unmatched objects and source-url-unusable count', async () => {
    const rows = [{ id: 'missing-bad-url', status: 'VISIBLE', url: '', size: 5, mimeType: 'image/png' }]
    const prisma = makePrisma({ total: 1, visibleCount: 1, hiddenCount: 0, rows })
    const listBlobs = makeListBlobs(['derivatives/display-v1/does-not-exist-anymore.jpg'])

    const inventory = await computeInventory({ prisma, listBlobs })

    expect(inventory.displayV1ExtraUnmatched).toBe(1)
    expect(inventory.sourceUrlUnusableCount).toBe(1)
  })

  it('paginates blob list with bounded cursor loop', async () => {
    const listBlobs = vi
      .fn()
      .mockResolvedValueOnce({ blobs: [{ pathname: VISIBLE_PATH('a') }], cursor: 'next', hasMore: true })
      .mockResolvedValueOnce({ blobs: [{ pathname: VISIBLE_PATH('b') }], cursor: undefined, hasMore: false })
    const prisma = makePrisma({ total: 0, visibleCount: 0, hiddenCount: 0, rows: [] })

    const inventory = await computeInventory({ prisma, listBlobs })

    expect(listBlobs).toHaveBeenCalledTimes(2)
    expect(listBlobs.mock.calls[1][0].cursor).toBe('next')
    expect(inventory.displayV1ObjectsTotal).toBe(2)
  })
})

describe('main — dry run is strictly read-only', () => {
  it('default invocation performs zero ensure/source-fetch/mutation calls', async () => {
    const rows = [{ id: 'p1', status: 'VISIBLE', url: 'https://x/a.jpg', size: 10, mimeType: 'image/jpeg' }]
    const prisma = makePrisma({ total: 1, visibleCount: 1, hiddenCount: 0, rows })
    const listBlobs = makeListBlobs([])
    const ensureDisplayDerivative = vi.fn()
    const getPhotoBuffer = vi.fn()
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() }

    const result = await main([], {
      getPrismaClient: async () => prisma,
      listBlobs,
      ensureDisplayDerivative,
      getPhotoBuffer,
      logger,
    })

    expect(result.exitCode).toBe(0)
    expect(result.mode).toBe('dry-run')
    expect(ensureDisplayDerivative).not.toHaveBeenCalled()
    expect(getPhotoBuffer).not.toHaveBeenCalled()
    expect(prisma.photo.findUnique).not.toHaveBeenCalled()
  })

  it('reports the exact required aggregate keys, no ids/urls in output', async () => {
    const rows = [{ id: 'super-secret-photo-id', status: 'VISIBLE', url: 'https://secret.example/x.jpg', size: 10, mimeType: 'image/jpeg' }]
    const prisma = makePrisma({ total: 1, visibleCount: 1, hiddenCount: 0, rows })
    const listBlobs = makeListBlobs([])
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() }

    await main([], { getPrismaClient: async () => prisma, listBlobs, ensureDisplayDerivative: vi.fn(), getPhotoBuffer: vi.fn(), logger })

    const printed = logger.log.mock.calls.map((call) => call[0]).join('\n')
    for (const key of [
      'CURRENT_TOTAL_PHOTOS',
      'CURRENT_VISIBLE_PHOTOS',
      'CURRENT_HIDDEN_PHOTOS',
      'DISPLAY_V1_OBJECTS_TOTAL',
      'VISIBLE_DISPLAY_PRESENT',
      'VISIBLE_DISPLAY_MISSING',
      'HIDDEN_DISPLAY_PRESENT',
      'DISPLAY_V1_EXTRA_UNMATCHED',
      'TARGET_COUNT',
      'SOURCE_URL_UNUSABLE_COUNT',
    ]) {
      expect(printed).toContain(key)
    }
    expect(printed).not.toContain('super-secret-photo-id')
    expect(printed).not.toContain('secret.example')
  })
})

describe('main — apply gates (all before ensure/source fetch)', () => {
  const rows = [{ id: 'p1', status: 'VISIBLE', url: 'https://x/a.jpg', size: 10, mimeType: 'image/jpeg' }]

  it('--apply without --confirm-production aborts before ensure', async () => {
    const prisma = makePrisma({ total: 1, visibleCount: 1, hiddenCount: 0, rows })
    const ensureDisplayDerivative = vi.fn()
    const result = await main(['--apply'], {
      getPrismaClient: async () => prisma,
      listBlobs: makeListBlobs([]),
      ensureDisplayDerivative,
      getPhotoBuffer: vi.fn(),
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })
    expect(result.exitCode).toBe(1)
    expect(ensureDisplayDerivative).not.toHaveBeenCalled()
    expect(prisma.photo.count).not.toHaveBeenCalled()
  })

  it('--apply + --confirm-production but missing expected counters aborts before ensure', async () => {
    const ensureDisplayDerivative = vi.fn()
    const result = await main(['--apply', '--confirm-production'], {
      getPrismaClient: async () => makePrisma(),
      listBlobs: makeListBlobs([]),
      ensureDisplayDerivative,
      getPhotoBuffer: vi.fn(),
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })
    expect(result.exitCode).toBe(1)
    expect(ensureDisplayDerivative).not.toHaveBeenCalled()
  })

  it('expected-visible mismatch aborts before ensure', async () => {
    const prisma = makePrisma({ total: 1, visibleCount: 1, hiddenCount: 0, rows })
    const ensureDisplayDerivative = vi.fn()
    const result = await main(
      ['--apply', '--confirm-production', '--expected-visible=999', '--expected-missing=1'],
      {
        getPrismaClient: async () => prisma,
        listBlobs: makeListBlobs([]),
        ensureDisplayDerivative,
        getPhotoBuffer: vi.fn(),
        logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
      },
    )
    expect(result.exitCode).toBe(1)
    expect(ensureDisplayDerivative).not.toHaveBeenCalled()
  })

  it('expected-missing mismatch aborts before ensure', async () => {
    const prisma = makePrisma({ total: 1, visibleCount: 1, hiddenCount: 0, rows })
    const ensureDisplayDerivative = vi.fn()
    const result = await main(
      ['--apply', '--confirm-production', '--expected-visible=1', '--expected-missing=999'],
      {
        getPrismaClient: async () => prisma,
        listBlobs: makeListBlobs([]),
        ensureDisplayDerivative,
        getPhotoBuffer: vi.fn(),
        logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
      },
    )
    expect(result.exitCode).toBe(1)
    expect(ensureDisplayDerivative).not.toHaveBeenCalled()
  })

  it('source-url-unusable > 0 aborts apply before ensure', async () => {
    const badRows = [{ id: 'p1', status: 'VISIBLE', url: '', size: 10, mimeType: 'image/jpeg' }]
    const prisma = makePrisma({ total: 1, visibleCount: 1, hiddenCount: 0, rows: badRows })
    const ensureDisplayDerivative = vi.fn()
    const result = await main(
      ['--apply', '--confirm-production', '--expected-visible=1', '--expected-missing=1'],
      {
        getPrismaClient: async () => prisma,
        listBlobs: makeListBlobs([]),
        ensureDisplayDerivative,
        getPhotoBuffer: vi.fn(),
        logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
      },
    )
    expect(result.exitCode).toBe(1)
    expect(ensureDisplayDerivative).not.toHaveBeenCalled()
  })

  it('HIDDEN_DISPLAY_PRESENT > 0 aborts apply before ensure/source fetch', async () => {
    const hiddenRows = [
      { id: 'p1', status: 'VISIBLE', url: 'https://x/a.jpg', size: 10, mimeType: 'image/jpeg' },
      { id: 'hidden-1', status: 'HIDDEN', url: 'https://x/b.jpg', size: 10, mimeType: 'image/jpeg' },
    ]
    const prisma = makePrisma({ total: 2, visibleCount: 1, hiddenCount: 1, rows: hiddenRows })
    const listBlobs = makeListBlobs([VISIBLE_PATH('hidden-1')])
    const ensureDisplayDerivative = vi.fn()
    const getPhotoBuffer = vi.fn()
    const result = await main(
      ['--apply', '--confirm-production', '--expected-visible=1', '--expected-missing=1'],
      {
        getPrismaClient: async () => prisma,
        listBlobs,
        ensureDisplayDerivative,
        getPhotoBuffer,
        logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
      },
    )
    expect(result.exitCode).toBe(1)
    expect(ensureDisplayDerivative).not.toHaveBeenCalled()
    expect(getPhotoBuffer).not.toHaveBeenCalled()
  })

  it('extra-unmatched alone does not block an otherwise-valid apply', async () => {
    const rows = [{ id: 'p1', status: 'VISIBLE', url: 'https://x/a.jpg', size: 10, mimeType: 'image/jpeg' }]
    const prisma = makePrisma({
      total: 1,
      visibleCount: 1,
      hiddenCount: 0,
      rows,
      findUniqueImpl: async () => ({ status: 'VISIBLE', url: 'https://x/a.jpg' }),
    })
    const listBlobs = makeListBlobs(['derivatives/display-v1/orphan-no-photo.jpg'])
    const ensureDisplayDerivative = vi.fn().mockResolvedValue({ created: true })
    const result = await main(
      ['--apply', '--confirm-production', '--expected-visible=1', '--expected-missing=1'],
      {
        getPrismaClient: async () => prisma,
        listBlobs,
        ensureDisplayDerivative,
        getPhotoBuffer: vi.fn().mockResolvedValue(Buffer.from('x')),
        logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
      },
    )
    expect(result.exitCode).toBe(0)
    expect(ensureDisplayDerivative).toHaveBeenCalledTimes(1)
  })
})

describe('main — apply: per-item status revalidation', () => {
  it('row now HIDDEN -> skip, no ensure, no source fetch', async () => {
    const rows = [{ id: 'p1', status: 'VISIBLE', url: 'https://x/a.jpg', size: 10, mimeType: 'image/jpeg' }]
    const prisma = makePrisma({
      total: 1,
      visibleCount: 1,
      hiddenCount: 0,
      rows,
      findUniqueImpl: async () => ({ status: 'HIDDEN', url: 'https://x/a.jpg' }),
    })
    const ensureDisplayDerivative = vi.fn()
    const getPhotoBuffer = vi.fn()
    const result = await main(
      ['--apply', '--confirm-production', '--expected-visible=1', '--expected-missing=1'],
      {
        getPrismaClient: async () => prisma,
        listBlobs: makeListBlobs([]),
        ensureDisplayDerivative,
        getPhotoBuffer,
        logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
      },
    )
    expect(result.exitCode).toBe(0)
    expect(result.applyResult.skippedStatusChanged).toBe(1)
    expect(ensureDisplayDerivative).not.toHaveBeenCalled()
    expect(getPhotoBuffer).not.toHaveBeenCalled()
  })

  it('row now absent -> skip, no ensure', async () => {
    const rows = [{ id: 'p1', status: 'VISIBLE', url: 'https://x/a.jpg', size: 10, mimeType: 'image/jpeg' }]
    const prisma = makePrisma({ total: 1, visibleCount: 1, hiddenCount: 0, rows, findUniqueImpl: async () => null })
    const ensureDisplayDerivative = vi.fn()
    const result = await main(
      ['--apply', '--confirm-production', '--expected-visible=1', '--expected-missing=1'],
      {
        getPrismaClient: async () => prisma,
        listBlobs: makeListBlobs([]),
        ensureDisplayDerivative,
        getPhotoBuffer: vi.fn(),
        logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
      },
    )
    expect(result.applyResult.skippedStatusChanged).toBe(1)
    expect(ensureDisplayDerivative).not.toHaveBeenCalled()
  })
})

describe('main — apply: ensure integration, race, create, failure', () => {
  function setupSingleTarget({ findUniqueImpl, ensureImpl }) {
    const rows = [{ id: 'p1', status: 'VISIBLE', url: 'https://x/a.jpg', size: 10, mimeType: 'image/jpeg' }]
    const prisma = makePrisma({ total: 1, visibleCount: 1, hiddenCount: 0, rows, findUniqueImpl })
    return { prisma, ensureDisplayDerivative: vi.fn(ensureImpl) }
  }

  it('live-eager race: ensure returns created:false -> alreadyPresent, not a failure', async () => {
    const { prisma, ensureDisplayDerivative } = setupSingleTarget({
      findUniqueImpl: async () => ({ status: 'VISIBLE', url: 'https://x/a.jpg' }),
      ensureImpl: async () => ({ created: false }),
    })
    const result = await main(
      ['--apply', '--confirm-production', '--expected-visible=1', '--expected-missing=1'],
      {
        getPrismaClient: async () => prisma,
        listBlobs: makeListBlobs([]),
        ensureDisplayDerivative,
        getPhotoBuffer: vi.fn().mockResolvedValue(Buffer.from('x')),
        logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
      },
    )
    expect(result.applyResult.alreadyPresent).toBe(1)
    expect(result.applyResult.failed).toBe(0)
    expect(result.exitCode).toBe(0)
  })

  it('true miss: ensure returns created:true -> created count', async () => {
    const { prisma, ensureDisplayDerivative } = setupSingleTarget({
      findUniqueImpl: async () => ({ status: 'VISIBLE', url: 'https://x/a.jpg' }),
      ensureImpl: async () => ({ created: true }),
    })
    const result = await main(
      ['--apply', '--confirm-production', '--expected-visible=1', '--expected-missing=1'],
      {
        getPrismaClient: async () => prisma,
        listBlobs: makeListBlobs([]),
        ensureDisplayDerivative,
        getPhotoBuffer: vi.fn().mockResolvedValue(Buffer.from('x')),
        logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
      },
    )
    expect(result.applyResult.created).toBe(1)
    expect(result.applyResult.failed).toBe(0)
  })

  it('uses the FRESH revalidated url, not the stale initial one, in getSourceBuffer', async () => {
    const rows = [{ id: 'p1', status: 'VISIBLE', url: 'https://stale.example/a.jpg', size: 10, mimeType: 'image/jpeg' }]
    const prisma = makePrisma({
      total: 1,
      visibleCount: 1,
      hiddenCount: 0,
      rows,
      findUniqueImpl: async () => ({ status: 'VISIBLE', url: 'https://fresh.example/a.jpg' }),
    })
    const getPhotoBuffer = vi.fn().mockResolvedValue(Buffer.from('x'))
    const ensureDisplayDerivative = vi.fn(async ({ getSourceBuffer }) => {
      await getSourceBuffer()
      return { created: true }
    })
    await main(['--apply', '--confirm-production', '--expected-visible=1', '--expected-missing=1'], {
      getPrismaClient: async () => prisma,
      listBlobs: makeListBlobs([]),
      ensureDisplayDerivative,
      getPhotoBuffer,
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })
    expect(getPhotoBuffer).toHaveBeenCalledWith('https://fresh.example/a.jpg')
  })
})

describe('main — failure continuation and exit code', () => {
  it('one ensure rejects, siblings continue, failures > 0 -> non-zero exit, no id/url in output', async () => {
    const rows = [
      { id: 'photo-ok', status: 'VISIBLE', url: 'https://x/ok.jpg', size: 10, mimeType: 'image/jpeg' },
      { id: 'photo-bad', status: 'VISIBLE', url: 'https://x/bad.jpg', size: 10, mimeType: 'image/jpeg' },
    ]
    const prisma = makePrisma({
      total: 2,
      visibleCount: 2,
      hiddenCount: 0,
      rows,
      findUniqueImpl: async ({ where }) => ({ status: 'VISIBLE', url: where.id === 'photo-bad' ? 'https://x/bad.jpg' : 'https://x/ok.jpg' }),
    })
    const ensureDisplayDerivative = vi.fn(async ({ photoId }) => {
      if (photoId === 'photo-bad') throw new Error('transform failed')
      return { created: true }
    })
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() }

    const result = await main(
      ['--apply', '--confirm-production', '--expected-visible=2', '--expected-missing=2'],
      {
        getPrismaClient: async () => prisma,
        listBlobs: makeListBlobs([]),
        ensureDisplayDerivative,
        getPhotoBuffer: vi.fn().mockResolvedValue(Buffer.from('x')),
        logger,
      },
    )

    expect(result.applyResult.created).toBe(1)
    expect(result.applyResult.failed).toBe(1)
    expect(result.exitCode).toBe(1)

    const printed = [...logger.log.mock.calls, ...logger.error.mock.calls, ...logger.warn.mock.calls].map((c) => c.join(' ')).join('\n')
    expect(printed).not.toContain('photo-ok')
    expect(printed).not.toContain('photo-bad')
    expect(printed).not.toContain('https://x/ok.jpg')
    expect(printed).not.toContain('https://x/bad.jpg')
  })
})

describe('main — bounded concurrency = 3', () => {
  it('never exceeds BACKFILL_APPLY_CONCURRENCY simultaneous ensure calls', async () => {
    expect(BACKFILL_APPLY_CONCURRENCY).toBe(3)

    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: `photo-${i}`,
      status: 'VISIBLE',
      url: `https://x/${i}.jpg`,
      size: 10,
      mimeType: 'image/jpeg',
    }))
    const prisma = makePrisma({
      total: 10,
      visibleCount: 10,
      hiddenCount: 0,
      rows,
      findUniqueImpl: async ({ where }) => ({ status: 'VISIBLE', url: `https://x/${where.id.split('-')[1]}.jpg` }),
    })

    let concurrent = 0
    let maxConcurrent = 0
    const ensureDisplayDerivative = vi.fn(async () => {
      concurrent += 1
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise((resolve) => setTimeout(resolve, 5))
      concurrent -= 1
      return { created: true }
    })

    await main(['--apply', '--confirm-production', '--expected-visible=10', '--expected-missing=10'], {
      getPrismaClient: async () => prisma,
      listBlobs: makeListBlobs([]),
      ensureDisplayDerivative,
      getPhotoBuffer: vi.fn().mockResolvedValue(Buffer.from('x')),
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })

    expect(maxConcurrent).toBeLessThanOrEqual(3)
    expect(maxConcurrent).toBeGreaterThan(1)
    expect(ensureDisplayDerivative).toHaveBeenCalledTimes(10)
  })
})

describe('main — mixed-mode limitation does not apply', () => {
  it('never imports/calls getDisplayDerivative (ensure-mode only)', () => {
    const source = readFileSync(join(process.cwd(), 'lib/server/display-backfill.js'), 'utf8')
    expect(source).not.toMatch(/\bgetDisplayDerivative\b/)
  })
})

describe('structural safety: no delete, no DB write', () => {
  const source = readFileSync(join(process.cwd(), 'lib/server/display-backfill.js'), 'utf8')

  it('never imports or calls Blob del', () => {
    expect(source).not.toMatch(/\bdel\b/)
  })

  it('never calls a Prisma write method', () => {
    for (const method of ['.create(', '.update(', '.delete(', '.upsert(', '.updateMany(', '.deleteMany(', '.createMany(', '$executeRaw', '$queryRawUnsafe']) {
      expect(source).not.toContain(method)
    }
  })

  it('CLI accepts no delete/cleanup/prune flags', async () => {
    for (const flag of ['--delete', '--cleanup', '--prune', '--force-delete']) {
      expect(parseArgs([flag])).toHaveProperty('error')
    }
  })
})

describe('import safety', () => {
  it('importing the module performs zero DB/Blob/ensure/fetch calls', async () => {
    // If import itself had a side effect, the mocked getPrismaClient/list
    // above would already have been invoked before this file's own tests run.
    const prismaClientModule = await import('@/lib/server/prisma-client')
    expect(prismaClientModule.getPrismaClient).not.toHaveBeenCalled()
  })
})

describe('createRealDependencies', () => {
  it('wires the real production primitives without invoking them', () => {
    const deps = createRealDependencies()
    expect(typeof deps.getPrismaClient).toBe('function')
    expect(typeof deps.listBlobs).toBe('function')
    expect(typeof deps.ensureDisplayDerivative).toBe('function')
    expect(typeof deps.getPhotoBuffer).toBe('function')
  })
})
