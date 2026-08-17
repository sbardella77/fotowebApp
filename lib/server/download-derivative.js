import { head, put, BlobNotFoundError } from '@vercel/blob'
import {
  tryAcquireDistributedLock,
  DISTRIBUTED_LOCK_OUTCOME,
} from '@/lib/server/rate-limiter'
import {
  WATERMARK_DERIVATIVE_VERSION,
  BRANDED_DOWNLOAD_WATERMARK_OPTIONS,
  applyWatermark,
} from '@/lib/server/watermark'

/**
 * Deterministic photo-derivative cache with distributed single-flight
 * (STEP 7.14b; generalised to multiple derivative kinds in STEP 7.15c).
 *
 * A derivative is a pure function of (source bytes, kind, version), so it is
 * produced at most once per photo per kind per version and then persisted to
 * Vercel Blob. Subsequent requests serve the stored object and never touch
 * Sharp or the source image.
 *
 * Concurrency rule (non-negotiable): while Redis is reachable, a request may
 * run a transform ONLY if it holds the distributed lock. A waiter reaching
 * its deadline never earns the right to transform — that is precisely what
 * would recreate the stampede this module exists to prevent. That rule is
 * structural: `produceAndPersist` is reachable only from the ACQUIRED branch
 * and from the degraded local-leader branch, and the HELD_BY_OTHER branch has
 * no code path to it. Adding a derivative kind cannot weaken this, because
 * every kind shares this one orchestrator.
 *
 * Delivery is CACHED_PROXY: this module returns the bytes and the caller
 * keeps ownership of the response headers, so the friendly download filename
 * is preserved. Redirecting to the Blob URL would expose a hash-named object
 * (the SDK cannot set contentDisposition on put), regressing that filename.
 *
 * This module performs no Prisma access.
 */

export const LOCK_TTL_SECONDS = 25
export const WAITER_DEADLINE_MS = 10_000
export const WAITER_POLL_INTERVAL_MS = 500
export const DERIVATIVE_CACHE_CONTROL_MAX_AGE = 31_536_000 // 1 year

/**
 * The derivative store is degraded (not merely empty). Callers must map this
 * to a temporary failure and must NOT fall back to transforming, or a Blob
 * incident would turn into a transform storm.
 */
export class DerivativeStorageUnavailableError extends Error {
  constructor(message = 'Derivative storage unavailable') {
    super(message)
    this.name = 'DerivativeStorageUnavailableError'
  }
}

