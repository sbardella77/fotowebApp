import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join } from 'path'

// P0 Gallery ZIP exposure closure (MINIMAL_P0: T2 + T3 + T4 + T5 + T6).
//
// The async gallery export used to write a PUBLIC Blob ZIP, persist its
// permanent URL in GalleryDownloadJob.resultUrl, return that URL to any slug
// holder from an unauthorized status GET (which also processed jobs inline),
// redirect to it from /api/gallery-downloads/[jobId] by jobId alone, and log
// it. These tests pin the closed state.

vi.mock('@upstash/redis', () => ({ Redis: vi.fn() }))

vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
  del: vi.fn(),
  get: vi.fn(),
  head: vi.fn(),
  list: vi.fn(),
}))

vi.mock('@/lib/server/prisma-client', () => ({
  getPrismaClient: vi.fn(),
  getAdminAuthDriver: vi.fn().mockReturnValue('env'),
}))

vi.mock('@/lib/server/gallery-repository', () => ({
  getGalleryRepository: vi.fn(),
  getGalleryRepositoryMode: vi.fn().mockResolvedValue('local'),
}))

vi.mock('@/lib/server/event-access', () => ({
  getEffectiveEventAccessState: vi.fn(),
}))

vi.mock('@/lib/server/download-representation', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, resolveDownloadRepresentation: vi.fn() }
})

const ROOT = resolve(import.meta.dirname, '..')
const readSource = (rel) => readFileSync(join(ROOT, rel), 'utf8')

const PUBLIC_ZIP_URL = 'https://abc123.public.blob.vercel-storage.com/gallery-downloads/wedding/job_legacy.zip'
const EVENT = { id: 'evt_1', slug: 'wedding', name: 'Wedding', billingTier: 'pro_event', ownerId: 'own_1' }
const LEGACY_JOB = {
  id: 'job_legacy',
  eventId: EVENT.id,
  status: 'READY',
  resultUrl: PUBLIC_ZIP_URL,
  error: 'raw provider error text',
  attempts: 1,
  lastAttemptAt: new Date('2026-09-01T10:00:00Z'),
  processedAt: new Date('2026-09-01T10:00:00Z'),
  createdAt: new Date('2026-09-01T09:59:00Z'),
  updatedAt: new Date('2026-09-01T10:00:00Z'),
}

let prismaMock
let consoleSpies

function makeRequest({ method = 'GET', ip = '203.0.113.7' } = {}) {
  return {
    method,
    url: 'https://snaprooms.app/api/test',
    headers: {
      get: (name) => {
        if (name === 'origin') return 'https://snaprooms.app'
        if (name === 'x-forwarded-for') return ip
        return null
      },
    },
    cookies: { get: () => undefined },
    json: async () => ({}),
  }
}

