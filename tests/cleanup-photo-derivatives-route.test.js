import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

// STEP 7.15d §19/§45 — the reconciliation cron surface.
//
// This route is the only way the sweep can ever run, so its auth contract is
// the boundary that keeps a deletion mechanism from becoming a public one. It
// deliberately reuses the existing CRON_SECRET model rather than inventing a
// second one.

vi.mock('@/lib/server/derivative-cleanup', () => ({ cleanupPhotoDerivatives: vi.fn() }))
vi.mock('@/lib/server/ops-alerts', () => ({ sendOpsAlert: vi.fn().mockResolvedValue({ sent: true }) }))

import { GET, POST } from '@/app/api/cron/cleanup-photo-derivatives/route'
import { cleanupPhotoDerivatives } from '@/lib/server/derivative-cleanup'
import { sendOpsAlert } from '@/lib/server/ops-alerts'

const originalEnv = process.env
const SECRET = 'cron_secret_test'

const STATS = {
  pages: 2,
  scanned: 12,
  valid: 11,
  malformedIgnored: 1,
  visibleKept: 8,
  hiddenDeleted: 2,
  absentDeleted: 1,
  deleteFailures: 0,
}

beforeAll(() => {
  process.env = { ...originalEnv, CRON_SECRET: SECRET }
})

afterAll(() => {
  process.env = originalEnv
})

function createRequest({ secret = SECRET, header } = {}) {
  const value = header !== undefined ? header : `Bearer ${secret}`
  return {
    headers: { get: vi.fn((name) => (name.toLowerCase() === 'authorization' ? value : null)) },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = SECRET
  sendOpsAlert.mockResolvedValue({ sent: true })
})

describe('cleanup-photo-derivatives cron — auth (§45)', () => {
  it.each([
    ['missing authorization header', { header: null }],
    ['wrong secret', { secret: 'not-the-secret' }],
    ['empty bearer', { header: 'Bearer ' }],
    ['raw secret without Bearer prefix', { header: 'cron_secret_test_wrong' }],
  ])('rejects %s with 401 and never runs the sweep', async (_label, requestOptions) => {
    const response = await GET(createRequest(requestOptions))

    expect(response.status).toBe(401)
    expect(cleanupPhotoDerivatives).not.toHaveBeenCalled()
  })

  it('rejects unauthorized POST as well — no second, laxer surface', async () => {
    const response = await POST(createRequest({ secret: 'nope' }))

    expect(response.status).toBe(401)
    expect(cleanupPhotoDerivatives).not.toHaveBeenCalled()
  })

  it('returns 503 and runs nothing when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET

    const response = await GET(createRequest())

    expect(response.status).toBe(503)
    expect(cleanupPhotoDerivatives).not.toHaveBeenCalled()
  })

  it('accepts the correct secret on GET and POST', async () => {
    cleanupPhotoDerivatives.mockResolvedValue(STATS)

    expect((await GET(createRequest())).status).toBe(200)
    expect((await POST(createRequest())).status).toBe(200)
    expect(cleanupPhotoDerivatives).toHaveBeenCalledTimes(2)
  })
})

describe('cleanup-photo-derivatives cron — success', () => {
  it('returns aggregate counters only — no ids, no pathnames (§28)', async () => {
    cleanupPhotoDerivatives.mockResolvedValue(STATS)

    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, ...STATS })
    expect(typeof body.durationMs).toBe('number')

    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('derivatives/')
    expect(serialized).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/)
    expect(sendOpsAlert).not.toHaveBeenCalled()
  })
})

describe('cleanup-photo-derivatives cron — failure (§44)', () => {
  it('surfaces a 500 and sends exactly one critical ops alert', async () => {
    cleanupPhotoDerivatives.mockRejectedValue(new Error('Database unavailable'))

    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe('Database unavailable')
    expect(sendOpsAlert).toHaveBeenCalledTimes(1)

    const alert = sendOpsAlert.mock.calls[0][0]
    expect(alert.severity).toBe('critical')
    expect(alert.type).toBe('ops:cron:photo_derivative_cleanup_failed')

    const payload = JSON.stringify(alert)
    expect(payload).not.toMatch(/cron_secret_test/i)
    expect(payload).not.toMatch(/vercel_blob_rw/i)
    expect(payload).not.toMatch(/postgresql:\/\//i)
  })

  it('an ops-alert failure does not mask the original cleanup failure', async () => {
    cleanupPhotoDerivatives.mockRejectedValue(new Error('Derivative sweep aborted: derivative listing unavailable'))
    sendOpsAlert.mockRejectedValue(new Error('resend transport exploded'))

    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe('Derivative sweep aborted: derivative listing unavailable')
  })
})
