import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// STEP 7.15f.1-c — display-v1 backfill operator core.
// Extended by:
//  - "Display Backfill Status Reconciliation": a successful backfill run
//    also reconciles Photo.displayDerivativeStatus, not just Blob object
//    existence (a status left at LEGACY_UNVERIFIED after a successful
//    backfill was a false negative for the guest resolver).
//  - "Guest EXIF Plumbing + Backfill Reconciliation: Operator Target
//    Safety": every invocation (dry-run included) now must declare
//    --env=preview|production, and main() proves — via
//    lib/server/backfill-target-identity.js's checkTargetIdentity — that
//    the injected DATABASE_URL/BLOB_READ_WRITE_TOKEN pair actually belongs
//    to that declared environment BEFORE any other dependency is touched.
//    See tests/backfill-target-identity.test.js for that module's own
//    direct, exhaustive coverage (the Preview/Production cross-mismatch
//    matrix lives there); this file's identity-related tests focus on
//    main()'s wiring and fail-closed short-circuiting.
//
// display-backfill.js is a pure function of (argv, dependencies): it never
// reads process.env and never imports Vite/CLI plumbing, so every test here
// uses fully synthetic, injected dependencies and touches zero Production
// credentials. The status write itself is delegated to the shared, already
// unit-tested lib/server/photo-display-derivative-status.js helper (see
// tests/photo-display-derivative-status.test.js). The native .cjs bootstrap
// (env policy, Vite resolution, non-listening ModuleRunner) is covered
// separately in tests/backfill-display-cli.test.js.

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

function makePrisma({ total = 0, visibleCount = 0, hiddenCount = 0, rows = [], findUniqueImpl, updateManyImpl } = {}) {
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
      updateMany: vi.fn(updateManyImpl || (async () => ({ count: 1 }))),
    },
  }
}

function makeListBlobs(pathnames) {
  const blobs = pathnames.map((pathname) => ({ pathname, url: `https://blob.test/${pathname}`, size: 1, uploadedAt: new Date() }))
  return vi.fn(async () => ({ blobs, cursor: undefined, hasMore: false }))
}

const VISIBLE_PATH = (id) => `derivatives/display-v1/${id}.jpg`

// A fully self-consistent, synthetic environment table — distinct from the
// real, shipped ENV_CONFIG (which is deliberately NOT_CONFIGURED for
// blobStoreId/databaseRole and would fail closed on every test below). This
// lets tests focused on generation/reconciliation logic get PAST the
// identity gate with an explicit, readable, self-consistent fixture, while
// tests/backfill-target-identity.test.js separately proves the real
// ENV_CONFIG fails closed by default.
const TEST_ENV_CONFIG = {
  preview: {
    expectedDirectHost: 'ep-test-preview.c-1.us-east-1.aws.neon.tech',
    expectedDatabaseName: 'neondb',
    expectedDatabaseRole: 'test_runtime_role',
    expectedBlobStoreId: 'previewstore',
  },
  production: {
    expectedDirectHost: 'ep-test-production.c-1.us-east-1.aws.neon.tech',
    expectedDatabaseName: 'neondb',
    expectedDatabaseRole: 'test_runtime_role',
    expectedBlobStoreId: 'productionstore',
  },
}
const PREVIEW_DB_URL = 'postgresql://user:pass@ep-test-preview-pooler.c-1.us-east-1.aws.neon.tech/neondb'
const PRODUCTION_DB_URL = 'postgresql://user:pass@ep-test-production-pooler.c-1.us-east-1.aws.neon.tech/neondb'
const PREVIEW_BLOB_TOKEN = 'vercel_blob_rw_previewstore_randomsuffix'
const PRODUCTION_BLOB_TOKEN = 'vercel_blob_rw_productionstore_randomsuffix'

/** A complete, PASSING identity fixture for --env=preview, merged into a dependencies object. */
function validPreviewIdentity(overrides = {}) {
  return {
    databaseUrl: PREVIEW_DB_URL,
    blobReadWriteToken: PREVIEW_BLOB_TOKEN,
    queryLiveDatabaseIdentity: vi.fn().mockResolvedValue({ databaseName: 'neondb', databaseRole: 'test_runtime_role' }),
    envConfig: TEST_ENV_CONFIG,
    ...overrides,
  }
}

function baseLogger() {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

// A real apply run now always attempts status writes (READY, on the
// success branch, for every target it touches) even when no test is
// specifically asserting on the log — suppress the noise the same way
// photo-display-derivative-status.test.js does for its own failure-path
// warnings.
let warnSpy
beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  warnSpy.mockRestore()
})

