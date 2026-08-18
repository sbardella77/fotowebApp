import { describe, it, expect, vi, beforeEach } from 'vitest'

// STEP 7.15c — display derivative orchestration.
//
// display-v1 deliberately shares the branded derivative's producer, so the
// STEP 7.14b invariant holds for it structurally: while Redis is reachable,
// a request may run the transform ONLY if it acquired the distributed lock.
// A waiter reaching its deadline must never earn permission to transform.

const headMock = vi.fn()
const putMock = vi.fn()

class FakeBlobNotFoundError extends Error {
  constructor() {
    super('The requested blob does not exist')
    this.name = 'BlobNotFoundError'
  }
}

vi.mock('@vercel/blob', () => ({
  head: (...args) => headMock(...args),
  put: (...args) => putMock(...args),
  BlobNotFoundError: FakeBlobNotFoundError,
}))

// Chainable Sharp stub: lets the pipeline be asserted without decoding real
// images (image semantics are covered in tests/display-image.test.js).
const toBufferMock = vi.fn()
const pipeline = {
  rotate: vi.fn(() => pipeline),
  resize: vi.fn(() => pipeline),
  flatten: vi.fn(() => pipeline),
  jpeg: vi.fn(() => pipeline),
  toBuffer: (...args) => toBufferMock(...args),
}
const sharpMock = vi.fn(() => pipeline)
vi.mock('sharp', () => ({ default: (...args) => sharpMock(...args) }))

const tryAcquireDistributedLockMock = vi.fn()
vi.mock('@/lib/server/rate-limiter', () => ({
  tryAcquireDistributedLock: (...args) => tryAcquireDistributedLockMock(...args),
  DISTRIBUTED_LOCK_OUTCOME: {
    ACQUIRED: 'ACQUIRED',
    HELD_BY_OTHER: 'HELD_BY_OTHER',
    BACKEND_UNAVAILABLE: 'BACKEND_UNAVAILABLE',
  },
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const PHOTO_ID = 'photo-uuid-1'
const DISPLAY_PATH = 'derivatives/display-v1/photo-uuid-1.jpg'
const DISPLAY_URL = 'https://store.public.blob.vercel-storage.com/derivatives/display-v1/photo-uuid-1.jpg'
const SOURCE_BYTES = Buffer.from('source-image-bytes')
const DISPLAY_BYTES = Buffer.from('display-jpeg-bytes')
const CACHED_BYTES = Buffer.from('cached-display-bytes')

const derivativeExists = () => headMock.mockResolvedValue({ url: DISPLAY_URL, size: CACHED_BYTES.length })
const derivativeMissing = () => headMock.mockRejectedValue(new FakeBlobNotFoundError())
const cachedFetchOk = (bytes = CACHED_BYTES) =>
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  })

const ACQUIRED = { outcome: 'ACQUIRED' }
const HELD = { outcome: 'HELD_BY_OTHER' }
const NO_BACKEND = { outcome: 'BACKEND_UNAVAILABLE' }

let getSourceBuffer

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  toBufferMock.mockResolvedValue(DISPLAY_BYTES)
  putMock.mockResolvedValue({ url: DISPLAY_URL, pathname: DISPLAY_PATH })
  getSourceBuffer = vi.fn().mockResolvedValue(SOURCE_BYTES)
  cachedFetchOk()
})

async function loadDisplay() {
  const mod = await import('@/lib/server/display-derivative')
  const { __resetLocalSingleFlight } = await import('@/lib/server/download-derivative')
  __resetLocalSingleFlight()
  return mod
}

