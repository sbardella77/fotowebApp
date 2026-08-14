import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

vi.mock('@vercel/blob', () => ({ head: vi.fn() }))
vi.mock('@/lib/server/prisma-client', () => ({ getPrismaClient: vi.fn() }))
vi.mock('@/lib/server/storage', () => ({ deleteStoredFile: vi.fn() }))
vi.mock('@/lib/server/blob-upload-cleanup', () => ({ cleanupBlobUploadSessions: vi.fn() }))
vi.mock('@/lib/server/ops-alerts', () => ({ sendOpsAlert: vi.fn().mockResolvedValue({ sent: true }) }))

import { GET } from '@/app/api/cron/cleanup-blob-uploads/route'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { cleanupBlobUploadSessions } from '@/lib/server/blob-upload-cleanup'
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
  getPrismaClient.mockResolvedValue({ fakePrisma: true })
})

describe('GET /api/cron/cleanup-blob-uploads — ops alerting', () => {
  it('A. success: sendOpsAlert is not called', async () => {
    cleanupBlobUploadSessions.mockResolvedValue({ scanned: 3, deleted: 1 })

    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(sendOpsAlert).not.toHaveBeenCalled()
  })

  it('B. fatal cleanup failure: preserves original HTTP semantics and sends exactly one critical alert', async () => {
    cleanupBlobUploadSessions.mockRejectedValue(new Error('blob storage unreachable'))

    const response = await GET(createRequest())
    const body = await response.json()

    // Original HTTP behavior preserved.
    expect(response.status).toBe(500)
    expect(body.error).toBe('Blob upload cleanup failed')

    // Alert fired exactly once, correctly identified, no secrets.
    expect(sendOpsAlert).toHaveBeenCalledTimes(1)
    const alertArg = sendOpsAlert.mock.calls[0][0]
    expect(alertArg.severity).toBe('critical')
    expect(alertArg.type).toBe('ops:cron:blob_upload_cleanup_failed')
    expect(alertArg.message).toBe('blob storage unreachable')

    const payload = JSON.stringify(alertArg)
    expect(payload).not.toMatch(/cron_secret_test/i)
    expect(payload).not.toMatch(/authorization/i)
    expect(payload).not.toMatch(/postgresql:\/\//i)
  })

  it('C. sendOpsAlert failure does not mask the original cleanup failure', async () => {
    cleanupBlobUploadSessions.mockRejectedValue(new Error('blob storage unreachable'))
    sendOpsAlert.mockRejectedValue(new Error('resend transport exploded'))

    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe('Blob upload cleanup failed')
  })

  it('database unavailable: no alert (unchanged precondition behavior)', async () => {
    getPrismaClient.mockResolvedValue(null)

    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.error).toBe('Database not available')
    expect(sendOpsAlert).not.toHaveBeenCalled()
  })
})