describe('parseArgs', () => {
  it('no args -> missing --env is an error (no environment inference, ever)', () => {
    const result = parseArgs([])
    expect(result).toHaveProperty('error')
    expect(result.error).toMatch(/--env/)
  })

  it('--env=preview alone -> dry run (apply=false)', () => {
    expect(parseArgs(['--env=preview'])).toEqual({
      apply: false,
      env: 'preview',
      confirmTarget: null,
      expectedVisible: null,
      expectedMissing: null,
      expectedReconcile: null,
    })
  })

  it('rejects an invalid --env value', () => {
    expect(parseArgs(['--env=staging'])).toHaveProperty('error')
    expect(parseArgs(['--env=Production'])).toHaveProperty('error') // case-sensitive, no fuzzy matching
  })

  it('rejects unknown flags', () => {
    expect(parseArgs(['--env=preview', '--yes'])).toHaveProperty('error')
    expect(parseArgs(['--env=preview', '--force'])).toHaveProperty('error')
    expect(parseArgs(['--env=preview', '--delete'])).toHaveProperty('error')
    expect(parseArgs(['--env=preview', '--cleanup'])).toHaveProperty('error')
    expect(parseArgs(['--env=preview', '--prune'])).toHaveProperty('error')
  })

  it('the old, environment-blind --confirm-production flag no longer exists', () => {
    expect(parseArgs(['--env=preview', '--confirm-production'])).toHaveProperty('error')
  })

  it('rejects non-integer/negative/decimal expected counters, including --expected-reconcile', () => {
    expect(parseArgs(['--env=preview', '--expected-visible=abc'])).toHaveProperty('error')
    expect(parseArgs(['--env=preview', '--expected-visible=-5'])).toHaveProperty('error')
    expect(parseArgs(['--env=preview', '--expected-visible=3.5'])).toHaveProperty('error')
    expect(parseArgs(['--env=preview', '--expected-reconcile=abc'])).toHaveProperty('error')
    expect(parseArgs(['--env=preview', '--expected-reconcile=-5'])).toHaveProperty('error')
    expect(parseArgs(['--env=preview', '--expected-reconcile=3.5'])).toHaveProperty('error')
  })

  it('--apply alone (no confirm-target/counters) is an error', () => {
    expect(parseArgs(['--env=preview', '--apply'])).toHaveProperty('error')
  })

  it('--apply + --confirm-target but missing expected counters is an error', () => {
    expect(parseArgs(['--env=preview', '--apply', '--confirm-target=preview'])).toHaveProperty('error')
  })

  it('7. Preview apply cannot be authorized with a Production confirmation', () => {
    const result = parseArgs([
      '--env=preview',
      '--apply',
      '--confirm-target=production',
      '--expected-visible=1',
      '--expected-missing=0',
      '--expected-reconcile=0',
    ])
    expect(result).toHaveProperty('error')
    expect(result.error).toMatch(/does not match/)
  })

  it('8. Production apply cannot be authorized with a Preview confirmation', () => {
    const result = parseArgs([
      '--env=production',
      '--apply',
      '--confirm-target=preview',
      '--expected-visible=1',
      '--expected-missing=0',
      '--expected-reconcile=0',
    ])
    expect(result).toHaveProperty('error')
    expect(result.error).toMatch(/does not match/)
  })

  it('full valid Preview apply invocation parses cleanly', () => {
    const result = parseArgs([
      '--env=preview',
      '--apply',
      '--confirm-target=preview',
      '--expected-visible=10',
      '--expected-missing=3',
      '--expected-reconcile=2',
    ])
    expect(result).toEqual({
      apply: true,
      env: 'preview',
      confirmTarget: 'preview',
      expectedVisible: 10,
      expectedMissing: 3,
      expectedReconcile: 2,
    })
  })

  it('full valid Production apply invocation parses cleanly', () => {
    const result = parseArgs([
      '--env=production',
      '--apply',
      '--confirm-target=production',
      '--expected-visible=10',
      '--expected-missing=3',
      '--expected-reconcile=2',
    ])
    expect(result.apply).toBe(true)
    expect(result.env).toBe('production')
    expect(result.confirmTarget).toBe('production')
  })
})