describe('identity: path and lock key', () => {
  it('display path is deterministic, version-scoped, and uses only the opaque photo id', async () => {
    const { buildDisplayDerivativePath } = await loadDisplay()
    expect(buildDisplayDerivativePath(PHOTO_ID)).toBe(DISPLAY_PATH)
  })

  it('display path leaks no url, slug, storedName or original filename', async () => {
    const { buildDisplayDerivativePath } = await loadDisplay()
    const p = buildDisplayDerivativePath(PHOTO_ID)

    expect(p).not.toContain('http')
    expect(p).not.toContain('events/')
    expect(p.split('/').pop()).toBe(`${PHOTO_ID}.jpg`)
  })

  it('lock key is version-scoped and carries no pathname', async () => {
    const { buildDisplayTransformLockKey } = await loadDisplay()
    const key = buildDisplayTransformLockKey(PHOTO_ID)

    expect(key).toBe(`display-photo-transform:v1:${PHOTO_ID}`)
    expect(key).not.toContain('/')
    expect(key).not.toContain('.jpg')
  })

  it('does NOT collide with the branded derivative for the same photo', async () => {
    const display = await loadDisplay()
    const branded = await import('@/lib/server/download-derivative')

    expect(display.buildDisplayDerivativePath(PHOTO_ID)).not.toBe(branded.buildDerivativePath(PHOTO_ID))
    expect(display.buildDisplayTransformLockKey(PHOTO_ID)).not.toBe(branded.buildTransformLockKey(PHOTO_ID))
    expect(branded.buildDerivativePath(PHOTO_ID)).toBe(`derivatives/wm-v1/${PHOTO_ID}.jpg`)
  })

  it('freezes the display output constants', async () => {
    const m = await loadDisplay()
    expect(m.DISPLAY_DERIVATIVE_VERSION).toBe('v1')
    expect(m.DISPLAY_MAX_LONG_EDGE).toBe(1600)
    expect(m.DISPLAY_FORMAT).toBe('jpeg')
    expect(m.DISPLAY_QUALITY).toBe(82)
    expect(m.DISPLAY_BACKGROUND).toBe('#ffffff')
    expect(m.DISPLAY_CACHE_CONTROL_MAX_AGE).toBe(31_536_000)
  })
})

describe('versioning', () => {
  it('a version bump moves BOTH the path and the lock key', async () => {
    const { createDerivativeKind } = await import('@/lib/server/download-derivative')
    const v2 = createDerivativeKind({
      version: 'v2',
      pathPrefix: 'display',
      lockNamespace: 'display-photo-transform',
      transform: async (b) => b,
    })

    expect(v2.buildPath(PHOTO_ID)).toBe(`derivatives/display-v2/${PHOTO_ID}.jpg`)
    expect(v2.buildLockKey(PHOTO_ID)).toBe(`display-photo-transform:v2:${PHOTO_ID}`)
  })

  it('path and lock key derive from the SAME version constant', async () => {
    const { createDerivativeKind } = await import('@/lib/server/download-derivative')
    const k = createDerivativeKind({
      version: 'v9',
      pathPrefix: 'display',
      lockNamespace: 'display-photo-transform',
      transform: async (b) => b,
    })

    expect(k.buildPath(PHOTO_ID)).toContain('-v9/')
    expect(k.buildLockKey(PHOTO_ID)).toContain(':v9:')
  })
})

describe('cache hit', () => {
  it('serves the stored object with no transform, no source fetch and no put', async () => {
    derivativeExists()
    const { getDisplayDerivative } = await loadDisplay()

    const out = await getDisplayDerivative({ photoId: PHOTO_ID, getSourceBuffer })

    expect(out).toEqual(CACHED_BYTES)
    expect(sharpMock).not.toHaveBeenCalled()
    expect(getSourceBuffer).not.toHaveBeenCalled()
    expect(putMock).not.toHaveBeenCalled()
    expect(tryAcquireDistributedLockMock).not.toHaveBeenCalled()
  })
})

