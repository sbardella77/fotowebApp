import { describe, it, expect, vi } from 'vitest'
import { safeFetchJson, normalizeEvent } from '../lib/dashboard-data-helpers'

describe('safeFetchJson', () => {
  it('returns parsed JSON with ok=true for a successful response', async () => {
    const response = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ plan: 'professional', extraEventCredits: 3 }),
    }
    const result = await safeFetchJson(response)
    expect(result).toEqual({ ok: true, status: 200, payload: { plan: 'professional', extraEventCredits: 3 } })
  })

  it('returns payload with ok=false for an HTTP error', async () => {
    const response = {
      ok: false,
      status: 404,
      json: vi.fn().mockResolvedValue({ error: 'not found' }),
    }
    const result = await safeFetchJson(response)
    expect(result).toEqual({ ok: false, status: 404, payload: { error: 'not found' } })
  })

  it('falls back to the provided default when the body is not valid JSON', async () => {
    const response = {
      ok: false,
      status: 500,
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
    }
    const result = await safeFetchJson(response, { fallback: { events: [] } })
    expect(result).toEqual({ ok: false, status: 500, payload: { events: [] } })
  })

  it('falls back to an empty object when no fallback is provided', async () => {
    const response = {
      ok: true,
      status: 204,
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected end of JSON input')),
    }
    const result = await safeFetchJson(response)
    expect(result).toEqual({ ok: true, status: 204, payload: {} })
  })

  it('carries the status even when the response body is empty', async () => {
    const response = {
      ok: false,
      status: 503,
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected end of JSON input')),
    }
    const result = await safeFetchJson(response, { fallback: { plan: 'free' } })
    expect(result.status).toBe(503)
    expect(result.payload).toEqual({ plan: 'free' })
  })
})

describe('normalizeEvent', () => {
  it('returns null for null or undefined input', () => {
    expect(normalizeEvent(null)).toBeNull()
    expect(normalizeEvent(undefined)).toBeNull()
  })

  it('fills in safe defaults for missing fields', () => {
    const event = {}
    const normalized = normalizeEvent(event)
    expect(normalized.id).toBe('')
    expect(normalized.name).toBe('')
    expect(normalized.slug).toBe('')
    expect(normalized.billingTier).toBeNull()
    expect(normalized.originalDownloadUnlocked).toBe(false)
    expect(normalized.coverUrl).toBeNull()
    expect(normalized.photoCount).toBeNull()
    expect(normalized.photos).toEqual([])
    expect(normalized.moments).toEqual([])
    expect(normalized.createdAt).toBeNull()
    expect(normalized.vaultExtendedUntil).toBeNull()
    expect(normalized.gracePeriodUntil).toBeNull()
    expect(normalized.archiveLocked).toBe(false)
  })

  it('preserves existing values and coerces booleans', () => {
    const event = {
      id: 'evt_123',
      name: 'Wedding',
      slug: 'wedding-2026',
      billingTier: 'wedding_pro',
      originalDownloadUnlocked: 1,
      coverUrl: 'https://example.com/cover.jpg',
      photoCount: 42,
      photos: [{ id: 'p1' }],
      moments: [{ id: 'm1' }],
      createdAt: '2026-01-01T00:00:00Z',
      vaultExtendedUntil: '2027-01-01T00:00:00Z',
      gracePeriodUntil: '2026-02-01T00:00:00Z',
      archiveLocked: true,
    }
    const normalized = normalizeEvent(event)
    expect(normalized.id).toBe('evt_123')
    expect(normalized.name).toBe('Wedding')
    expect(normalized.slug).toBe('wedding-2026')
    expect(normalized.billingTier).toBe('wedding_pro')
    expect(normalized.originalDownloadUnlocked).toBe(true)
    expect(normalized.coverUrl).toBe('https://example.com/cover.jpg')
    expect(normalized.photoCount).toBe(42)
    expect(normalized.photos).toEqual([{ id: 'p1' }])
    expect(normalized.moments).toEqual([{ id: 'm1' }])
    expect(normalized.createdAt).toBe('2026-01-01T00:00:00Z')
    expect(normalized.archiveLocked).toBe(true)
  })

  it('treats photoCount strings as invalid and falls back to null', () => {
    const event = { photoCount: '42' }
    const normalized = normalizeEvent(event)
    expect(normalized.photoCount).toBeNull()
  })

  it('preserves additional unknown fields via spread', () => {
    const event = { customField: 'value' }
    const normalized = normalizeEvent(event)
    expect(normalized.customField).toBe('value')
  })
})