describe('computeInventory — target algorithm', () => {
  it('targets VISIBLE-actionable rows only; HIDDEN is never targeted regardless of status', async () => {
    const rows = [
      { id: 'visible-missing', status: 'VISIBLE', url: 'https://x/a.jpg', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'LEGACY_UNVERIFIED' },
      { id: 'visible-present-ready', status: 'VISIBLE', url: 'https://x/b.jpg', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'READY' },
      { id: 'hidden-missing', status: 'HIDDEN', url: 'https://x/c.jpg', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'LEGACY_UNVERIFIED' },
      { id: 'hidden-present', status: 'HIDDEN', url: 'https://x/d.jpg', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'LEGACY_UNVERIFIED' },
    ]
    const prisma = makePrisma({ total: 4, visibleCount: 2, hiddenCount: 2, rows })
    const listBlobs = makeListBlobs([VISIBLE_PATH('visible-present-ready'), VISIBLE_PATH('hidden-present')])

    const inventory = await computeInventory({ prisma, listBlobs })

    expect(inventory.targets.map((t) => t.id)).toEqual(['visible-missing'])
    expect(inventory.visibleDisplayMissing).toBe(1)
    expect(inventory.visibleDisplayPresent).toBe(1)
    expect(inventory.hiddenDisplayPresent).toBe(1)
  })

  it('computes extra-unmatched objects and source-url-unusable count (generation targets only)', async () => {
    const rows = [{ id: 'missing-bad-url', status: 'VISIBLE', url: '', size: 5, mimeType: 'image/png', displayDerivativeStatus: 'LEGACY_UNVERIFIED' }]
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

describe('status reconciliation — target classification (Display Backfill Status Reconciliation)', () => {
  it('LEGACY_UNVERIFIED + blob present -> reconcile-only target (needsGeneration:false); never counted as missing or source-url-unusable, even with an unusable url', async () => {
    const rows = [{ id: 'p1', status: 'VISIBLE', url: '', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'LEGACY_UNVERIFIED' }]
    const prisma = makePrisma({ total: 1, visibleCount: 1, hiddenCount: 0, rows })
    const listBlobs = makeListBlobs([VISIBLE_PATH('p1')])

    const inventory = await computeInventory({ prisma, listBlobs })

    expect(inventory.targets).toHaveLength(1)
    expect(inventory.targets[0]).toMatchObject({ id: 'p1', needsGeneration: false })
    expect(inventory.reconcileOnlyCount).toBe(1)
    expect(inventory.visibleDisplayMissing).toBe(0)
    expect(inventory.sourceUrlUnusableCount).toBe(0)
  })

  it('FAILED + blob present -> also reconcile-only', async () => {
    const rows = [{ id: 'p1', status: 'VISIBLE', url: 'https://x/a.jpg', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'FAILED' }]
    const prisma = makePrisma({ total: 1, visibleCount: 1, hiddenCount: 0, rows })
    const listBlobs = makeListBlobs([VISIBLE_PATH('p1')])

    const inventory = await computeInventory({ prisma, listBlobs })

    expect(inventory.reconcileOnlyCount).toBe(1)
    expect(inventory.targets[0].needsGeneration).toBe(false)
  })

  it('READY + blob present -> steady state, excluded from targets entirely (idempotent rerun invariant)', async () => {
    const rows = [{ id: 'p1', status: 'VISIBLE', url: 'https://x/a.jpg', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'READY' }]
    const prisma = makePrisma({ total: 1, visibleCount: 1, hiddenCount: 0, rows })
    const listBlobs = makeListBlobs([VISIBLE_PATH('p1')])

    const inventory = await computeInventory({ prisma, listBlobs })

    expect(inventory.targets).toHaveLength(0)
    expect(inventory.reconcileOnlyCount).toBe(0)
    expect(inventory.visibleDisplayMissing).toBe(0)
    expect(inventory.readyButBlobMissing).toBe(0)
  })

  it('READY + blob missing -> anomaly counted (readyButBlobMissing) AND still included as a generation target (self-healing, not silently trusted)', async () => {
    const rows = [{ id: 'p1', status: 'VISIBLE', url: 'https://x/a.jpg', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'READY' }]
    const prisma = makePrisma({ total: 1, visibleCount: 1, hiddenCount: 0, rows })
    const listBlobs = makeListBlobs([])

    const inventory = await computeInventory({ prisma, listBlobs })

    expect(inventory.readyButBlobMissing).toBe(1)
    expect(inventory.targets).toHaveLength(1)
    expect(inventory.targets[0].needsGeneration).toBe(true)
    expect(inventory.visibleDisplayMissing).toBe(1)
  })

  it('PENDING is always skipped, regardless of blob presence, and never appears in targets', async () => {
    const rows = [
      { id: 'pending-present', status: 'VISIBLE', url: 'https://x/a.jpg', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'PENDING' },
      { id: 'pending-missing', status: 'VISIBLE', url: 'https://x/b.jpg', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'PENDING' },
    ]
    const prisma = makePrisma({ total: 2, visibleCount: 2, hiddenCount: 0, rows })
    const listBlobs = makeListBlobs([VISIBLE_PATH('pending-present')])

    const inventory = await computeInventory({ prisma, listBlobs })

    expect(inventory.targets).toHaveLength(0)
    expect(inventory.visiblePendingSkipped).toBe(2)
  })
})

describe('main — target-identity gate (Operator Target Safety)', () => {
  it('missing --env aborts before any dependency is touched', async () => {
    const getPrismaClient = vi.fn()
    const listBlobs = vi.fn()
    const result = await main([], {
      getPrismaClient,
      listBlobs,
      ensureDisplayDerivative: vi.fn(),
      getPhotoBuffer: vi.fn(),
      ...validPreviewIdentity(),
      logger: baseLogger(),
    })
    expect(result.exitCode).toBe(1)
    expect(getPrismaClient).not.toHaveBeenCalled()
    expect(listBlobs).not.toHaveBeenCalled()
  })

  it('5. wrong --env (declares preview, DATABASE_URL is actually production) -> FAIL, zero ensure/updateMany/getPrisma calls', async () => {
    const getPrismaClient = vi.fn()
    const ensureDisplayDerivative = vi.fn()
    const result = await main(['--env=preview'], {
      getPrismaClient,
      listBlobs: vi.fn(),
      ensureDisplayDerivative,
      getPhotoBuffer: vi.fn(),
      ...validPreviewIdentity({ databaseUrl: PRODUCTION_DB_URL }),
      logger: baseLogger(),
    })
    expect(result.exitCode).toBe(1)
    expect(result.mode).toBe('identity-check')
    expect(result.identity.reason).toBe('UNEXPECTED_DATABASE_HOST')
    expect(getPrismaClient).not.toHaveBeenCalled()
    expect(ensureDisplayDerivative).not.toHaveBeenCalled()
  })

  it('3. Preview DB + Production Blob -> FAIL (UNEXPECTED_BLOB_STORE), no live DB query attempted', async () => {
    const queryLiveDatabaseIdentity = vi.fn()
    const result = await main(['--env=preview'], {
      getPrismaClient: vi.fn(),
      listBlobs: vi.fn(),
      ensureDisplayDerivative: vi.fn(),
      getPhotoBuffer: vi.fn(),
      ...validPreviewIdentity({ blobReadWriteToken: PRODUCTION_BLOB_TOKEN, queryLiveDatabaseIdentity }),
      logger: baseLogger(),
    })
    expect(result.exitCode).toBe(1)
    expect(result.identity.reason).toBe('UNEXPECTED_BLOB_STORE')
    expect(queryLiveDatabaseIdentity).not.toHaveBeenCalled()
  })

  it('9. an identity failure results in zero ensure calls and zero updateMany calls, end to end', async () => {
    const prisma = makePrisma({ total: 1, visibleCount: 1, hiddenCount: 0, rows: [{ id: 'p1', status: 'VISIBLE', url: 'https://x/a.jpg', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'LEGACY_UNVERIFIED' }] })
    const ensureDisplayDerivative = vi.fn()
    const result = await main(
      ['--env=preview', '--apply', '--confirm-target=preview', '--expected-visible=1', '--expected-missing=1', '--expected-reconcile=0'],
      {
        getPrismaClient: async () => prisma,
        listBlobs: makeListBlobs([]),
        ensureDisplayDerivative,
        getPhotoBuffer: vi.fn(),
        ...validPreviewIdentity({ blobReadWriteToken: PRODUCTION_BLOB_TOKEN }), // mismatched -> fails
        logger: baseLogger(),
      },
    )
    expect(result.exitCode).toBe(1)
    expect(ensureDisplayDerivative).not.toHaveBeenCalled()
    expect(prisma.photo.updateMany).not.toHaveBeenCalled()
    expect(prisma.photo.findUnique).not.toHaveBeenCalled()
  })

  it('a passing identity check prints TARGET_IDENTITY=PASS with ENV/DB/DB_ROLE/DB_BRANCH/BLOB_STORE, never a credential', async () => {
    const rows = [{ id: 'p1', status: 'VISIBLE', url: 'https://x/a.jpg', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'LEGACY_UNVERIFIED' }]
    const prisma = makePrisma({ total: 1, visibleCount: 1, hiddenCount: 0, rows })
    const logger = baseLogger()

    await main(['--env=preview'], {
      getPrismaClient: async () => prisma,
      listBlobs: makeListBlobs([]),
      ensureDisplayDerivative: vi.fn(),
      getPhotoBuffer: vi.fn(),
      ...validPreviewIdentity(),
      logger,
    })

    const printed = logger.log.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(printed).toContain('TARGET_IDENTITY=PASS')
    expect(printed).toContain('ENV=preview')
    expect(printed).toContain('DB=neondb')
    expect(printed).toContain('DB_ROLE=test_runtime_role')
    expect(printed).toContain('DB_BRANCH=ep-test-preview')
    expect(printed).toContain('BLOB_STORE=previewstore')
    expect(printed).not.toContain(PREVIEW_BLOB_TOKEN)
    expect(printed).not.toContain('user:pass')
  })

  it('10. an identity PASS followed by dry-run (no --apply) remains mutation-free', async () => {
    const rows = [{ id: 'p1', status: 'VISIBLE', url: 'https://x/a.jpg', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'LEGACY_UNVERIFIED' }]
    const prisma = makePrisma({ total: 1, visibleCount: 1, hiddenCount: 0, rows })
    const ensureDisplayDerivative = vi.fn()

    const result = await main(['--env=preview'], {
      getPrismaClient: async () => prisma,
      listBlobs: makeListBlobs([]),
      ensureDisplayDerivative,
      getPhotoBuffer: vi.fn(),
      ...validPreviewIdentity(),
      logger: baseLogger(),
    })

    expect(result.exitCode).toBe(0)
    expect(result.mode).toBe('dry-run')
    expect(ensureDisplayDerivative).not.toHaveBeenCalled()
    expect(prisma.photo.updateMany).not.toHaveBeenCalled()
  })
})

describe('main — dry run is strictly read-only', () => {
  it('default invocation performs zero ensure/source-fetch/mutation calls, including status writes', async () => {
    const rows = [{ id: 'p1', status: 'VISIBLE', url: 'https://x/a.jpg', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'LEGACY_UNVERIFIED' }]
    const prisma = makePrisma({ total: 1, visibleCount: 1, hiddenCount: 0, rows })
    const listBlobs = makeListBlobs([])
    const ensureDisplayDerivative = vi.fn()
    const getPhotoBuffer = vi.fn()
    const logger = baseLogger()

    const result = await main(['--env=preview'], {
      getPrismaClient: async () => prisma,
      listBlobs,
      ensureDisplayDerivative,
      getPhotoBuffer,
      ...validPreviewIdentity(),
      logger,
    })

    expect(result.exitCode).toBe(0)
    expect(result.mode).toBe('dry-run')
    expect(ensureDisplayDerivative).not.toHaveBeenCalled()
    expect(getPhotoBuffer).not.toHaveBeenCalled()
    expect(prisma.photo.findUnique).not.toHaveBeenCalled()
    expect(prisma.photo.updateMany).not.toHaveBeenCalled()
  })

  it('reports the exact required aggregate keys, no ids/urls in output', async () => {
    const rows = [{ id: 'super-secret-photo-id', status: 'VISIBLE', url: 'https://secret.example/x.jpg', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'LEGACY_UNVERIFIED' }]
    const prisma = makePrisma({ total: 1, visibleCount: 1, hiddenCount: 0, rows })
    const listBlobs = makeListBlobs([])
    const logger = baseLogger()

    await main(['--env=preview'], {
      getPrismaClient: async () => prisma,
      listBlobs,
      ensureDisplayDerivative: vi.fn(),
      getPhotoBuffer: vi.fn(),
      ...validPreviewIdentity(),
      logger,
    })

    const printed = logger.log.mock.calls.map((call) => call[0]).join('\n')
    for (const key of [
      'CURRENT_TOTAL_PHOTOS',
      'CURRENT_VISIBLE_PHOTOS',
      'CURRENT_HIDDEN_PHOTOS',
      'DISPLAY_V1_OBJECTS_TOTAL',
      'VISIBLE_DISPLAY_PRESENT',
      'VISIBLE_DISPLAY_MISSING',
      'VISIBLE_PENDING_SKIPPED',
      'READY_BUT_BLOB_MISSING_COUNT',
      'HIDDEN_DISPLAY_PRESENT',
      'DISPLAY_V1_EXTRA_UNMATCHED',
      'TARGET_COUNT',
      'SOURCE_URL_UNUSABLE_COUNT',
      'RECONCILE_TARGET_COUNT',
    ]) {
      expect(printed).toContain(key)
    }
    expect(printed).not.toContain('super-secret-photo-id')
    expect(printed).not.toContain('secret.example')
  })
})

describe('main — apply gates (all before ensure/source fetch)', () => {
  const rows = [{ id: 'p1', status: 'VISIBLE', url: 'https://x/a.jpg', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'LEGACY_UNVERIFIED' }]

  it('--apply without --confirm-target aborts before ensure', async () => {
    const prisma = makePrisma({ total: 1, visibleCount: 1, hiddenCount: 0, rows })
    const ensureDisplayDerivative = vi.fn()
    const result = await main(['--env=preview', '--apply'], {
      getPrismaClient: async () => prisma,
      listBlobs: makeListBlobs([]),
      ensureDisplayDerivative,
      getPhotoBuffer: vi.fn(),
      ...validPreviewIdentity(),
      logger: baseLogger(),
    })
    expect(result.exitCode).toBe(1)
    expect(ensureDisplayDerivative).not.toHaveBeenCalled()
    expect(prisma.photo.count).not.toHaveBeenCalled()
  })

  it('--apply + --confirm-target but missing expected counters aborts before ensure', async () => {
    const ensureDisplayDerivative = vi.fn()
    const result = await main(['--env=preview', '--apply', '--confirm-target=preview'], {
      getPrismaClient: async () => makePrisma(),
      listBlobs: makeListBlobs([]),
      ensureDisplayDerivative,
      getPhotoBuffer: vi.fn(),
      ...validPreviewIdentity(),
      logger: baseLogger(),
    })
    expect(result.exitCode).toBe(1)
    expect(ensureDisplayDerivative).not.toHaveBeenCalled()
  })

  it('expected-visible mismatch aborts before ensure', async () => {
    const prisma = makePrisma({ total: 1, visibleCount: 1, hiddenCount: 0, rows })
    const ensureDisplayDerivative = vi.fn()
    const result = await main(
      ['--env=preview', '--apply', '--confirm-target=preview', '--expected-visible=999', '--expected-missing=1', '--expected-reconcile=0'],
      {
        getPrismaClient: async () => prisma,
        listBlobs: makeListBlobs([]),
        ensureDisplayDerivative,
        getPhotoBuffer: vi.fn(),
        ...validPreviewIdentity(),
        logger: baseLogger(),
      },
    )
    expect(result.exitCode).toBe(1)
    expect(ensureDisplayDerivative).not.toHaveBeenCalled()
  })

  it('expected-missing mismatch aborts before ensure', async () => {
    const prisma = makePrisma({ total: 1, visibleCount: 1, hiddenCount: 0, rows })
    const ensureDisplayDerivative = vi.fn()
    const result = await main(
      ['--env=preview', '--apply', '--confirm-target=preview', '--expected-visible=1', '--expected-missing=999', '--expected-reconcile=0'],
      {
        getPrismaClient: async () => prisma,
        listBlobs: makeListBlobs([]),
        ensureDisplayDerivative,
        getPhotoBuffer: vi.fn(),
        ...validPreviewIdentity(),
        logger: baseLogger(),
      },
    )
    expect(result.exitCode).toBe(1)
    expect(ensureDisplayDerivative).not.toHaveBeenCalled()
  })

  it('expected-reconcile mismatch aborts before ensure (Display Backfill Status Reconciliation safety rail)', async () => {
    const reconcileRows = [{ id: 'p1', status: 'VISIBLE', url: 'https://x/a.jpg', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'LEGACY_UNVERIFIED' }]
    const prisma = makePrisma({ total: 1, visibleCount: 1, hiddenCount: 0, rows: reconcileRows })
    const listBlobs = makeListBlobs([VISIBLE_PATH('p1')]) // blob present -> reconcile-only, not generation
    const ensureDisplayDerivative = vi.fn()
    const result = await main(
      ['--env=preview', '--apply', '--confirm-target=preview', '--expected-visible=1', '--expected-missing=0', '--expected-reconcile=999'],
      {
        getPrismaClient: async () => prisma,
        listBlobs,
        ensureDisplayDerivative,
        getPhotoBuffer: vi.fn(),
        ...validPreviewIdentity(),
        logger: baseLogger(),
      },
    )
    expect(result.exitCode).toBe(1)
    expect(ensureDisplayDerivative).not.toHaveBeenCalled()
    expect(prisma.photo.updateMany).not.toHaveBeenCalled()
  })

  it('source-url-unusable > 0 aborts apply before ensure', async () => {
    const badRows = [{ id: 'p1', status: 'VISIBLE', url: '', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'LEGACY_UNVERIFIED' }]
    const prisma = makePrisma({ total: 1, visibleCount: 1, hiddenCount: 0, rows: badRows })
    const ensureDisplayDerivative = vi.fn()
    const result = await main(
      ['--env=preview', '--apply', '--confirm-target=preview', '--expected-visible=1', '--expected-missing=1', '--expected-reconcile=0'],
      {
        getPrismaClient: async () => prisma,
        listBlobs: makeListBlobs([]),
        ensureDisplayDerivative,
        getPhotoBuffer: vi.fn(),
        ...validPreviewIdentity(),
        logger: baseLogger(),
      },
    )
    expect(result.exitCode).toBe(1)
    expect(ensureDisplayDerivative).not.toHaveBeenCalled()
  })

  it('HIDDEN_DISPLAY_PRESENT > 0 aborts apply before ensure/source fetch', async () => {
    const hiddenRows = [
      { id: 'p1', status: 'VISIBLE', url: 'https://x/a.jpg', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'LEGACY_UNVERIFIED' },
      { id: 'hidden-1', status: 'HIDDEN', url: 'https://x/b.jpg', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'LEGACY_UNVERIFIED' },
    ]
    const prisma = makePrisma({ total: 2, visibleCount: 1, hiddenCount: 1, rows: hiddenRows })
    const listBlobs = makeListBlobs([VISIBLE_PATH('hidden-1')])
    const ensureDisplayDerivative = vi.fn()
    const getPhotoBuffer = vi.fn()
    const result = await main(
      ['--env=preview', '--apply', '--confirm-target=preview', '--expected-visible=1', '--expected-missing=1', '--expected-reconcile=0'],
      {
        getPrismaClient: async () => prisma,
        listBlobs,
        ensureDisplayDerivative,
        getPhotoBuffer,
        ...validPreviewIdentity(),
        logger: baseLogger(),
      },
    )
    expect(result.exitCode).toBe(1)
    expect(ensureDisplayDerivative).not.toHaveBeenCalled()
    expect(getPhotoBuffer).not.toHaveBeenCalled()
  })

  it('extra-unmatched alone does not block an otherwise-valid apply', async () => {
    const rows2 = [{ id: 'p1', status: 'VISIBLE', url: 'https://x/a.jpg', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'LEGACY_UNVERIFIED' }]
    const prisma = makePrisma({
      total: 1,
      visibleCount: 1,
      hiddenCount: 0,
      rows: rows2,
      findUniqueImpl: async () => ({ status: 'VISIBLE', url: 'https://x/a.jpg' }),
    })
    const listBlobs = makeListBlobs(['derivatives/display-v1/orphan-no-photo.jpg'])
    const ensureDisplayDerivative = vi.fn().mockResolvedValue({ created: true })
    const result = await main(
      ['--env=preview', '--apply', '--confirm-target=preview', '--expected-visible=1', '--expected-missing=1', '--expected-reconcile=0'],
      {
        getPrismaClient: async () => prisma,
        listBlobs,
        ensureDisplayDerivative,
        getPhotoBuffer: vi.fn().mockResolvedValue(Buffer.from('x')),
        ...validPreviewIdentity(),
        logger: baseLogger(),
      },
    )
    expect(result.exitCode).toBe(0)
    expect(ensureDisplayDerivative).toHaveBeenCalledTimes(1)
  })

  it('Production apply works identically with Production identity/confirmation', async () => {
    const prodRows = [{ id: 'p1', status: 'VISIBLE', url: 'https://x/a.jpg', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'LEGACY_UNVERIFIED' }]
    const prisma = makePrisma({
      total: 1,
      visibleCount: 1,
      hiddenCount: 0,
      rows: prodRows,
      findUniqueImpl: async () => ({ status: 'VISIBLE', url: 'https://x/a.jpg' }),
    })
    const ensureDisplayDerivative = vi.fn().mockResolvedValue({ created: true })
    const result = await main(
      ['--env=production', '--apply', '--confirm-target=production', '--expected-visible=1', '--expected-missing=1', '--expected-reconcile=0'],
      {
        getPrismaClient: async () => prisma,
        listBlobs: makeListBlobs([]),
        ensureDisplayDerivative,
        getPhotoBuffer: vi.fn().mockResolvedValue(Buffer.from('x')),
        databaseUrl: PRODUCTION_DB_URL,
        blobReadWriteToken: PRODUCTION_BLOB_TOKEN,
        queryLiveDatabaseIdentity: vi.fn().mockResolvedValue({ databaseName: 'neondb', databaseRole: 'test_runtime_role' }),
        envConfig: TEST_ENV_CONFIG,
        logger: baseLogger(),
      },
    )
    expect(result.exitCode).toBe(0)
    expect(result.applyResult.created).toBe(1)
  })
})

describe('main — apply: per-item status revalidation', () => {
  it('row now HIDDEN -> skip, no ensure, no source fetch, no status write', async () => {
    const rows = [{ id: 'p1', status: 'VISIBLE', url: 'https://x/a.jpg', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'LEGACY_UNVERIFIED' }]
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
      ['--env=preview', '--apply', '--confirm-target=preview', '--expected-visible=1', '--expected-missing=1', '--expected-reconcile=0'],
      {
        getPrismaClient: async () => prisma,
        listBlobs: makeListBlobs([]),
        ensureDisplayDerivative,
        getPhotoBuffer,
        ...validPreviewIdentity(),
        logger: baseLogger(),
      },
    )
    expect(result.exitCode).toBe(0)
    expect(result.applyResult.skippedStatusChanged).toBe(1)
    expect(ensureDisplayDerivative).not.toHaveBeenCalled()
    expect(getPhotoBuffer).not.toHaveBeenCalled()
    expect(prisma.photo.updateMany).not.toHaveBeenCalled()
  })

  it('row now absent -> skip, no ensure', async () => {
    const rows = [{ id: 'p1', status: 'VISIBLE', url: 'https://x/a.jpg', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'LEGACY_UNVERIFIED' }]
    const prisma = makePrisma({ total: 1, visibleCount: 1, hiddenCount: 0, rows, findUniqueImpl: async () => null })
    const ensureDisplayDerivative = vi.fn()
    const result = await main(
      ['--env=preview', '--apply', '--confirm-target=preview', '--expected-visible=1', '--expected-missing=1', '--expected-reconcile=0'],
      {
        getPrismaClient: async () => prisma,
        listBlobs: makeListBlobs([]),
        ensureDisplayDerivative,
        getPhotoBuffer: vi.fn(),
        ...validPreviewIdentity(),
        logger: baseLogger(),
      },
    )
    expect(result.applyResult.skippedStatusChanged).toBe(1)
    expect(ensureDisplayDerivative).not.toHaveBeenCalled()
  })
})

describe('main — apply: ensure integration, race, create, failure, and status writes', () => {
  function setupSingleTarget({ findUniqueImpl, ensureImpl, displayDerivativeStatus = 'LEGACY_UNVERIFIED', updateManyImpl }) {
    const rows = [{ id: 'p1', status: 'VISIBLE', url: 'https://x/a.jpg', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus }]
    const prisma = makePrisma({ total: 1, visibleCount: 1, hiddenCount: 0, rows, findUniqueImpl, updateManyImpl })
    return { prisma, ensureDisplayDerivative: vi.fn(ensureImpl) }
  }

  it('existing derivative + LEGACY_UNVERIFIED (reconcile-only): ensure returns created:false -> alreadyPresent, and READY is recorded', async () => {
    const { prisma, ensureDisplayDerivative } = setupSingleTarget({
      findUniqueImpl: async () => ({ status: 'VISIBLE', url: 'https://x/a.jpg' }),
      ensureImpl: async () => ({ created: false }),
    })
    const result = await main(
      ['--env=preview', '--apply', '--confirm-target=preview', '--expected-visible=1', '--expected-missing=0', '--expected-reconcile=1'],
      {
        getPrismaClient: async () => prisma,
        listBlobs: makeListBlobs([VISIBLE_PATH('p1')]),
        ensureDisplayDerivative,
        getPhotoBuffer: vi.fn().mockResolvedValue(Buffer.from('x')),
        ...validPreviewIdentity(),
        logger: baseLogger(),
      },
    )
    expect(result.applyResult.alreadyPresent).toBe(1)
    expect(result.applyResult.failed).toBe(0)
    expect(result.exitCode).toBe(0)
    expect(prisma.photo.updateMany).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { displayDerivativeStatus: 'READY' } })
  })

  it('true miss (generation): ensure returns created:true -> created count, and READY is recorded', async () => {
    const { prisma, ensureDisplayDerivative } = setupSingleTarget({
      findUniqueImpl: async () => ({ status: 'VISIBLE', url: 'https://x/a.jpg' }),
      ensureImpl: async () => ({ created: true }),
    })
    const result = await main(
      ['--env=preview', '--apply', '--confirm-target=preview', '--expected-visible=1', '--expected-missing=1', '--expected-reconcile=0'],
      {
        getPrismaClient: async () => prisma,
        listBlobs: makeListBlobs([]),
        ensureDisplayDerivative,
        getPhotoBuffer: vi.fn().mockResolvedValue(Buffer.from('x')),
        ...validPreviewIdentity(),
        logger: baseLogger(),
      },
    )
    expect(result.applyResult.created).toBe(1)
    expect(result.applyResult.failed).toBe(0)
    expect(prisma.photo.updateMany).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { displayDerivativeStatus: 'READY' } })
  })

  it('generation failure -> FAILED is recorded, not READY, and the run reports it as failed', async () => {
    const { prisma, ensureDisplayDerivative } = setupSingleTarget({
      findUniqueImpl: async () => ({ status: 'VISIBLE', url: 'https://x/a.jpg' }),
      ensureImpl: async () => {
        throw new Error('transform failed')
      },
    })
    const result = await main(
      ['--env=preview', '--apply', '--confirm-target=preview', '--expected-visible=1', '--expected-missing=1', '--expected-reconcile=0'],
      {
        getPrismaClient: async () => prisma,
        listBlobs: makeListBlobs([]),
        ensureDisplayDerivative,
        getPhotoBuffer: vi.fn().mockResolvedValue(Buffer.from('x')),
        ...validPreviewIdentity(),
        logger: baseLogger(),
      },
    )
    expect(result.applyResult.created).toBe(0)
    expect(result.applyResult.alreadyPresent).toBe(0)
    expect(result.applyResult.failed).toBe(1)
    expect(result.exitCode).toBe(1)
    expect(prisma.photo.updateMany).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { displayDerivativeStatus: 'FAILED' } })
  })

  it('FAILED retry success -> READY is recorded (idempotent recovery from a prior failure)', async () => {
    const { prisma, ensureDisplayDerivative } = setupSingleTarget({
      displayDerivativeStatus: 'FAILED',
      findUniqueImpl: async () => ({ status: 'VISIBLE', url: 'https://x/a.jpg' }),
      ensureImpl: async () => ({ created: true }),
    })
    const result = await main(
      ['--env=preview', '--apply', '--confirm-target=preview', '--expected-visible=1', '--expected-missing=1', '--expected-reconcile=0'],
      {
        getPrismaClient: async () => prisma,
        listBlobs: makeListBlobs([]),
        ensureDisplayDerivative,
        getPhotoBuffer: vi.fn().mockResolvedValue(Buffer.from('x')),
        ...validPreviewIdentity(),
        logger: baseLogger(),
      },
    )
    expect(result.applyResult.created).toBe(1)
    expect(result.applyResult.failed).toBe(0)
    expect(prisma.photo.updateMany).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { displayDerivativeStatus: 'READY' } })
  })

  it('a reconcile-only target with an unusable url is NOT failed — the head-first probe never needs the source', async () => {
    const { prisma, ensureDisplayDerivative } = setupSingleTarget({
      findUniqueImpl: async () => ({ status: 'VISIBLE', url: '' }), // stale/irrelevant url, blob already present
      ensureImpl: async ({ getSourceBuffer }) => {
        void getSourceBuffer
        return { created: false }
      },
    })
    const result = await main(
      ['--env=preview', '--apply', '--confirm-target=preview', '--expected-visible=1', '--expected-missing=0', '--expected-reconcile=1'],
      {
        getPrismaClient: async () => prisma,
        listBlobs: makeListBlobs([VISIBLE_PATH('p1')]),
        ensureDisplayDerivative,
        getPhotoBuffer: vi.fn(),
        ...validPreviewIdentity(),
        logger: baseLogger(),
      },
    )
    expect(result.applyResult.failed).toBe(0)
    expect(result.applyResult.alreadyPresent).toBe(1)
    expect(prisma.photo.updateMany).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { displayDerivativeStatus: 'READY' } })
  })

  it('uses the FRESH revalidated url, not the stale initial one, in getSourceBuffer', async () => {
    const rows = [{ id: 'p1', status: 'VISIBLE', url: 'https://stale.example/a.jpg', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'LEGACY_UNVERIFIED' }]
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
    await main(['--env=preview', '--apply', '--confirm-target=preview', '--expected-visible=1', '--expected-missing=1', '--expected-reconcile=0'], {
      getPrismaClient: async () => prisma,
      listBlobs: makeListBlobs([]),
      ensureDisplayDerivative,
      getPhotoBuffer,
      ...validPreviewIdentity(),
      logger: baseLogger(),
    })
    expect(getPhotoBuffer).toHaveBeenCalledWith('https://fresh.example/a.jpg')
  })
})