describe('first miss — producer', () => {
  it('probes, locks, re-probes, transforms once and persists', async () => {
    headMock
      .mockRejectedValueOnce(new FakeBlobNotFoundError())
      .mockRejectedValueOnce(new FakeBlobNotFoundError())
    tryAcquireDistributedLockMock.mockResolvedValue(ACQUIRED)
    const { getDisplayDerivative } = await loadDisplay()

    const out = await getDisplayDerivative({ photoId: PHOTO_ID, getSourceBuffer })

    expect(out).toEqual(DISPLAY_BYTES)
    expect(getSourceBuffer).toHaveBeenCalledTimes(1)
    expect(toBufferMock).toHaveBeenCalledTimes(1)
    expect(headMock).toHaveBeenCalledTimes(2)
  })

  it('returns the generated buffer directly without re-fetching what it just wrote', async () => {
    derivativeMissing()
    tryAcquireDistributedLockMock.mockResolvedValue(ACQUIRED)
    const { getDisplayDerivative } = await loadDisplay()

    const out = await getDisplayDerivative({ photoId: PHOTO_ID, getSourceBuffer })

    expect(out).toEqual(DISPLAY_BYTES)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('persists with the exact frozen Blob options', async () => {
    derivativeMissing()
    tryAcquireDistributedLockMock.mockResolvedValue(ACQUIRED)
    const { getDisplayDerivative } = await loadDisplay()

    await getDisplayDerivative({ photoId: PHOTO_ID, getSourceBuffer })

    expect(putMock).toHaveBeenCalledWith(DISPLAY_PATH, DISPLAY_BYTES, {
      access: 'public',
      contentType: 'image/jpeg',
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 31_536_000,
    })
  })

  it('acquires the lock with the derivative TTL', async () => {
    derivativeMissing()
    tryAcquireDistributedLockMock.mockResolvedValue(ACQUIRED)
    const { getDisplayDerivative } = await loadDisplay()
    const { LOCK_TTL_SECONDS } = await import('@/lib/server/download-derivative')

    await getDisplayDerivative({ photoId: PHOTO_ID, getSourceBuffer })

    expect(tryAcquireDistributedLockMock).toHaveBeenCalledWith(
      `display-photo-transform:v1:${PHOTO_ID}`,
      LOCK_TTL_SECONDS,
    )
  })

  it('runs the frozen Sharp pipeline in order with explicit parameters', async () => {
    derivativeMissing()
    tryAcquireDistributedLockMock.mockResolvedValue(ACQUIRED)
    const { getDisplayDerivative } = await loadDisplay()

    await getDisplayDerivative({ photoId: PHOTO_ID, getSourceBuffer })

    expect(sharpMock).toHaveBeenCalledWith(SOURCE_BYTES)
    expect(pipeline.rotate).toHaveBeenCalled()
    expect(pipeline.resize).toHaveBeenCalledWith(1600, 1600, { fit: 'inside', withoutEnlargement: true })
    expect(pipeline.flatten).toHaveBeenCalledWith({ background: '#ffffff' })
    expect(pipeline.jpeg).toHaveBeenCalledWith({ quality: 82 })
  })

  it('never passes animated:true — the GIF first-frame contract is deliberate', async () => {
    derivativeMissing()
    tryAcquireDistributedLockMock.mockResolvedValue(ACQUIRED)
    const { getDisplayDerivative } = await loadDisplay()

    await getDisplayDerivative({ photoId: PHOTO_ID, getSourceBuffer })

    for (const call of sharpMock.mock.calls) {
      expect(call[1]?.animated).toBeUndefined()
    }
  })
})

describe('WAITER RULE — a timeout is never permission to transform', () => {
  it('HELD_BY_OTHER never transforms and never fetches the source', async () => {
    derivativeMissing()
    tryAcquireDistributedLockMock.mockResolvedValue(HELD)
    const { getDisplayDerivative } = await loadDisplay()
    const { DerivativePendingError } = await import('@/lib/server/download-derivative')

    let clock = 0
    const promise = getDisplayDerivative({
      photoId: PHOTO_ID,
      getSourceBuffer,
      now: () => {
        const v = clock
        clock += 20_000 // blow past the deadline on the first check
        return v
      },
    })

    await expect(promise).rejects.toBeInstanceOf(DerivativePendingError)
    expect(sharpMock).not.toHaveBeenCalled()
    expect(getSourceBuffer).not.toHaveBeenCalled()
    expect(putMock).not.toHaveBeenCalled()
  })

  it('a waiter that sees the derivative appear serves it without transforming', async () => {
    headMock
      .mockRejectedValueOnce(new FakeBlobNotFoundError())
      .mockResolvedValueOnce({ url: DISPLAY_URL })
    tryAcquireDistributedLockMock.mockResolvedValue(HELD)
    const { getDisplayDerivative } = await loadDisplay()

    const out = await getDisplayDerivative({ photoId: PHOTO_ID, getSourceBuffer })

    expect(out).toEqual(CACHED_BYTES)
    expect(sharpMock).not.toHaveBeenCalled()
    expect(getSourceBuffer).not.toHaveBeenCalled()
  })
})

describe('degraded mode — Redis unavailable', () => {
  it('falls back to local single-flight rather than failing the request', async () => {
    derivativeMissing()
    tryAcquireDistributedLockMock.mockResolvedValue(NO_BACKEND)
    const { getDisplayDerivative } = await loadDisplay()

    const out = await getDisplayDerivative({ photoId: PHOTO_ID, getSourceBuffer })

    expect(out).toEqual(DISPLAY_BYTES)
    expect(toBufferMock).toHaveBeenCalledTimes(1)
  })

  it('dedupes concurrent same-photo requests within one process', async () => {
    derivativeMissing()
    tryAcquireDistributedLockMock.mockResolvedValue(NO_BACKEND)
    const { getDisplayDerivative } = await loadDisplay()

    const results = await Promise.all(
      Array.from({ length: 5 }, () => getDisplayDerivative({ photoId: PHOTO_ID, getSourceBuffer })),
    )

    expect(results.every((r) => r.equals(DISPLAY_BYTES))).toBe(true)
    expect(toBufferMock).toHaveBeenCalledTimes(1)
    expect(putMock).toHaveBeenCalledTimes(1)
  })

  it('the local leader re-probes before spending a transform', async () => {
    headMock
      .mockRejectedValueOnce(new FakeBlobNotFoundError())
      .mockResolvedValueOnce({ url: DISPLAY_URL })
    tryAcquireDistributedLockMock.mockResolvedValue(NO_BACKEND)
    const { getDisplayDerivative } = await loadDisplay()

    const out = await getDisplayDerivative({ photoId: PHOTO_ID, getSourceBuffer })

    expect(out).toEqual(CACHED_BYTES)
    expect(sharpMock).not.toHaveBeenCalled()
    expect(putMock).not.toHaveBeenCalled()
  })
})

describe('single-flight under a healthy lock', () => {
  it('N concurrent first requests produce at most one transform', async () => {
    derivativeMissing()
    let granted = false
    tryAcquireDistributedLockMock.mockImplementation(async () => {
      if (granted) return HELD
      granted = true
      return ACQUIRED
    })
    const { getDisplayDerivative } = await loadDisplay()

    const settled = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        getDisplayDerivative({
          photoId: PHOTO_ID,
          getSourceBuffer,
          now: (() => {
            let c = 0
            return () => (c += 20_000)
          })(),
        }),
      ),
    )

    expect(toBufferMock.mock.calls.length).toBeLessThanOrEqual(1)
    expect(settled.filter((s) => s.status === 'fulfilled').length).toBeGreaterThanOrEqual(1)
  })
})

