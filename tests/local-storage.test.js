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

import { rm } from 'fs/promises'
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
