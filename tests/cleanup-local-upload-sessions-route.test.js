import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

vi.mock('@/lib/server/storage/local-storage', () => ({ cleanupExpiredLocalSessions: vi.fn() }))
vi.mock('@/lib/server/ops-alerts', () => ({ sendOpsAlert: vi.fn().mockResolvedValue({ sent: true }) }))

import { GET } from '@/app/api/cron/cleanup-local-upload-sessions/route'
import { cleanupExpiredLocalSessions } from '@/lib/server/storage/local-storage'
import { sendOpsAlert } from '@/lib/server/ops-alerts'

const originalEnv = process.env

beforeAll(() => {
  process.env = { ...originalEnv, CRON_SECRET: 'cron_secret_test' }
})

afterAll(() => {
  process.env = originalEnv
})

function createRequest(secret = 'cron_secret_test') {
  return {
    headers: {
      get: vi.fn((name) => (name.toLowerCase() === 'authorization' ? `Bearer ${secret}` : null)),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  sendOpsAlert.mockResolvedValue({ sent: true })
})

describe('GET /api/cron/cleanup-local-upload-sessions', () => {
  it('rejects a request with a wrong bearer token', async () => {
    const response = await GET(createRequest('wrong-secret'))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
    expect(cleanupExpiredLocalSessions).not.toHaveBeenCalled()
  })

  it('success: returns scanned/removed counts and does not alert', async () => {
    cleanupExpiredLocalSessions.mockResolvedValue({ scanned: 4, removed: 2 })

    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.scanned).toBe(4)
    expect(body.removed).toBe(2)
    expect(sendOpsAlert).not.toHaveBeenCalled()
  })

  it('cleanup failure: returns 500 and sends exactly one warning alert without leaking the secret', async () => {
    cleanupExpiredLocalSessions.mockRejectedValue(new Error('disk unreachable'))

    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe('Local upload session cleanup failed')

    expect(sendOpsAlert).toHaveBeenCalledTimes(1)
    const alertArg = sendOpsAlert.mock.calls[0][0]
    expect(alertArg.severity).toBe('warning')
    expect(alertArg.type).toBe('ops:cron:local_upload_cleanup_failed')
    expect(alertArg.message).toBe('disk unreachable')

    const payload = JSON.stringify(alertArg)
    expect(payload).not.toMatch(/cron_secret_test/i)
  })

  it('alert failure does not mask the original cleanup failure', async () => {
    cleanupExpiredLocalSessions.mockRejectedValue(new Error('disk unreachable'))
    sendOpsAlert.mockRejectedValue(new Error('resend transport exploded'))

    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe('Local upload session cleanup failed')
  })
})
