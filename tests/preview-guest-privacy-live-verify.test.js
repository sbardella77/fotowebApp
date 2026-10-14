import { describe, it, expect, vi } from 'vitest'
import {
  redactUrl,
  containsRawUrl,
  isDeploymentProtectionRedirect,
  fetchWithSafeRedirects,
  parseSupportedSetCookies,
  MAX_REDIRECT_HOPS,
  READY_FIXTURE_STATE,
  FAILED_FIXTURE_STATE,
  findPhotoAcrossPages,
  verifyLiveDto,
  OG_CLASSIFICATION,
  classifyOgImage,
  DOWNLOAD_CONTRACT_CLASSIFICATION,
  classifyDownloadContract,
  verifyPageAndOg,
  scanDownloadContractInHtml,
  fetchRuntimeLogSummary,
  main,
} from '../scripts/preview-guest-privacy-live-verify.mjs'

// scripts/preview-guest-privacy-live-verify.mjs was NEVER run against real
// Preview data in this session — there is no Preview DATABASE_URL or Vercel
// Protection Bypass secret available. Every test here uses fully synthetic
// fixtures to prove the script's own logic is correct and, critically, that
// its report can never leak a raw original URL — before anyone runs it for
// real.

const ORIGINAL_READY_URL = 'https://store123.public.blob.vercel-storage.com/events/wedding/uuid-ready-photo.jpg'
const ORIGINAL_FAILED_URL = 'https://store123.public.blob.vercel-storage.com/events/wedding/uuid-failed-photo.jpg'
const DERIVATIVE_READY_URL = 'https://store123.public.blob.vercel-storage.com/derivatives/display-v1/photo-ready.jpg'

function makeResponse({ status = 200, headers = {}, jsonBody, textBody, setCookie }) {
  const headerMap = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    status,
    headers: {
      get: (name) => headerMap.get(name.toLowerCase()) || null,
      // Mirrors Node's native fetch (undici) Headers#getSetCookie(), which
      // is how multiple real Set-Cookie response headers are actually read
      // (the Fetch spec forbids combining them behind a single #get()).
      getSetCookie: setCookie ? () => setCookie : undefined,
    },
    text: async () => (textBody !== undefined ? textBody : JSON.stringify(jsonBody)),
    json: async () => jsonBody,
  }
}

describe('redactUrl — never returns the raw string', () => {
  it('returns host/pathClass/hash, never the literal URL', () => {
    const result = redactUrl(ORIGINAL_READY_URL)
    expect(result.present).toBe(true)
    expect(result.host).toBe('store123.public.blob.vercel-storage.com')
    expect(result.pathClass).toBe('/events/wedding/<redacted-filename>')
    expect(JSON.stringify(result)).not.toContain('uuid-ready-photo')
  })

  it('null/undefined → { present: false }, never throws', () => {
    expect(redactUrl(null)).toEqual({ present: false })
    expect(redactUrl(undefined)).toEqual({ present: false })
  })

  it('unparseable input degrades to host: UNPARSEABLE, never throws', () => {
    const result = redactUrl('not a url')
    expect(result.present).toBe(true)
    expect(result.host).toBe('UNPARSEABLE')
  })
})

describe('containsRawUrl / isDeploymentProtectionRedirect', () => {
  it('detects presence and absence correctly', () => {
    expect(containsRawUrl(`<img src="${ORIGINAL_READY_URL}">`, ORIGINAL_READY_URL)).toBe(true)
    expect(containsRawUrl(`<img src="${DERIVATIVE_READY_URL}">`, ORIGINAL_READY_URL)).toBe(false)
    expect(containsRawUrl('', ORIGINAL_READY_URL)).toBe(false)
  })

  it('recognizes a Vercel SSO redirect (302 to vercel.com)', () => {
    const res = makeResponse({ status: 302, headers: { location: 'https://vercel.com/sso-api?url=...' } })
    expect(isDeploymentProtectionRedirect(res)).toBe(true)
  })

  it('does not misclassify a normal same-app redirect', () => {
    const res = makeResponse({ status: 302, headers: { location: 'https://fotoweb-app-preview.vercel.app/somewhere' } })
    expect(isDeploymentProtectionRedirect(res)).toBe(false)
  })

  it('does not misclassify a 200 response', () => {
    const res = makeResponse({ status: 200, jsonBody: {} })
    expect(isDeploymentProtectionRedirect(res)).toBe(false)
  })
})