describe('put race', () => {
  it('accepts the race when a re-probe shows the object now exists', async () => {
    headMock
      .mockRejectedValueOnce(new FakeBlobNotFoundError())
      .mockRejectedValueOnce(new FakeBlobNotFoundError())
      .mockResolvedValueOnce({ url: DISPLAY_URL })
    tryAcquireDistributedLockMock.mockResolvedValue(ACQUIRED)
    putMock.mockRejectedValue(new Error('blob already exists'))
    const { getDisplayDerivative } = await loadDisplay()

    const out = await getDisplayDerivative({ photoId: PHOTO_ID, getSourceBuffer })

    expect(out).toEqual(DISPLAY_BYTES)
  })

  it('rethrows the ORIGINAL put error when the object still does not exist', async () => {
    derivativeMissing()
    tryAcquireDistributedLockMock.mockResolvedValue(ACQUIRED)
    const putError = new Error('disk on fire')
    putMock.mockRejectedValue(putError)
    const { getDisplayDerivative } = await loadDisplay()

    await expect(getDisplayDerivative({ photoId: PHOTO_ID, getSourceBuffer })).rejects.toBe(putError)
  })

  it('rethrows the ORIGINAL put error when the re-probe itself fails', async () => {
    headMock
      .mockRejectedValueOnce(new FakeBlobNotFoundError())
      .mockRejectedValueOnce(new FakeBlobNotFoundError())
      .mockRejectedValueOnce(new Error('head exploded'))
    tryAcquireDistributedLockMock.mockResolvedValue(ACQUIRED)
    const putError = new Error('original put failure')
    putMock.mockRejectedValue(putError)
    const { getDisplayDerivative } = await loadDisplay()

    await expect(getDisplayDerivative({ photoId: PHOTO_ID, getSourceBuffer })).rejects.toBe(putError)
  })

  it('resolves the race by re-probing, never by matching an error message', async () => {
    headMock
      .mockRejectedValueOnce(new FakeBlobNotFoundError())
      .mockRejectedValueOnce(new FakeBlobNotFoundError())
      .mockResolvedValueOnce({ url: DISPLAY_URL })
    tryAcquireDistributedLockMock.mockResolvedValue(ACQUIRED)
    putMock.mockRejectedValue(new Error('totally unrelated wording'))
    const { getDisplayDerivative } = await loadDisplay()

    await expect(getDisplayDerivative({ photoId: PHOTO_ID, getSourceBuffer })).resolves.toEqual(DISPLAY_BYTES)
  })
})

