import { list } from '@vercel/blob'
import { ensureDisplayDerivative, buildDisplayDerivativePath } from '@/lib/server/display-derivative'
import { getPhotoBuffer } from '@/lib/server/download-utils'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { ensurePhotoDisplayDerivativeStatus } from '@/lib/server/photo-display-derivative-status'

/**
 * Display-v1 backfill operator core (STEP 7.15f.1-c; extended by
 * Display Backfill Status Reconciliation to keep Photo.displayDerivativeStatus
 * consistent with actual derivative existence).
 *
 * Fills in the canonical `derivatives/display-v1/<photoId>.jpg` object for
 * every currently-VISIBLE Photo that is missing one, reusing the exact same
 * `ensureDisplayDerivative` orchestration that live eager generation already
 * uses — no transform, path, lock, or put-race logic is duplicated here.
 *
 * A prior version of this module only ever created missing Blob objects and
 * never touched Photo.displayDerivativeStatus at all, which meant a
 * successful run could leave a photo's status at LEGACY_UNVERIFIED forever —
 * a false negative for lib/server/guest-photo-url.js's resolver, which only
 * ever treats READY as safe to serve. This module now ALSO reconciles status
 * for two target categories (see computeInventory): rows whose derivative is
 * missing (generation + status write) and rows whose derivative already
 * exists but whose status has not caught up (status write only, no
 * generation). Both categories are written through the exact same shared,
 * already-tested helper — lib/server/photo-display-derivative-status.js's
 * ensurePhotoDisplayDerivativeStatus — so the READY/FAILED write logic is
 * never duplicated here. This module's OWN source still contains no direct
 * Prisma write call (see the structural test in
 * tests/display-backfill.test.js); the one field it is now authorized to
 * mutate (displayDerivativeStatus, one row at a time) is always written by
 * that shared, separately-tested helper, never inline here.
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

const KNOWN_FLAGS = new Set(['--apply', '--confirm-production', '--expected-visible', '--expected-missing', '--expected-reconcile'])
const INTEGER_FLAG_PATTERN = /^(--expected-visible|--expected-missing|--expected-reconcile)=(.*)$/

/**
 * Parses CLI arguments. Fails closed on anything unrecognized: unknown
 * flags, and non-integer/negative expected counters are all rejected before
 * any dependency is touched.
 *
 * --expected-reconcile (Display Backfill Status Reconciliation) is a
 * separate required counter from --expected-missing: --expected-missing
 * still means exactly what it always meant (VISIBLE, non-PENDING rows whose
 * derivative Blob object is absent — generation required); --expected-reconcile
 * is the new category of rows whose derivative already exists but whose
 * displayDerivativeStatus has not caught up (status write only, no
 * generation). Both are now mutation-affecting categories, so both require an
 * explicit operator-declared expected count before --apply proceeds — the
 * same fail-closed rationale that already applied to --expected-missing.
 */
export function parseArgs(argv) {
  let apply = false
  let confirmProduction = false
  let expectedVisible = null
  let expectedMissing = null
  let expectedReconcile = null

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
      else if (name === '--expected-missing') expectedMissing = value
      else expectedReconcile = value
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
    if (expectedReconcile === null) return { error: '--apply requires --expected-reconcile=<N>' }
  }

  return { apply, confirmProduction, expectedVisible, expectedMissing, expectedReconcile }
}