describe('verifyLiveDto', () => {
  it('READY: passes when the DTO exposes the derivative, not the original, with status hidden', async () => {
    const fetchImpl = vi.fn(async () =>
      makeResponse({ jsonBody: { photos: [{ id: 'photo-ready', url: DERIVATIVE_READY_URL, originalName: 'x.jpg' }] } }),
    )
    const result = await verifyLiveDto({
      fetchImpl,
      previewUrl: 'https://preview.test',
      slug: 'wedding',
      photoId: 'photo-ready',
      expectedStatus: 'READY',
      originalUrl: ORIGINAL_READY_URL,
    })

    expect(result.blocked).toBe(false)
    expect(result.derivativeNonNull).toBe(true)
    expect(result.derivativeIsDisplayV1).toBe(true)
    expect(result.urlDiffersFromOriginal).toBe(true)
    expect(result.originalExcluded).toBe(true)
    expect(result.statusFieldHidden).toBe(true)
  })

  it('READY: catches a regression where the API still returns the original url', async () => {
    const fetchImpl = vi.fn(async () =>
      makeResponse({ jsonBody: { photos: [{ id: 'photo-ready', url: ORIGINAL_READY_URL }] } }),
    )
    const result = await verifyLiveDto({
      fetchImpl,
      previewUrl: 'https://preview.test',
      slug: 'wedding',
      photoId: 'photo-ready',
      expectedStatus: 'READY',
      originalUrl: ORIGINAL_READY_URL,
    })

    expect(result.urlDiffersFromOriginal).toBe(false) // FAIL condition, correctly detected
    expect(result.derivativeIsDisplayV1).toBe(false)
  })

  it('READY: catches a regression where displayDerivativeStatus is exposed', async () => {
    const fetchImpl = vi.fn(async () =>
      makeResponse({ jsonBody: { photos: [{ id: 'photo-ready', url: DERIVATIVE_READY_URL, displayDerivativeStatus: 'READY' }] } }),
    )
    const result = await verifyLiveDto({
      fetchImpl,
      previewUrl: 'https://preview.test',
      slug: 'wedding',
      photoId: 'photo-ready',
      expectedStatus: 'READY',
      originalUrl: ORIGINAL_READY_URL,
    })

    expect(result.statusFieldHidden).toBe(false) // FAIL condition, correctly detected
  })

  it('FAILED: passes when url is null and the original never appears in the raw response body', async () => {
    const fetchImpl = vi.fn(async () =>
      makeResponse({ jsonBody: { photos: [{ id: 'photo-failed', url: null, originalName: 'y.jpg' }] } }),
    )
    const result = await verifyLiveDto({
      fetchImpl,
      previewUrl: 'https://preview.test',
      slug: 'wedding',
      photoId: 'photo-failed',
      expectedStatus: 'FAILED',
      originalUrl: ORIGINAL_FAILED_URL,
    })

    expect(result.blocked).toBe(false)
    expect(result.urlIsNull).toBe(true)
    expect(result.originalExcluded).toBe(true)
    expect(result.statusFieldHidden).toBe(true)
  })

  it('FAILED: catches a regression where the original url leaks anywhere in the raw response text', async () => {
    // e.g. some OTHER field on the same payload accidentally echoing it
    const fetchImpl = vi.fn(async () =>
      makeResponse({ textBody: JSON.stringify({ photos: [{ id: 'photo-failed', url: null }] }) + `<!-- debug: ${ORIGINAL_FAILED_URL} -->` }),
    )
    const result = await verifyLiveDto({
      fetchImpl,
      previewUrl: 'https://preview.test',
      slug: 'wedding',
      photoId: 'photo-failed',
      expectedStatus: 'FAILED',
      originalUrl: ORIGINAL_FAILED_URL,
    })

    expect(result.blocked).toBe(true) // non-JSON-parseable text is reported blocked, not silently ignored
  })

  it('reports blocked with DEPLOYMENT_PROTECTION_NOT_BYPASSED instead of misreading the SSO page as content', async () => {
    const fetchImpl = vi.fn(async () => makeResponse({ status: 302, headers: { location: 'https://vercel.com/sso-api?url=x' } }))
    const result = await verifyLiveDto({
      fetchImpl,
      previewUrl: 'https://preview.test',
      slug: 'wedding',
      photoId: 'photo-ready',
      expectedStatus: 'READY',
      originalUrl: ORIGINAL_READY_URL,
    })
    expect(result.blocked).toBe(true)
    expect(result.reason).toBe('DEPLOYMENT_PROTECTION_NOT_BYPASSED')
    expect(result.redirectChain).toEqual([{ hop: 0, status: 302, locationPresent: true, host: 'vercel.com', path: '/sso-api' }])
  })

  it('sends the bypass header when a secret is provided', async () => {
    const fetchImpl = vi.fn(async () => makeResponse({ jsonBody: { photos: [] } }))
    await verifyLiveDto({
      fetchImpl,
      previewUrl: 'https://preview.test',
      bypassSecret: 'shh',
      slug: 'wedding',
      photoId: 'photo-ready',
      expectedStatus: 'READY',
      originalUrl: ORIGINAL_READY_URL,
    })
    const [, options] = fetchImpl.mock.calls[0]
    expect(options.headers['x-vercel-protection-bypass']).toBe('shh')
  })
})

describe('verifyPageAndOg', () => {
  it('READY page: original absent, OG image is the derivative, download contract uses photoId', async () => {
    const html = `<html><head><meta property="og:image" content="${DERIVATIVE_READY_URL}"></head><body>
      <img src="${DERIVATIVE_READY_URL}">
      <script>fetch('/api/download/photo?photoId=photo-ready')</script>
    </body></html>`
    const fetchImpl = vi.fn(async () => makeResponse({ textBody: html }))
    const result = await verifyPageAndOg({ fetchImpl, previewUrl: 'https://preview.test', slug: 'wedding', originalUrl: ORIGINAL_READY_URL })

    expect(result.originalPresentInPage).toBe(false)
    expect(result.ogIsOriginal).toBe(false)
    expect(result.ogIsDisplayV1Derivative).toBe(true)
    expect(result.downloadContract.photoIdParamPatternFound).toBe(true)
    expect(result.downloadContract.photoUrlParamPatternFound).toBe(false)
    expect(JSON.stringify(result)).not.toContain('uuid-ready-photo')
  })

  it('catches a regression where the original url is embedded in the serialized page payload', async () => {
    const html = `<html><body><script>window.__NEXT_DATA__=${JSON.stringify({ props: { photo: { url: ORIGINAL_READY_URL } } })}</script></body></html>`
    const fetchImpl = vi.fn(async () => makeResponse({ textBody: html }))
    const result = await verifyPageAndOg({ fetchImpl, previewUrl: 'https://preview.test', slug: 'wedding', originalUrl: ORIGINAL_READY_URL })

    expect(result.originalPresentInPage).toBe(true) // FAIL condition, correctly detected
  })

  it('catches a regression where og:image is the original url', async () => {
    const html = `<html><head><meta property="og:image" content="${ORIGINAL_READY_URL}"></head></html>`
    const fetchImpl = vi.fn(async () => makeResponse({ textBody: html }))
    const result = await verifyPageAndOg({ fetchImpl, previewUrl: 'https://preview.test', slug: 'wedding', originalUrl: ORIGINAL_READY_URL })

    expect(result.ogIsOriginal).toBe(true) // FAIL condition, correctly detected
  })

  it('no og:image present is reported, not crashed on', async () => {
    const html = `<html><head></head><body>no og tag here</body></html>`
    const fetchImpl = vi.fn(async () => makeResponse({ textBody: html }))
    const result = await verifyPageAndOg({ fetchImpl, previewUrl: 'https://preview.test', slug: 'wedding', originalUrl: ORIGINAL_READY_URL })

    expect(result.ogPresent).toBe(false)
    expect(result.ogImage).toEqual({ present: false })
  })

  it('reports blocked on a deployment-protection redirect', async () => {
    const fetchImpl = vi.fn(async () => makeResponse({ status: 302, headers: { location: 'https://vercel.com/sso-api?url=x' } }))
    const result = await verifyPageAndOg({ fetchImpl, previewUrl: 'https://preview.test', slug: 'wedding', originalUrl: ORIGINAL_READY_URL })
    expect(result.blocked).toBe(true)
    expect(result.reason).toBe('DEPLOYMENT_PROTECTION_NOT_BYPASSED')
  })
})

