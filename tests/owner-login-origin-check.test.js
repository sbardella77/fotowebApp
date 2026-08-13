import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateManagementToken, hashManagementToken } from '@/lib/server/management-token'

// Regression coverage for the login-CSRF finding: POST /api/owner/session and
// POST /api/owner/login used to accept requests from any Origin, letting a
// third-party site silently log a victim's browser into an attacker-chosen
// owner account (login CSRF) by relying on the browser accepting the
// resulting Set-Cookie regardless of SameSite=Lax. Both handlers now call
// verifySameOriginRequest(request) first, mirroring the existing pattern in
// setupAdmin/loginAdmin/resetOwnerPassword/setupOwnerPassword.

vi.mock('@/lib/server/gallery-repository', () => ({
  getGalleryRepository: vi.fn(),
  getGalleryRepositoryMode: vi.fn().mockResolvedValue('local'),
}))

vi.mock('@/lib/server/owner-resolution', () => ({
  resolveCanonicalOwner: vi.fn(),
  findOwnerByEmailWithPassword: vi.fn(),
}))

vi.mock('@/lib/server/prisma-client', () => ({
  getPrismaClient: vi.fn(),
}))

const OWNER_EMAIL = 'owner@example.com'
const ALLOWED_ORIGIN = 'https://snaprooms.app'
const EVIL_ORIGIN = 'https://evil.com'
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

function makeRequest(body, { origin, referer } = {}) {
  return {
    method: 'POST',
    headers: {
      get: (name) => {
        if (name === 'origin') return origin ?? null
        if (name === 'referer') return referer ?? null
        return null
      },
    },
    json: async () => body,
  }
}

async function setupOwnerMocks() {
  const owner = { id: 'owner-1', email: OWNER_EMAIL, sessionVersion: 0 }

  const { resolveCanonicalOwner, findOwnerByEmailWithPassword } = await import('@/lib/server/owner-resolution')
  resolveCanonicalOwner.mockResolvedValue(owner)
  findOwnerByEmailWithPassword.mockResolvedValue({ ...owner, passwordHash: 'x', passwordSalt: 'y' })

  const { getPrismaClient } = await import('@/lib/server/prisma-client')
  getPrismaClient.mockResolvedValue({
    owner: { findUnique: vi.fn().mockResolvedValue({ id: owner.id, email: owner.email, sessionVersion: owner.sessionVersion }) },
  })

  const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
  getGalleryRepository.mockResolvedValue({
    listEventsByOwnerEmail: vi.fn().mockResolvedValue([]),
    getEventBySlug: vi.fn(),
  })
}

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  restoreEnv()
  process.env.OWNER_SESSION_SECRET = 'test-owner-secret-'.repeat(3)
  process.env.NODE_ENV = 'test'
  process.env.ALLOWED_ORIGINS = ALLOWED_ORIGIN
  await setupOwnerMocks()
})

afterEach(() => {
  restoreEnv()
})

describe('POST /api/owner/session — origin check', () => {
  // A. Origin whitelistato → login può procedere (password branch)
  it('A: allows the request to proceed with a whitelisted Origin', async () => {
    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(
      makeRequest({ email: OWNER_EMAIL, password: 'whatever' }, { origin: ALLOWED_ORIGIN }),
      { params: { path: ['owner', 'session'] } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.authenticated).toBe(true)
    expect(response.headers.get('set-cookie')).toContain('snaprooms_owner_session=')
  })

  // B. Origin non whitelistato → 403
  it('B: rejects a non-whitelisted Origin with 403', async () => {
    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(
      makeRequest({ email: OWNER_EMAIL, password: 'whatever' }, { origin: EVIL_ORIGIN }),
      { params: { path: ['owner', 'session'] } },
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.code).toBe('origin_not_allowed')
  })

  // C. richiesta cross-origin rifiutata prima di creare cookie / consultare l'owner
  it('C: rejects before setting a cookie or resolving any owner', async () => {
    const { resolveCanonicalOwner, findOwnerByEmailWithPassword } = await import('@/lib/server/owner-resolution')
    const { POST } = await import('@/app/api/[[...path]]/route')

    const response = await POST(
      makeRequest({ email: OWNER_EMAIL, password: 'whatever' }, { origin: EVIL_ORIGIN }),
      { params: { path: ['owner', 'session'] } },
    )

    expect(response.headers.get('set-cookie')).toBeNull()
    expect(findOwnerByEmailWithPassword).not.toHaveBeenCalled()
    expect(resolveCanonicalOwner).not.toHaveBeenCalled()
  })

  // D. management token valido ma Origin malevolo → 403, mai verificato
  it('D: rejects a malicious Origin even with a valid management token, before verifying it', async () => {
    const managementToken = generateManagementToken()
    const managementTokenHash = hashManagementToken(managementToken)

    const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
    const getEventBySlug = vi.fn().mockResolvedValue({ slug: EVENT_SLUG, managementTokenHash })
    getGalleryRepository.mockResolvedValue({
      listEventsByOwnerEmail: vi.fn().mockResolvedValue([{ slug: EVENT_SLUG }]),
      getEventBySlug,
    })

    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(
      makeRequest({ email: OWNER_EMAIL, token: managementToken }, { origin: EVIL_ORIGIN }),
      { params: { path: ['owner', 'session'] } },
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.code).toBe('origin_not_allowed')
    // The origin check must short-circuit before any management-token verification.
    expect(getEventBySlug).not.toHaveBeenCalled()
    expect(response.headers.get('set-cookie')).toBeNull()
  })
})

describe('POST /api/owner/login — origin check', () => {
  // A. Origin whitelistato → login può procedere
  it('A: allows the request to proceed with a whitelisted Origin', async () => {
    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(
      makeRequest({ email: OWNER_EMAIL, password: 'whatever' }, { origin: ALLOWED_ORIGIN }),
      { params: { path: ['owner', 'login'] } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.authenticated).toBe(true)
    expect(response.headers.get('set-cookie')).toContain('snaprooms_owner_session=')
  })

  // B. Origin malevolo → 403
  it('B: rejects a malicious Origin with 403', async () => {
    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(
      makeRequest({ email: OWNER_EMAIL, password: 'whatever' }, { origin: EVIL_ORIGIN }),
      { params: { path: ['owner', 'login'] } },
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.code).toBe('origin_not_allowed')
  })

  // C. nessun cookie su richiesta rifiutata
  it('C: does not set a cookie on a rejected request', async () => {
    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(
      makeRequest({ email: OWNER_EMAIL, password: 'whatever' }, { origin: EVIL_ORIGIN }),
      { params: { path: ['owner', 'login'] } },
    )

    expect(response.headers.get('set-cookie')).toBeNull()
  })
})

describe('verifySameOriginRequest — behavior when Origin is missing (unchanged by this fix)', () => {
  // Documents the existing, unmodified fallback: Origin missing → falls back
  // to Referer; only rejected when BOTH are absent.

  it('falls back to an allowed Referer when Origin is absent', async () => {
    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(
      makeRequest(
        { email: OWNER_EMAIL, password: 'whatever' },
        { origin: null, referer: `${ALLOWED_ORIGIN}/dashboard/login` },
      ),
      { params: { path: ['owner', 'login'] } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.authenticated).toBe(true)
  })

  it('rejects with origin_missing when both Origin and Referer are absent', async () => {
    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(
      makeRequest({ email: OWNER_EMAIL, password: 'whatever' }, { origin: null, referer: null }),
      { params: { path: ['owner', 'login'] } },
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.code).toBe('origin_missing')
    expect(response.headers.get('set-cookie')).toBeNull()
  })
})
