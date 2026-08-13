import { describe, it, expect, vi } from 'vitest'
import { deleteEventScopedStoredFile } from '@/lib/server/event-scoped-storage-delete'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeDeleteFile = () => vi.fn().mockResolvedValue(undefined)
const makeLogger = () => ({ warn: vi.fn() })

const VERCEL_HOST = 'https://abc123.blob.vercel-storage.com'

// ─── Valid Vercel Blob URLs ───────────────────────────────────────────────────

describe('deleteEventScopedStoredFile — Vercel Blob, room-photo', () => {
  const eventSlug = 'my-event'
  const url = `${VERCEL_HOST}/events/${eventSlug}/photo-uuid.jpg`

  it('returns { deleted: true, skipped: false } for a valid URL', async () => {
    const deleteFile = makeDeleteFile()
    const result = await deleteEventScopedStoredFile({ url, eventSlug, kind: 'room-photo', deleteFile })
    expect(result).toEqual({ deleted: true, skipped: false })
  })

  it('calls deleteFile with the exact URL', async () => {
    const deleteFile = makeDeleteFile()
    await deleteEventScopedStoredFile({ url, eventSlug, kind: 'room-photo', deleteFile })
    expect(deleteFile).toHaveBeenCalledOnce()
    expect(deleteFile).toHaveBeenCalledWith(url)
  })

  it('skips if namespace is wrong (private-delivery instead of events)', async () => {
    const deleteFile = makeDeleteFile()
    const badUrl = `${VERCEL_HOST}/private-delivery/${eventSlug}/photo.jpg`
    const result = await deleteEventScopedStoredFile({ url: badUrl, eventSlug, kind: 'room-photo', deleteFile })
    expect(result).toEqual({ deleted: false, skipped: true })
    expect(deleteFile).not.toHaveBeenCalled()
  })

  it('skips if eventSlug does not match URL', async () => {
    const deleteFile = makeDeleteFile()
    const badUrl = `${VERCEL_HOST}/events/other-event/photo.jpg`
    const result = await deleteEventScopedStoredFile({ url: badUrl, eventSlug, kind: 'room-photo', deleteFile })
    expect(result).toEqual({ deleted: false, skipped: true })
    expect(deleteFile).not.toHaveBeenCalled()
  })

  it('skips on prefix-collision (slug "event-a" must not match "event-ab")', async () => {
    const deleteFile = makeDeleteFile()
    const slugA = 'event-a'
    const badUrl = `${VERCEL_HOST}/events/event-ab/photo.jpg`
    const result = await deleteEventScopedStoredFile({ url: badUrl, eventSlug: slugA, kind: 'room-photo', deleteFile })
    expect(result).toEqual({ deleted: false, skipped: true })
    expect(deleteFile).not.toHaveBeenCalled()
  })
})

describe('deleteEventScopedStoredFile — Vercel Blob, private-asset', () => {
  const eventSlug = 'wedding-2025'
  const url = `${VERCEL_HOST}/private-delivery/${eventSlug}/doc.pdf`

  it('returns { deleted: true } for valid private-asset URL', async () => {
    const deleteFile = makeDeleteFile()
    const result = await deleteEventScopedStoredFile({ url, eventSlug, kind: 'private-asset', deleteFile })
    expect(result).toEqual({ deleted: true, skipped: false })
    expect(deleteFile).toHaveBeenCalledWith(url)
  })

  it('skips if namespace is wrong (events instead of private-delivery)', async () => {
    const deleteFile = makeDeleteFile()
    const badUrl = `${VERCEL_HOST}/events/${eventSlug}/doc.pdf`
    const result = await deleteEventScopedStoredFile({ url: badUrl, eventSlug, kind: 'private-asset', deleteFile })
    expect(result).toEqual({ deleted: false, skipped: true })
    expect(deleteFile).not.toHaveBeenCalled()
  })
})

// ─── Valid local paths ────────────────────────────────────────────────────────