describe('scanDownloadContractInHtml', () => {
  it('flags a regression where a client-supplied photoUrl parameter appears', () => {
    const result = scanDownloadContractInHtml('<script>fetch("/api/download/photo?photoUrl=" + encodeURIComponent(photo.url))</script>')
    expect(result.photoUrlParamPatternFound).toBe(true) // FAIL condition, correctly detected
  })

  it('handles null/undefined html without throwing', () => {
    expect(() => scanDownloadContractInHtml(undefined)).not.toThrow()
    expect(scanDownloadContractInHtml(null).photoIdParamPatternFound).toBe(false)
  })
})

describe('fetchRuntimeLogSummary', () => {
  it('reports not available without credentials, does not attempt a network call', async () => {
    const fetchImpl = vi.fn()
    const result = await fetchRuntimeLogSummary({ fetchImpl })
    expect(result).toEqual({ available: false, reason: 'NO_VERCEL_API_TOKEN_CONFIGURED' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('summarizes events when credentials are provided', async () => {
    const fetchImpl = vi.fn(async () =>
      makeResponse({ jsonBody: [{ text: 'GET /api/events/x 200' }, { text: 'Prisma error: connection lost' }, { text: '500 Internal Server Error' }] }),
    )
    const result = await fetchRuntimeLogSummary({ fetchImpl, vercelApiToken: 'tok', deploymentId: 'dpl_1' })
    expect(result.available).toBe(true)
    expect(result.prismaErrors).toBe(1)
    expect(result.unexpected5xx).toBe(1)
  })
})

describe('main — full orchestration, synthetic end to end', () => {
  function makeFakePrisma({ ready, failed }) {
    let call = 0
    return {
      photo: {
        findFirst: vi.fn(async ({ where }) => {
          call += 1
          return where.displayDerivativeStatus === 'READY' ? ready : failed
        }),
      },
    }
  }

  it('a fully passing scenario never leaks either original URL into the report JSON', async () => {
    const ready = { id: 'photo-ready', eventId: 'event-1', url: ORIGINAL_READY_URL, event: { slug: 'wedding' } }
    const failed = { id: 'photo-failed', eventId: 'event-1', url: ORIGINAL_FAILED_URL, event: { slug: 'wedding' } }
    const prisma = makeFakePrisma({ ready, failed })

    const dtoResponses = {
      wedding: { photos: [{ id: 'photo-ready', url: DERIVATIVE_READY_URL }, { id: 'photo-failed', url: null }] },
    }
    const html = `<html><head><meta property="og:image" content="${DERIVATIVE_READY_URL}"></head><body>
      <script>fetch('/api/download/photo?photoId=x')</script>
    </body></html>`

    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('/api/events/')) return makeResponse({ jsonBody: dtoResponses.wedding })
      return makeResponse({ textBody: html })
    })

    const logger = { log: vi.fn(), error: vi.fn() }
    const result = await main({ prisma, fetchImpl, previewUrl: 'https://preview.test', logger })

    expect(result.exitCode).toBe(0)
    const reportText = logger.log.mock.calls[0][0]
    expect(reportText).not.toContain('uuid-ready-photo')
    expect(reportText).not.toContain('uuid-failed-photo')
    expect(reportText).not.toContain(ORIGINAL_READY_URL)
    expect(reportText).not.toContain(ORIGINAL_FAILED_URL)

    const report = JSON.parse(reportText)
    expect(report.liveDto.ready.derivativeIsDisplayV1).toBe(true)
    expect(report.liveDto.failed.urlIsNull).toBe(true)
    expect(report.fixtures.readyPhotoId).toBe('photo-ready')
    expect(report.fixtures.failedPhotoId).toBe('photo-failed')
  })

  it('refuses (exitCode 1) when a READY or FAILED fixture cannot be found, without calling fetch at all', async () => {
    const prisma = makeFakePrisma({ ready: null, failed: { id: 'x', eventId: 'e', url: 'u', event: { slug: 's' } } })
    const fetchImpl = vi.fn()
    const logger = { log: vi.fn(), error: vi.fn() }

    const result = await main({ prisma, fetchImpl, logger })

    expect(result.exitCode).toBe(1)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('the fake prisma used above exposes no write method — a mistaken write call in main() would throw, not silently succeed', () => {
    const prisma = makeFakePrisma({ ready: null, failed: null })
    expect(Object.keys(prisma.photo)).toEqual(['findFirst'])
  })
})

// ─── fetchWithSafeRedirects — safe 307/301/302/303/308 handling ───────────
//
// Fixes the real defect found this turn: the app's own locale middleware
// (verified directly against middleware.js + lib/i18n/config.js) cannot
// redirect /api/* or /event/* at all — both are in PRIVATE_PATH_PREFIXES,
// which middleware skips unconditionally, and /api is additionally
// excluded by the middleware matcher. So a 307 from either probed endpoint
// is not app-level; it is most consistent with Vercel's own Deployment
// Protection, which can redirect through a same-origin hop before finally
// landing on vercel.com/sso-api — a single-hop, vercel.com-only check
// (the previous isDeploymentProtectionRedirect-only logic) would follow
// neither hop and misreport UNEXPECTED_HTTP_STATUS_307.

const TRUSTED_ORIGIN = 'https://fotoweb-app-preview.vercel.app'

describe('fetchWithSafeRedirects', () => {
  it('1. follows a same-origin 307 and returns the final 200 for analysis', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url) => {
      calls.push(url)
      if (url === `${TRUSTED_ORIGIN}/api/events/wedding/photos`) {
        return makeResponse({ status: 307, headers: { location: `${TRUSTED_ORIGIN}/api/events/wedding/photos/` } })
      }
      return makeResponse({ status: 200, jsonBody: { ok: true } })
    })

    const result = await fetchWithSafeRedirects({
      fetchImpl,
      url: `${TRUSTED_ORIGIN}/api/events/wedding/photos`,
      headers: { 'x-vercel-protection-bypass': 'secret123' },
      trustedOrigin: TRUSTED_ORIGIN,
    })

    expect(result.blocked).toBe(false)
    expect(result.response.status).toBe(200)
    expect(await result.response.json()).toEqual({ ok: true })
    expect(result.redirectChain).toEqual([{ hop: 0, status: 307, locationPresent: true, host: 'fotoweb-app-preview.vercel.app', path: '/api/events/wedding/photos/', setCookieNames: [] }])
    expect(calls).toEqual([`${TRUSTED_ORIGIN}/api/events/wedding/photos`, `${TRUSTED_ORIGIN}/api/events/wedding/photos/`])
  })

  it('2. resolves a relative Location against the Preview origin and follows it', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url) => {
      calls.push(url)
      if (calls.length === 1) return makeResponse({ status: 307, headers: { location: '/event/wedding' } })
      return makeResponse({ status: 200, textBody: '<html>ok</html>' })
    })

    const result = await fetchWithSafeRedirects({
      fetchImpl,
      url: `${TRUSTED_ORIGIN}/some/path`,
      headers: {},
      trustedOrigin: TRUSTED_ORIGIN,
    })

    expect(result.blocked).toBe(false)
    expect(calls[1]).toBe(`${TRUSTED_ORIGIN}/event/wedding`)
  })

  it('3. blocks a redirect to another origin and NEVER forwards the bypass secret to it', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url, options) => {
      calls.push({ url, headers: options.headers })
      return makeResponse({ status: 302, headers: { location: 'https://evil.example.com/steal?x=1' } })
    })

    const result = await fetchWithSafeRedirects({
      fetchImpl,
      url: `${TRUSTED_ORIGIN}/api/events/wedding/photos`,
      headers: { 'x-vercel-protection-bypass': 'super-secret' },
      trustedOrigin: TRUSTED_ORIGIN,
    })

    expect(result.blocked).toBe(true)
    expect(result.reason).toBe('REDIRECT_LEFT_TRUSTED_ORIGIN')
    // The untrusted origin was never fetched at all — not just "fetched without the header".
    expect(calls).toHaveLength(1)
    expect(calls.every((c) => !c.url.startsWith('https://evil.example.com'))).toBe(true)
    // The diagnostic records host/path (routing info, not sensitive) but
    // never the secret and never the query string (which can carry
    // tokens/nonces) — the path segment "steal" is expected to appear,
    // the query param "x=1" must not.
    expect(JSON.stringify(result.redirectChain)).not.toContain('super-secret')
    expect(JSON.stringify(result.redirectChain)).not.toContain('x=1')
    expect(result.redirectChain).toEqual([{ hop: 0, status: 302, locationPresent: true, host: 'evil.example.com', path: '/steal' }])
  })

  it('4. classifies a redirect to Vercel SSO/protection explicitly, even after a same-origin hop first', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url === `${TRUSTED_ORIGIN}/api/events/wedding/photos`) {
        return makeResponse({ status: 307, headers: { location: `${TRUSTED_ORIGIN}/_vercel/insights/protect` } })
      }
      return makeResponse({ status: 307, headers: { location: 'https://vercel.com/sso-api?url=x&nonce=abc' } })
    })

    const result = await fetchWithSafeRedirects({
      fetchImpl,
      url: `${TRUSTED_ORIGIN}/api/events/wedding/photos`,
      headers: {},
      trustedOrigin: TRUSTED_ORIGIN,
    })

    expect(result.blocked).toBe(true)
    expect(result.reason).toBe('DEPLOYMENT_PROTECTION_NOT_BYPASSED')
    expect(result.redirectChain).toHaveLength(2)
    expect(result.redirectChain[1].host).toBe('vercel.com')
    // The sensitive nonce query param must never appear in the diagnostic.
    expect(JSON.stringify(result.redirectChain)).not.toContain('nonce')
    expect(JSON.stringify(result.redirectChain)).not.toContain('abc')
  })

  it('5. blocks a redirect loop', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url === `${TRUSTED_ORIGIN}/a`) return makeResponse({ status: 307, headers: { location: `${TRUSTED_ORIGIN}/b` } })
      return makeResponse({ status: 307, headers: { location: `${TRUSTED_ORIGIN}/a` } })
    })

    const result = await fetchWithSafeRedirects({ fetchImpl, url: `${TRUSTED_ORIGIN}/a`, headers: {}, trustedOrigin: TRUSTED_ORIGIN })

    expect(result.blocked).toBe(true)
    expect(result.reason).toBe('REDIRECT_LOOP_DETECTED')
  })

  it('6. blocks once the max-hop limit is exceeded, without looping forever', async () => {
    let hop = 0
    const fetchImpl = vi.fn(async () => {
      hop += 1
      return makeResponse({ status: 307, headers: { location: `${TRUSTED_ORIGIN}/hop-${hop}` } })
    })

    const result = await fetchWithSafeRedirects({ fetchImpl, url: `${TRUSTED_ORIGIN}/hop-0`, headers: {}, trustedOrigin: TRUSTED_ORIGIN })

    expect(result.blocked).toBe(true)
    expect(result.reason).toBe('REDIRECT_MAX_HOPS_EXCEEDED')
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(MAX_REDIRECT_HOPS)
  })

  it('7. a direct 200 with no redirect at all is unchanged (empty redirectChain, single fetch call)', async () => {
    const fetchImpl = vi.fn(async () => makeResponse({ status: 200, jsonBody: { ok: true } }))

    const result = await fetchWithSafeRedirects({ fetchImpl, url: `${TRUSTED_ORIGIN}/api/events/wedding/photos`, headers: {}, trustedOrigin: TRUSTED_ORIGIN })

    expect(result.blocked).toBe(false)
    expect(result.redirectChain).toEqual([])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('8. the full verifyLiveDto report includes sanitized redirect diagnostics but never the bypass secret', async () => {
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls += 1
      if (calls === 1) return makeResponse({ status: 307, headers: { location: `${TRUSTED_ORIGIN}/api/events/wedding/photos/?take=48` } })
      return makeResponse({ jsonBody: { photos: [{ id: 'photo-ready', url: DERIVATIVE_READY_URL }] } })
    })

    const result = await verifyLiveDto({
      fetchImpl,
      previewUrl: TRUSTED_ORIGIN,
      bypassSecret: 'top-secret-value',
      slug: 'wedding',
      photoId: 'photo-ready',
      expectedStatus: 'READY',
      originalUrl: ORIGINAL_READY_URL,
    })

    // The redirect was followed and the final 200 correctly analyzed —
    // this is NOT the loop/error path, it's the intended happy path.
    expect(result.blocked).toBe(false)
    expect(result.derivativeIsDisplayV1).toBe(true)
    expect(calls).toBe(2)
    expect(result.redirectChain).toBeDefined()
    expect(result.redirectChain.length).toBeGreaterThan(0)
    expect(JSON.stringify(result)).not.toContain('top-secret-value')
  })
})

