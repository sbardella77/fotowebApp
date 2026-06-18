import { describe, it, expect, vi } from 'vitest'
import { safeReadJson } from '../lib/nav-session-helpers'

describe('safeReadJson', () => {
  it('returns parsed JSON for a valid response', async () => {
    const response = {
      text: vi.fn().mockResolvedValue(JSON.stringify({ authenticated: true })),
    }
    const result = await safeReadJson(response)
    expect(result).toEqual({ authenticated: true })
  })

  it('returns empty object for an empty response body', async () => {
    const response = {
      text: vi.fn().mockResolvedValue(''),
    }
    const result = await safeReadJson(response)
    expect(result).toEqual({})
  })

  it('returns empty object for invalid JSON', async () => {
    const response = {
      text: vi.fn().mockResolvedValue('<html>not json</html>'),
    }
    const result = await safeReadJson(response)
    expect(result).toEqual({})
  })

  it('returns empty object when text() rejects', async () => {
    const response = {
      text: vi.fn().mockRejectedValue(new Error('network')),
    }
    const result = await safeReadJson(response)
    expect(result).toEqual({})
  })
})
