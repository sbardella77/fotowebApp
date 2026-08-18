import { list } from '@vercel/blob'
import { ensureDisplayDerivative, buildDisplayDerivativePath } from '@/lib/server/display-derivative'
import { getPhotoBuffer } from '@/lib/server/download-utils'
import { getPrismaClient } from '@/lib/server/prisma-client'

/**
 * Display-v1 backfill operator core (STEP 7.15f.1-c).
 *
 * Fills in the canonical `derivatives/display-v1/<photoId>.jpg` object for
 * every currently-VISIBLE Photo that is missing one, reusing the exact same
 * `ensureDisplayDerivative` orchestration that live eager generation already
 * uses — no transform, path, lock, or put-race logic is duplicated here.
 *
 * This module is intentionally side-effect-free on import and knows nothing
 * about Vite/CLI plumbing: `main(argv, dependencies)` is a pure function of
 * its injected dependencies, so it can be exercised in tests with fully
 * synthetic fixtures and zero Production credentials. `createRealDependencies()`
 * is the only place that wires it to the real production primitives; the
 * native `.cjs` bootstrap calls that, never this module's internals directly.
 */

export const BACKFILL_APPLY_CONCURRENCY = 3
const BLOB_LIST_PAGE_SIZE = 100

// Derives the display-v1 prefix from the real production path builder
// (mirrors the probe-id technique already used in derivative-cleanup.js)
// instead of duplicating version/pathname identity here.
const PROBE_PHOTO_ID = '00000000-0000-4000-8000-000000000000'
const DISPLAY_V1_PATH_PREFIX = (() => {
  const sample = buildDisplayDerivativePath(PROBE_PHOTO_ID)
  return sample.slice(0, sample.lastIndexOf('/') + 1)
})()

const KNOWN_FLAGS = new Set(['--apply', '--confirm-production', '--expected-visible', '--expected-missing'])
const INTEGER_FLAG_PATTERN = /^(--expected-visible|--expected-missing)=(.*)$/

/**
 * Parses CLI arguments. Fails closed on anything unrecognized: unknown
 * flags, and non-integer/negative expected counters are all rejected before
 * any dependency is touched.
 */
export function parseArgs(argv) {
  let apply = false
  let confirmProduction = false
  let expectedVisible = null
  let expectedMissing = null

  for (const arg of argv) {
    if (arg === '--apply') {
      apply = true
      continue
    }
    if (arg === '--confirm-production') {
      confirmProduction = true
      continue
    }

    const match = INTEGER_FLAG_PATTERN.exec(arg)
    if (match) {
      const [, name, rawValue] = match
      if (!/^\d+$/.test(rawValue)) {
        return { error: `Invalid value for ${name}: must be a non-negative integer` }
      }
      const value = Number(rawValue)
      if (name === '--expected-visible') expectedVisible = value
      else expectedMissing = value
      continue
    }

    const bareFlagName = arg.split('=')[0]
    if (!KNOWN_FLAGS.has(bareFlagName)) {
      return { error: `Unknown argument: ${arg}` }
    }
    return { error: `Malformed argument: ${arg}` }
  }

  if (apply) {
    if (!confirmProduction) return { error: '--apply requires --confirm-production' }
    if (expectedVisible === null) return { error: '--apply requires --expected-visible=<N>' }
    if (expectedMissing === null) return { error: '--apply requires --expected-missing=<N>' }
  }

  return { apply, confirmProduction, expectedVisible, expectedMissing }
}

/**
 * Fresh, read-only DB + Blob inventory. Never mutates anything. Computes the
 * exact backfill target set: VISIBLE Photos whose canonical display-v1
 * object is absent. HIDDEN rows are read only to compute
 * `hiddenDisplayPresent` (an apply gate) and are never targeted.
 */