// ─── Vercel bypass-cookie handshake ────────────────────────────────────────
//
// Root cause: a follow-up live probe (x-vercel-protection-bypass +
// x-vercel-set-bypass-cookie:true) got back a 307 to the SAME path plus
// Set-Cookie: _vercel_jwt=... — Vercel's own bypass-cookie handshake. The
// prior revision's `visited` set was seeded with the starting URL BEFORE
// the loop began, so this exact same-URL redirect was misclassified as
// REDIRECT_LOOP_DETECTED on its first hop (confirmed by re-reading that
// code directly, independent of the live evidence). Fixed by keying loop
// detection on (url, cookie-jar-state) instead of url alone.

describe('parseSupportedSetCookies', () => {
  it('extracts only the supported _vercel_jwt cookie, ignoring attributes', () => {
    const res = makeResponse({ status: 307, setCookie: ['_vercel_jwt=abc123XYZ; Path=/; HttpOnly; Secure; SameSite=None'] })
    expect(parseSupportedSetCookies(res)).toEqual({ _vercel_jwt: 'abc123XYZ' })
  })

  it('ignores unrelated cookie names', () => {
    const res = makeResponse({ status: 307, setCookie: ['some_other_cookie=irrelevant; Path=/'] })
    expect(parseSupportedSetCookies(res)).toEqual({})
  })

  it('handles multiple Set-Cookie lines, keeping only the supported one', () => {
    const res = makeResponse({ status: 307, setCookie: ['tracking=xyz; Path=/', '_vercel_jwt=realvalue; Path=/; HttpOnly'] })
    expect(parseSupportedSetCookies(res)).toEqual({ _vercel_jwt: 'realvalue' })
  })

  it('no Set-Cookie header at all → {}', () => {
    expect(parseSupportedSetCookies(makeResponse({ status: 200, jsonBody: {} }))).toEqual({})
  })
})