describe('main — apply: rerun idempotency end-to-end', () => {
  it('a second full run over rows already reconciled to READY computes zero targets and performs zero further calls', async () => {
    const firstRunRows = [{ id: 'p1', status: 'VISIBLE', url: 'https://x/a.jpg', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'LEGACY_UNVERIFIED' }]
    const firstPrisma = makePrisma({
      total: 1,
      visibleCount: 1,
      hiddenCount: 0,
      rows: firstRunRows,
      findUniqueImpl: async () => ({ status: 'VISIBLE', url: 'https://x/a.jpg' }),
    })
    const ensureDisplayDerivative = vi.fn().mockResolvedValue({ created: false })
    await main(['--env=preview', '--apply', '--confirm-target=preview', '--expected-visible=1', '--expected-missing=0', '--expected-reconcile=1'], {
      getPrismaClient: async () => firstPrisma,
      listBlobs: makeListBlobs([VISIBLE_PATH('p1')]),
      ensureDisplayDerivative,
      getPhotoBuffer: vi.fn(),
      ...validPreviewIdentity(),
      logger: baseLogger(),
    })
    expect(firstPrisma.photo.updateMany).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { displayDerivativeStatus: 'READY' } })

    const secondRunRows = [{ id: 'p1', status: 'VISIBLE', url: 'https://x/a.jpg', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'READY' }]
    const secondPrisma = makePrisma({ total: 1, visibleCount: 1, hiddenCount: 0, rows: secondRunRows })
    const secondEnsure = vi.fn()
    const secondResult = await main(
      ['--env=preview', '--apply', '--confirm-target=preview', '--expected-visible=1', '--expected-missing=0', '--expected-reconcile=0'],
      {
        getPrismaClient: async () => secondPrisma,
        listBlobs: makeListBlobs([VISIBLE_PATH('p1')]),
        ensureDisplayDerivative: secondEnsure,
        getPhotoBuffer: vi.fn(),
        ...validPreviewIdentity(),
        logger: baseLogger(),
      },
    )
    expect(secondResult.exitCode).toBe(0)
    expect(secondEnsure).not.toHaveBeenCalled()
    expect(secondPrisma.photo.updateMany).not.toHaveBeenCalled()
    expect(secondPrisma.photo.findUnique).not.toHaveBeenCalled()
  })
})