export async function computeInventory({ prisma, listBlobs }) {
  const [totalCount, visibleAgg, hiddenCount, rows] = await Promise.all([
    prisma.photo.count(),
    prisma.photo.aggregate({
      where: { status: 'VISIBLE' },
      _count: { _all: true },
    }),
    prisma.photo.count({ where: { status: 'HIDDEN' } }),
    prisma.photo.findMany({
      where: { status: { in: ['VISIBLE', 'HIDDEN'] } },
      select: { id: true, status: true, url: true, size: true, mimeType: true },
    }),
  ])

  const blobPathnames = new Set()
  let cursor
  do {
    const page = await listBlobs({ prefix: DISPLAY_V1_PATH_PREFIX, limit: BLOB_LIST_PAGE_SIZE, cursor })
    for (const blob of page.blobs) blobPathnames.add(blob.pathname)
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)

  const visibleRows = rows.filter((row) => row.status === 'VISIBLE')
  const hiddenRows = rows.filter((row) => row.status === 'HIDDEN')

  const targets = []
  let visibleDisplayPresent = 0
  let sourceUrlUnusableCount = 0
  let targetTotalSize = 0
  let targetMaxSize = 0
  const targetMimeCounts = {}

  for (const row of visibleRows) {
    const path = buildDisplayDerivativePath(row.id)
    if (blobPathnames.has(path)) {
      visibleDisplayPresent += 1
      continue
    }

    const urlUsable = typeof row.url === 'string' && row.url.length > 0
    if (!urlUsable) sourceUrlUnusableCount += 1

    targets.push(row)
    targetMimeCounts[row.mimeType] = (targetMimeCounts[row.mimeType] || 0) + 1
    if (typeof row.size === 'number') {
      targetTotalSize += row.size
      if (row.size > targetMaxSize) targetMaxSize = row.size
    }
  }

  let hiddenDisplayPresent = 0
  for (const row of hiddenRows) {
    if (blobPathnames.has(buildDisplayDerivativePath(row.id))) hiddenDisplayPresent += 1
  }

  const knownPaths = new Set(rows.map((row) => buildDisplayDerivativePath(row.id)))
  let displayV1ExtraUnmatched = 0
  for (const pathname of blobPathnames) {
    if (!knownPaths.has(pathname)) displayV1ExtraUnmatched += 1
  }

  return {
    currentTotalPhotos: totalCount,
    currentVisiblePhotos: visibleAgg._count._all,
    currentHiddenPhotos: hiddenCount,
    displayV1ObjectsTotal: blobPathnames.size,
    visibleDisplayPresent,
    visibleDisplayMissing: targets.length,
    hiddenDisplayPresent,
    displayV1ExtraUnmatched,
    sourceUrlUnusableCount,
    targets,
    targetAggregates: {
      count: targets.length,
      totalSize: targetTotalSize,
      avgSize: targets.length ? Math.round(targetTotalSize / targets.length) : 0,
      maxSize: targetMaxSize,
      mimeCounts: targetMimeCounts,
    },
  }
}

function toPlanSummary(inventory, mode) {
  return {
    mode,
    concurrency: BACKFILL_APPLY_CONCURRENCY,
    CURRENT_TOTAL_PHOTOS: inventory.currentTotalPhotos,
    CURRENT_VISIBLE_PHOTOS: inventory.currentVisiblePhotos,
    CURRENT_HIDDEN_PHOTOS: inventory.currentHiddenPhotos,
    DISPLAY_V1_OBJECTS_TOTAL: inventory.displayV1ObjectsTotal,
    VISIBLE_DISPLAY_PRESENT: inventory.visibleDisplayPresent,
    VISIBLE_DISPLAY_MISSING: inventory.visibleDisplayMissing,
    HIDDEN_DISPLAY_PRESENT: inventory.hiddenDisplayPresent,
    DISPLAY_V1_EXTRA_UNMATCHED: inventory.displayV1ExtraUnmatched,
    TARGET_COUNT: inventory.targetAggregates.count,
    TARGET_TOTAL_SIZE: inventory.targetAggregates.totalSize,
    TARGET_AVG_SIZE: inventory.targetAggregates.avgSize,
    TARGET_MAX_SIZE: inventory.targetAggregates.maxSize,
    TARGET_MIME_COUNTS: inventory.targetAggregates.mimeCounts,
    SOURCE_URL_UNUSABLE_COUNT: inventory.sourceUrlUnusableCount,
  }
}

/**
 * Applies ensure() to every target with bounded concurrency, revalidating
 * each Photo's status immediately before ensuring it (race-reduction, not
 * race-elimination — see STEP 7.15f.1-c report). Never mutates the DB, never
 * deletes anything. A single item's failure never stops the others.
 */