describe('fetchWithSafeRedirects — Vercel bypass-cookie handshake', () => {
  it('REQUIRED 1: same-path 307 + Set-Cookie _vercel_jwt → followed once, Cookie forwarded on retry, final 200 analyzed', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url, options) => {
      calls.push({ url, headers: options.headers })
      if (calls.length === 1) {
        return makeResponse({ status: 307, headers: { location: `${TRUSTED_ORIGIN}/api/events/watermark/photos` }, setCookie: ['_vercel_jwt=XYZ123; Path=/; HttpOnly; Secure'] })
      }
      return makeResponse({ status: 200, jsonBody: { photos: [] } })
    })

    const result = await fetchWithSafeRedirects({
      fetchImpl,
      url: `${TRUSTED_ORIGIN}/api/events/watermark/photos`,
      headers: { 'x-vercel-protection-bypass': 'secret123', 'x-vercel-set-bypass-cookie': 'true' },
      trustedOrigin: TRUSTED_ORIGIN,
    })

    expect(result.blocked).toBe(false)
    expect(result.response.status).toBe(200)
    expect(calls).toHaveLength(2)
    // First request: no cookie yet (jar was empty).
    expect(calls[0].headers.Cookie).toBeUndefined()
    // Second request: the captured cookie IS forwarded, alongside the
    // still-present bypass header (explicitly allowed on trusted origin).
    expect(calls[1].headers.Cookie).toBe('_vercel_jwt=XYZ123')
    expect(calls[1].headers['x-vercel-protection-bypass']).toBe('secret123')
  })

  it('REQUIRED 2: same-path 307 with NO state change on the second hop → REDIRECT_LOOP_DETECTED', async () => {
    const fetchImpl = vi.fn(async () =>
      // Every response sets the exact same cookie value — no new state is
      // ever introduced, so this must NOT be treated as a valid handshake.
      makeResponse({ status: 307, headers: { location: `${TRUSTED_ORIGIN}/api/events/watermark/photos` }, setCookie: ['_vercel_jwt=SAME; Path=/'] }),
    )

    const result = await fetchWithSafeRedirects({
      fetchImpl,
      url: `${TRUSTED_ORIGIN}/api/events/watermark/photos`,
      headers: {},
      trustedOrigin: TRUSTED_ORIGIN,
    })

    expect(result.blocked).toBe(true)
    expect(result.reason).toBe('REDIRECT_LOOP_DETECTED')
    // Confirms the fix does not simply disable loop detection: hop 1
    // (empty -> SAME) is allowed once, hop 2 (SAME -> SAME, no change) is
    // correctly caught rather than looping forever.
    expect(fetchImpl.mock.calls.length).toBeLessThan(MAX_REDIRECT_HOPS)
  })

  it('REQUIRED 3 + 4: _vercel_jwt and the bypass header are never forwarded to a cross-origin redirect target', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url, options) => {
      calls.push({ url, headers: options.headers })
      if (calls.length === 1) {
        return makeResponse({ status: 307, headers: { location: `${TRUSTED_ORIGIN}/api/events/watermark/photos` }, setCookie: ['_vercel_jwt=XYZ123; Path=/'] })
      }
      // The second same-origin request itself gets redirected off-origin.
      return makeResponse({ status: 302, headers: { location: 'https://attacker.example.com/collect' } })
    })

    const result = await fetchWithSafeRedirects({
      fetchImpl,
      url: `${TRUSTED_ORIGIN}/api/events/watermark/photos`,
      headers: { 'x-vercel-protection-bypass': 'secret123' },
      trustedOrigin: TRUSTED_ORIGIN,
    })

    expect(result.blocked).toBe(true)
    expect(result.reason).toBe('REDIRECT_LEFT_TRUSTED_ORIGIN')
    // The cross-origin URL was never fetched at all.
    expect(calls.every((c) => !c.url.startsWith('https://attacker.example.com'))).toBe(true)
    expect(calls).toHaveLength(2)
  })

  it('REQUIRED 5 + 6 + 7: the cookie value never appears in redirectChain or the full JSON report, and Set-Cookie attributes are not echoed', async () => {
    const calls = []
    const fetchImpl = vi.fn(async () => {
      calls.push(1)
      if (calls.length === 1) {
        return makeResponse({
          status: 307,
          headers: { location: `${TRUSTED_ORIGIN}/api/events/watermark/photos` },
          setCookie: ['_vercel_jwt=SuperSecretJwtValue.abc.def; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=3600'],
        })
      }
      return makeResponse({ status: 200, jsonBody: { photos: [{ id: 'photo-ready', url: DERIVATIVE_READY_URL }] } })
    })

    const result = await verifyLiveDto({
      fetchImpl,
      previewUrl: TRUSTED_ORIGIN,
      bypassSecret: 'secret123',
      slug: 'watermark',
      photoId: 'photo-ready',
      expectedStatus: 'READY',
      originalUrl: ORIGINAL_READY_URL,
    })

    expect(result.blocked).toBe(false)
    const reportText = JSON.stringify(result)
    expect(reportText).not.toContain('SuperSecretJwtValue')
    expect(reportText).not.toContain('secret123')
    expect(reportText).not.toContain('HttpOnly')
    expect(reportText).not.toContain('Max-Age')
    // The redirectChain only ever records that A cookie named _vercel_jwt
    // was set on that hop — never its value.
    expect(result.redirectChain[0].setCookieNames).toEqual(['_vercel_jwt'])
  })

  it('REQUIRED 9: verifyPageAndOg behaves the same way through the handshake (existing live verification unchanged)', async () => {
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls += 1
      if (calls === 1) {
        return makeResponse({ status: 307, headers: { location: `${TRUSTED_ORIGIN}/event/watermark` }, setCookie: ['_vercel_jwt=XYZ; Path=/'] })
      }
      return makeResponse({ status: 200, textBody: `<html><head><meta property="og:image" content="${DERIVATIVE_READY_URL}"></head></html>` })
    })

    const result = await verifyPageAndOg({ fetchImpl, previewUrl: TRUSTED_ORIGIN, bypassSecret: 'secret123', slug: 'watermark', originalUrl: ORIGINAL_READY_URL })

    expect(result.blocked).toBe(false)
    expect(result.ogIsDisplayV1Derivative).toBe(true)
    expect(calls).toBe(2)
  })
})

