import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// STEP 7.14b — branded derivative cache + distributed transform
// single-flight.
//
// The load-bearing invariant, asserted repeatedly below, is that while Redis
// is reachable a request may run Sharp ONLY if it acquired the distributed
// lock. A waiter reaching its deadline must return 503 rather than
// transform — that is exactly the stampede the previous design recreated.

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

const applyWatermarkMock = vi.fn()

// vi.mock is hoisted, so this factory must be inline. beforeEach then pins
// the version explicitly via doMock so a version-swapping test cannot leak.
vi.mock('@/lib/server/watermark', () => ({
  WATERMARK_DERIVATIVE_VERSION: 'v1',
  BRANDED_DOWNLOAD_WATERMARK_OPTIONS: Object.freeze({
    outputFormat: 'jpeg',
    jpegQuality: 85,
    flattenBackground: '#ffffff',
    autoOrient: true,
  }),
  applyWatermark: (...args) => applyWatermarkMock(...args),
}))

const watermarkModuleFactory = (version) => () => ({
  WATERMARK_DERIVATIVE_VERSION: version,
  BRANDED_DOWNLOAD_WATERMARK_OPTIONS: Object.freeze({
    outputFormat: 'jpeg',
    jpegQuality: 85,
    flattenBackground: '#ffffff',
    autoOrient: true,
  }),
  applyWatermark: (...args) => applyWatermarkMock(...args),
})

/**
 * Re-register the watermark module at a specific version. beforeEach pins
 * 'v1' so a test that swaps the version cannot leak into later tests.
 */
function mockWatermarkVersion(version) {
  vi.doMock('@/lib/server/watermark', watermarkModuleFactory(version))
}

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
const DERIVATIVE_PATH = 'derivatives/wm-v1/photo-uuid-1.jpg'
const DERIVATIVE_URL = 'https://store.public.blob.vercel-storage.com/derivatives/wm-v1/photo-uuid-1.jpg'
const SOURCE_BYTES = Buffer.from('source-image-bytes')
const JPEG_BYTES = Buffer.from('branded-jpeg-bytes')
const CACHED_BYTES = Buffer.from('cached-derivative-bytes')

function derivativeExists() {
  headMock.mockResolvedValue({ url: DERIVATIVE_URL, size: CACHED_BYTES.length })
}
function derivativeMissing() {
  headMock.mockRejectedValue(new FakeBlobNotFoundError())
}
function cachedFetchOk(bytes = CACHED_BYTES) {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  })
}

let getSourceBuffer

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mockWatermarkVersion('v1')
  applyWatermarkMock.mockResolvedValue(JPEG_BYTES)
  putMock.mockResolvedValue({ url: DERIVATIVE_URL, pathname: DERIVATIVE_PATH })
  getSourceBuffer = vi.fn().mockResolvedValue(SOURCE_BYTES)
  cachedFetchOk()
})

afterEach(() => {
  vi.useRealTimers()
})

async function loadModule() {
  const mod = await import('@/lib/server/download-derivative')
  mod.__resetLocalSingleFlight()
  return mod
}

describe('identity: path and lock key', () => {
  it('derivative path is deterministic, version-scoped, and uses only the opaque photo id', async () => {
    const { buildDerivativePath } = await loadModule()
    expect(buildDerivativePath(PHOTO_ID)).toBe(DERIVATIVE_PATH)
  })

  it('lock key is version-scoped and carries no pathname or filename', async () => {
    const { buildTransformLockKey } = await loadModule()
    const key = buildTransformLockKey(PHOTO_ID)

    expect(key).toBe(`download-photo-transform:v1:${PHOTO_ID}`)
    expect(key).not.toContain('/')
    expect(key).not.toContain('.jpg')
  })

  it('a watermark version change moves BOTH the derivative path and the lock key', async () => {
    mockWatermarkVersion('v2')
    const mod = await import('@/lib/server/download-derivative')

    expect(mod.buildDerivativePath(PHOTO_ID)).toBe(`derivatives/wm-v2/${PHOTO_ID}.jpg`)
    expect(mod.buildTransformLockKey(PHOTO_ID)).toBe(`download-photo-transform:v2:${PHOTO_ID}`)
  })

  it('freezes the timing policy derived in STEP 7.14b.0', async () => {
    const mod = await loadModule()
    expect(mod.LOCK_TTL_SECONDS).toBe(25)
    expect(mod.WAITER_DEADLINE_MS).toBe(10_000)
    expect(mod.WAITER_POLL_INTERVAL_MS).toBe(500)
    expect(mod.DERIVATIVE_CACHE_CONTROL_MAX_AGE).toBe(31_536_000)
  })
})

