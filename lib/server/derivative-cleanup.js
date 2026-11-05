import { del, list } from '@vercel/blob'
import { buildDerivativePath } from '@/lib/server/download-derivative'
import { buildDisplayDerivativePath } from '@/lib/server/display-derivative'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { getStorageMode } from '@/lib/server/storage'
import { PWM_DERIVATIVE_VERSION, PWM_DISPLAY_KIND, PWM_ORIGINAL_KIND, buildPwmPhotoPrefix } from '@/lib/server/photographer-watermark-derivative'

/**
 * Public photo-derivative lifecycle cleanup (STEP 7.15d).
 *
 * Derivatives (`derivatives/wm-v1/<photoId>.jpg`,
 * `derivatives/display-v1/<photoId>.jpg`) are PUBLIC, deterministic cache
 * artifacts keyed only by the opaque photo id. Nothing else in the product
 * removes them, so before this module a deleted or hidden photo left its
 * branded derivative publicly readable forever — a privacy gap that exists
 * today for `wm-v1`, independently of the (still dormant) display kind.
 *
 * Two mechanisms, deliberately layered:
 *
 *   1. Synchronous best-effort deletion on the photo/event lifecycle events.
 *      Fast, but it can never be complete: a producer already holding the
 *      source bytes may `put` its derivative AFTER the synchronous delete has
 *      run, and there is no distributed transaction spanning Postgres and
 *      Blob that could close that window (STEP 7.15d §29).
 *
 *   2. A periodic reconciliation sweep, which is therefore the actual
 *      consistency guarantee rather than a nicety. It is also the recovery
 *      path for every best-effort failure in (1).
 *
 * Safety posture — this module may delete ONLY objects that the derivative
 * path builders themselves could have produced, for the CURRENT versions:
 *   - no wildcard and no prefix deletion, ever;
 *   - source namespaces (`events/`, `private-delivery/`, `covers/`,
 *     `gallery-downloads/`) are unreachable by construction, because every
 *     pathname is built by `buildPath(photoId)` and every swept pathname is
 *     round-tripped back through that same builder before deletion;
 *   - unknown/retired versions (`wm-v2`, `display-v2`, …) are never scanned
 *     and never deleted — retiring a version stays a separate, approved step;
 *   - anything that does not parse exactly is counted and IGNORED, never
 *     "best guessed" into an id.
 *
 * PrivateAsset is not a Photo and has no derivative identity here.
 */

/**
 * Probe id used only to derive each kind's prefix/extension FROM the real
 * builder, so pathname identity has exactly one source of truth and the
 * sweep can never drift from what the producers actually write.
 */
const PROBE_PHOTO_ID = '00000000-0000-4000-8000-000000000000'

const UUID_PATTERN = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'

const escapeForRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function describeKind(name, buildPath) {
  const sample = buildPath(PROBE_PHOTO_ID)
  const prefix = sample.slice(0, sample.lastIndexOf('/') + 1)
  const extension = sample.slice(sample.lastIndexOf('.'))

  return Object.freeze({
    name,
    buildPath,
    prefix,
    extension,
    // Anchored: exactly one filename segment under the exact version prefix,
    // a UUID-shaped id, and the exact extension. Nested paths, wrong
    // extensions and non-UUID names all fail to match.
    pattern: new RegExp(`^${escapeForRegExp(prefix)}(${UUID_PATTERN})${escapeForRegExp(extension)}$`),
  })
}

/**
 * The derivative kinds subject to cleanup — CURRENT versions only.
 *
 * Adding a kind here is the single place that makes it eligible for both
 * lifecycle deletion and reconciliation.
 */
export const DERIVATIVE_CLEANUP_KINDS = Object.freeze([
  describeKind('wm', buildDerivativePath),
  describeKind('display', buildDisplayDerivativePath),
])

/**
 * Pathnames deleted per `del()` call.
 *
 * 50 keeps the largest Production event (186 photos → 372 pathnames) at 8
 * bounded, sequential calls instead of one oversized request or 372 parallel
 * ones. Chosen conservatively; the batching boundary is covered by tests.
 */
export const DERIVATIVE_DELETE_BATCH_SIZE = 50