// ─── READY fixture false-negative diagnosis fix ────────────────────────────
//
// Root cause investigated: a live report showed the READY fixture FOUND
// (blocked:false) with a null-shaped url. Tracing the prior code shows
// pagination-absence and found-with-null were ALREADY distinguishable
// (absence returned blocked:true/FIXTURE_PHOTO_NOT_IN_RESPONSE, a
// genuinely different branch) — so the specific reported symptom is not
// explained by a "confuses absent with null" bug. What WAS a real, code-
// verified gap: only one page (?take=48) was ever fetched, so a fixture
// on event with >48 visible photos, not among the 48 most recent, would
// have been misreported as a generic blocked failure rather than the
// specific NOT_FOUND_IN_RESPONSE state. This section proves the fix:
// paginated exact-ID lookup, explicit named result states, and OG/download
// classifications that don't fail merely on absence of live evidence.

const READY_ORIGINAL_URL = 'https://store123.public.blob.vercel-storage.com/events/watermark/uuid-ready.jpg'
const FAILED_ORIGINAL_URL = 'https://store123.public.blob.vercel-storage.com/events/summer-beach/uuid-failed.jpg'

describe('findPhotoAcrossPages / verifyLiveDto — explicit fixture states (REQUIRED tests 1-6)', () => {
  it('REQUIRED 1: READY fixture absent from every page -> NOT_FOUND_IN_RESPONSE, never treated as url=null', async () => {
    const fetchImpl = vi.fn(async () => makeResponse({ jsonBody: { photos: [{ id: 'some-other-photo', url: DERIVATIVE_READY_URL }], nextCursor: null, total: 1 } }))

    const result = await verifyLiveDto({
      fetchImpl,
      previewUrl: TRUSTED_ORIGIN,
      slug: 'watermark',
      photoId: 'photo-ready-not-present',
      expectedStatus: 'READY',
      originalUrl: READY_ORIGINAL_URL,
    })

    expect(result.blocked).toBe(false)
    expect(result.state).toBe(READY_FIXTURE_STATE.NOT_FOUND_IN_RESPONSE)
    // Crucially: NOT confused with a real null-url finding.
    expect(result.state).not.toBe(READY_FIXTURE_STATE.FOUND_WITH_NULL_URL)
    expect(result).not.toHaveProperty('derivativeNonNull')
    expect(result).not.toHaveProperty('potentialProductDefect', true)
  })

  it('REQUIRED 2: READY present with a display-v1 derivative -> FOUND_WITH_DERIVATIVE, not a defect', async () => {
    const fetchImpl = vi.fn(async () => makeResponse({ jsonBody: { photos: [{ id: 'photo-ready', url: DERIVATIVE_READY_URL }], nextCursor: null } }))

    const result = await verifyLiveDto({
      fetchImpl,
      previewUrl: TRUSTED_ORIGIN,
      slug: 'watermark',
      photoId: 'photo-ready',
      expectedStatus: 'READY',
      originalUrl: READY_ORIGINAL_URL,
    })

    expect(result.state).toBe(READY_FIXTURE_STATE.FOUND_WITH_DERIVATIVE)
    expect(result.potentialProductDefect).toBe(false)
  })

  it('REQUIRED 3: READY present with null url -> FOUND_WITH_NULL_URL, a genuine potential product defect', async () => {
    const fetchImpl = vi.fn(async () => makeResponse({ jsonBody: { photos: [{ id: 'photo-ready', url: null }], nextCursor: null } }))

    const result = await verifyLiveDto({
      fetchImpl,
      previewUrl: TRUSTED_ORIGIN,
      slug: 'watermark',
      photoId: 'photo-ready',
      expectedStatus: 'READY',
      originalUrl: READY_ORIGINAL_URL,
    })

    expect(result.state).toBe(READY_FIXTURE_STATE.FOUND_WITH_NULL_URL)
    expect(result.potentialProductDefect).toBe(true)
  })

  it('a READY photo present with a NON-derivative, non-null url is flagged as the more severe FOUND_WITH_UNSAFE_URL, never silently accepted', async () => {
    const fetchImpl = vi.fn(async () => makeResponse({ jsonBody: { photos: [{ id: 'photo-ready', url: 'https://example.com/not-a-derivative.jpg' }], nextCursor: null } }))

    const result = await verifyLiveDto({
      fetchImpl,
      previewUrl: TRUSTED_ORIGIN,
      slug: 'watermark',
      photoId: 'photo-ready',
      expectedStatus: 'READY',
      originalUrl: READY_ORIGINAL_URL,
    })

    expect(result.state).toBe(READY_FIXTURE_STATE.FOUND_WITH_UNSAFE_URL)
    expect(result.potentialProductDefect).toBe(true)
  })

  it('REQUIRED 4: FAILED fixture absent from every page -> NOT_FOUND_IN_RESPONSE', async () => {
    const fetchImpl = vi.fn(async () => makeResponse({ jsonBody: { photos: [], nextCursor: null, total: 0 } }))

    const result = await verifyLiveDto({
      fetchImpl,
      previewUrl: TRUSTED_ORIGIN,
      slug: 'summer-beach-party-2024-4',
      photoId: 'photo-failed-not-present',
      expectedStatus: 'FAILED',
      originalUrl: FAILED_ORIGINAL_URL,
    })

    expect(result.blocked).toBe(false)
    expect(result.state).toBe(FAILED_FIXTURE_STATE.NOT_FOUND_IN_RESPONSE)
  })

  it('REQUIRED 5: FAILED present with null url -> FOUND_WITH_NULL_URL, PASS (not a defect)', async () => {
    const fetchImpl = vi.fn(async () => makeResponse({ jsonBody: { photos: [{ id: 'photo-failed', url: null }], nextCursor: null } }))

    const result = await verifyLiveDto({
      fetchImpl,
      previewUrl: TRUSTED_ORIGIN,
      slug: 'summer-beach-party-2024-4',
      photoId: 'photo-failed',
      expectedStatus: 'FAILED',
      originalUrl: FAILED_ORIGINAL_URL,
    })

    expect(result.state).toBe(FAILED_FIXTURE_STATE.FOUND_WITH_NULL_URL)
    expect(result.potentialProductDefect).toBe(false)
  })

  it('a FAILED photo present with a non-null url is a genuine defect (the original, or anything, leaking)', async () => {
    const fetchImpl = vi.fn(async () => makeResponse({ jsonBody: { photos: [{ id: 'photo-failed', url: FAILED_ORIGINAL_URL }], nextCursor: null } }))

    const result = await verifyLiveDto({
      fetchImpl,
      previewUrl: TRUSTED_ORIGIN,
      slug: 'summer-beach-party-2024-4',
      photoId: 'photo-failed',
      expectedStatus: 'FAILED',
      originalUrl: FAILED_ORIGINAL_URL,
    })

    expect(result.state).toBe(FAILED_FIXTURE_STATE.FOUND_WITH_NON_NULL_URL)
    expect(result.potentialProductDefect).toBe(true)
  })

  it('REQUIRED 6: paginated search finds the exact photoId on a LATER page via nextCursor', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url) => {
      calls.push(url)
      if (!url.includes('cursor=')) {
        // First page: 48 unrelated photos, points to page 2.
        return makeResponse({ jsonBody: { photos: [{ id: 'other-photo-1', url: DERIVATIVE_READY_URL }], nextCursor: 'cursor-page-2', total: 60 } })
      }
      // Second page: the real fixture.
      return makeResponse({ jsonBody: { photos: [{ id: 'photo-ready', url: DERIVATIVE_READY_URL }], nextCursor: null, total: 60 } })
    })

    const result = await verifyLiveDto({
      fetchImpl,
      previewUrl: TRUSTED_ORIGIN,
      slug: 'watermark',
      photoId: 'photo-ready',
      expectedStatus: 'READY',
      originalUrl: READY_ORIGINAL_URL,
    })

    expect(result.blocked).toBe(false)
    expect(result.state).toBe(READY_FIXTURE_STATE.FOUND_WITH_DERIVATIVE)
    expect(result.pagesScanned).toBe(2)
    expect(calls[1]).toContain('cursor=cursor-page-2')
  })

  it('findPhotoAcrossPages stops after MAX_FIXTURE_SEARCH_PAGES rather than scanning forever', async () => {
    let page = 0
    const fetchImpl = vi.fn(async () => {
      page += 1
      return makeResponse({ jsonBody: { photos: [{ id: `unrelated-${page}` }], nextCursor: `cursor-${page}` } })
    })

    const result = await findPhotoAcrossPages({
      fetchImpl,
      previewUrl: TRUSTED_ORIGIN,
      slug: 'watermark',
      photoId: 'never-found',
      trustedOrigin: TRUSTED_ORIGIN,
    })

    expect(result.found).toBe(false)
    expect(result.blocked).toBe(false)
    expect(result.reason).toBe('NOT_FOUND_IN_RESPONSE')
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(20)
  })
})