describe('deleteEventScopedStoredFile — local path, room-photo', () => {
  const eventSlug = 'my-event'
  const url = `/uploads/events/${eventSlug}/photo.jpg`

  it('returns { deleted: true } for valid local room-photo path', async () => {
    const deleteFile = makeDeleteFile()
    const result = await deleteEventScopedStoredFile({ url, eventSlug, kind: 'room-photo', deleteFile })
    expect(result).toEqual({ deleted: true, skipped: false })
    expect(deleteFile).toHaveBeenCalledWith(url)
  })

  it('skips if namespace is wrong', async () => {
    const deleteFile = makeDeleteFile()
    const badUrl = `/uploads/private-delivery/${eventSlug}/photo.jpg`
    const result = await deleteEventScopedStoredFile({ url: badUrl, eventSlug, kind: 'room-photo', deleteFile })
    expect(result).toEqual({ deleted: false, skipped: true })
    expect(deleteFile).not.toHaveBeenCalled()
  })

  it('skips if eventSlug does not match', async () => {
    const deleteFile = makeDeleteFile()
    const badUrl = `/uploads/events/other-event/photo.jpg`
    const result = await deleteEventScopedStoredFile({ url: badUrl, eventSlug, kind: 'room-photo', deleteFile })
    expect(result).toEqual({ deleted: false, skipped: true })
    expect(deleteFile).not.toHaveBeenCalled()
  })

  it('skips on path traversal attempt (../)', async () => {
    const deleteFile = makeDeleteFile()
    const badUrl = `/uploads/events/${eventSlug}/../other-event/photo.jpg`
    const result = await deleteEventScopedStoredFile({ url: badUrl, eventSlug, kind: 'room-photo', deleteFile })
    expect(result).toEqual({ deleted: false, skipped: true })
    expect(deleteFile).not.toHaveBeenCalled()
  })
})

describe('deleteEventScopedStoredFile — local path, private-asset', () => {
  const eventSlug = 'corp-event'
  const url = `/uploads/private-delivery/${eventSlug}/contract.pdf`

  it('returns { deleted: true } for valid local private-asset path', async () => {
    const deleteFile = makeDeleteFile()
    const result = await deleteEventScopedStoredFile({ url, eventSlug, kind: 'private-asset', deleteFile })
    expect(result).toEqual({ deleted: true, skipped: false })
    expect(deleteFile).toHaveBeenCalledWith(url)
  })
})

// ─── Input validation ─────────────────────────────────────────────────────────

describe('deleteEventScopedStoredFile — input validation', () => {
  const eventSlug = 'my-event'
  const validUrl = `${VERCEL_HOST}/events/${eventSlug}/photo.jpg`

  it('skips when url is null', async () => {
    const deleteFile = makeDeleteFile()
    const result = await deleteEventScopedStoredFile({ url: null, eventSlug, kind: 'room-photo', deleteFile })
    expect(result).toEqual({ deleted: false, skipped: true })
    expect(deleteFile).not.toHaveBeenCalled()
  })

  it('skips when url is undefined', async () => {
    const deleteFile = makeDeleteFile()
    const result = await deleteEventScopedStoredFile({ url: undefined, eventSlug, kind: 'room-photo', deleteFile })
    expect(result).toEqual({ deleted: false, skipped: true })
    expect(deleteFile).not.toHaveBeenCalled()
  })

  it('skips when url is empty string', async () => {
    const deleteFile = makeDeleteFile()
    const result = await deleteEventScopedStoredFile({ url: '', eventSlug, kind: 'room-photo', deleteFile })
    expect(result).toEqual({ deleted: false, skipped: true })
    expect(deleteFile).not.toHaveBeenCalled()
  })

  it('skips when eventSlug is empty', async () => {
    const deleteFile = makeDeleteFile()
    const result = await deleteEventScopedStoredFile({ url: validUrl, eventSlug: '', kind: 'room-photo', deleteFile })
    expect(result).toEqual({ deleted: false, skipped: true })
    expect(deleteFile).not.toHaveBeenCalled()
  })

  it('skips when eventSlug contains "/"', async () => {
    const deleteFile = makeDeleteFile()
    const result = await deleteEventScopedStoredFile({ url: validUrl, eventSlug: 'my/event', kind: 'room-photo', deleteFile })
    expect(result).toEqual({ deleted: false, skipped: true })
    expect(deleteFile).not.toHaveBeenCalled()
  })

  it('skips when eventSlug contains "%"', async () => {
    const deleteFile = makeDeleteFile()
    const result = await deleteEventScopedStoredFile({ url: validUrl, eventSlug: 'my%2fevent', kind: 'room-photo', deleteFile })
    expect(result).toEqual({ deleted: false, skipped: true })
    expect(deleteFile).not.toHaveBeenCalled()
  })

  it('skips URL with percent-encoded characters in pathname', async () => {
    const deleteFile = makeDeleteFile()
    const badUrl = `${VERCEL_HOST}/events/${eventSlug}/photo%20name.jpg`
    const result = await deleteEventScopedStoredFile({ url: badUrl, eventSlug, kind: 'room-photo', deleteFile })
    expect(result).toEqual({ deleted: false, skipped: true })
    expect(deleteFile).not.toHaveBeenCalled()
  })

  it('throws for unknown kind', async () => {
    const deleteFile = makeDeleteFile()
    await expect(
      deleteEventScopedStoredFile({ url: validUrl, eventSlug, kind: 'unknown-kind', deleteFile })
    ).rejects.toThrow('unknown kind')
  })
})