/** The derivative is still being produced elsewhere and did not arrive in time. */
export class DerivativePendingError extends Error {
  constructor(message = 'Derivative is still being prepared') {
    super(message)
    this.name = 'DerivativePendingError'
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Existence probe. Only BlobNotFoundError means "miss" — every other error
 * is a storage problem and is escalated rather than silently treated as a
 * cache miss.
 *
 * @returns {Promise<{exists: boolean, url?: string}>}
 */
async function probeDerivative(derivativePath) {
  try {
    const result = await head(derivativePath)
    return { exists: true, url: result.url }
  } catch (error) {
    if (error instanceof BlobNotFoundError) {
      return { exists: false }
    }
    throw new DerivativeStorageUnavailableError(
      `head failed for ${derivativePath}: ${error?.message ?? 'unknown error'}`,
    )
  }
}

/**
 * Read a derivative that head() has already confirmed exists. A failure here
 * is a storage problem, never a cache miss — see STEP 7.14b §10.
 */
async function readDerivative(url) {
  let response
  try {
    response = await fetch(url, { cache: 'no-store' })
  } catch (error) {
    throw new DerivativeStorageUnavailableError(
      `derivative fetch failed: ${error?.message ?? 'unknown error'}`,
    )
  }
  if (!response.ok) {
    throw new DerivativeStorageUnavailableError(
      `derivative fetch returned ${response.status}`,
    )
  }
  return Buffer.from(await response.arrayBuffer())
}

/**
 * Produce the derivative once and persist it.
 *
 * The generated buffer is returned directly — the freshly stored object is
 * never re-fetched, which would waste a round trip on the slowest path.
 */
async function produceAndPersist({ kind, derivativePath, getSourceBuffer, onTransform }) {
  const sourceBuffer = await getSourceBuffer()
  if (onTransform) onTransform()
  const derivativeBuffer = await kind.transform(sourceBuffer)

  try {
    await put(derivativePath, derivativeBuffer, {
      access: 'public',
      contentType: kind.contentType,
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: kind.cacheControlMaxAge,
    })
  } catch (putError) {
    // allowOverwrite:false means a concurrent producer that already stored
    // this exact deterministic object makes our put fail. There is no
    // dedicated "already exists" error class in the SDK, so resolve the race
    // by re-probing rather than matching an error message.
    let raced = false
    try {
      raced = (await probeDerivative(derivativePath)).exists
    } catch {
      // Probe itself failed — we cannot prove a benign race, so surface the
      // original put failure rather than inventing a reason.
      throw putError
    }
    if (!raced) throw putError
  }

  return derivativeBuffer
}

// ── Degraded mode ──────────────────────────────────────────────────────────
// When Redis cannot answer (outage, or simply not configured locally), fall
// back to per-process deduplication. This bounds duplicate work within one
// instance; different instances can still duplicate. That limitation is
// accepted rather than papered over — failing the download because Redis is
// down would be strictly worse.
//
// The map is shared across derivative kinds, which is safe because lock keys
// are kind-namespaced and therefore never collide.
const inFlightLocalTransforms = new Map()

async function runWithLocalSingleFlight(lockKey, task) {
  const existing = inFlightLocalTransforms.get(lockKey)
  if (existing) return existing

  const promise = (async () => task())().finally(() => {
    inFlightLocalTransforms.delete(lockKey)
  })
  inFlightLocalTransforms.set(lockKey, promise)
  return promise
}

/** Test-only visibility into the degraded-mode map. */
export function __getLocalSingleFlightSize() {
  return inFlightLocalTransforms.size
}
export function __resetLocalSingleFlight() {
  inFlightLocalTransforms.clear()
}

/**
 * Resolve a derivative for a photo, transforming at most once.
 *
 * Shared by every derivative kind, so the single-flight and
 * never-transform-without-the-lock guarantees cannot drift between kinds.
 *
 * @param {object} kind                                   frozen derivative kind
 * @param {object} params
 * @param {string} params.photoId
 * @param {() => Promise<Buffer>} params.getSourceBuffer  fetches the original image
 * @param {() => void} [params.onTransform]               test hook, fired per real transform
 * @param {() => number} [params.now]                     injectable clock for deadline tests
 * @returns {Promise<Buffer>} derivative bytes
 */
async function resolveDerivative(kind, { photoId, getSourceBuffer, onTransform, now = Date.now }) {
  const derivativePath = kind.buildPath(photoId)
  const lockKey = kind.buildLockKey(photoId)

  // 1. Fast path — an already-produced derivative costs no Sharp and no
  //    source fetch.
  const initial = await probeDerivative(derivativePath)
  if (initial.exists) {
    return readDerivative(initial.url)
  }

  const deadline = now() + WAITER_DEADLINE_MS

  // 2. Contend for the right to produce it. Sharp is reachable only from the
  //    ACQUIRED branch below, or from the degraded local path when Redis
  //    cannot answer at all.
  for (;;) {
    const { outcome } = await tryAcquireDistributedLock(lockKey, LOCK_TTL_SECONDS)

    if (outcome === DISTRIBUTED_LOCK_OUTCOME.ACQUIRED) {
      // Another producer may have finished between our probe and this
      // acquisition (or during a previous lock generation).
      const afterLock = await probeDerivative(derivativePath)
      if (afterLock.exists) {
        return readDerivative(afterLock.url)
      }
      return produceAndPersist({ kind, derivativePath, getSourceBuffer, onTransform })
    }

    if (outcome === DISTRIBUTED_LOCK_OUTCOME.BACKEND_UNAVAILABLE) {
      return runWithLocalSingleFlight(lockKey, async () => {
        // The local leader must re-probe: another instance may have stored
        // the derivative since this request's earlier miss.
        const beforeLocalTransform = await probeDerivative(derivativePath)
        if (beforeLocalTransform.exists) {
          return readDerivative(beforeLocalTransform.url)
        }
        return produceAndPersist({ kind, derivativePath, getSourceBuffer, onTransform })
      })
    }

    // HELD_BY_OTHER — wait for the holder to publish, never transform.
    if (now() >= deadline) {
      throw new DerivativePendingError()
    }

    await sleep(WAITER_POLL_INTERVAL_MS)

    const polled = await probeDerivative(derivativePath)
    if (polled.exists) {
      return readDerivative(polled.url)
    }

    if (now() >= deadline) {
      throw new DerivativePendingError()
    }
  }
}

/**
 * Define a derivative kind.
 *
 * `version` is supplied once and feeds BOTH the storage path and the lock
 * key, so the two can never drift and a version bump can never be blocked by
 * a stale lock from the previous generation.
 *
 * Callers get only `buildPath`, `buildLockKey` and `resolve` — the Redis and
 * Blob mechanics stay private to this module.
 *
 * @param {object} spec
 * @param {string} spec.version                          e.g. 'v1'
 * @param {string} spec.pathPrefix                       path segment, e.g. 'wm' -> derivatives/wm-v1/
 * @param {string} spec.lockNamespace                    lock prefix, e.g. 'download-photo-transform'
 * @param {(buffer: Buffer) => Promise<Buffer>} spec.transform
 * @param {string} [spec.contentType]
 * @param {string} [spec.extension]
 * @param {number} [spec.cacheControlMaxAge]
 */
export function createDerivativeKind({
  version,
  pathPrefix,
  lockNamespace,
  transform,
  contentType = 'image/jpeg',
  extension = '.jpg',
  cacheControlMaxAge = DERIVATIVE_CACHE_CONTROL_MAX_AGE,
}) {
  const kind = Object.freeze({
    version,
    contentType,
    cacheControlMaxAge,
    transform,
    buildPath: (photoId) => `derivatives/${pathPrefix}-${version}/${photoId}${extension}`,
    buildLockKey: (photoId) => `${lockNamespace}:${version}:${photoId}`,
    resolve: (params) => resolveDerivative(kind, params),
  })
  return kind
}

/**
 * Branded single-photo download derivative (STEP 7.14b), unchanged.
 *
 * `applyWatermark` has exactly one call site — here — and it is reached only
 * through the shared orchestrator's producer.
 */
export const BRANDED_DERIVATIVE_KIND = createDerivativeKind({
  version: WATERMARK_DERIVATIVE_VERSION,
  pathPrefix: 'wm',
  lockNamespace: 'download-photo-transform',
  transform: (sourceBuffer) => applyWatermark(sourceBuffer, BRANDED_DOWNLOAD_WATERMARK_OPTIONS),
})

/** Deterministic, version-scoped, PII-free storage path. */
export function buildDerivativePath(photoId) {
  return BRANDED_DERIVATIVE_KIND.buildPath(photoId)
}

/** One lock per derivative version — a version bump can never be blocked by a stale lock. */
export function buildTransformLockKey(photoId) {
  return BRANDED_DERIVATIVE_KIND.buildLockKey(photoId)
}

/**
 * Resolve the branded JPEG for a photo, transforming at most once.
 *
 * @param {object} params
 * @param {string} params.photoId
 * @param {() => Promise<Buffer>} params.getSourceBuffer  fetches the original image
 * @param {() => void} [params.onTransform]               test hook, fired per real transform
 * @param {() => number} [params.now]                     injectable clock for deadline tests
 * @returns {Promise<Buffer>} branded JPEG bytes
 */
export async function getBrandedDerivative({ photoId, getSourceBuffer, onTransform, now = Date.now }) {
  return BRANDED_DERIVATIVE_KIND.resolve({ photoId, getSourceBuffer, onTransform, now })
}