/** Objects requested per `list()` page — bounded so memory stays per-page. */
export const DERIVATIVE_LIST_PAGE_SIZE = 100

/**
 * A photo id is usable only if it cannot escape its version prefix. This is
 * the guard that makes "the builder output is always inside
 * `derivatives/<kind>-<version>/`" a property rather than a hope.
 */
function isSafePhotoId(photoId) {
  return typeof photoId === 'string' && photoId.length > 0 && !/[/\\\s]/.test(photoId)
}

/**
 * Strictly parse a swept object pathname back to a photo id.
 *
 * Returns `null` for anything that is not EXACTLY a current-version
 * derivative. The round-trip assertion is deliberate belt-and-braces: even if
 * the regex were ever loosened by mistake, a pathname the builder would not
 * itself produce can still never be returned as deletable.
 *
 * @returns {{ photoId: string, kind: string } | null}
 */
export function parseDerivativePathname(pathname) {
  if (typeof pathname !== 'string') return null

  for (const kind of DERIVATIVE_CLEANUP_KINDS) {
    const match = kind.pattern.exec(pathname)
    if (!match) continue

    const photoId = match[1]
    if (!isSafePhotoId(photoId)) return null
    if (kind.buildPath(photoId) !== pathname) return null

    return { photoId, kind: kind.name }
  }

  return null
}

// ── Photographer-watermark (pwm) derivatives ────────────────────────────────
// Unlike the kinds above, a photo can have several pwm objects (one per
// variant and watermark revision), so they cannot be enumerated from the id
// alone. They live under one folder per photo, which is listed; every listed
// pathname is then strictly parsed and round-tripped through the real
// builder before it can be deleted — the same "only what the builder could
// have produced" guarantee, never a blind prefix delete.

export const PWM_CLEANUP_PREFIX = `derivatives/pwm-${PWM_DERIVATIVE_VERSION}/`
const PWM_KINDS_BY_VARIANT = Object.freeze({ display: PWM_DISPLAY_KIND, original: PWM_ORIGINAL_KIND })
const PWM_PATTERN = new RegExp(`^${escapeForRegExp(PWM_CLEANUP_PREFIX)}(${UUID_PATTERN})/(display|original)-([a-f0-9]{16})\\.jpg$`)

/**
 * Old revisions stay reachable this long after a watermark change, so a ZIP
 * or a gallery page that started with the previous revision can finish.
 */
export const PWM_REVISION_GRACE_MS = 24 * 60 * 60 * 1000

/** @returns {{ photoId: string, variant: string, revision: string } | null} */
export function parsePwmPathname(pathname) {
  if (typeof pathname !== 'string') return null
  const match = PWM_PATTERN.exec(pathname)
  if (!match) return null
  const [, photoId, variant, revision] = match
  if (!isSafePhotoId(photoId)) return null
  if (PWM_KINDS_BY_VARIANT[variant].buildPath(photoId, { revision }) !== pathname) return null
  return { photoId, variant, revision }
}

async function listAllPwmPathsForPhoto(photoId) {
  const paths = []
  let cursor
  do {
    const page = await list({ prefix: buildPwmPhotoPrefix(photoId), limit: DERIVATIVE_LIST_PAGE_SIZE, cursor })
    for (const blob of page?.blobs || []) {
      const hit = parsePwmPathname(blob?.pathname)
      if (hit && hit.photoId === photoId) paths.push(blob.pathname)
    }
    cursor = page?.hasMore ? page.cursor : undefined
  } while (cursor)
  return paths
}

const PWM_LIFECYCLE_LIST_CONCURRENCY = 5

/**
 * Every pwm pathname of these photos. Listing failures are counted, never
 * thrown: the sweep reclaims whatever is missed here.
 */
async function collectPwmPaths(photoIds, { logger, context }) {
  const paths = []
  let listFailures = 0
  for (const group of chunk(photoIds, PWM_LIFECYCLE_LIST_CONCURRENCY)) {
    const results = await Promise.allSettled(group.map(listAllPwmPathsForPhoto))
    for (const result of results) {
      if (result.status === 'fulfilled') paths.push(...result.value)
      else listFailures += 1
    }
  }
  if (listFailures > 0) {
    logger.warn?.(`[${context}] pwm derivative listing failed: count=${listFailures}`)
  }
  return { paths, listFailures }
}