// ─── Error propagation ────────────────────────────────────────────────────────

describe('deleteEventScopedStoredFile — error propagation', () => {
  it('propagates error thrown by deleteFile', async () => {
    const eventSlug = 'my-event'
    const url = `${VERCEL_HOST}/events/${eventSlug}/photo.jpg`
    const storageError = new Error('storage unavailable')
    const deleteFile = vi.fn().mockRejectedValue(storageError)
    await expect(
      deleteEventScopedStoredFile({ url, eventSlug, kind: 'room-photo', deleteFile })
    ).rejects.toThrow('storage unavailable')
  })
})

// ─── Logger contract ──────────────────────────────────────────────────────────

describe('deleteEventScopedStoredFile — logger contract', () => {
  const eventSlug = 'my-event'

  it('calls logger.warn on skip — message is static (no URL/slug)', async () => {
    const deleteFile = makeDeleteFile()
    const logger = makeLogger()
    const badUrl = `${VERCEL_HOST}/events/other-event/photo.jpg`
    await deleteEventScopedStoredFile({ url: badUrl, eventSlug, kind: 'room-photo', deleteFile, logger })
    expect(logger.warn).toHaveBeenCalledOnce()
    const [message] = logger.warn.mock.calls[0]
    expect(message).not.toContain(badUrl)
    expect(message).not.toContain(eventSlug)
  })

  it('does not call logger.warn on successful delete', async () => {
    const deleteFile = makeDeleteFile()
    const logger = makeLogger()
    const url = `${VERCEL_HOST}/events/${eventSlug}/photo.jpg`
    await deleteEventScopedStoredFile({ url, eventSlug, kind: 'room-photo', deleteFile, logger })
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('works without a logger (no error)', async () => {
    const deleteFile = makeDeleteFile()
    const badUrl = `${VERCEL_HOST}/events/other-event/photo.jpg`
    await expect(
      deleteEventScopedStoredFile({ url: badUrl, eventSlug, kind: 'room-photo', deleteFile })
    ).resolves.toEqual({ deleted: false, skipped: true })
  })
})

// ─── Legacy attack regression ─────────────────────────────────────────────────

describe('deleteEventScopedStoredFile — legacy confused-deputy regression', () => {
  it('does not delete a blob belonging to a different event even if URL is valid Vercel format', async () => {
    // Attacker owns "attacker-event" but poisons photo.url with victim's blob URL
    const attackerSlug = 'attacker-event'
    const victimUrl = `${VERCEL_HOST}/events/victim-event/sensitive-photo.jpg`
    const deleteFile = makeDeleteFile()
    const result = await deleteEventScopedStoredFile({
      url: victimUrl,
      eventSlug: attackerSlug,
      kind: 'room-photo',
      deleteFile,
    })
    expect(result).toEqual({ deleted: false, skipped: true })
    expect(deleteFile).not.toHaveBeenCalled()
  })

  it('does not delete via local path belonging to a different event', async () => {
    const attackerSlug = 'attacker-event'
    const victimUrl = `/uploads/events/victim-event/sensitive-photo.jpg`
    const deleteFile = makeDeleteFile()
    const result = await deleteEventScopedStoredFile({
      url: victimUrl,
      eventSlug: attackerSlug,
      kind: 'room-photo',
      deleteFile,
    })
    expect(result).toEqual({ deleted: false, skipped: true })
    expect(deleteFile).not.toHaveBeenCalled()
  })
})

// ─── Static regression: route.js uses scoped helper ──────────────────────────

import { readFileSync } from 'fs'
import { resolve } from 'path'

const routeSrc = readFileSync(
  resolve(import.meta.dirname, '../app/api/[[...path]]/route.js'),
  'utf8'
)

describe('route.js static regression — scoped delete helper', () => {
  it('imports deleteEventScopedStoredFile', () => {
    expect(routeSrc).toContain("import { deleteEventScopedStoredFile } from '@/lib/server/event-scoped-storage-delete'")
  })

  it('does not call bare deleteStoredFile on photo.url', () => {
    expect(routeSrc).not.toMatch(/deleteStoredFile\(\s*photo\.url\s*\)/)
  })

  it('does not call bare deleteStoredFile on asset.url', () => {
    expect(routeSrc).not.toMatch(/deleteStoredFile\(\s*asset\.url\s*\)/)
  })

  it('uses deleteEventScopedStoredFile with kind room-photo for photos', () => {
    expect(routeSrc).toMatch(/deleteEventScopedStoredFile\(\{[^}]*kind:\s*'room-photo'/)
  })

  it('uses deleteEventScopedStoredFile with kind private-asset for assets', () => {
    expect(routeSrc).toMatch(/deleteEventScopedStoredFile\(\{[^}]*kind:\s*'private-asset'/)
  })
})

// ─── deleteOwnerPhoto static regression ──────────────────────────────────────

// Extract only the deleteOwnerPhoto function body from the source
function extractDeleteOwnerPhoto(source) {
  const start = source.indexOf('const deleteOwnerPhoto = async (request, photoId)')
  if (start === -1) return ''
  // Find the closing brace of the function (the pattern ends with return json(...))
  const end = source.indexOf('\nconst ', start + 1)
  return end === -1 ? source.slice(start) : source.slice(start, end)
}

const deleteOwnerPhotoSrc = extractDeleteOwnerPhoto(routeSrc)

describe('route.js static regression — deleteOwnerPhoto local-path fix', () => {
  it('deleteOwnerPhoto does not call getPrismaClient directly', () => {
    expect(deleteOwnerPhotoSrc).not.toContain('getPrismaClient')
  })

  it('deleteOwnerPhoto uses repository.getEventById for slug resolution', () => {
    expect(deleteOwnerPhotoSrc).toContain('repository.getEventById')
  })

  it('deleteOwnerPhoto passes eventSlug derived from repository (not hardcoded empty string)', () => {
    expect(deleteOwnerPhotoSrc).toMatch(/ownerPhotoEvent\?\.slug/)
  })

  it('getEventById call is inside the storage cleanup try block', () => {
    // Extract the try block: from 'try {' to its closing catch
    const tryStart = deleteOwnerPhotoSrc.indexOf('try {')
    const catchStart = deleteOwnerPhotoSrc.indexOf('} catch (storageError)')
    expect(tryStart).toBeGreaterThan(-1)
    expect(catchStart).toBeGreaterThan(tryStart)
    const tryBlock = deleteOwnerPhotoSrc.slice(tryStart, catchStart)
    expect(tryBlock).toContain('repository.getEventById')
    expect(tryBlock).toContain('deleteEventScopedStoredFile')
  })
})
