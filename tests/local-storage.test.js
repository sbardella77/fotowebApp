import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'

// vi.mock is hoisted by vitest before any import is resolved, so
// local-storage.js will receive the mocked fs/promises at load time.
vi.mock('fs/promises', () => ({
  rm: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('{}'),
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockResolvedValue({ size: 0 }),
  appendFile: vi.fn().mockResolvedValue(undefined),
}))

import { rm, writeFile, readFile, stat } from 'fs/promises'
import { localStorageDriver } from '@/lib/server/storage/local-storage'

const STORAGE_ROOT = path.join(process.cwd(), 'public', 'uploads')

describe('localStorageDriver.deleteStoredFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --- Valid paths ---

  it('deletes a valid file under /uploads/events/', async () => {
    const url = '/uploads/events/summer-wedding/abc123-photo.jpg'
    await localStorageDriver.deleteStoredFile(url)
    const expected = path.join(STORAGE_ROOT, 'events', 'summer-wedding', 'abc123-photo.jpg')
    expect(rm).toHaveBeenCalledOnce()
    expect(rm).toHaveBeenCalledWith(expected, { force: true })
  })

  it('deletes a valid file under /uploads/private-delivery/', async () => {
    const url = '/uploads/private-delivery/event-slug/uuid-document.pdf'
    await localStorageDriver.deleteStoredFile(url)
    const expected = path.join(STORAGE_ROOT, 'private-delivery', 'event-slug', 'uuid-document.pdf')
    expect(rm).toHaveBeenCalledOnce()
    expect(rm).toHaveBeenCalledWith(expected, { force: true })
  })

  it('deletes a file inside a directory whose name starts with ".." (not a traversal)', async () => {
    // A directory named "..hidden" is a valid filesystem name; its path.relative()
    // result starts with "..hidden/" which must NOT be confused with "../" traversal.
    const url = '/uploads/..hidden/event-slug/photo.jpg'
    await localStorageDriver.deleteStoredFile(url)
    const expected = path.join(STORAGE_ROOT, '..hidden', 'event-slug', 'photo.jpg')
    expect(rm).toHaveBeenCalledOnce()
    expect(rm).toHaveBeenCalledWith(expected, { force: true })
  })

  // --- Path outside /uploads/ ---

  it('throws for a path directly outside /uploads/', async () => {
    await expect(localStorageDriver.deleteStoredFile('/package.json')).rejects.toThrow('Invalid file path')
    expect(rm).not.toHaveBeenCalled()
  })

  // --- Dot segment traversal ---

  it('throws for path traversal with ../', async () => {
    await expect(localStorageDriver.deleteStoredFile('/uploads/../etc/passwd')).rejects.toThrow('Invalid file path')
    expect(rm).not.toHaveBeenCalled()
  })

  it('throws for path traversal using backslash separators', async () => {
    await expect(localStorageDriver.deleteStoredFile('/uploads\\..\\etc\\passwd')).rejects.toThrow('Invalid file path')
    expect(rm).not.toHaveBeenCalled()
  })

  // --- Percent-encoded traversal ---

  it('throws for percent-encoded traversal %2e%2e', async () => {
    await expect(localStorageDriver.deleteStoredFile('/uploads/%2e%2e/etc/passwd')).rejects.toThrow('Invalid file path')
    expect(rm).not.toHaveBeenCalled()
  })

  it('throws for invalid percent-encoding sequence', async () => {
    await expect(localStorageDriver.deleteStoredFile('/uploads/%zz/file.jpg')).rejects.toThrow('Invalid file path')
    expect(rm).not.toHaveBeenCalled()
  })

  // --- Exact root ---

  it('throws when targeting the /uploads/ root without a filename', async () => {
    await expect(localStorageDriver.deleteStoredFile('/uploads/')).rejects.toThrow('Invalid file path')
    expect(rm).not.toHaveBeenCalled()
  })

  // --- Sibling directory ---

  it('throws for a sibling directory /uploads-evil/', async () => {
    await expect(localStorageDriver.deleteStoredFile('/uploads-evil/file.jpg')).rejects.toThrow('Invalid file path')
    expect(rm).not.toHaveBeenCalled()
  })

  // --- Null / empty no-op ---

  it('is a no-op for null', async () => {
    await localStorageDriver.deleteStoredFile(null)
    expect(rm).not.toHaveBeenCalled()
  })

  it('is a no-op for empty string', async () => {
    await localStorageDriver.deleteStoredFile('')
    expect(rm).not.toHaveBeenCalled()
  })
})