/** Every current-version derivative pathname for one photo. */
function derivativePathsFor(photoId) {
  return DERIVATIVE_CLEANUP_KINDS.map((kind) => kind.buildPath(photoId))
}

const chunk = (items, size) => {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Delete an explicit list of derivative pathnames in bounded sequential
 * batches. Never parallel-fans-out, never throws.
 *
 * @returns {Promise<{ deleted: number, failed: number, batches: number }>}
 */
async function deleteDerivativePaths(paths, { logger = console, context = 'derivative-cleanup' } = {}) {
  let deleted = 0
  let failed = 0
  let batches = 0

  for (const batch of chunk(paths, DERIVATIVE_DELETE_BATCH_SIZE)) {
    batches += 1
    try {
      await del(batch)
      deleted += batch.length
    } catch (error) {
      failed += batch.length
      // Safe to log: object count and error class only. Never the pathname
      // set, never provider internals, never credentials.
      logger.warn?.(
        `[${context}] derivative delete batch failed: count=${batch.length} error=${error?.name || 'Error'}`,
      )
    }
  }

  return { deleted, failed, batches }
}

/**
 * Best-effort deletion of every current-version derivative for the given
 * photo ids.
 *
 * Never throws: derivatives are caches, and a cache failure must not roll back
 * a photo deletion, an event deletion or a moderation decision. Residue is
 * reclaimed by `cleanupPhotoDerivatives()`.
 *
 * @param {string[]} photoIds
 * @returns {Promise<{ photos: number, attempted: number, deleted: number, failed: number, batches: number, skipped: boolean }>}
 */
export async function deletePhotoDerivativesBatch(photoIds, { logger = console, context = 'derivative-cleanup' } = {}) {
  const empty = { photos: 0, attempted: 0, deleted: 0, failed: 0, batches: 0, skipped: false }

  if (!Array.isArray(photoIds) || photoIds.length === 0) return empty

  const safeIds = [...new Set(photoIds.filter(isSafePhotoId))]
  if (safeIds.length === 0) return empty

  // Derivatives only ever exist in Vercel Blob; in local storage mode there is
  // nothing to delete and calling the provider would only produce noise.
  if (getStorageMode() !== 'vercel-blob') {
    return { ...empty, photos: safeIds.length, skipped: true }
  }

  const pwm = await collectPwmPaths(safeIds, { logger, context })
  const paths = [...safeIds.flatMap(derivativePathsFor), ...pwm.paths]
  const result = await deleteDerivativePaths(paths, { logger, context })

  // A hidden photo may be shown again later: its recorded watermark revision
  // must not keep pointing at an object deleted here.
  if (pwm.paths.length > 0) {
    try {
      const prisma = await getPrismaClient()
      await prisma?.photo?.updateMany({ where: { id: { in: safeIds } }, data: { watermarkDisplayRevision: null } })
    } catch (error) {
      logger.warn?.(`[${context}] failed to reset watermark display revision: error=${error?.name || 'Error'}`)
    }
  }

  return { photos: safeIds.length, attempted: paths.length, skipped: false, ...result, failed: result.failed + pwm.listFailures }
}

/**
 * Best-effort deletion of every current-version derivative for one photo.
 *
 * Both pathnames go out in a single `del()` call — the installed SDK accepts
 * the array form — so one lifecycle event costs one provider round trip.
 */
export async function deletePhotoDerivatives(photoId, options = {}) {
  return deletePhotoDerivativesBatch([photoId], options)
}

/**
 * Reconciliation sweep over the current derivative versions.
 *
 * Stale (§24) means: the Photo row is ABSENT, or its status is not VISIBLE.
 * A HIDDEN photo is a deliberately withdrawn photo, so leaving a public,
 * deterministically-addressable derivative behind would mean hiding changed
 * the API but not actual public reachability.
 *
 * Per-page fail-safe order is load-bearing: list → parse strictly → resolve DB
 * state → compute stale paths → only then delete. A DB or listing failure
 * therefore aborts with NOTHING deleted for the unresolved page; provider
 * failure is never reinterpreted as evidence that an object is stale.
 *
 * @returns {Promise<object>} aggregate counters only — no ids, no filenames,
 *          no customer metadata ever leaves this function.
 */
export async function cleanupPhotoDerivatives({ logger = console, now = Date.now } = {}) {
  const prisma = await getPrismaClient()
  if (!prisma) {
    throw new Error('Database unavailable')
  }

  const stats = {
    pages: 0,
    scanned: 0,
    valid: 0,
    malformedIgnored: 0,
    visibleKept: 0,
    hiddenDeleted: 0,
    absentDeleted: 0,
    deleteFailures: 0,
    pwmStaleRevisionDeleted: 0,
    watermarkLogosDeleted: 0,
  }

  for (const kind of DERIVATIVE_CLEANUP_KINDS) {
    let cursor

    do {
      let page
      try {
        page = await list({ prefix: kind.prefix, limit: DERIVATIVE_LIST_PAGE_SIZE, cursor })
      } catch (error) {
        // Abort rather than continue: a partial listing must never be treated
        // as "everything that exists".
        logger.error?.(`[cleanup-photo-derivatives] listing failed: kind=${kind.name} error=${error?.name || 'Error'}`)
        throw new Error('Derivative sweep aborted: derivative listing unavailable')
      }

      stats.pages += 1

      const blobs = page?.blobs || []
      stats.scanned += blobs.length

      // 2. Strict parse. Anything unexpected is ignored, never guessed at.
      const parsed = []
      for (const blob of blobs) {
        const hit = parseDerivativePathname(blob?.pathname)
        if (hit) parsed.push({ ...hit, pathname: blob.pathname })
        else stats.malformedIgnored += 1
      }
      stats.valid += parsed.length

      if (parsed.length > 0) {
        // 3. One DB lookup per page, never one per object.
        const ids = [...new Set(parsed.map((item) => item.photoId))]
        const rows = await prisma.photo.findMany({
          where: { id: { in: ids } },
          select: { id: true, status: true },
        })
        const statusById = new Map(rows.map((row) => [row.id, row.status]))

        // 4. Compute stale paths.
        const stalePaths = []
        for (const item of parsed) {
          const status = statusById.get(item.photoId)
          if (status === undefined) {
            stats.absentDeleted += 1
            stalePaths.push(item.pathname)
          } else if (status !== 'VISIBLE') {
            stats.hiddenDeleted += 1
            stalePaths.push(item.pathname)
          } else {
            stats.visibleKept += 1
          }
        }

        // 5. Only now delete, and only these exact pathnames.
        if (stalePaths.length > 0) {
          const result = await deleteDerivativePaths(stalePaths, {
            logger,
            context: 'cleanup-photo-derivatives',
          })
          stats.deleteFailures += result.failed
        }
      }

      cursor = page?.hasMore ? page.cursor : undefined
    } while (cursor)
  }

  await sweepPwmDerivatives({ prisma, stats, logger, now })
  await sweepWatermarkLogos({ prisma, stats, logger, now })

  logger.log?.('[cleanup-photo-derivatives] stats:', JSON.stringify(stats))

  if (stats.deleteFailures > 0) {
    // Surface as an operational failure so the cron alert fires, but only
    // after the sweep has done every deletion it could: the remaining stale
    // objects stay stale and are retried on the next run.
    const failure = new Error(`Derivative sweep completed with ${stats.deleteFailures} delete failure(s)`)
    failure.stats = stats
    throw failure
  }

  return stats
}

async function listPage(prefix, cursor, logger, label) {
  try {
    return await list({ prefix, limit: DERIVATIVE_LIST_PAGE_SIZE, cursor })
  } catch (error) {
    logger.error?.(`[cleanup-photo-derivatives] listing failed: kind=${label} error=${error?.name || 'Error'}`)
    throw new Error('Derivative sweep aborted: derivative listing unavailable')
  }
}

/**
 * Photographer-watermark pass. Stale means: the photo is absent or not
 * VISIBLE; its owner has no watermark anymore; or the object's revision is
 * not the owner's current one and the change is older than the grace period.
 * Same fail-safe order as the main sweep: list → strict parse → one DB lookup
 * per page → delete exact pathnames.
 */
async function sweepPwmDerivatives({ prisma, stats, logger, now }) {
  let cursor
  do {
    const page = await listPage(PWM_CLEANUP_PREFIX, cursor, logger, 'pwm')
    stats.pages += 1
    const blobs = page?.blobs || []
    stats.scanned += blobs.length

    const parsed = []
    for (const blob of blobs) {
      const hit = parsePwmPathname(blob?.pathname)
      if (hit) parsed.push({ ...hit, pathname: blob.pathname })
      else stats.malformedIgnored += 1
    }
    stats.valid += parsed.length

    if (parsed.length > 0) {
      const ids = [...new Set(parsed.map((item) => item.photoId))]
      const rows = await prisma.photo.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          status: true,
          watermarkDisplayRevision: true,
          event: { select: { owner: { select: { watermark: { select: { revision: true, revisionChangedAt: true } } } } } },
        },
      })
      const rowById = new Map(rows.map((row) => [row.id, row]))

      const stalePaths = []
      const resetColumnIds = new Set()
      for (const item of parsed) {
        const row = rowById.get(item.photoId)
        const watermark = row?.event?.owner?.watermark
        let stale = false
        if (!row) {
          stats.absentDeleted += 1
          stale = true
        } else if (row.status !== 'VISIBLE') {
          stats.hiddenDeleted += 1
          stale = true
        } else if (!watermark || (item.revision !== watermark.revision && now() - new Date(watermark.revisionChangedAt).getTime() > PWM_REVISION_GRACE_MS)) {
          stats.pwmStaleRevisionDeleted += 1
          stale = true
        } else {
          stats.visibleKept += 1
        }
        if (stale) {
          stalePaths.push(item.pathname)
          if (item.variant === 'display' && row?.watermarkDisplayRevision === item.revision) resetColumnIds.add(item.photoId)
        }
      }

      if (stalePaths.length > 0) {
        // Column first: if the delete then fails, the photo is merely served
        // through the lazy route again, never pointed at a missing object.
        if (resetColumnIds.size > 0) {
          await prisma.photo.updateMany({ where: { id: { in: [...resetColumnIds] } }, data: { watermarkDisplayRevision: null } })
        }
        const result = await deleteDerivativePaths(stalePaths, { logger, context: 'cleanup-photo-derivatives' })
        stats.deleteFailures += result.failed
      }
    }

    cursor = page?.hasMore ? page.cursor : undefined
  } while (cursor)
}

