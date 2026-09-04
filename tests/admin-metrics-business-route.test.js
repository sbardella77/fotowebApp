import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Real route-handler integration test — invokes the exported GET handler
// from @/app/api/[[...path]]/route, mirroring
// tests/admin-metrics-traffic-route.test.js's approach so auth-before-query
// ordering is actually proven, not just asserted from source.

vi.mock('@/lib/server/gallery-repository', () => ({
  getGalleryRepository: vi.fn(),
  getGalleryRepositoryMode: vi.fn().mockResolvedValue('local'),
}))

vi.mock('@/lib/server/owner-resolution', () => ({
  resolveCanonicalOwner: vi.fn(),
  findOwnerByEmailWithPassword: vi.fn(),
}))

vi.mock('@/lib/server/admin-analytics-posthog', () => ({
  getTrafficMetrics: vi.fn(),
}))

vi.mock('@/lib/server/admin-business-dashboard', () => ({
  getAdminBusinessMetrics: vi.fn(),
}))

const FAKE_PRISMA = {}

vi.mock('@/lib/server/prisma-client', () => ({
  getPrismaClient: vi.fn(),
  getAdminAuthDriver: vi.fn().mockReturnValue('env'),
}))

const ORIGINAL_ENV = { ...process.env }
const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

function makeRequest({ method = 'GET', url = 'https://snaprooms.app/api/admin/metrics/business', cookie } = {}) {
  return {
    method,
    url,
    headers: { get: () => null },
    cookies: { get: (name) => (cookie && cookie.name === name ? { value: cookie.value } : undefined) },
    json: async () => ({}),
  }
}

async function buildAdminCookie() {
  const { createAdminSessionToken, ADMIN_COOKIE_NAME } = await import('@/lib/server/admin-auth')
  return { name: ADMIN_COOKIE_NAME, value: await createAdminSessionToken() }
}

function fakeBusinessMetrics(overrides = {}) {
  return {
    range: '30d',
    generatedAt: '2026-09-04T00:00:00.000Z',
    since: '2026-08-05T00:00:00.000Z',
    until: '2026-09-04T00:00:00.000Z',
    previous: { since: '2026-07-06T00:00:00.000Z', until: '2026-08-05T00:00:00.000Z' },
    postHog: { status: 'ok' },
    acquisition: {
      visitors: { current: 100 },
      signups: { current: 10, previous: 5, percentageChange: { value: 100, trend: 'up' } },
    },
    activation: {
      eventsCreated: { current: 8, previous: 4, percentageChange: { value: 100, trend: 'up' } },
      firstEvents: { current: 6, previous: 3, percentageChange: { value: 100, trend: 'up' } },
      coreActivatedOwners: { current: 3, previous: 1, percentageChange: { value: 200, trend: 'up' } },
    },
    engagement: { roomsWithShareIntent: 2, shareActions: 5, roomsReached: 3, guestRoomViews: 9 },
    monetization: { paidAccounts: 2 },
    funnel: {
      isStageFunnel: true,
      stages: [
        { key: 'visitors', label: 'Visitors', count: 100, conversionFromPrevious: null },
        { key: 'signups', label: 'Signups', count: 10, conversionFromPrevious: 10 },
        { key: 'firstEvents', label: 'First Event', count: 6, conversionFromPrevious: 60 },
        { key: 'coreActivated', label: 'Core Activation', count: 3, conversionFromPrevious: 50 },
        { key: 'paid', label: 'Paid', count: 2, conversionFromPrevious: 66.7 },
      ],
    },
    trends: { visitors: [], signups: [], eventsCreated: [], coreActivation: [] },
    ...overrides,
  }
}

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  restoreEnv()
  process.env.NODE_ENV = 'test'
  process.env.ADMIN_SESSION_SECRET = 'test-admin-secret-'.repeat(3)
  process.env.OWNER_SESSION_SECRET = 'test-owner-secret-'.repeat(3)
  process.env.ADMIN_PASSWORD = 'CorrectHorseBatteryStaple1'
  const { getPrismaClient } = await import('@/lib/server/prisma-client')
  getPrismaClient.mockResolvedValue(FAKE_PRISMA)
})

afterEach(() => {
  restoreEnv()
})

