import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

vi.mock('@/lib/server/gallery-download-cleanup', () => ({ cleanupGalleryDownloads: vi.fn() }))
vi.mock('@/lib/server/ops-alerts', () => ({ sendOpsAlert: vi.fn().mockResolvedValue({ sent: true }) }))

import { GET } from '@/app/api/cron/cleanup-gallery-downloads/route'
import { cleanupGalleryDownloads } from '@/lib/server/gallery-download-cleanup'
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

describe('GET /api/cron/cleanup-gallery-downloads — ops alerting', () => {
  it('A. success: sendOpsAlert is not called', async () => {
    cleanupGalleryDownloads.mockResolvedValue({ scanned: 2, deleted: 0 })

    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(sendOpsAlert).not.toHaveBeenCalled()
  })

  it('B. fatal cleanup failure: preserves original HTTP semantics and sends exactly one critical alert', async () => {
    cleanupGalleryDownloads.mockRejectedValue(new Error('database connection lost'))

    const response = await GET(createRequest())
    const body = await response.json()

    // Original HTTP behavior preserved (route already surfaces err.message).
    expect(response.status).toBe(500)
    expect(body.error).toBe('database connection lost')

    // Alert fired exactly once, correctly identified, no secrets.
    expect(sendOpsAlert).toHaveBeenCalledTimes(1)
    const alertArg = sendOpsAlert.mock.calls[0][0]
    expect(alertArg.severity).toBe('critical')
    expect(alertArg.type).toBe('ops:cron:gallery_download_cleanup_failed')
    expect(alertArg.message).toBe('database connection lost')

    const payload = JSON.stringify(alertArg)
    expect(payload).not.toMatch(/cron_secret_test/i)
    expect(payload).not.toMatch(/authorization/i)
    expect(payload).not.toMatch(/postgresql:\/\//i)
  })

  it('C. sendOpsAlert failure does not mask the original cleanup failure', async () => {
    cleanupGalleryDownloads.mockRejectedValue(new Error('database connection lost'))
    sendOpsAlert.mockRejectedValue(new Error('resend transport exploded'))

    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe('database connection lost')
  })

  it('unauthorized request: no alert', async () => {
    const response = await GET(createRequest('wrong-secret'))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
    expect(sendOpsAlert).not.toHaveBeenCalled()
  })
})