async function setupMocks({ event = EVENT, canDownloadGallery = true, job = LEGACY_JOB } = {}) {
  prismaMock = {
    galleryDownloadJob: {
      findFirst: vi.fn().mockResolvedValue(job),
      findUnique: vi.fn().mockResolvedValue(job),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    photo: { count: vi.fn(), findMany: vi.fn() },
    owner: { findUnique: vi.fn().mockResolvedValue(null) },
  }
  const { getPrismaClient } = await import('@/lib/server/prisma-client')
  getPrismaClient.mockResolvedValue(prismaMock)
  const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
  getGalleryRepository.mockResolvedValue({ getEventBySlug: vi.fn().mockResolvedValue(event) })
  const { getEffectiveEventAccessState } = await import('@/lib/server/event-access')
  getEffectiveEventAccessState.mockResolvedValue({ canDownloadGallery, hasUnbrandedDownloads: canDownloadGallery })
}

function allLoggedText() {
  return consoleSpies
    .flatMap((spy) => spy.mock.calls)
    .map((args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
    .join('\n')
}

async function expectNoStorageSideEffects() {
  const blob = await import('@vercel/blob')
  expect(blob.put).not.toHaveBeenCalled()
  expect(blob.del).not.toHaveBeenCalled()
  expect(blob.get).not.toHaveBeenCalled()
  expect(prismaMock.galleryDownloadJob.create).not.toHaveBeenCalled()
  expect(prismaMock.galleryDownloadJob.update).not.toHaveBeenCalled()
  expect(prismaMock.galleryDownloadJob.updateMany).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  delete process.env.UPSTASH_REDIS_REST_URL
  delete process.env.UPSTASH_REDIS_REST_TOKEN
  consoleSpies = ['log', 'info', 'warn', 'error'].map((level) => vi.spyOn(console, level).mockImplementation(() => {}))
})

afterEach(() => {
  consoleSpies.forEach((spy) => spy.mockRestore())
})

// ─── 1. SAFE DTO ─────────────────────────────────────────────────────────────

describe('1 — toClientGalleryDownloadJob is a strict allowlist', () => {
  it('drops resultUrl, eventId, error and bookkeeping from a legacy READY row', async () => {
    const { toClientGalleryDownloadJob } = await import('@/lib/server/gallery-download-job')
    const dto = toClientGalleryDownloadJob(LEGACY_JOB)
    expect(Object.keys(dto).sort()).toEqual(['createdAt', 'id', 'status'])
    const serialized = JSON.stringify(dto)
    expect(serialized).not.toContain('resultUrl')
    expect(serialized).not.toContain('blob.vercel-storage.com')
    expect(serialized).not.toContain(EVENT.id)
    expect(serialized).not.toContain('raw provider error')
  })

  it('maps a missing job to null', async () => {
    const { toClientGalleryDownloadJob } = await import('@/lib/server/gallery-download-job')
    expect(toClientGalleryDownloadJob(null)).toBeNull()
    expect(toClientGalleryDownloadJob(undefined)).toBeNull()
  })
})

// ─── 2 + 3. STATUS GET: authorization, safe DTO, no inline processing ───────

describe('2/3 — GET /api/events/:slug/gallery-download', () => {
  const callStatus = async (slug = EVENT.slug) => {
    const { GET } = await import('@/app/api/[[...path]]/route')
    const response = await GET(makeRequest(), { params: { path: ['events', slug, 'gallery-download'] } })
    return { response, body: await response.json() }
  }

  it('entitled request gets the safe DTO only — never resultUrl', async () => {
    await setupMocks()
    const { response, body } = await callStatus()
    expect(response.status).toBe(200)
    expect(body.job).toEqual({ id: LEGACY_JOB.id, status: 'READY', createdAt: LEGACY_JOB.createdAt.toISOString() })
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('resultUrl')
    expect(serialized).not.toContain('blob.vercel-storage.com')
  })

  it('not entitled → 403 without reading the job', async () => {
    await setupMocks({ canDownloadGallery: false })
    const { response, body } = await callStatus()
    expect(response.status).toBe(403)
    expect(JSON.stringify(body)).not.toContain('blob.vercel-storage.com')
    expect(prismaMock.galleryDownloadJob.findFirst).not.toHaveBeenCalled()
  })

  it('unknown event → 404 without reading any job', async () => {
    await setupMocks({ event: null })
    const { response } = await callStatus('no-such-room')
    expect(response.status).toBe(404)
    expect(prismaMock.galleryDownloadJob.findFirst).not.toHaveBeenCalled()
  })

  it('entitlement resolver failure fails closed (no job data)', async () => {
    await setupMocks()
    const { getEffectiveEventAccessState } = await import('@/lib/server/event-access')
    getEffectiveEventAccessState.mockRejectedValue(new Error('owner lookup failed'))
    const { response, body } = await callStatus()
    expect(response.status).toBe(503)
    expect(body.job).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('owner lookup failed')
    expect(prismaMock.galleryDownloadJob.findFirst).not.toHaveBeenCalled()
  })

  it('a PENDING job is never processed by the status GET', async () => {
    await setupMocks({ job: { ...LEGACY_JOB, status: 'PENDING', resultUrl: null, processedAt: null } })
    const { response, body } = await callStatus()
    expect(response.status).toBe(200)
    expect(body.job.status).toBe('PENDING')
    await expectNoStorageSideEffects()
    expect(prismaMock.photo.findMany).not.toHaveBeenCalled()
    expect(prismaMock.photo.count).not.toHaveBeenCalled()
  })

  it('is rate limited (60 / 10 min per IP + event)', async () => {
    await setupMocks()
    const { GET } = await import('@/app/api/[[...path]]/route')
    const statuses = []
    for (let i = 0; i < 61; i++) {
      const response = await GET(makeRequest({ ip: '198.51.100.9' }), { params: { path: ['events', EVENT.slug, 'gallery-download'] } })
      statuses.push(response.status)
    }
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true)
    expect(statuses[60]).toBe(429)
  })

  it('the job module no longer exports any processing/creation entry point', async () => {
    const jobModule = await import('@/lib/server/gallery-download-job')
    expect(jobModule.processGalleryDownloadJobIfPending).toBeUndefined()
    expect(jobModule.createGalleryDownloadJob).toBeUndefined()
  })
})

// ─── 4. NO PUBLIC PUT (static inventory) ────────────────────────────────────

function listSourceFiles(dir) {
  const out = []
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name)
    const stat = statSync(join(ROOT, rel))
    if (stat.isDirectory()) out.push(...listSourceFiles(rel))
    else if (/\.(js|jsx|ts|tsx|mjs|cjs)$/.test(name)) out.push(rel)
  }
  return out
}

