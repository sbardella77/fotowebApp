import { describe, it, expect, vi } from 'vitest'

// STEP 7.14b — watermark-version identity, split out of
// download-photo-derivative.test.js (CI-GOV-012B).
//
// The version-swap assertion previously lived inside the main derivative
// test file and swapped the mocked '@/lib/server/watermark' module mid-file
// via vi.resetModules() + vi.doMock() + a dynamic import(), so that one test
// could see a different WATERMARK_DERIVATIVE_VERSION than every other test
// in that file (which is pinned to 'v1' in beforeEach). That pattern
// recurred as a flake in CI (identical symptom, 7 occurrences) even after an
// earlier attempt (commit a2f8e53, PR #52) added an extra resetModules()
// call — the mid-file mock swap itself, not a missing reset, was the root
// cause (CI-GOV-012A).
//
// This file never swaps anything: it is its own Vitest worker with its own
// module registry from process start, and it mocks '@/lib/server/watermark'
// to 'v2' exactly once, statically, before any import. There is no shared
// mutable mock state for a scheduling race to ever expose.

vi.mock('@vercel/blob', () => ({
  head: vi.fn(),
  put: vi.fn(),
  BlobNotFoundError: class FakeBlobNotFoundError extends Error {},
}))

vi.mock('@/lib/server/rate-limiter', () => ({
  tryAcquireDistributedLock: vi.fn(),
  DISTRIBUTED_LOCK_OUTCOME: {
    ACQUIRED: 'ACQUIRED',
    HELD_BY_OTHER: 'HELD_BY_OTHER',
    BACKEND_UNAVAILABLE: 'BACKEND_UNAVAILABLE',
  },
}))

vi.mock('@/lib/server/watermark', () => ({
  WATERMARK_DERIVATIVE_VERSION: 'v2',
  BRANDED_DOWNLOAD_WATERMARK_OPTIONS: Object.freeze({
    outputFormat: 'jpeg',
    jpegQuality: 85,
    flattenBackground: '#ffffff',
    autoOrient: true,
  }),
  applyWatermark: vi.fn(),
}))

const PHOTO_ID = 'photo-uuid-1'

describe('identity: path and lock key — watermark version change', () => {
  it('a watermark version change moves BOTH the derivative path and the lock key', async () => {
    const { buildDerivativePath, buildTransformLockKey } = await import('@/lib/server/download-derivative')

    expect(buildDerivativePath(PHOTO_ID)).toBe(`derivatives/wm-v2/${PHOTO_ID}.jpg`)
    expect(buildTransformLockKey(PHOTO_ID)).toBe(`download-photo-transform:v2:${PHOTO_ID}`)
  })
})