describe('localStorageDriver contributorId propagation (init → meta → complete)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stat.mockResolvedValue({ size: 1024 })
  })

  it('initUploadSession writes contributorId into the session meta file', async () => {
    await localStorageDriver.initUploadSession({
      eventSlug: 'wedding-2026',
      fileName: 'photo.jpg',
      fileSize: 1024,
      mimeType: 'image/jpeg',
      totalChunks: 1,
      contributorId: '44444444-4444-4444-8444-444444444444',
    })

    const [, metaJson] = writeFile.mock.calls[0]
    const meta = JSON.parse(metaJson)
    expect(meta.contributorId).toBe('44444444-4444-4444-8444-444444444444')
  })

  it('initUploadSession defaults contributorId to null when omitted (legacy call sites)', async () => {
    await localStorageDriver.initUploadSession({
      eventSlug: 'wedding-2026',
      fileName: 'photo.jpg',
      fileSize: 1024,
      mimeType: 'image/jpeg',
      totalChunks: 1,
    })

    const [, metaJson] = writeFile.mock.calls[0]
    const meta = JSON.parse(metaJson)
    expect(meta.contributorId).toBeNull()
  })

  it('completeUploadSession returns the contributorId stored in meta', async () => {
    readFile.mockImplementation(async (filePath) => {
      if (String(filePath).endsWith('meta.json')) {
        return JSON.stringify({
          sessionId: 'sess-1',
          eventSlug: 'wedding-2026',
          fileName: 'photo.jpg',
          mimeType: 'image/jpeg',
          totalChunks: 1,
          directory: 'events',
          contributorId: '44444444-4444-4444-8444-444444444444',
        })
      }
      return Buffer.from('chunk-bytes')
    })

    const result = await localStorageDriver.completeUploadSession({
      sessionId: 'sess-1',
      photoId: 'photo-1',
    })

    expect(result.contributorId).toBe('44444444-4444-4444-8444-444444444444')
  })

  it('completeUploadSession returns null contributorId for a legacy meta file that never had it', async () => {
    readFile.mockImplementation(async (filePath) => {
      if (String(filePath).endsWith('meta.json')) {
        // Legacy meta.json written before this field existed — no
        // contributorId key at all.
        return JSON.stringify({
          sessionId: 'sess-1',
          eventSlug: 'wedding-2026',
          fileName: 'photo.jpg',
          mimeType: 'image/jpeg',
          totalChunks: 1,
          directory: 'events',
        })
      }
      return Buffer.from('chunk-bytes')
    })

    const result = await localStorageDriver.completeUploadSession({
      sessionId: 'sess-1',
      photoId: 'photo-1',
    })

    expect(result.contributorId).toBeNull()
    expect(result.url).toContain('wedding-2026')
  })
})

describe('localStorageDriver uploadActorType propagation (init → meta → complete)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stat.mockResolvedValue({ size: 1024 })
  })

  it('initUploadSession writes uploadActorType into the session meta file', async () => {
    await localStorageDriver.initUploadSession({
      eventSlug: 'wedding-2026',
      fileName: 'photo.jpg',
      fileSize: 1024,
      mimeType: 'image/jpeg',
      totalChunks: 1,
      uploadActorType: 'owner',
    })

    const [, metaJson] = writeFile.mock.calls[0]
    const meta = JSON.parse(metaJson)
    expect(meta.uploadActorType).toBe('owner')
  })

  it('initUploadSession defaults uploadActorType to null when omitted (anonymous guest upload)', async () => {
    await localStorageDriver.initUploadSession({
      eventSlug: 'wedding-2026',
      fileName: 'photo.jpg',
      fileSize: 1024,
      mimeType: 'image/jpeg',
      totalChunks: 1,
    })

    const [, metaJson] = writeFile.mock.calls[0]
    const meta = JSON.parse(metaJson)
    expect(meta.uploadActorType).toBeNull()
  })

  it('completeUploadSession returns the uploadActorType stored in meta', async () => {
    readFile.mockImplementation(async (filePath) => {
      if (String(filePath).endsWith('meta.json')) {
        return JSON.stringify({
          sessionId: 'sess-1',
          eventSlug: 'wedding-2026',
          fileName: 'photo.jpg',
          mimeType: 'image/jpeg',
          totalChunks: 1,
          directory: 'events',
          uploadActorType: 'guest',
        })
      }
      return Buffer.from('chunk-bytes')
    })

    const result = await localStorageDriver.completeUploadSession({
      sessionId: 'sess-1',
      photoId: 'photo-1',
    })

    expect(result.uploadActorType).toBe('guest')
  })

  it('completeUploadSession returns null uploadActorType for a legacy meta file that never had it', async () => {
    readFile.mockImplementation(async (filePath) => {
      if (String(filePath).endsWith('meta.json')) {
        // Legacy meta.json written before this field existed — no
        // uploadActorType key at all. Must stay null (unknown), never
        // fall back to 'guest'.
        return JSON.stringify({
          sessionId: 'sess-1',
          eventSlug: 'wedding-2026',
          fileName: 'photo.jpg',
          mimeType: 'image/jpeg',
          totalChunks: 1,
          directory: 'events',
        })
      }
      return Buffer.from('chunk-bytes')
    })

    const result = await localStorageDriver.completeUploadSession({
      sessionId: 'sess-1',
      photoId: 'photo-1',
    })

    expect(result.uploadActorType).toBeNull()
  })
})
