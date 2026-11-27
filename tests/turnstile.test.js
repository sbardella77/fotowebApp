import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { verifyTurnstileToken, isTurnstileEnabled } from '@/lib/server/turnstile'

const okJson = (data) => ({ ok: true, status: 200, json: async () => data })

describe('verifyTurnstileToken', () => {
  beforeEach(() => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret-test')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is skipped (allowed) when no secret is configured', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', '')
    const fetchImpl = vi.fn()
    expect(isTurnstileEnabled()).toBe(false)
    expect(await verifyTurnstileToken(undefined, { fetchImpl })).toEqual({ success: true, skipped: true })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects a missing token without calling Cloudflare', async () => {
    const fetchImpl = vi.fn()
    const result = await verifyTurnstileToken('', { fetchImpl })
    expect(result.success).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('accepts a token Cloudflare validates and forwards secret, token and IP', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ success: true, action: 'create_room' }))
    const result = await verifyTurnstileToken('tok', { fetchImpl, remoteIp: '198.51.100.7', expectedAction: 'create_room' })
    expect(result).toEqual({ success: true })
    const body = fetchImpl.mock.calls[0][1].body
    expect(body.get('secret')).toBe('secret-test')
    expect(body.get('response')).toBe('tok')
    expect(body.get('remoteip')).toBe('198.51.100.7')
  })

  it('rejects a token Cloudflare refuses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ success: false, 'error-codes': ['timeout-or-duplicate'] }))
    expect(await verifyTurnstileToken('tok', { fetchImpl })).toEqual({ success: false, errorCodes: ['timeout-or-duplicate'] })
  })

  it('rejects a token minted for a different action', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ success: true, action: 'login' }))
    const result = await verifyTurnstileToken('tok', { fetchImpl, expectedAction: 'create_room' })
    expect(result.success).toBe(false)
    expect(result.errorCodes).toEqual(['action-mismatch'])
  })

  it('fails open when Cloudflare is unreachable or errors', async () => {
    const down = vi.fn().mockRejectedValue(new Error('network'))
    expect(await verifyTurnstileToken('tok', { fetchImpl: down })).toEqual({ success: true, failOpen: true })
    const http500 = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    expect(await verifyTurnstileToken('tok', { fetchImpl: http500 })).toEqual({ success: true, failOpen: true })
  })
})
