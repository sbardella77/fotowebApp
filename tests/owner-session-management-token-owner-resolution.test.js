import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateManagementToken, hashManagementToken } from '@/lib/server/management-token'

// Exercises the management-token branch of loginOwner (POST /api/owner/session)
// end-to-end through the real route handler, to verify the invariant: this
// endpoint must never respond authenticated:true (or set a session cookie)
// unless it can also issue a token that will actually pass
// verifyOwnerSessionToken later on.

vi.mock('@/lib/server/gallery-repository', () => ({
  getGalleryRepository: vi.fn(),
  getGalleryRepositoryMode: vi.fn().mockResolvedValue('local'),
}))

vi.mock('@/lib/server/owner-resolution', () => ({
  resolveCanonicalOwner: vi.fn(),
}))

vi.mock('@/lib/server/prisma-client', () => ({
  getPrismaClient: vi.fn(),
}))

const OWNER_EMAIL = 'owner@example.com'
const EVENT_SLUG = 'wedding-2026'

const ORIGINAL_ENV = { ...process.env }

const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

function makeRequest(body, { origin = 'https://snaprooms.app' } = {}) {
  return {
    method: 'POST',
    headers: { get: (name) => (name === 'origin' ? origin : null) },
    json: async () => body,
  }
}

describe('POST /api/owner/session — management-token branch owner resolution', () => {
  let managementToken
  let managementTokenHash

  beforeEach(async () => {
    vi.resetModules()
    restoreEnv()
    process.env.OWNER_SESSION_SECRET = 'test-owner-secret-'.repeat(3)
    process.env.NODE_ENV = 'test'
    process.env.ALLOWED_ORIGINS = 'https://snaprooms.app'

    managementToken = generateManagementToken()
    managementTokenHash = hashManagementToken(managementToken)

    const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
    getGalleryRepository.mockResolvedValue({
      listEventsByOwnerEmail: vi.fn().mockResolvedValue([{ slug: EVENT_SLUG }]),
      getEventBySlug: vi.fn().mockResolvedValue({ slug: EVENT_SLUG, managementTokenHash }),
    })
  })

  afterEach(() => {
    restoreEnv()
  })

  // 1. management-token + sessionVersion > 0 → valid, verifiable session

  it('issues a verifiable session when the owner exists with sessionVersion > 0', async () => {
    const { resolveCanonicalOwner } = await import('@/lib/server/owner-resolution')
    const owner = { id: 'owner-1', email: OWNER_EMAIL, sessionVersion: 3 }
    resolveCanonicalOwner.mockResolvedValue(owner)

    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue({
      owner: {
        findUnique: vi.fn().mockResolvedValue({ id: owner.id, email: owner.email, sessionVersion: owner.sessionVersion }),
      },
    })

    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(
      makeRequest({ email: OWNER_EMAIL, token: managementToken }),
      { params: { path: ['owner', 'session'] } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.authenticated).toBe(true)

    const setCookie = response.headers.get('set-cookie')
    expect(setCookie).toContain('snaprooms_owner_session=')

    // Extract the issued token and confirm it round-trips with sessionVersion 3
    // through the real owner-auth verification (not just that a cookie exists).
    const cookieToken = decodeURIComponent(setCookie.match(/snaprooms_owner_session=([^;]+)/)[1])
    const [encodedPayload] = cookieToken.split('.')
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
    expect(payload.sessionVersion).toBe(3)

    const { verifyOwnerSessionToken } = await import('@/lib/server/owner-auth')
    expect(await verifyOwnerSessionToken(cookieToken)).toBe(OWNER_EMAIL)
  })

  // 2. resolveCanonicalOwner() = null → no authenticated:true, no cookie

  it('does not report authenticated:true or set a cookie when resolveCanonicalOwner returns null', async () => {
    const { resolveCanonicalOwner } = await import('@/lib/server/owner-resolution')
    resolveCanonicalOwner.mockResolvedValue(null)

    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(
      makeRequest({ email: OWNER_EMAIL, token: managementToken }),
      { params: { path: ['owner', 'session'] } },
    )
    const body = await response.json()

    expect(body.authenticated).not.toBe(true)
    expect(response.status).not.toBe(200)
    expect(response.headers.get('set-cookie')).toBeNull()
  })
})