describe('cache HIT', () => {
  it('serves the stored derivative with zero Sharp, zero source fetch, zero put, zero lock', async () => {
    derivativeExists()
    const { getBrandedDerivative } = await loadModule()

    const result = await getBrandedDerivative({ photoId: PHOTO_ID, getSourceBuffer })

    expect(Buffer.compare(result, CACHED_BYTES)).toBe(0)
    expect(applyWatermarkMock).not.toHaveBeenCalled()
    expect(getSourceBuffer).not.toHaveBeenCalled()
    expect(putMock).not.toHaveBeenCalled()
    expect(tryAcquireDistributedLockMock).not.toHaveBeenCalled()
    expect(headMock).toHaveBeenCalledTimes(1)
  })
})

describe('first MISS — winner path', () => {
  it('re-checks after acquiring, transforms once, persists once, and returns the GENERATED buffer', async () => {
    derivativeMissing()
    tryAcquireDistributedLockMock.mockResolvedValue({ outcome: 'ACQUIRED' })
    const { getBrandedDerivative } = await loadModule()

    const result = await getBrandedDerivative({ photoId: PHOTO_ID, getSourceBuffer })

    expect(headMock).toHaveBeenCalledTimes(2) // initial probe + post-lock recheck
    expect(getSourceBuffer).toHaveBeenCalledTimes(1)
    expect(applyWatermarkMock).toHaveBeenCalledTimes(1)
    expect(putMock).toHaveBeenCalledTimes(1)
    // The freshly generated buffer is returned directly — no wasteful refetch.
    expect(Buffer.compare(result, JPEG_BYTES)).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('persists with the exact frozen Blob options', async () => {
    derivativeMissing()
    tryAcquireDistributedLockMock.mockResolvedValue({ outcome: 'ACQUIRED' })
    const { getBrandedDerivative } = await loadModule()

    await getBrandedDerivative({ photoId: PHOTO_ID, getSourceBuffer })

    expect(putMock).toHaveBeenCalledWith(DERIVATIVE_PATH, JPEG_BYTES, {
      access: 'public',
      contentType: 'image/jpeg',
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 31_536_000,
    })
  })

  it('acquires the lock with the 25s TTL', async () => {
    derivativeMissing()
    tryAcquireDistributedLockMock.mockResolvedValue({ outcome: 'ACQUIRED' })
    const { getBrandedDerivative, buildTransformLockKey } = await loadModule()

    await getBrandedDerivative({ photoId: PHOTO_ID, getSourceBuffer })

    expect(tryAcquireDistributedLockMock).toHaveBeenCalledWith(buildTransformLockKey(PHOTO_ID), 25)
  })

  it('serves the cached object instead of transforming when it appeared between probe and lock', async () => {
    headMock
      .mockRejectedValueOnce(new FakeBlobNotFoundError())
      .mockResolvedValueOnce({ url: DERIVATIVE_URL })
    tryAcquireDistributedLockMock.mockResolvedValue({ outcome: 'ACQUIRED' })
    const { getBrandedDerivative } = await loadModule()

    const result = await getBrandedDerivative({ photoId: PHOTO_ID, getSourceBuffer })

    expect(applyWatermarkMock).not.toHaveBeenCalled()
    expect(getSourceBuffer).not.toHaveBeenCalled()
    expect(Buffer.compare(result, CACHED_BYTES)).toBe(0)
  })
})

describe('N concurrent first misses — exactly one transform', () => {
  it('only the ACQUIRED caller transforms; the others serve the published derivative', async () => {
    let stored = false
    headMock.mockImplementation(async () => {
      if (!stored) throw new FakeBlobNotFoundError()
      return { url: DERIVATIVE_URL }
    })
    let granted = false
    tryAcquireDistributedLockMock.mockImplementation(async () => {
      if (granted) return { outcome: 'HELD_BY_OTHER' }
      granted = true
      return { outcome: 'ACQUIRED' }
    })
    putMock.mockImplementation(async () => { stored = true; return { url: DERIVATIVE_URL } })

    const { getBrandedDerivative } = await loadModule()
    const results = await Promise.all(
      Array.from({ length: 8 }, () => getBrandedDerivative({ photoId: PHOTO_ID, getSourceBuffer }))
    )

    expect(applyWatermarkMock).toHaveBeenCalledTimes(1)
    expect(getSourceBuffer).toHaveBeenCalledTimes(1)
    expect(putMock).toHaveBeenCalledTimes(1)
    expect(results).toHaveLength(8)
  })
})

describe('waiter — never transforms without the lock', () => {
  it('polls while the lock is held and returns the derivative once it is published', async () => {
    let stored = false
    headMock.mockImplementation(async () => {
      if (!stored) throw new FakeBlobNotFoundError()
      return { url: DERIVATIVE_URL }
    })
    tryAcquireDistributedLockMock.mockResolvedValue({ outcome: 'HELD_BY_OTHER' })

    const { getBrandedDerivative } = await loadModule()
    const pending = getBrandedDerivative({ photoId: PHOTO_ID, getSourceBuffer })

    // Simulate the real winner publishing shortly after.
    await Promise.resolve()
    stored = true

    const result = await pending

    expect(applyWatermarkMock).not.toHaveBeenCalled()
    expect(getSourceBuffer).not.toHaveBeenCalled()
    expect(Buffer.compare(result, CACHED_BYTES)).toBe(0)
  })

  it('reaching the deadline yields DerivativePendingError and still runs ZERO Sharp', async () => {
    derivativeMissing()
    tryAcquireDistributedLockMock.mockResolvedValue({ outcome: 'HELD_BY_OTHER' })

    const { getBrandedDerivative, DerivativePendingError, WAITER_DEADLINE_MS } = await loadModule()

    // Injected clock: jump past the deadline instead of waiting 10 real seconds.
    let t = 0
    const now = () => {
      t += WAITER_DEADLINE_MS + 1
      return t
    }

    await expect(
      getBrandedDerivative({ photoId: PHOTO_ID, getSourceBuffer, now })
    ).rejects.toBeInstanceOf(DerivativePendingError)

    expect(applyWatermarkMock).not.toHaveBeenCalled()
    expect(getSourceBuffer).not.toHaveBeenCalled()
    expect(putMock).not.toHaveBeenCalled()
  })

  it('a slow-but-healthy winner never causes a duplicate transform, however long the waiter polls', async () => {
    let stored = false
    headMock.mockImplementation(async () => {
      if (!stored) throw new FakeBlobNotFoundError()
      return { url: DERIVATIVE_URL }
    })
    tryAcquireDistributedLockMock.mockResolvedValue({ outcome: 'HELD_BY_OTHER' })

    const { getBrandedDerivative } = await loadModule()
    const pending = getBrandedDerivative({ photoId: PHOTO_ID, getSourceBuffer })

    // Several poll cycles elapse before the winner publishes.
    for (let i = 0; i < 5; i++) await Promise.resolve()
    stored = true
    await pending

    expect(applyWatermarkMock).not.toHaveBeenCalled()
  })
})

describe('lock expiry reacquisition', () => {
  it('after the holder disappears, exactly one contender acquires and produces', async () => {
    derivativeMissing()
    let attempts = 0
    tryAcquireDistributedLockMock.mockImplementation(async () => {
      attempts += 1
      // Held for the first two attempts, then the TTL lapses.
      return attempts <= 2 ? { outcome: 'HELD_BY_OTHER' } : { outcome: 'ACQUIRED' }
    })

    const { getBrandedDerivative } = await loadModule()
    const result = await getBrandedDerivative({ photoId: PHOTO_ID, getSourceBuffer })

    expect(attempts).toBe(3)
    expect(applyWatermarkMock).toHaveBeenCalledTimes(1)
    expect(Buffer.compare(result, JPEG_BYTES)).toBe(0)
  })
})

describe('put race', () => {
  it('a put failure whose object now exists is treated as a won race, with no message matching', async () => {
    let stored = false
    headMock.mockImplementation(async () => {
      if (!stored) throw new FakeBlobNotFoundError()
      return { url: DERIVATIVE_URL }
    })
    tryAcquireDistributedLockMock.mockResolvedValue({ outcome: 'ACQUIRED' })
    putMock.mockImplementation(async () => {
      stored = true // a concurrent producer stored it first
      throw new Error('some opaque blob failure')
    })

    const { getBrandedDerivative } = await loadModule()
    const result = await getBrandedDerivative({ photoId: PHOTO_ID, getSourceBuffer })

    // We still own a correct deterministic buffer, so we return it.
    expect(Buffer.compare(result, JPEG_BYTES)).toBe(0)
    expect(applyWatermarkMock).toHaveBeenCalledTimes(1)
  })

  it('a put failure with the object genuinely absent propagates the ORIGINAL put error', async () => {
    derivativeMissing()
    tryAcquireDistributedLockMock.mockResolvedValue({ outcome: 'ACQUIRED' })
    const putError = new Error('genuine put failure')
    putMock.mockRejectedValue(putError)

    const { getBrandedDerivative } = await loadModule()

    await expect(getBrandedDerivative({ photoId: PHOTO_ID, getSourceBuffer })).rejects.toThrow('genuine put failure')
  })

  it('a put failure whose existence re-probe also fails propagates the original put error', async () => {
    headMock
      .mockRejectedValueOnce(new FakeBlobNotFoundError())
      .mockRejectedValueOnce(new FakeBlobNotFoundError())
      .mockRejectedValueOnce(new Error('blob service down'))
    tryAcquireDistributedLockMock.mockResolvedValue({ outcome: 'ACQUIRED' })
    putMock.mockRejectedValue(new Error('genuine put failure'))

    const { getBrandedDerivative } = await loadModule()

    await expect(getBrandedDerivative({ photoId: PHOTO_ID, getSourceBuffer })).rejects.toThrow('genuine put failure')
  })
})

describe('storage errors never degrade into a transform', () => {
  it('a non-BlobNotFound head error raises storage-unavailable and runs zero Sharp', async () => {
    headMock.mockRejectedValue(new Error('blob service unavailable'))
    const { getBrandedDerivative, DerivativeStorageUnavailableError } = await loadModule()

    await expect(
      getBrandedDerivative({ photoId: PHOTO_ID, getSourceBuffer })
    ).rejects.toBeInstanceOf(DerivativeStorageUnavailableError)

    expect(applyWatermarkMock).not.toHaveBeenCalled()
    expect(getSourceBuffer).not.toHaveBeenCalled()
    expect(tryAcquireDistributedLockMock).not.toHaveBeenCalled()
  })

  it('a confirmed-existing derivative that fails to download raises storage-unavailable, not a miss', async () => {
    derivativeExists()
    fetchMock.mockRejectedValue(new Error('network reset'))
    const { getBrandedDerivative, DerivativeStorageUnavailableError } = await loadModule()

    await expect(
      getBrandedDerivative({ photoId: PHOTO_ID, getSourceBuffer })
    ).rejects.toBeInstanceOf(DerivativeStorageUnavailableError)

    expect(applyWatermarkMock).not.toHaveBeenCalled()
    expect(getSourceBuffer).not.toHaveBeenCalled()
  })

  it('a non-OK derivative download raises storage-unavailable, not a miss', async () => {
    derivativeExists()
    fetchMock.mockResolvedValue({ ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) })
    const { getBrandedDerivative, DerivativeStorageUnavailableError } = await loadModule()

    await expect(
      getBrandedDerivative({ photoId: PHOTO_ID, getSourceBuffer })
    ).rejects.toBeInstanceOf(DerivativeStorageUnavailableError)

    expect(applyWatermarkMock).not.toHaveBeenCalled()
  })
})

describe('degraded mode — Redis unavailable', () => {
  it('N same-instance concurrent misses share one local producer: one Sharp, one put', async () => {
    derivativeMissing()
    tryAcquireDistributedLockMock.mockResolvedValue({ outcome: 'BACKEND_UNAVAILABLE' })

    const { getBrandedDerivative } = await loadModule()
    const results = await Promise.all(
      Array.from({ length: 6 }, () => getBrandedDerivative({ photoId: PHOTO_ID, getSourceBuffer }))
    )

    expect(applyWatermarkMock).toHaveBeenCalledTimes(1)
    expect(getSourceBuffer).toHaveBeenCalledTimes(1)
    expect(putMock).toHaveBeenCalledTimes(1)
    for (const r of results) expect(Buffer.compare(r, JPEG_BYTES)).toBe(0)
  })

  it('still persists the derivative so other instances become cache hits while Redis is down', async () => {
    derivativeMissing()
    tryAcquireDistributedLockMock.mockResolvedValue({ outcome: 'BACKEND_UNAVAILABLE' })
    const { getBrandedDerivative } = await loadModule()

    await getBrandedDerivative({ photoId: PHOTO_ID, getSourceBuffer })

    expect(putMock).toHaveBeenCalledTimes(1)
  })

  it('the local leader re-probes and serves a derivative another instance published (zero transform)', async () => {
    // Initial probe misses; by the time the leader runs, the object exists.
    let calls = 0
    headMock.mockImplementation(async () => {
      calls += 1
      if (calls === 1) throw new FakeBlobNotFoundError()
      return { url: DERIVATIVE_URL }
    })
    tryAcquireDistributedLockMock.mockResolvedValue({ outcome: 'BACKEND_UNAVAILABLE' })

    const { getBrandedDerivative } = await loadModule()
    const result = await getBrandedDerivative({ photoId: PHOTO_ID, getSourceBuffer })

    expect(applyWatermarkMock).not.toHaveBeenCalled()
    expect(getSourceBuffer).not.toHaveBeenCalled()
    expect(putMock).not.toHaveBeenCalled()
    expect(Buffer.compare(result, CACHED_BYTES)).toBe(0)
  })

  it('a failed local producer rejects all current waiters and leaves no stale entry', async () => {
    derivativeMissing()
    tryAcquireDistributedLockMock.mockResolvedValue({ outcome: 'BACKEND_UNAVAILABLE' })
    applyWatermarkMock.mockRejectedValueOnce(new Error('sharp exploded'))

    const { getBrandedDerivative, __getLocalSingleFlightSize } = await loadModule()

    const settled = await Promise.allSettled([
      getBrandedDerivative({ photoId: PHOTO_ID, getSourceBuffer }),
      getBrandedDerivative({ photoId: PHOTO_ID, getSourceBuffer }),
    ])

    expect(settled.every((s) => s.status === 'rejected')).toBe(true)
    expect(__getLocalSingleFlightSize()).toBe(0)

    // A later request can become a fresh leader — no poisoned promise.
    applyWatermarkMock.mockResolvedValue(JPEG_BYTES)
    const retry = await getBrandedDerivative({ photoId: PHOTO_ID, getSourceBuffer })
    expect(Buffer.compare(retry, JPEG_BYTES)).toBe(0)
  })

  it('never surfaces a failure merely because Redis is unavailable', async () => {
    derivativeMissing()
    tryAcquireDistributedLockMock.mockResolvedValue({ outcome: 'BACKEND_UNAVAILABLE' })
    const { getBrandedDerivative } = await loadModule()

    await expect(getBrandedDerivative({ photoId: PHOTO_ID, getSourceBuffer })).resolves.toBeInstanceOf(Buffer)
  })
})