describe('GET /api/admin/metrics/business', () => {
  it('unauthenticated request is rejected with 401 and never computes metrics', async () => {
    const { GET } = await import('@/app/api/[[...path]]/route')
    const { getAdminBusinessMetrics } = await import('@/lib/server/admin-business-dashboard')

    const response = await GET(makeRequest(), { params: { path: ['admin', 'metrics', 'business'] } })

    expect(response.status).toBe(401)
    expect(getAdminBusinessMetrics).not.toHaveBeenCalled()
  })

  it('auth happens before any Postgres/PostHog work: an invalid range is rejected with 400 and metrics are never computed', async () => {
    const { GET } = await import('@/app/api/[[...path]]/route')
    const { getAdminBusinessMetrics } = await import('@/lib/server/admin-business-dashboard')
    const cookie = await buildAdminCookie()

    const response = await GET(
      makeRequest({ url: 'https://snaprooms.app/api/admin/metrics/business?range=13d', cookie }),
      { params: { path: ['admin', 'metrics', 'business'] } },
    )

    expect(response.status).toBe(400)
    expect(getAdminBusinessMetrics).not.toHaveBeenCalled()
  })

  it("range=all is deferred (501), matching admin/metrics/traffic", async () => {
    const { GET } = await import('@/app/api/[[...path]]/route')
    const { getAdminBusinessMetrics } = await import('@/lib/server/admin-business-dashboard')
    const cookie = await buildAdminCookie()

    const response = await GET(
      makeRequest({ url: 'https://snaprooms.app/api/admin/metrics/business?range=all', cookie }),
      { params: { path: ['admin', 'metrics', 'business'] } },
    )

    expect(response.status).toBe(501)
    expect(getAdminBusinessMetrics).not.toHaveBeenCalled()
  })

  it.each(['7d', '30d', '90d'])('accepts range=%s for an authenticated admin', async (range) => {
    const { GET } = await import('@/app/api/[[...path]]/route')
    const { getAdminBusinessMetrics } = await import('@/lib/server/admin-business-dashboard')
    getAdminBusinessMetrics.mockResolvedValue(fakeBusinessMetrics({ range }))
    const cookie = await buildAdminCookie()

    const response = await GET(
      makeRequest({ url: `https://snaprooms.app/api/admin/metrics/business?range=${range}`, cookie }),
      { params: { path: ['admin', 'metrics', 'business'] } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(getAdminBusinessMetrics).toHaveBeenCalledWith({ prisma: FAKE_PRISMA, range })
    expect(body.range).toBe(range)
  })

  it('defaults to range=30d when no range param is given', async () => {
    const { GET } = await import('@/app/api/[[...path]]/route')
    const { getAdminBusinessMetrics } = await import('@/lib/server/admin-business-dashboard')
    getAdminBusinessMetrics.mockResolvedValue(fakeBusinessMetrics())
    const cookie = await buildAdminCookie()

    await GET(makeRequest({ cookie }), { params: { path: ['admin', 'metrics', 'business'] } })

    expect(getAdminBusinessMetrics).toHaveBeenCalledWith({ prisma: FAKE_PRISMA, range: '30d' })
  })

  it('database unavailable (no prisma client) returns 503 and never computes metrics', async () => {
    const { GET } = await import('@/app/api/[[...path]]/route')
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    const { getAdminBusinessMetrics } = await import('@/lib/server/admin-business-dashboard')
    getPrismaClient.mockResolvedValue(null)
    const cookie = await buildAdminCookie()

    const response = await GET(
      makeRequest({ url: 'https://snaprooms.app/api/admin/metrics/business?range=7d', cookie }),
      { params: { path: ['admin', 'metrics', 'business'] } },
    )

    expect(response.status).toBe(503)
    expect(getAdminBusinessMetrics).not.toHaveBeenCalled()
  })

  it('an unexpected orchestration failure returns a safe 502 without leaking internals', async () => {
    const { GET } = await import('@/app/api/[[...path]]/route')
    const { getAdminBusinessMetrics } = await import('@/lib/server/admin-business-dashboard')
    getAdminBusinessMetrics.mockRejectedValue(new Error('internal trace id abc123 connection string leaked'))
    const cookie = await buildAdminCookie()

    const response = await GET(
      makeRequest({ url: 'https://snaprooms.app/api/admin/metrics/business?range=7d', cookie }),
      { params: { path: ['admin', 'metrics', 'business'] } },
    )
    const body = await response.json()

    expect(response.status).toBe(502)
    expect(JSON.stringify(body)).not.toContain('abc123')
    expect(JSON.stringify(body)).not.toContain('connection string')
  })

  it('response contains only aggregate fields — no PII, no identifiers', async () => {
    const { GET } = await import('@/app/api/[[...path]]/route')
    const { getAdminBusinessMetrics } = await import('@/lib/server/admin-business-dashboard')
    getAdminBusinessMetrics.mockResolvedValue(fakeBusinessMetrics())
    const cookie = await buildAdminCookie()

    const response = await GET(
      makeRequest({ url: 'https://snaprooms.app/api/admin/metrics/business?range=30d', cookie }),
      { params: { path: ['admin', 'metrics', 'business'] } },
    )
    const body = await response.json()
    const serialized = JSON.stringify(body)

    expect(response.status).toBe(200)
    expect(serialized).not.toMatch(/@/) // no email addresses
    expect(serialized.toLowerCase()).not.toContain('distinct_id')
    expect(serialized.toLowerCase()).not.toContain('personid')
    expect(serialized.toLowerCase()).not.toContain('ip_address')
    expect(serialized.toLowerCase()).not.toContain('stripecustomerid')
    expect(serialized.toLowerCase()).not.toContain('stripesubscriptionid')
    expect(serialized.toLowerCase()).not.toContain('ownerid')
    expect(serialized.toLowerCase()).not.toContain('sessionid')
  })

  it('zero-value metrics are preserved as zero, not omitted or coerced', async () => {
    const { GET } = await import('@/app/api/[[...path]]/route')
    const { getAdminBusinessMetrics } = await import('@/lib/server/admin-business-dashboard')
    getAdminBusinessMetrics.mockResolvedValue(fakeBusinessMetrics({
      acquisition: { visitors: { current: 0 }, signups: { current: 0, previous: 0, percentageChange: { value: 0, trend: 'flat' } } },
      monetization: { paidAccounts: 0 },
    }))
    const cookie = await buildAdminCookie()

    const response = await GET(
      makeRequest({ url: 'https://snaprooms.app/api/admin/metrics/business?range=30d', cookie }),
      { params: { path: ['admin', 'metrics', 'business'] } },
    )
    const body = await response.json()

    expect(body.acquisition.visitors.current).toBe(0)
    expect(body.acquisition.signups.current).toBe(0)
    expect(body.monetization.paidAccounts).toBe(0)
  })
})