describe('4 — no application path can create a gallery-downloads/*.zip Blob', () => {
  it('the job module does not import @vercel/blob, call put() or use access:public', () => {
    const src = readSource('lib/server/gallery-download-job.js')
    expect(src).not.toMatch(/@vercel\/blob/)
    expect(src).not.toMatch(/\bput\s*\(/)
    expect(src).not.toMatch(/access:\s*['"]public['"]/)
    expect(src).not.toMatch(/ZipArchive|archiver/)
  })

  it('no source file under app/ or lib/ builds a gallery-downloads/ Blob pathname', () => {
    const offenders = [...listSourceFiles('app'), ...listSourceFiles('lib')].filter((file) =>
      /gallery-downloads\/\$\{|['"`]gallery-downloads\/['"`]\s*\+/.test(readSource(file))
    )
    expect(offenders).toEqual([])
  })
})

// ─── 5. LEGACY jobId ENDPOINT ───────────────────────────────────────────────

describe('5 — GET /api/gallery-downloads/[jobId] is retired (410, no IDOR)', () => {
  const callLegacy = async (jobId) => {
    const { GET } = await import('@/app/api/gallery-downloads/[jobId]/route')
    const response = await GET(makeRequest(), { params: { jobId } })
    return { response, text: await response.text() }
  }

  it('known and random jobIds get the identical 410, no redirect, no URL, no DB/Blob access', async () => {
    await setupMocks()
    const known = await callLegacy(LEGACY_JOB.id)
    const random = await callLegacy('c' + Math.random().toString(36).slice(2))

    for (const { response, text } of [known, random]) {
      expect(response.status).toBe(410)
      expect(response.headers.get('location')).toBeNull()
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(text).not.toContain('blob.vercel-storage.com')
      expect(text).not.toContain('resultUrl')
    }
    expect(known.text).toBe(random.text)

    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    expect(getPrismaClient).not.toHaveBeenCalled()
    await expectNoStorageSideEffects()
  })

  it('the route source has no DB lookup and no redirect', () => {
    const code = readSource('app/api/gallery-downloads/[jobId]/route.js')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/getPrismaClient|galleryDownloadJob|resultUrl|redirect\(|@vercel\/blob/)
  })
})

// ─── 6. STALE CLIENT POST ───────────────────────────────────────────────────

describe('6 — POST /api/events/:slug/gallery-download refuses async creation', () => {
  const callCreate = async (slug = EVENT.slug) => {
    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(makeRequest({ method: 'POST' }), { params: { path: ['events', slug, 'gallery-download'] } })
    return { response, body: await response.json() }
  }

  it('entitled stale client → 409 export_unavailable, no job, no processing, no Blob', async () => {
    await setupMocks()
    const { response, body } = await callCreate()
    expect(response.status).toBe(409)
    expect(body.code).toBe('export_unavailable')
    expect(body.job).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('blob.vercel-storage.com')
    await expectNoStorageSideEffects()
    expect(prismaMock.galleryDownloadJob.findFirst).not.toHaveBeenCalled()
  })

  it('not entitled → 403, unknown event → 404 (server-side checks preserved)', async () => {
    await setupMocks({ canDownloadGallery: false })
    expect((await callCreate()).response.status).toBe(403)
    await setupMocks({ event: null })
    expect((await callCreate('no-such-room')).response.status).toBe(404)
  })
})

// ─── 7. >200 UI ─────────────────────────────────────────────────────────────

describe('7 — room page: >200 photos never starts the async flow', () => {
  const ROOM = readSource('components/room-page-client.jsx')

  it('no async create, no polling, no legacy download link remain in the client', () => {
    expect(ROOM).not.toContain('/gallery-download`')
    expect(ROOM).not.toContain('/api/gallery-downloads/')
    expect(ROOM).not.toMatch(/galleryJob/)
    expect(ROOM).not.toMatch(/setTimeout\(poll/)
  })

  it('shows the localized unavailable message and keeps the sync path for ≤200', () => {
    expect(ROOM).toContain('t.galleryLargeDownloadUnavailable')
    expect(ROOM).toContain('(activeEvent.photoCount || 0) <= 200')
    expect(ROOM).toContain('fetch(`/api/download/gallery?eventSlug=')
  })

  it('every locale has a non-empty room.galleryLargeDownloadUnavailable without internal terms', async () => {
    const { dictionaries } = await import('@/lib/i18n/dictionaries')
    for (const locale of ['en', 'de', 'it', 'fr', 'es', 'pt-BR']) {
      const value = dictionaries[locale]?.room?.galleryLargeDownloadUnavailable
      expect(typeof value).toBe('string')
      expect(value.length).toBeGreaterThan(0)
      expect(value.toLowerCase()).not.toMatch(/blob|zip|async|security|export_unavailable|410|409/)
    }
  })
})

// ─── 8. ≤200 SYNC STILL WORKS ───────────────────────────────────────────────

describe('8 — GET /api/download/gallery still streams a Standard ZIP', () => {
  it('entitled event → 200 private/no-store ZIP built via the Standard resolver', async () => {
    const photos = [
      { id: 'p1', originalName: 'a.jpg', storedName: 'a.jpg', mimeType: 'image/jpeg', url: 'https://x.public.blob.vercel-storage.com/events/wedding/a.jpg' },
      { id: 'p2', originalName: 'b.jpg', storedName: 'b.jpg', mimeType: 'image/jpeg', url: 'https://x.public.blob.vercel-storage.com/events/wedding/b.jpg' },
    ]
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue({
      event: { findUnique: vi.fn().mockResolvedValue(EVENT) },
      photo: { findMany: vi.fn().mockResolvedValue(photos) },
    })
    const access = { canDownloadGallery: true, hasUnbrandedDownloads: true, canDownloadOriginal: true }
    const { getEffectiveEventAccessState } = await import('@/lib/server/event-access')
    getEffectiveEventAccessState.mockResolvedValue(access)
    const { resolveDownloadRepresentation } = await import('@/lib/server/download-representation')
    resolveDownloadRepresentation.mockImplementation(async ({ photo }) => ({
      quality: 'standard',
      buffer: Buffer.from(`display-v1:${photo.id}`),
      contentType: 'image/jpeg',
      extension: '.jpg',
      representation: 'display-v1',
    }))

    const { GET } = await import('@/app/api/download/gallery/route')
    const response = await GET({
      url: `https://snaprooms.app/api/download/gallery?eventSlug=${EVENT.slug}`,
      headers: { get: (n) => (n === 'x-forwarded-for' ? '192.0.2.50' : null) },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/zip')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename=/)
    const bytes = Buffer.from(await response.arrayBuffer())
    expect(bytes.subarray(0, 2).toString()).toBe('PK')

    expect(resolveDownloadRepresentation).toHaveBeenCalledTimes(2)
    for (const [args] of resolveDownloadRepresentation.mock.calls) {
      expect(args.requestedQuality).toBe('standard')
    }
    const blob = await import('@vercel/blob')
    expect(blob.put).not.toHaveBeenCalled()
  })
})

// ─── 9. LOGGING ─────────────────────────────────────────────────────────────

describe('9 — a Gallery ZIP URL is never logged', () => {
  it('status GET on a job carrying a public resultUrl logs no URL', async () => {
    await setupMocks()
    const { GET } = await import('@/app/api/[[...path]]/route')
    await GET(makeRequest(), { params: { path: ['events', EVENT.slug, 'gallery-download'] } })
    const logged = allLoggedText()
    expect(logged).not.toContain('blob.vercel-storage.com')
    expect(logged).not.toContain(PUBLIC_ZIP_URL)
  })

  it('no log statement in the gallery job/cleanup modules interpolates a URL', () => {
    for (const file of ['lib/server/gallery-download-job.js', 'lib/server/gallery-download-cleanup.js']) {
      const logLines = readSource(file).split('\n').filter((line) => /console\.(log|info|warn|error)\(/.test(line))
      for (const line of logLines) {
        expect(line).not.toMatch(/resultUrl|blob\.url|url=/)
      }
    }
  })
})
