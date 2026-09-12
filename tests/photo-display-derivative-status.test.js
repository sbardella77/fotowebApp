import { describe, it, expect, vi, beforeEach } from 'vitest'

// TASK-03 (Phase 1A) — direct unit coverage for the shared status-recording
// logic extracted from app/api/[[...path]]/route.js's original inline
// ensurePhotoDisplayDerivative. route.js's own wrapper is proven to
// delegate here unchanged in tests/display-derivative-status-model.test.js
// and exercised end-to-end (unchanged behavior) in
// tests/photo-display-generation.test.js and
// tests/photo-derivative-lifecycle.test.js — this file is the one place
// that tests the extracted function directly, in isolation.

vi.mock('@/lib/server/display-derivative', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, ensureDisplayDerivative: vi.fn() }
})

vi.mock('@/lib/server/download-utils', () => ({
  getPhotoBuffer: vi.fn(),
}))

import { ensureDisplayDerivative } from '@/lib/server/display-derivative'
import { getPhotoBuffer } from '@/lib/server/download-utils'
import { ensurePhotoDisplayDerivativeStatus } from '@/lib/server/photo-display-derivative-status'

const PHOTO = { id: 'photo-1', url: 'https://store.public.blob.vercel-storage.com/events/e/photo-1.jpg' }

function makeFakePrisma() {
  return {
    photo: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  getPhotoBuffer.mockResolvedValue(Buffer.from('source-bytes'))
})

describe('success path', () => {
  it('records READY and returns {created, status: READY}', async () => {
    ensureDisplayDerivative.mockResolvedValue({ created: true })
    const prisma = makeFakePrisma()

    const result = await ensurePhotoDisplayDerivativeStatus({ prisma, photo: PHOTO, operation: 'test' })

    expect(result).toEqual({ created: true, status: 'READY' })
    expect(prisma.photo.updateMany).toHaveBeenCalledWith({
      where: { id: PHOTO.id },
      data: { displayDerivativeStatus: 'READY' },
    })
  })

  it('a cache HIT (created: false) still records READY', async () => {
    ensureDisplayDerivative.mockResolvedValue({ created: false })
    const prisma = makeFakePrisma()

    const result = await ensurePhotoDisplayDerivativeStatus({ prisma, photo: PHOTO, operation: 'test' })

    expect(result).toEqual({ created: false, status: 'READY' })
  })

  it('falls back to getPhotoBuffer(photo.url) when neither sourceBuffer nor getSourceBuffer is given', async () => {
    ensureDisplayDerivative.mockImplementation(async ({ getSourceBuffer }) => {
      await getSourceBuffer()
      return { created: true }
    })
    const prisma = makeFakePrisma()

    await ensurePhotoDisplayDerivativeStatus({ prisma, photo: PHOTO, operation: 'test' })

    expect(getPhotoBuffer).toHaveBeenCalledWith(PHOTO.url)
  })

  it('reuses sourceBuffer directly when given — never calls getPhotoBuffer', async () => {
    const buf = Buffer.from('already-fetched')
    ensureDisplayDerivative.mockImplementation(async ({ getSourceBuffer }) => {
      const b = await getSourceBuffer()
      expect(b).toBe(buf)
      return { created: true }
    })
    const prisma = makeFakePrisma()

    await ensurePhotoDisplayDerivativeStatus({ prisma, photo: PHOTO, operation: 'test', sourceBuffer: buf })

    expect(getPhotoBuffer).not.toHaveBeenCalled()
  })

  it('a caller-supplied getSourceBuffer fully overrides both sourceBuffer and photo.url', async () => {
    const custom = vi.fn().mockResolvedValue(Buffer.from('custom'))
    ensureDisplayDerivative.mockImplementation(async ({ getSourceBuffer }) => {
      await getSourceBuffer()
      return { created: true }
    })
    const prisma = makeFakePrisma()

    await ensurePhotoDisplayDerivativeStatus({ prisma, photo: PHOTO, operation: 'test', getSourceBuffer: custom })

    expect(custom).toHaveBeenCalledTimes(1)
    expect(getPhotoBuffer).not.toHaveBeenCalled()
  })

  it('passes photo.id as the photoId to ensureDisplayDerivative', async () => {
    ensureDisplayDerivative.mockResolvedValue({ created: true })
    const prisma = makeFakePrisma()

    await ensurePhotoDisplayDerivativeStatus({ prisma, photo: PHOTO, operation: 'test' })

    expect(ensureDisplayDerivative).toHaveBeenCalledWith(expect.objectContaining({ photoId: PHOTO.id }))
  })
})

describe('failure path', () => {
  it('records FAILED and returns {created: false, status: FAILED} — never rethrows', async () => {
    ensureDisplayDerivative.mockRejectedValue(new Error('blob unavailable'))
    const prisma = makeFakePrisma()

    await expect(ensurePhotoDisplayDerivativeStatus({ prisma, photo: PHOTO, operation: 'test' })).resolves.toEqual({
      created: false,
      status: 'FAILED',
    })
    expect(prisma.photo.updateMany).toHaveBeenCalledWith({
      where: { id: PHOTO.id },
      data: { displayDerivativeStatus: 'FAILED' },
    })
  })

  it('logs the error via console.warn with only the opaque photoId and operation label, never the raw error object or URL', async () => {
    ensureDisplayDerivative.mockRejectedValue(new Error('a message that must not leak verbatim'))
    const prisma = makeFakePrisma()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await ensurePhotoDisplayDerivativeStatus({ prisma, photo: PHOTO, operation: 'my-op' })

    expect(warnSpy).toHaveBeenCalled()
    const loggedArgs = warnSpy.mock.calls.flat()
    expect(loggedArgs.join(' | ')).toContain('my-op')
    expect(loggedArgs.join(' | ')).toContain(PHOTO.id)
    expect(loggedArgs.join(' | ')).not.toContain(PHOTO.url)
    warnSpy.mockRestore()
  })
})

describe('status-write failure is itself swallowed (never fails the caller)', () => {
  it('a READY-write DB failure does not throw and still returns created/status normally', async () => {
    ensureDisplayDerivative.mockResolvedValue({ created: true })
    const prisma = { photo: { updateMany: vi.fn().mockRejectedValue(new Error('DB down')) } }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await ensurePhotoDisplayDerivativeStatus({ prisma, photo: PHOTO, operation: 'test' })

    expect(result).toEqual({ created: true, status: 'READY' })
    warnSpy.mockRestore()
  })

  it('a FAILED-write DB failure does not throw and still returns created:false/status:FAILED', async () => {
    ensureDisplayDerivative.mockRejectedValue(new Error('generation failed'))
    const prisma = { photo: { updateMany: vi.fn().mockRejectedValue(new Error('DB down')) } }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await ensurePhotoDisplayDerivativeStatus({ prisma, photo: PHOTO, operation: 'test' })

    expect(result).toEqual({ created: false, status: 'FAILED' })
    warnSpy.mockRestore()
  })

  it('tolerates a missing/null prisma client via optional chaining, without throwing', async () => {
    ensureDisplayDerivative.mockResolvedValue({ created: true })

    await expect(ensurePhotoDisplayDerivativeStatus({ prisma: null, photo: PHOTO, operation: 'test' })).resolves.toEqual({
      created: true,
      status: 'READY',
    })
  })
})