async function applyTargets(targets, { prisma, ensureDisplayDerivative: ensure, getPhotoBuffer: readSource, concurrency }) {
  let created = 0
  let alreadyPresent = 0
  let skippedStatusChanged = 0
  let failed = 0

  let cursor = 0
  async function worker() {
    for (;;) {
      const currentIndex = cursor
      cursor += 1
      if (currentIndex >= targets.length) return
      const target = targets[currentIndex]

      let freshRow
      try {
        freshRow = await prisma.photo.findUnique({
          where: { id: target.id },
          select: { status: true, url: true },
        })
      } catch {
        failed += 1
        continue
      }

      if (!freshRow || freshRow.status !== 'VISIBLE') {
        skippedStatusChanged += 1
        continue
      }

      const currentUrl = freshRow.url
      if (typeof currentUrl !== 'string' || currentUrl.length === 0) {
        failed += 1
        continue
      }

      try {
        const result = await ensure({
          photoId: target.id,
          getSourceBuffer: () => readSource(currentUrl),
        })
        if (result && result.created) created += 1
        else alreadyPresent += 1
      } catch {
        failed += 1
      }
    }
  }

  const workerCount = Math.max(0, Math.min(concurrency, targets.length))
  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  return { created, alreadyPresent, skippedStatusChanged, failed }
}

/**
 * Entry point. Pure function of (argv, dependencies) — never reads
 * process.env, never imports Vite, never knows it's running inside a
 * ModuleRunner. Default (no --apply) is always read-only.
 */
export async function main(argv, dependencies) {
  const { getPrismaClient: getPrisma, listBlobs, ensureDisplayDerivative: ensure, getPhotoBuffer: readSource, logger = console } = dependencies

  const parsed = parseArgs(argv)
  if (parsed.error) {
    logger.error(`[backfill] ${parsed.error}`)
    return { exitCode: 1 }
  }

  const prisma = await getPrisma()
  if (!prisma) {
    logger.error('[backfill] Database unavailable')
    return { exitCode: 1 }
  }

  const inventory = await computeInventory({ prisma, listBlobs })
  logger.log(JSON.stringify(toPlanSummary(inventory, parsed.apply ? 'apply' : 'dry-run'), null, 2))

  if (inventory.displayV1ExtraUnmatched > 0) {
    logger.warn(
      `[backfill] WARNING: DISPLAY_V1_EXTRA_UNMATCHED=${inventory.displayV1ExtraUnmatched} — objects with no corresponding current Photo row. Not deleted; see derivative reconciliation.`,
    )
  }

  if (!parsed.apply) {
    return { exitCode: 0, mode: 'dry-run', inventory }
  }

  if (inventory.sourceUrlUnusableCount > 0) {
    logger.error(`[backfill] ABORT: SOURCE_URL_UNUSABLE_COUNT=${inventory.sourceUrlUnusableCount} — refusing to apply`)
    return { exitCode: 1, mode: 'apply', inventory }
  }

  if (inventory.hiddenDisplayPresent > 0) {
    logger.error(`[backfill] ABORT: HIDDEN_DISPLAY_PRESENT=${inventory.hiddenDisplayPresent} — unresolved lifecycle anomaly, refusing to apply`)
    return { exitCode: 1, mode: 'apply', inventory }
  }

  if (inventory.currentVisiblePhotos !== parsed.expectedVisible) {
    logger.error(
      `[backfill] ABORT: --expected-visible mismatch (expected ${parsed.expectedVisible}, actual ${inventory.currentVisiblePhotos})`,
    )
    return { exitCode: 1, mode: 'apply', inventory }
  }

  if (inventory.visibleDisplayMissing !== parsed.expectedMissing) {
    logger.error(
      `[backfill] ABORT: --expected-missing mismatch (expected ${parsed.expectedMissing}, actual ${inventory.visibleDisplayMissing})`,
    )
    return { exitCode: 1, mode: 'apply', inventory }
  }

  const applyResult = await applyTargets(inventory.targets, {
    prisma,
    ensureDisplayDerivative: ensure,
    getPhotoBuffer: readSource,
    concurrency: BACKFILL_APPLY_CONCURRENCY,
  })

  logger.log(
    JSON.stringify(
      {
        mode: 'apply-result',
        created: applyResult.created,
        alreadyPresent: applyResult.alreadyPresent,
        skippedStatusChanged: applyResult.skippedStatusChanged,
        failed: applyResult.failed,
      },
      null,
      2,
    ),
  )

  return { exitCode: applyResult.failed > 0 ? 1 : 0, mode: 'apply', inventory, applyResult }
}

/** The only place real production primitives are wired together. */
export function createRealDependencies() {
  return {
    getPrismaClient,
    listBlobs: list,
    ensureDisplayDerivative,
    getPhotoBuffer,
    logger: console,
  }
}