const WATERMARK_LOGO_PATTERN = /^watermarks\/([A-Za-z0-9-]+)\/([a-f0-9]{16})\.png$/

/**
 * Watermark logos no OwnerWatermark references anymore (replaced, removed,
 * or uploaded for a preview and never saved), once older than the grace
 * period — an in-flight render may still be using a just-replaced logo.
 */
async function sweepWatermarkLogos({ prisma, stats, logger, now }) {
  let cursor
  do {
    const page = await listPage('watermarks/', cursor, logger, 'watermark-logo')
    stats.pages += 1
    const blobs = (page?.blobs || []).filter((blob) => {
      if (!WATERMARK_LOGO_PATTERN.test(blob?.pathname || '')) {
        stats.malformedIgnored += 1
        return false
      }
      return now() - new Date(blob.uploadedAt).getTime() > PWM_REVISION_GRACE_MS
    })

    if (blobs.length > 0) {
      const referenced = await prisma.ownerWatermark.findMany({
        where: { logoPathname: { in: blobs.map((blob) => blob.pathname) } },
        select: { logoPathname: true },
      })
      const inUse = new Set(referenced.map((row) => row.logoPathname))
      const stalePaths = blobs.map((blob) => blob.pathname).filter((pathname) => !inUse.has(pathname))
      if (stalePaths.length > 0) {
        const result = await deleteDerivativePaths(stalePaths, { logger, context: 'cleanup-photo-derivatives' })
        stats.watermarkLogosDeleted += result.deleted
        stats.deleteFailures += result.failed
      }
    }

    cursor = page?.hasMore ? page.cursor : undefined
  } while (cursor)
}