describe('storage-error semantics', () => {
  it('a non-BlobNotFound head error is a storage failure, never a cache miss', async () => {
    headMock.mockRejectedValue(new Error('service unavailable'))
    const { getDisplayDerivative } = await loadDisplay()
    const { DerivativeStorageUnavailableError } = await import('@/lib/server/download-derivative')

    await expect(getDisplayDerivative({ photoId: PHOTO_ID, getSourceBuffer })).rejects.toBeInstanceOf(
      DerivativeStorageUnavailableError,
    )
    expect(sharpMock).not.toHaveBeenCalled()
    expect(getSourceBuffer).not.toHaveBeenCalled()
  })

  it('a failed read of a confirmed-existing object is a storage failure, not a miss', async () => {
    derivativeExists()
    fetchMock.mockResolvedValue({ ok: false, status: 500 })
    const { getDisplayDerivative } = await loadDisplay()
    const { DerivativeStorageUnavailableError } = await import('@/lib/server/download-derivative')

    await expect(getDisplayDerivative({ photoId: PHOTO_ID, getSourceBuffer })).rejects.toBeInstanceOf(
      DerivativeStorageUnavailableError,
    )
    expect(sharpMock).not.toHaveBeenCalled()
  })
})

// ─── ensureDisplayDerivative — STEP 7.15e ────────────────────────────────
//
// Shares the exact same probe/lock/waiter/single-flight/produce/put-race
// orchestration as getDisplayDerivative above (same mocks, same module) —
// the only thing under test here is the return-shape/no-bytes contract.

describe('ensure mode — cache HIT (merge-blocking: §36)', () => {
  it('returns created:false with ZERO byte fetch, ZERO source fetch, ZERO transform, ZERO put', async () => {
    derivativeExists()
    const { ensureDisplayDerivative } = await loadDisplay()

    const result = await ensureDisplayDerivative({ photoId: PHOTO_ID, getSourceBuffer })

    expect(result).toEqual({ created: false })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getSourceBuffer).not.toHaveBeenCalled()
    expect(sharpMock).not.toHaveBeenCalled()
    expect(putMock).not.toHaveBeenCalled()
    expect(headMock).toHaveBeenCalledTimes(1)
  })
})