describe('main — bounded writes: only displayDerivativeStatus is ever touched, one row at a time', () => {
  it('every updateMany call across a mixed generation+reconcile apply run has exactly {where:{id}, data:{displayDerivativeStatus}} — no other field, no multi-id where clause', async () => {
    const rows = [
      { id: 'gen-target', status: 'VISIBLE', url: 'https://x/a.jpg', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'LEGACY_UNVERIFIED' },
      { id: 'reconcile-target', status: 'VISIBLE', url: 'https://x/b.jpg', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'FAILED' },
    ]
    const prisma = makePrisma({
      total: 2,
      visibleCount: 2,
      hiddenCount: 0,
      rows,
      findUniqueImpl: async ({ where }) => ({
        status: 'VISIBLE',
        url: where.id === 'gen-target' ? 'https://x/a.jpg' : 'https://x/b.jpg',
      }),
    })
    const listBlobs = makeListBlobs([VISIBLE_PATH('reconcile-target')])
    const ensureDisplayDerivative = vi.fn().mockResolvedValue({ created: true })

    await main(['--env=preview', '--apply', '--confirm-target=preview', '--expected-visible=2', '--expected-missing=1', '--expected-reconcile=1'], {
      getPrismaClient: async () => prisma,
      listBlobs,
      ensureDisplayDerivative,
      getPhotoBuffer: vi.fn().mockResolvedValue(Buffer.from('x')),
      ...validPreviewIdentity(),
      logger: baseLogger(),
    })

    expect(prisma.photo.updateMany).toHaveBeenCalledTimes(2)
    for (const call of prisma.photo.updateMany.mock.calls) {
      const [arg] = call
      expect(Object.keys(arg)).toEqual(['where', 'data'])
      expect(Object.keys(arg.where)).toEqual(['id'])
      expect(Object.keys(arg.data)).toEqual(['displayDerivativeStatus'])
      expect(['READY', 'FAILED']).toContain(arg.data.displayDerivativeStatus)
    }
  })
})

