import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Real route-handler integration test — invokes the exported GET handler
// from @/app/api/[[...path]]/route, not just source/grep assertions. This
// is the only way to actually prove the auth-before-PostHog ordering.

vi.mock('@/lib/server/gallery-repository', () => ({
  getGalleryRepository: vi.fn(),
  getGalleryRepositoryMode: vi.fn().mockResolvedValue('local'),
}))

vi.mock('@/lib/server/prisma-client', () => ({
  getPrismaClient: vi.fn(),
  getAdminAuthDriver: vi.fn().mockReturnValue('env'),
}))

vi.mock('@/lib/server/owner-resolution', () => ({
  resolveCanonicalOwner: vi.fn(),
  findOwnerByEmailWithPassword: vi.fn(),
}))

vi.mock('@/lib/server/admin-analytics-posthog', () => ({
  getTrafficMetrics: vi.fn(),
}))

const ORIGINAL_ENV = { ...process.env }
const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

function makeRequest({ method = 'GET', url = 'https://snaprooms.app/api/admin/metrics/traffic', cookie } = {}) {
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

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  restoreEnv()
  process.env.NODE_ENV = 'test'
  process.env.ADMIN_SESSION_SECRET = 'test-admin-secret-'.repeat(3)
  process.env.OWNER_SESSION_SECRET = 'test-owner-secret-'.repeat(3)
  process.env.ADMIN_PASSWORD = 'CorrectHorseBatteryStaple1'
})

afterEach(() => {
  restoreEnv()
})

