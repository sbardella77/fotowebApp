import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock @vercel/blob so no network calls can occur
vi.mock('@vercel/blob', () => ({
  del: vi.fn(),
}))

import {
  buildBlobPathname,
  buildPrivateDeliveryBlobPathname,
  getStoredNameFromBlobPathname,
  vercelBlobStorageDriver,
} from '../lib/server/storage/vercel-blob-storage.js'

// ─── buildBlobPathname ────────────────────────────────────────────────────────

describe('buildBlobPathname', () => {
  it('returns a path in the events/ namespace', () => {
    const result = buildBlobPathname({
      eventSlug: 'wedding-2026',
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
    })
    expect(result).toMatch(/^events\/wedding-2026\//)
  })

  it('uses MIME-derived extension for image/jpeg, ignoring client extension', () => {
    // Client sends a percent-encoded traversal as extension — MIME must win
    const result = buildBlobPathname({
      eventSlug: 'wedding-2026',
      fileName: 'photo%2e%2ejpg',
      mimeType: 'image/jpeg',
    })
    expect(result).toMatch(/\.jpg$/)
  })

  it('uses .png for image/png regardless of client file extension', () => {
    const result = buildBlobPathname({
      eventSlug: 'test-event',
      fileName: 'image.PNG',
      mimeType: 'image/png',
    })
    expect(result).toMatch(/\.png$/)
  })

  it('uses .webp for image/webp when file has no extension', () => {
    const result = buildBlobPathname({
      eventSlug: 'test-event',
      fileName: 'capture',
      mimeType: 'image/webp',
    })
    expect(result).toMatch(/\.webp$/)
  })

  it('falls back to alphanumeric extension when MIME not in map', () => {
    const result = buildBlobPathname({
      eventSlug: 'test-event',
      fileName: 'document.pdf',
      mimeType: 'application/pdf',
    })
    expect(result).toMatch(/\.pdf$/)
  })

  it('produces no extension for unknown MIME and no safe extension', () => {
    const result = buildBlobPathname({
      eventSlug: 'test-event',
      fileName: 'file',
      mimeType: 'application/octet-stream',
    })
    // No extension — just UUID-basename
    expect(result).not.toMatch(/\.\w+$/)
  })

  it('contains no percent-encoding, backslashes, or double slashes', () => {
    const result = buildBlobPathname({
      eventSlug: 'my-event',
      fileName: 'bad%20name..jpg',
      mimeType: 'image/jpeg',
    })
    expect(result).not.toContain('%')
    expect(result).not.toContain('\\')
    expect(result).not.toContain('//')
  })

  it('works without mimeType (backward compat — uses file extension fallback)', () => {
    const result = buildBlobPathname({
      eventSlug: 'legacy-event',
      fileName: 'photo.jpg',
    })
    expect(result).toMatch(/^events\/legacy-event\//)
    expect(result).toMatch(/\.jpg$/)
  })
})

// ─── buildPrivateDeliveryBlobPathname ────────────────────────────────────────

describe('buildPrivateDeliveryBlobPathname', () => {
  it('returns a path in the private-delivery/ namespace', () => {
    const result = buildPrivateDeliveryBlobPathname({
      eventSlug: 'wedding-2026',
      fileName: 'delivery.jpg',
      mimeType: 'image/jpeg',
    })
    expect(result).toMatch(/^private-delivery\/wedding-2026\//)
  })

  it('applies the same MIME-safe extension logic as buildBlobPathname', () => {
    const result = buildPrivateDeliveryBlobPathname({
      eventSlug: 'test-event',
      fileName: 'img.gif',
      mimeType: 'image/gif',
    })
    expect(result).toMatch(/\.gif$/)
  })
})

// ─── vercelBlobStorageDriver.initUploadSession ───────────────────────────────

describe('vercelBlobStorageDriver.initUploadSession', () => {
  const VALID_INPUT = {
    sessionId: 'sess-abc-123',
    expectedPathname: 'events/wedding-2026/uuid-photo.jpg',
    handleUploadUrl: '/api/uploads/blob',
  }

  it('returns the provided sessionId in the descriptor', async () => {
    const result = await vercelBlobStorageDriver.initUploadSession(VALID_INPUT)
    expect(result.sessionId).toBe('sess-abc-123')
  })

  it('returns the expectedPathname as pathname in the descriptor', async () => {
    const result = await vercelBlobStorageDriver.initUploadSession(VALID_INPUT)
    expect(result.pathname).toBe('events/wedding-2026/uuid-photo.jpg')
  })

  it('preserves the handleUploadUrl in the descriptor', async () => {
    const result = await vercelBlobStorageDriver.initUploadSession(VALID_INPUT)
    expect(result.handleUploadUrl).toBe('/api/uploads/blob')
  })

  it('sets storageMode to vercel-blob', async () => {
    const result = await vercelBlobStorageDriver.initUploadSession(VALID_INPUT)
    expect(result.storageMode).toBe('vercel-blob')
  })

  it('sets uploadStrategy to vercel-blob-client', async () => {
    const result = await vercelBlobStorageDriver.initUploadSession(VALID_INPUT)
    expect(result.uploadStrategy).toBe('vercel-blob-client')
  })

  it('rejects a missing sessionId', async () => {
    await expect(
      vercelBlobStorageDriver.initUploadSession({
        ...VALID_INPUT,
        sessionId: '',
      }),
    ).rejects.toThrow('sessionId is required')
  })

  it('rejects a missing expectedPathname', async () => {
    await expect(
      vercelBlobStorageDriver.initUploadSession({
        ...VALID_INPUT,
        expectedPathname: '',
      }),
    ).rejects.toThrow('expectedPathname is required')
  })

  it('rejects an external (http) handleUploadUrl', async () => {
    await expect(
      vercelBlobStorageDriver.initUploadSession({
        ...VALID_INPUT,
        handleUploadUrl: 'https://evil.example.com/upload',
      }),
    ).rejects.toThrow()
  })

  it('rejects a handleUploadUrl that does not start with /api/', async () => {
    await expect(
      vercelBlobStorageDriver.initUploadSession({
        ...VALID_INPUT,
        handleUploadUrl: '/other/path',
      }),
    ).rejects.toThrow('must start with /api/')
  })

  it('rejects a handleUploadUrl containing a query string', async () => {
    await expect(
      vercelBlobStorageDriver.initUploadSession({
        ...VALID_INPUT,
        handleUploadUrl: '/api/uploads/blob?foo=bar',
      }),
    ).rejects.toThrow()
  })

  it('rejects a handleUploadUrl containing a fragment', async () => {
    await expect(
      vercelBlobStorageDriver.initUploadSession({
        ...VALID_INPUT,
        handleUploadUrl: '/api/uploads/blob#section',
      }),
    ).rejects.toThrow()
  })
})