describe('main — failure continuation and exit code', () => {
  it('one ensure rejects, siblings continue, failures > 0 -> non-zero exit, no id/url in output', async () => {
    const rows = [
      { id: 'photo-ok', status: 'VISIBLE', url: 'https://x/ok.jpg', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'LEGACY_UNVERIFIED' },
      { id: 'photo-bad', status: 'VISIBLE', url: 'https://x/bad.jpg', size: 10, mimeType: 'image/jpeg', displayDerivativeStatus: 'LEGACY_UNVERIFIED' },
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
    const logger = baseLogger()

    const result = await main(
      ['--env=preview', '--apply', '--confirm-target=preview', '--expected-visible=2', '--expected-missing=2', '--expected-reconcile=0'],
      {
        getPrismaClient: async () => prisma,
        listBlobs: makeListBlobs([]),
        ensureDisplayDerivative,
        getPhotoBuffer: vi.fn().mockResolvedValue(Buffer.from('x')),
        ...validPreviewIdentity(),
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
      displayDerivativeStatus: 'LEGACY_UNVERIFIED',
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

    await main(['--env=preview', '--apply', '--confirm-target=preview', '--expected-visible=10', '--expected-missing=10', '--expected-reconcile=0'], {
      getPrismaClient: async () => prisma,
      listBlobs: makeListBlobs([]),
      ensureDisplayDerivative,
      getPhotoBuffer: vi.fn().mockResolvedValue(Buffer.from('x')),
      ...validPreviewIdentity(),
      logger: baseLogger(),
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

describe('structural safety: no delete, no direct DB write, no hardcoded credential', () => {
  const source = readFileSync(join(process.cwd(), 'lib/server/display-backfill.js'), 'utf8')

  it('never imports or calls Blob del', () => {
    expect(source).not.toMatch(/\bdel\b/)
  })

  it("never calls a Prisma write method directly in this module's own source — the one authorized field write (displayDerivativeStatus) is delegated to the shared, separately-tested photo-display-derivative-status.js helper (Display Backfill Status Reconciliation)", () => {
    for (const method of ['.create(', '.update(', '.delete(', '.upsert(', '.updateMany(', '.deleteMany(', '.createMany(', '$executeRaw', '$queryRawUnsafe']) {
      expect(source).not.toContain(method)
    }
  })

  it('delegates status writes by importing ensurePhotoDisplayDerivativeStatus from photo-display-derivative-status.js', () => {
    expect(source).toMatch(/import\s*\{\s*ensurePhotoDisplayDerivativeStatus\s*\}\s*from\s*'@\/lib\/server\/photo-display-derivative-status'/)
  })

  it('delegates target-identity proof by importing checkTargetIdentity/ENV_CONFIG from backfill-target-identity.js — never reimplements the parse itself', () => {
    expect(source).toMatch(/import\s*\{\s*checkTargetIdentity,\s*ENV_CONFIG\s*\}\s*from\s*'@\/lib\/server\/backfill-target-identity'/)
    expect(source).not.toMatch(/vercel_blob_rw_[a-zA-Z0-9]/)
  })

  it('CLI accepts no delete/cleanup/prune flags', async () => {
    for (const flag of ['--delete', '--cleanup', '--prune', '--force-delete']) {
      expect(parseArgs(['--env=preview', flag])).toHaveProperty('error')
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
    expect(typeof deps.queryLiveDatabaseIdentity).toBe('function')
    expect(deps.envConfig).toBeDefined()
  })
})