describe('GET /api/admin/metrics/traffic', () => {
  it('3. unauthenticated request is rejected with 401 and never calls PostHog', async () => {
    const { GET } = await import('@/app/api/[[...path]]/route')
    const { getTrafficMetrics } = await import('@/lib/server/admin-analytics-posthog')

    const response = await GET(makeRequest(), { params: { path: ['admin', 'metrics', 'traffic'] } })

    expect(response.status).toBe(401)
    expect(getTrafficMetrics).not.toHaveBeenCalled()
  })

  it('5. an invalid range is rejected with 400 and PostHog is never called', async () => {
    const { GET } = await import('@/app/api/[[...path]]/route')
    const { getTrafficMetrics } = await import('@/lib/server/admin-analytics-posthog')
    const cookie = await buildAdminCookie()

    const response = await GET(
      makeRequest({ url: 'https://snaprooms.app/api/admin/metrics/traffic?range=13d', cookie }),
      { params: { path: ['admin', 'metrics', 'traffic'] } },
    )

    expect(response.status).toBe(400)
    expect(getTrafficMetrics).not.toHaveBeenCalled()
  })

  it('4. arbitrary/SQL-shaped input in the range param cannot reach a query — rejected as an invalid enum value', async () => {
    const { GET } = await import('@/app/api/[[...path]]/route')
    const { getTrafficMetrics } = await import('@/lib/server/admin-analytics-posthog')
    const cookie = await buildAdminCookie()

    const response = await GET(
      makeRequest({
        url: `https://snaprooms.app/api/admin/metrics/traffic?range=${encodeURIComponent("30d'; DROP TABLE events; --")}`,
        cookie,
      }),
      { params: { path: ['admin', 'metrics', 'traffic'] } },
    )

    expect(response.status).toBe(400)
    expect(getTrafficMetrics).not.toHaveBeenCalled()
  })

  it("range=all is explicitly deferred (501), not silently accepted or rejected as invalid", async () => {
    const { GET } = await import('@/app/api/[[...path]]/route')
    const { getTrafficMetrics } = await import('@/lib/server/admin-analytics-posthog')
    const cookie = await buildAdminCookie()

    const response = await GET(
      makeRequest({ url: 'https://snaprooms.app/api/admin/metrics/traffic?range=all', cookie }),
      { params: { path: ['admin', 'metrics', 'traffic'] } },
    )

    expect(response.status).toBe(501)
    expect(getTrafficMetrics).not.toHaveBeenCalled()
  })

  it('authenticated admin + valid range returns aggregate-only data with no PII fields', async () => {
    const { GET } = await import('@/app/api/[[...path]]/route')
    const { getTrafficMetrics } = await import('@/lib/server/admin-analytics-posthog')
    getTrafficMetrics.mockResolvedValue({
      visitors: { count: 10, daily: [{ date: '2026-09-01', visitors: 10 }] },
      sharing: { totalActions: 2, roomsWithShareIntent: 1, byType: { whatsapp: 2, native: 0, copyLink: 0, qr: 0 } },
      guestRoomReach: { views: 5, roomsReached: 2 },
    })
    const cookie = await buildAdminCookie()

    const response = await GET(
      makeRequest({ url: 'https://snaprooms.app/api/admin/metrics/traffic?range=7d', cookie }),
      { params: { path: ['admin', 'metrics', 'traffic'] } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(getTrafficMetrics).toHaveBeenCalledWith('7d')
    expect(body.range).toBe('7d')
    expect(body.source).toBe('posthog')
    expect(body.visitors.count).toBe(10)

    const serialized = JSON.stringify(body)
    expect(serialized).not.toMatch(/@/) // no email addresses
    expect(serialized.toLowerCase()).not.toContain('distinct_id')
    expect(serialized.toLowerCase()).not.toContain('personid')
    expect(serialized.toLowerCase()).not.toContain('ip_address')
  })

  it('defaults to range=30d when no range param is given', async () => {
    const { GET } = await import('@/app/api/[[...path]]/route')
    const { getTrafficMetrics } = await import('@/lib/server/admin-analytics-posthog')
    getTrafficMetrics.mockResolvedValue({
      visitors: { count: 0, daily: [] },
      sharing: { totalActions: 0, roomsWithShareIntent: 0, byType: { whatsapp: 0, native: 0, copyLink: 0, qr: 0 } },
      guestRoomReach: { views: 0, roomsReached: 0 },
    })
    const cookie = await buildAdminCookie()

    await GET(makeRequest({ cookie }), { params: { path: ['admin', 'metrics', 'traffic'] } })

    expect(getTrafficMetrics).toHaveBeenCalledWith('30d')
  })

  it('7. a PostHogQueryError never leaks the raw upstream error body to the client', async () => {
    const { GET } = await import('@/app/api/[[...path]]/route')
    const { getTrafficMetrics } = await import('@/lib/server/admin-analytics-posthog')
    const { PostHogQueryError, POSTHOG_ERROR } = await import('@/lib/server/posthog-query')
    getTrafficMetrics.mockRejectedValue(
      new PostHogQueryError(POSTHOG_ERROR.QUERY_FAILED, 'upstream said: <secret internal trace id abc123>'),
    )
    const cookie = await buildAdminCookie()

    const response = await GET(
      makeRequest({ url: 'https://snaprooms.app/api/admin/metrics/traffic?range=7d', cookie }),
      { params: { path: ['admin', 'metrics', 'traffic'] } },
    )
    const body = await response.json()

    expect(response.status).toBe(502)
    expect(JSON.stringify(body)).not.toContain('abc123')
    expect(JSON.stringify(body)).not.toContain('upstream said')
  })

  it('a POSTHOG_NOT_CONFIGURED error maps to a safe 503, not a crash', async () => {
    const { GET } = await import('@/app/api/[[...path]]/route')
    const { getTrafficMetrics } = await import('@/lib/server/admin-analytics-posthog')
    const { PostHogQueryError, POSTHOG_ERROR } = await import('@/lib/server/posthog-query')
    getTrafficMetrics.mockRejectedValue(new PostHogQueryError(POSTHOG_ERROR.NOT_CONFIGURED, 'not configured'))
    const cookie = await buildAdminCookie()

    const response = await GET(
      makeRequest({ url: 'https://snaprooms.app/api/admin/metrics/traffic?range=7d', cookie }),
      { params: { path: ['admin', 'metrics', 'traffic'] } },
    )
    expect(response.status).toBe(503)
  })
})