/**
 * Fresh, read-only DB + Blob inventory. Never mutates anything.
 *
 * Computes TWO target categories among VISIBLE, non-PENDING Photos (HIDDEN
 * rows are read only to compute `hiddenDisplayPresent`, an apply gate, and
 * are never targeted; PENDING rows are a live in-flight upload/moderation
 * state — touching them here could race the eager write path for no benefit,
 * so they are always left alone and reported separately as
 * `visiblePendingSkipped`):
 *
 *  - generation targets: derivative Blob object is absent. Needs
 *    ensureDisplayDerivative to actually produce it, then a status write.
 *    This includes the rare anomaly of a row already marked READY whose
 *    Blob object is missing (surfaced separately as `readyButBlobMissing`
 *    for visibility) — attempting generation is the correct remediation
 *    either way: it makes the existing READY claim true, or (on failure)
 *    correctly downgrades it to FAILED.
 *  - reconcile-only targets: derivative Blob object already exists, but
 *    status is LEGACY_UNVERIFIED or FAILED. No generation is needed —
 *    ensureDisplayDerivative's own head-first probe (see
 *    lib/server/download-derivative.js) confirms existence with a single
 *    Blob `head` call and never touches getSourceBuffer, so these targets
 *    are processed through the exact same call as generation targets at
 *    negligible cost, and READY is still only ever written on the strength
 *    of a fresh existence check, never inferred from the Blob-listing
 *    snapshot alone.
 *
 * Each returned target row carries `needsGeneration` so callers (and
 * per-item TOCTOU checks in applyTargets) can tell the two apart without
 * re-deriving Blob presence.
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
      select: { id: true, status: true, url: true, size: true, mimeType: true, displayDerivativeStatus: true },
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
  let visiblePendingSkipped = 0
  let readyButBlobMissing = 0
  let sourceUrlUnusableCount = 0
  let reconcileOnlyCount = 0
  let targetTotalSize = 0
  let targetMaxSize = 0
  const targetMimeCounts = {}

  for (const row of visibleRows) {
    const path = buildDisplayDerivativePath(row.id)
    const blobPresent = blobPathnames.has(path)
    if (blobPresent) visibleDisplayPresent += 1

    if (row.displayDerivativeStatus === 'PENDING') {
      visiblePendingSkipped += 1
      continue
    }

    if (row.displayDerivativeStatus === 'READY' && blobPresent) {
      continue // steady state — nothing to do
    }

    if (row.displayDerivativeStatus === 'READY' && !blobPresent) {
      readyButBlobMissing += 1
    }

    const needsGeneration = !blobPresent
    if (needsGeneration) {
      const urlUsable = typeof row.url === 'string' && row.url.length > 0
      if (!urlUsable) sourceUrlUnusableCount += 1
      targetMimeCounts[row.mimeType] = (targetMimeCounts[row.mimeType] || 0) + 1
      if (typeof row.size === 'number') {
        targetTotalSize += row.size
        if (row.size > targetMaxSize) targetMaxSize = row.size
      }
    } else {
      reconcileOnlyCount += 1
    }

    targets.push({ ...row, needsGeneration })
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

  const generationTargetCount = targets.length - reconcileOnlyCount

  return {
    currentTotalPhotos: totalCount,
    currentVisiblePhotos: visibleAgg._count._all,
    currentHiddenPhotos: hiddenCount,
    displayV1ObjectsTotal: blobPathnames.size,
    visibleDisplayPresent,
    visibleDisplayMissing: generationTargetCount,
    visiblePendingSkipped,
    readyButBlobMissing,
    hiddenDisplayPresent,
    displayV1ExtraUnmatched,
    sourceUrlUnusableCount,
    reconcileOnlyCount,
    targets,
    targetAggregates: {
      count: generationTargetCount,
      totalSize: targetTotalSize,
      avgSize: generationTargetCount ? Math.round(targetTotalSize / generationTargetCount) : 0,
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
    VISIBLE_PENDING_SKIPPED: inventory.visiblePendingSkipped,
    READY_BUT_BLOB_MISSING_COUNT: inventory.readyButBlobMissing,
    HIDDEN_DISPLAY_PRESENT: inventory.hiddenDisplayPresent,
    DISPLAY_V1_EXTRA_UNMATCHED: inventory.displayV1ExtraUnmatched,
    TARGET_COUNT: inventory.targetAggregates.count,
    TARGET_TOTAL_SIZE: inventory.targetAggregates.totalSize,
    TARGET_AVG_SIZE: inventory.targetAggregates.avgSize,
    TARGET_MAX_SIZE: inventory.targetAggregates.maxSize,
    TARGET_MIME_COUNTS: inventory.targetAggregates.mimeCounts,
    SOURCE_URL_UNUSABLE_COUNT: inventory.sourceUrlUnusableCount,
    RECONCILE_TARGET_COUNT: inventory.reconcileOnlyCount,
  }
}

/**
 * Applies the shared ensurePhotoDisplayDerivativeStatus helper to every
 * target with bounded concurrency, revalidating each Photo's status
 * immediately before processing it (race-reduction, not race-elimination —
 * see STEP 7.15f.1-c report). Never mutates the DB directly — the one
 * authorized write (Photo.displayDerivativeStatus, one row at a time) is
 * always performed by the shared helper, never inline here. Never deletes
 * anything. A single item's failure never stops the others.
 *
 * The per-item stale-url check only applies to targets that actually need
 * generation (`target.needsGeneration`): a reconcile-only target's Blob
 * object already exists, so ensurePhotoDisplayDerivativeStatus's underlying
 * head-first probe resolves it without ever calling getSourceBuffer — an
 * unusable/empty url on such a row is irrelevant, not a failure.
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
      if (target.needsGeneration && (typeof currentUrl !== 'string' || currentUrl.length === 0)) {
        failed += 1
        continue
      }

      const result = await ensurePhotoDisplayDerivativeStatus({
        prisma,
        photo: { id: target.id },
        operation: 'display-backfill',
        getSourceBuffer: () => readSource(currentUrl),
        ensure,
      })

      if (result.status === 'READY') {
        if (result.created) created += 1
        else alreadyPresent += 1
      } else {
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

  if (inventory.reconcileOnlyCount !== parsed.expectedReconcile) {
    logger.error(
      `[backfill] ABORT: --expected-reconcile mismatch (expected ${parsed.expectedReconcile}, actual ${inventory.reconcileOnlyCount})`,
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