describe('ensure mode — miss, acquired (§37)', () => {
  it('re-probes, fetches source once, transforms once, puts once, returns created:true', async () => {
    headMock
      .mockRejectedValueOnce(new FakeBlobNotFoundError())
      .mockRejectedValueOnce(new FakeBlobNotFoundError())
    tryAcquireDistributedLockMock.mockResolvedValue(ACQUIRED)
    const { ensureDisplayDerivative } = await loadDisplay()

    const result = await ensureDisplayDerivative({ photoId: PHOTO_ID, getSourceBuffer })

    expect(result).toEqual({ created: true })
    expect(getSourceBuffer).toHaveBeenCalledTimes(1)
    expect(toBufferMock).toHaveBeenCalledTimes(1)
    expect(putMock).toHaveBeenCalledWith(DISPLAY_PATH, DISPLAY_BYTES, {
      access: 'public',
      contentType: 'image/jpeg',
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 31_536_000,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a derivative that appears between probe and lock returns created:false, never transforms', async () => {
    headMock
      .mockRejectedValueOnce(new FakeBlobNotFoundError())
      .mockResolvedValueOnce({ url: DISPLAY_URL })
    tryAcquireDistributedLockMock.mockResolvedValue(ACQUIRED)
    const { ensureDisplayDerivative } = await loadDisplay()

    const result = await ensureDisplayDerivative({ photoId: PHOTO_ID, getSourceBuffer })

    expect(result).toEqual({ created: false })
    expect(sharpMock).not.toHaveBeenCalled()
    expect(getSourceBuffer).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('ensure mode — healthy concurrency (§38)', () => {
  it('N concurrent same-photo ensures on first miss produce at most one transform', async () => {
    derivativeMissing()
    let granted = false
    tryAcquireDistributedLockMock.mockImplementation(async () => {
      if (granted) return HELD
      granted = true
      return ACQUIRED
    })
    const { ensureDisplayDerivative } = await loadDisplay()

    const settled = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        ensureDisplayDerivative({
          photoId: PHOTO_ID,
          getSourceBuffer,
          now: (() => {
            let c = 0
            return () => (c += 20_000)
          })(),
        }),
      ),
    )

    expect(toBufferMock.mock.calls.length).toBeLessThanOrEqual(1)
    expect(settled.filter((s) => s.status === 'fulfilled').length).toBeGreaterThanOrEqual(1)
  })
})

describe('ensure mode — Redis outage (§39)', () => {
  it('falls back to local single-flight: one transform, one put, across concurrent ensures', async () => {
    derivativeMissing()
    tryAcquireDistributedLockMock.mockResolvedValue(NO_BACKEND)
    const { ensureDisplayDerivative } = await loadDisplay()

    const results = await Promise.all(
      Array.from({ length: 5 }, () => ensureDisplayDerivative({ photoId: PHOTO_ID, getSourceBuffer })),
    )

    expect(results.every((r) => r.created === true)).toBe(true)
    expect(toBufferMock).toHaveBeenCalledTimes(1)
    expect(putMock).toHaveBeenCalledTimes(1)
  })
})

describe('ensure mode — waiter (§40)', () => {
  it('HELD_BY_OTHER never transforms; created:false once the derivative appears', async () => {
    headMock
      .mockRejectedValueOnce(new FakeBlobNotFoundError())
      .mockResolvedValueOnce({ url: DISPLAY_URL })
    tryAcquireDistributedLockMock.mockResolvedValue(HELD)
    const { ensureDisplayDerivative } = await loadDisplay()

    const result = await ensureDisplayDerivative({ photoId: PHOTO_ID, getSourceBuffer })

    expect(result).toEqual({ created: false })
    expect(sharpMock).not.toHaveBeenCalled()
    expect(getSourceBuffer).not.toHaveBeenCalled()
  })

  it('reaching the deadline yields DerivativePendingError, never transforms', async () => {
    derivativeMissing()
    tryAcquireDistributedLockMock.mockResolvedValue(HELD)
    const { ensureDisplayDerivative } = await loadDisplay()
    const { DerivativePendingError } = await import('@/lib/server/download-derivative')

    let clock = 0
    const promise = ensureDisplayDerivative({
      photoId: PHOTO_ID,
      getSourceBuffer,
      now: () => {
        const v = clock
        clock += 20_000
        return v
      },
    })

    await expect(promise).rejects.toBeInstanceOf(DerivativePendingError)
    expect(sharpMock).not.toHaveBeenCalled()
    expect(getSourceBuffer).not.toHaveBeenCalled()
    expect(putMock).not.toHaveBeenCalled()
  })
})

describe('ensure mode — storage failure (§41)', () => {
  it('a non-BlobNotFound head error is a storage failure, never a transform', async () => {
    headMock.mockRejectedValue(new Error('service unavailable'))
    const { ensureDisplayDerivative } = await loadDisplay()
    const { DerivativeStorageUnavailableError } = await import('@/lib/server/download-derivative')

    await expect(ensureDisplayDerivative({ photoId: PHOTO_ID, getSourceBuffer })).rejects.toBeInstanceOf(
      DerivativeStorageUnavailableError,
    )
    expect(sharpMock).not.toHaveBeenCalled()
    expect(getSourceBuffer).not.toHaveBeenCalled()
  })
})

describe('ensure mode — put race (§42)', () => {
  it('a raced put (object now exists) is NOT counted as created by this call', async () => {
    headMock
      .mockRejectedValueOnce(new FakeBlobNotFoundError())
      .mockRejectedValueOnce(new FakeBlobNotFoundError())
      .mockResolvedValueOnce({ url: DISPLAY_URL })
    tryAcquireDistributedLockMock.mockResolvedValue(ACQUIRED)
    putMock.mockRejectedValue(new Error('blob already exists'))
    const { ensureDisplayDerivative } = await loadDisplay()

    const result = await ensureDisplayDerivative({ photoId: PHOTO_ID, getSourceBuffer })

    expect(result).toEqual({ created: false })
  })

  it('a put failure with the object genuinely absent propagates the ORIGINAL put error', async () => {
    derivativeMissing()
    tryAcquireDistributedLockMock.mockResolvedValue(ACQUIRED)
    const putError = new Error('disk on fire')
    putMock.mockRejectedValue(putError)
    const { ensureDisplayDerivative } = await loadDisplay()

    await expect(ensureDisplayDerivative({ photoId: PHOTO_ID, getSourceBuffer })).rejects.toBe(putError)
  })
})

describe('dormancy — STEP 7.15e narrows this to "no browser/public-response wiring yet"', () => {
  // STEP 7.15d narrowed this from "nothing may import the module" to "nothing
  // may GENERATE". STEP 7.15e narrows it again, deliberately: generation
  // callers are now allowed — the catch-all route's upload-completion and
  // moderation handlers, both reviewed in this STEP — because this STEP's
  // whole point is eager generation. What must STILL be false is any
  // browser/public-response wiring: no displayUrl field, no public URL
  // derivation, no Guest DTO/client/OG/room-grid/lightbox consumer of
  // display-v1. That stays false until GUEST_DISPLAY_CUTOVER. This is a
  // precise monetization invariant, not a caller-count invariant — the old
  // "zero callers" version would have made this STEP impossible to land
  // without weakening the test, which is exactly the kind of casual
  // weakening that must not happen silently.
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
  const isCatchAllRoute = (path) => path.endsWith('/api/[[...path]]/route.js')

  it('generation is called ONLY from display-derivative.js and the reviewed catch-all route', async () => {
    const offenders = (await productSources())
      .filter(({ path }) => !path.endsWith('display-derivative.js') && !isCatchAllRoute(path))
      .filter(({ src }) => /getDisplayDerivative\s*\(|transformDisplayImage\s*\(|ensureDisplayDerivative\s*\(/.test(src))
      .map(({ path }) => path)

    expect(offenders).toEqual([])
  })

  it('the catch-all route calls ONLY ensureDisplayDerivative — never the byte-returning primitive', async () => {
    const [route] = (await productSources()).filter(({ path }) => isCatchAllRoute(path))

    expect(route.src).not.toMatch(/getDisplayDerivative\s*\(/)
    expect(route.src).not.toMatch(/transformDisplayImage\s*\(/)
    expect(route.src).toMatch(/ensureDisplayDerivative\s*\(/)
  })

  it('the only product importers are derivative-cleanup.js (path builder only) and the catch-all route (ensure only)', async () => {
    const importers = (await productSources())
      .filter(({ path }) => !path.endsWith('display-derivative.js'))
      .filter(({ src }) => /display-derivative/.test(src))

    expect(importers.map(({ path }) => path.split('/').pop()).sort()).toEqual(['derivative-cleanup.js', 'route.js'])

    const cleanup = importers.find(({ path }) => path.endsWith('derivative-cleanup.js'))
    const cleanupSpecifiers = /import\s*\{([^}]*)\}\s*from\s*'@\/lib\/server\/display-derivative'/.exec(cleanup.src)[1]
    expect(cleanupSpecifiers.split(',').map((s) => s.trim()).filter(Boolean)).toEqual(['buildDisplayDerivativePath'])

    const route = importers.find(({ path }) => isCatchAllRoute(path))
    const routeSpecifiers = /import\s*\{([^}]*)\}\s*from\s*'@\/lib\/server\/display-derivative'/.exec(route.src)[1]
    expect(routeSpecifiers.split(',').map((s) => s.trim()).filter(Boolean)).toEqual(['ensureDisplayDerivative'])
  })

  it('does not derive a public URL — that belongs to the DTO cutover step', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const src = readFileSync(resolve(import.meta.dirname, '..', 'lib/server/display-derivative.js'), 'utf8')

    expect(src).not.toContain('constructBlobUrl')
    expect(src).not.toContain('parseStoreIdFromReadWriteToken')
    expect(src).not.toContain('blob.vercel-storage.com')
    expect(src).not.toContain('displayUrl')
  })

  it('no product source has a displayUrl field, public URL construction, or Guest/OG/room-grid consumer of display-v1', async () => {
    const offenders = (await productSources())
      .filter(({ src }) => /displayUrl/.test(src))
      .map(({ path }) => path)

    expect(offenders).toEqual([])
  })
})