describe('classifyOgImage (REQUIRED test 7) and classifyDownloadContract (REQUIRED test 8)', () => {
  it('REQUIRED 7: og:image absent -> SAFE_ABSENT_OR_FALLBACK, not a failure', () => {
    const classification = classifyOgImage({ ogImageUrl: null, originalUrl: READY_ORIGINAL_URL, coverUrl: null })
    expect(classification).toBe(OG_CLASSIFICATION.SAFE_ABSENT_OR_FALLBACK)
  })

  it('og:image is the display-v1 derivative -> SAFE_DERIVATIVE', () => {
    const classification = classifyOgImage({ ogImageUrl: DERIVATIVE_READY_URL, originalUrl: READY_ORIGINAL_URL, coverUrl: null })
    expect(classification).toBe(OG_CLASSIFICATION.SAFE_DERIVATIVE)
  })

  it('og:image is the original photo url -> UNSAFE_ORIGINAL', () => {
    const classification = classifyOgImage({ ogImageUrl: READY_ORIGINAL_URL, originalUrl: READY_ORIGINAL_URL, coverUrl: null })
    expect(classification).toBe(OG_CLASSIFICATION.UNSAFE_ORIGINAL)
  })

  it('og:image exactly matches the DB event.coverUrl -> UNSAFE_COVER', () => {
    const coverUrl = 'https://example.com/unprocessed-cover.jpg'
    const classification = classifyOgImage({ ogImageUrl: coverUrl, originalUrl: READY_ORIGINAL_URL, coverUrl })
    expect(classification).toBe(OG_CLASSIFICATION.UNSAFE_COVER)
  })

  it('og:image present, not original, not coverUrl, not display-v1 (e.g. socialCoverUrl) -> SAFE_ABSENT_OR_FALLBACK', () => {
    const classification = classifyOgImage({ ogImageUrl: 'https://example.com/dedicated-social-cover.jpg', originalUrl: READY_ORIGINAL_URL, coverUrl: 'https://example.com/different-cover.jpg' })
    expect(classification).toBe(OG_CLASSIFICATION.SAFE_ABSENT_OR_FALLBACK)
  })

  it('REQUIRED 8: download photoId/photoUrl patterns both absent from SSR HTML -> SOURCE_CONTRACT_PASS, NOT a failure', () => {
    const classification = classifyDownloadContract({ photoIdParamPatternFound: false, photoUrlParamPatternFound: false })
    expect(classification).toBe(DOWNLOAD_CONTRACT_CLASSIFICATION.SOURCE_CONTRACT_PASS)
    expect(classification).not.toBe(DOWNLOAD_CONTRACT_CLASSIFICATION.LIVE_CONTRACT_FAIL)
  })

  it('photoId pattern positively observed live -> LIVE_CONTRACT_PASS', () => {
    expect(classifyDownloadContract({ photoIdParamPatternFound: true, photoUrlParamPatternFound: false })).toBe(DOWNLOAD_CONTRACT_CLASSIFICATION.LIVE_CONTRACT_PASS)
  })

  it('forbidden photoUrl pattern positively observed live -> LIVE_CONTRACT_FAIL (the only real failure case, requires positive evidence)', () => {
    expect(classifyDownloadContract({ photoIdParamPatternFound: false, photoUrlParamPatternFound: true })).toBe(DOWNLOAD_CONTRACT_CLASSIFICATION.LIVE_CONTRACT_FAIL)
  })
})

describe('verifyPageAndOg — end-to-end OG/download classification wiring', () => {
  it('a page with no og:image tag at all is reported safe, not blocked or failed', async () => {
    const fetchImpl = vi.fn(async () => makeResponse({ textBody: '<html><body>no og tag</body></html>' }))
    const result = await verifyPageAndOg({ fetchImpl, previewUrl: TRUSTED_ORIGIN, slug: 'watermark', originalUrl: READY_ORIGINAL_URL, coverUrl: null })

    expect(result.blocked).toBe(false)
    expect(result.ogClassification).toBe(OG_CLASSIFICATION.SAFE_ABSENT_OR_FALLBACK)
    expect(result.ogPrivacyPass).toBe(true)
    expect(result.downloadContract.classification).toBe(DOWNLOAD_CONTRACT_CLASSIFICATION.SOURCE_CONTRACT_PASS)
  })

  it('a page whose og:image matches the DB coverUrl is flagged UNSAFE_COVER and fails privacy', async () => {
    const coverUrl = 'https://example.com/raw-cover-upload.jpg'
    const fetchImpl = vi.fn(async () => makeResponse({ textBody: `<html><head><meta property="og:image" content="${coverUrl}"></head></html>` }))
    const result = await verifyPageAndOg({ fetchImpl, previewUrl: TRUSTED_ORIGIN, slug: 'watermark', originalUrl: READY_ORIGINAL_URL, coverUrl })

    expect(result.ogClassification).toBe(OG_CLASSIFICATION.UNSAFE_COVER)
    expect(result.ogPrivacyPass).toBe(false)
  })
})
