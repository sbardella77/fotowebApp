#!/usr/bin/env node
/**
 * Preview Guest Privacy — Automated Live Verification (read-only).
 *
 * Replaces a manual DevTools click-through with a reproducible script that
 * proves the same guest-EXIF-safe-delivery invariants against a live
 * Vercel Preview deployment: PENDING/FAILED/LEGACY_UNVERIFIED photos never
 * expose Photo.url anywhere a guest can see it (API DTO, serialized page,
 * OG meta), READY photos only ever expose the display-v1 derivative.
 *
 * SAFETY, mechanically enforced by this file's own shape:
 *   - The only Prisma call this file makes is `photo.findFirst` (a SELECT).
 *     No create/update/updateMany/upsert/delete/deleteMany anywhere.
 *   - Every network request is `fetch(url, { method: 'GET' or default })` —
 *     no POST/PUT/DELETE, no @vercel/blob import, nothing is ever uploaded,
 *     mutated, or deleted, in the app DB, in Blob storage, or in Vercel
 *     itself (no `vercel env`/deploy calls of any kind).
 *   - The raw original Photo.url is held ONLY in local variables inside
 *     this process, for in-memory string-membership/equality checks. It is
 *     never passed to console.log/JSON output — every report field derived
 *     from it goes through redactUrl(), which returns only {host,
 *     pathClass, sha256_12}, never the literal string. This is verified
 *     both by inspection and by the accompanying test file
 *     (tests/preview-guest-privacy-live-verify.test.js), which asserts
 *     the report JSON never contains the fixture's original URL substring.
 *   - No file this script imports is capable of a write; it only imports
 *     @prisma/client and Node built-ins (crypto, url) plus the global
 *     `fetch`. No application module (download-utils.js, blob SDKs, the
 *     backfill operator, etc.) is imported at all.
 *
 * Requires (operator-supplied — this script has none of these itself):
 *   DATABASE_URL                    — Preview's read-only-capable Postgres URL
 *   PREVIEW_URL                     — the Preview deployment's base URL
 *   VERCEL_PROTECTION_BYPASS_SECRET — optional; Vercel's own "Protection
 *     Bypass for Automation" secret (Project Settings → Deployment
 *     Protection), sent as the x-vercel-protection-bypass header on every
 *     request, including every same-origin redirect hop. Without it (or
 *     with an invalid one), a Preview behind Deployment Protection will
 *     eventually redirect to vercel.com/sso-api — possibly via one or more
 *     same-origin hops first. fetchWithSafeRedirects() follows same-origin
 *     3xx hops (up to MAX_REDIRECT_HOPS) to find that, and reports
 *     DEPLOYMENT_PROTECTION_NOT_BYPASSED for the affected section rather
 *     than either misreading the SSO page as content or misclassifying an
 *     intermediate hop as a generic HTTP failure.
 *   VERCEL_API_TOKEN + VERCEL_DEPLOYMENT_ID — optional; enables the
 *     runtime-log check (Step 7) via Vercel's REST API. Without them, that
 *     section reports NOT_AVAILABLE.
 *
 * Usage:
 *   DATABASE_URL=... PREVIEW_URL=... VERCEL_PROTECTION_BYPASS_SECRET=... \
 *     node scripts/preview-guest-privacy-live-verify.mjs
 */

import { createHash } from 'crypto'

export const DEFAULT_PREVIEW_URL = 'https://fotoweb-app-git-feat-guest-7394c2-patrizio-sbardellas-projects.vercel.app'

/** Never returns the raw URL — only a fingerprint safe to print/log. */
export function redactUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return { present: false }
  let host = 'UNPARSEABLE'
  let pathClass = null
  try {
    const parsed = new URL(rawUrl)
    host = parsed.hostname
    const segments = parsed.pathname.split('/')
    segments[segments.length - 1] = '<redacted-filename>'
    pathClass = segments.join('/')
  } catch {
    // leave host = 'UNPARSEABLE'
  }
  return { present: true, host, pathClass, sha256_12: createHash('sha256').update(rawUrl).digest('hex').slice(0, 12) }
}

/** In-memory-only membership check — never logs either argument. */
export function containsRawUrl(haystack, rawUrl) {
  return typeof haystack === 'string' && typeof rawUrl === 'string' && rawUrl.length > 0 && haystack.includes(rawUrl)
}

export function isDeploymentProtectionRedirect(response) {
  if (response.status < 300 || response.status >= 400) return false
  const location = response.headers?.get ? response.headers.get('location') : response.location
  if (!location) return false
  try {
    return new URL(location, 'https://placeholder.invalid').hostname === 'vercel.com'
  } catch {
    return false
  }
}

function bypassHeaders(bypassSecret) {
  return bypassSecret ? { 'x-vercel-protection-bypass': bypassSecret, 'x-vercel-set-bypass-cookie': 'true' } : {}
}

export const MAX_REDIRECT_HOPS = 5

// Explicit allowlist, not "capture and replay anything the server sets" —
// this is a security-verification tool, so it should only ever persist the
// one cookie it has a documented reason to need (Vercel's own bypass-cookie
// handshake), not silently accumulate and forward arbitrary same-origin
// cookies forever.
const SUPPORTED_COOKIE_NAMES = new Set(['_vercel_jwt'])

/**
 * Parses Set-Cookie response header(s) for the names in
 * SUPPORTED_COOKIE_NAMES only. Node's native fetch (undici) exposes
 * Headers#getSetCookie() to read multiple Set-Cookie lines (the Fetch spec
 * otherwise forbids combining them behind a single #get('set-cookie'));
 * this falls back to a single #get() for any other Headers-like object
 * (e.g. this file's own test fakes), and to a plain `setCookie` array for
 * full portability. Returns { name: value } — never logs anything.
 */
export function parseSupportedSetCookies(response) {
  let lines = []
  if (typeof response.headers?.getSetCookie === 'function') {
    lines = response.headers.getSetCookie() || []
  } else if (Array.isArray(response.setCookie)) {
    lines = response.setCookie
  } else if (response.headers?.get) {
    const single = response.headers.get('set-cookie')
    if (single) lines = [single]
  }

  const found = {}
  for (const line of lines) {
    if (typeof line !== 'string') continue
    const attrPart = line.split(';', 1)[0]
    const eqIdx = attrPart.indexOf('=')
    if (eqIdx === -1) continue
    const name = attrPart.slice(0, eqIdx).trim()
    const value = attrPart.slice(eqIdx + 1).trim()
    if (SUPPORTED_COOKIE_NAMES.has(name) && value) {
      found[name] = value
    }
  }
  return found
}

function serializeCookieHeader(jar) {
  const entries = Object.entries(jar)
  if (entries.length === 0) return null
  return entries.map(([name, value]) => `${name}=${value}`).join('; ')
}

/** Internal control-flow key only — never returned/logged. Real cookie values are fine here since this string never leaves the function. */
function jarStateKey(jar) {
  return Object.entries(jar)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}=${value}`)
    .join('&')
}

/**
 * Manual, allow-listed redirect follower with a minimal same-origin cookie
 * jar for Vercel's own Protection Bypass handshake.
 *
 * Root cause history:
 *   1. A live Preview probe reported UNEXPECTED_HTTP_STATUS_307 for every
 *      endpoint. The app's OWN locale middleware (middleware.js) cannot be
 *      the source — its matcher excludes /api entirely, and /event/* and
 *      /api/* are both in PRIVATE_PATH_PREFIXES (lib/i18n/config.js),
 *      which middleware skips unconditionally (verified directly by
 *      reading both files). That pointed at Vercel's platform layer.
 *   2. A follow-up probe with x-vercel-protection-bypass +
 *      x-vercel-set-bypass-cookie:true confirmed it: Vercel accepts the
 *      bypass secret, issues `Set-Cookie: _vercel_jwt=...`, and redirects
 *      307 back to the SAME path so the retried request can use the
 *      cookie instead of the header. The redirect-loop guard added in the
 *      prior revision seeded `visited` with the starting URL BEFORE the
 *      loop began, so this exact same-URL handshake redirect was
 *      misclassified as REDIRECT_LOOP_DETECTED on its very first hop —
 *      confirmed directly by re-reading that code, independent of the
 *      live evidence.
 *
 * Loop semantics (fixed): a redirect to a URL+cookie-jar-state pair that
 * has already been seen is a loop; a redirect to the same URL is NOT a
 * loop if the response that produced it added cookie state not already
 * known (the handshake case). This is enforced by keying the visited-set
 * on `${url}::${jarStateKey}` rather than on the URL alone — the Vercel
 * handshake's first 307 changes the jar (empty -> _vercel_jwt=XYZ), so
 * the identical destination URL is a genuinely new (url, state) pair and
 * is allowed once; a second 307 back to the same URL with no further
 * state change reuses an already-visited (url, state) pair and is
 * correctly blocked.
 *
 * SECURITY: the bypass secret and the captured _vercel_jwt cookie both
 * live only in per-request headers built by buildRequestHeaders(), and a
 * request is only ever issued to a URL AFTER confirming that URL's origin
 * === trustedOrigin (vercel.com is special-cased and classified before
 * any further request is even considered). A cross-origin or vercel.com
 * Location is recorded in the sanitized redirectChain (host + path only,
 * never a cookie value, never the query string) and the function returns
 * immediately WITHOUT ever calling fetchImpl on that URL — so neither the
 * secret nor the cookie has any code path to an untrusted origin.
 */
export async function fetchWithSafeRedirects({ fetchImpl, url, headers, trustedOrigin, maxHops = MAX_REDIRECT_HOPS }) {
  const redirectChain = []
  const cookieJar = {}
  const visitedStates = new Set([`${url}::${jarStateKey(cookieJar)}`])
  let currentUrl = url

  const buildRequestHeaders = () => {
    const cookieHeader = serializeCookieHeader(cookieJar)
    return cookieHeader ? { ...headers, Cookie: cookieHeader } : { ...headers }
  }

  for (let hop = 0; ; hop++) {
    const res = await fetchImpl(currentUrl, { headers: buildRequestHeaders(), redirect: 'manual' })

    if (res.status < 300 || res.status >= 400) {
      return { blocked: false, response: res, redirectChain }
    }

    const location = res.headers?.get ? res.headers.get('location') : res.location
    if (!location) {
      redirectChain.push({ hop, status: res.status, locationPresent: false })
      return { blocked: true, reason: `REDIRECT_WITHOUT_LOCATION_${res.status}`, redirectChain }
    }

    let resolved
    try {
      resolved = new URL(location, currentUrl)
    } catch {
      redirectChain.push({ hop, status: res.status, locationPresent: true, host: 'UNPARSEABLE', path: null })
      return { blocked: true, reason: 'REDIRECT_LOCATION_UNPARSEABLE', redirectChain }
    }

    const hopInfo = { hop, status: res.status, locationPresent: true, host: resolved.hostname, path: resolved.pathname }

    if (resolved.hostname === 'vercel.com') {
      redirectChain.push(hopInfo)
      return { blocked: true, reason: 'DEPLOYMENT_PROTECTION_NOT_BYPASSED', redirectChain }
    }

    if (resolved.origin !== trustedOrigin) {
      redirectChain.push(hopInfo)
      return { blocked: true, reason: 'REDIRECT_LEFT_TRUSTED_ORIGIN', redirectChain }
    }

    // Only ever parsed for a same-trustedOrigin response — the cross-origin
    // and vercel.com branches above both return before this line, so a
    // cookie from an untrusted origin is never even parsed, let alone kept.
    const newCookies = parseSupportedSetCookies(res)
    Object.assign(cookieJar, newCookies)
    hopInfo.setCookieNames = Object.keys(newCookies) // names only — never values
    redirectChain.push(hopInfo)

    if (hop + 1 >= maxHops) {
      return { blocked: true, reason: 'REDIRECT_MAX_HOPS_EXCEEDED', redirectChain }
    }

    const nextState = `${resolved.href}::${jarStateKey(cookieJar)}`
    if (visitedStates.has(nextState)) {
      return { blocked: true, reason: 'REDIRECT_LOOP_DETECTED', redirectChain }
    }
    visitedStates.add(nextState)
    currentUrl = resolved.href
    // Loop continues. buildRequestHeaders() will send the bypass header
    // AND any captured cookie (e.g. _vercel_jwt) together — safe, because
    // we only ever reach here after confirming resolved.origin ===
    // trustedOrigin, so neither ever reaches anywhere else.
  }
}

/**
 * STEP 1 — select one READY and one FAILED VISIBLE photo fixture.
 * The only Prisma call in this whole file. Read-only.
 *
 * event.coverUrl is fetched too (not printed — held only for the OG
 * UNSAFE_COVER comparison in verifyPageAndOg, which never returns the raw
 * value, only a boolean).
 */
export async function selectFixtures(prisma) {
  const select = { id: true, eventId: true, url: true, event: { select: { slug: true, coverUrl: true } } }
  const ready = await prisma.photo.findFirst({ where: { status: 'VISIBLE', displayDerivativeStatus: 'READY' }, select })
  const failed = await prisma.photo.findFirst({ where: { status: 'VISIBLE', displayDerivativeStatus: 'FAILED' }, select })
  return { ready, failed }
}

// Bounds the paginated fixture search: 20 pages * 48/page = 960 photos
// scanned before giving up — generous relative to any known Preview event
// size, but still a hard, finite cap so a misbehaving/looping paginated
// endpoint can never hang this tool.
const MAX_FIXTURE_SEARCH_PAGES = 20

export const READY_FIXTURE_STATE = {
  FOUND_WITH_DERIVATIVE: 'FOUND_WITH_DERIVATIVE',
  FOUND_WITH_NULL_URL: 'FOUND_WITH_NULL_URL',
  // A non-null url that is NOT a display-v1 derivative (e.g. matches the
  // original) is a MORE severe finding than "null" — the spec's minimum
  // 3-state enum has no slot for it, but silently calling it
  // FOUND_WITH_DERIVATIVE would weaken exactly the assertion this tool
  // exists to make, so it gets its own explicit state instead.
  FOUND_WITH_UNSAFE_URL: 'FOUND_WITH_UNSAFE_URL',
  NOT_FOUND_IN_RESPONSE: 'NOT_FOUND_IN_RESPONSE',
}

export const FAILED_FIXTURE_STATE = {
  FOUND_WITH_NULL_URL: 'FOUND_WITH_NULL_URL',
  FOUND_WITH_NON_NULL_URL: 'FOUND_WITH_NON_NULL_URL',
  NOT_FOUND_IN_RESPONSE: 'NOT_FOUND_IN_RESPONSE',
}

/**
 * Root cause this exists to fix: the prior revision fetched exactly ONE
 * page (?take=48) and, if the fixture wasn't in it, returned
 * blocked:true/FIXTURE_PHOTO_NOT_IN_RESPONSE — indistinguishable, in the
 * final report, from every other blocked reason, and silently wrong for
 * any event with more than 48 visible photos where the fixture isn't
 * among the 48 most recent. This walks nextCursor until the exact
 * photoId is found (STOP requirement: exact-ID lookup, not
 * assume-first-page) or the endpoint reports no further pages, bounded by
 * MAX_FIXTURE_SEARCH_PAGES so it can never hang.
 *
 * Distinguishes PHOTO_NOT_PRESENT_IN_RESPONSE from
 * PHOTO_PRESENT_WITH_NULL_URL: the former is returned as `{found: false}`
 * (never reaching any url-related field), the latter as `{found: true,
 * photo}` where `photo.url` happens to be null — the caller (verifyLiveDto)
 * inspects `photo.url` only after `found` is true, so these two states can
 * never be conflated the way a single `blocked` boolean could.
 */
export async function findPhotoAcrossPages({ fetchImpl, previewUrl, bypassSecret, slug, photoId, trustedOrigin }) {
  let cursor = null
  const redirectChains = []

  for (let page = 0; page < MAX_FIXTURE_SEARCH_PAGES; page++) {
    const qs = new URLSearchParams({ take: '48' })
    if (cursor) qs.set('cursor', cursor)

    const redirectResult = await fetchWithSafeRedirects({
      fetchImpl,
      url: `${previewUrl}/api/events/${encodeURIComponent(slug)}/photos?${qs.toString()}`,
      headers: bypassHeaders(bypassSecret),
      trustedOrigin,
    })
    redirectChains.push(redirectResult.redirectChain)

    if (redirectResult.blocked) {
      return { found: false, blocked: true, reason: redirectResult.reason, redirectChains, pagesScanned: page + 1 }
    }
    const res = redirectResult.response
    if (res.status !== 200) {
      return { found: false, blocked: true, reason: `UNEXPECTED_HTTP_STATUS_${res.status}`, redirectChains, pagesScanned: page + 1 }
    }

    const bodyText = await res.text()
    let payload
    try {
      payload = JSON.parse(bodyText)
    } catch {
      return { found: false, blocked: true, reason: 'NON_JSON_RESPONSE', redirectChains, pagesScanned: page + 1 }
    }

    const photo = (payload.photos || []).find((p) => p.id === photoId)
    if (photo) {
      return { found: true, blocked: false, photo, bodyText, redirectChains, pagesScanned: page + 1 }
    }

    if (!payload.nextCursor) {
      return { found: false, blocked: false, reason: 'NOT_FOUND_IN_RESPONSE', redirectChains, pagesScanned: page + 1 }
    }
    cursor = payload.nextCursor
  }

  return { found: false, blocked: false, reason: 'NOT_FOUND_IN_RESPONSE', reasonDetail: 'MAX_PAGES_SCANNED', redirectChains, pagesScanned: MAX_FIXTURE_SEARCH_PAGES }
}

/** STEP 2 — live guest photo-feed DTO check for one fixture. */
export async function verifyLiveDto({ fetchImpl, previewUrl, bypassSecret, slug, photoId, expectedStatus, originalUrl }) {
  const search = await findPhotoAcrossPages({
    fetchImpl,
    previewUrl,
    bypassSecret,
    slug,
    photoId,
    trustedOrigin: new URL(previewUrl).origin,
  })

  if (search.blocked) {
    return { blocked: true, reason: search.reason, redirectChain: search.redirectChains.flat(), pagesScanned: search.pagesScanned }
  }
  if (!search.found) {
    const state = expectedStatus === 'READY' ? READY_FIXTURE_STATE.NOT_FOUND_IN_RESPONSE : FAILED_FIXTURE_STATE.NOT_FOUND_IN_RESPONSE
    return { blocked: false, state, reason: search.reasonDetail || 'NOT_FOUND_IN_RESPONSE', redirectChain: search.redirectChains.flat(), pagesScanned: search.pagesScanned }
  }

  const { photo, bodyText } = search
  const statusFieldHidden = !('displayDerivativeStatus' in photo)
  const rawResponseLeaksOriginal = containsRawUrl(bodyText, originalUrl)
  const urlIsNonNullString = typeof photo.url === 'string' && photo.url.length > 0
  const urlIsDisplayV1 = urlIsNonNullString && photo.url.includes('/derivatives/display-v1/')

  if (expectedStatus === 'READY') {
    let state
    if (!urlIsNonNullString) state = READY_FIXTURE_STATE.FOUND_WITH_NULL_URL
    else if (urlIsDisplayV1) state = READY_FIXTURE_STATE.FOUND_WITH_DERIVATIVE
    else state = READY_FIXTURE_STATE.FOUND_WITH_UNSAFE_URL

    return {
      blocked: false,
      state,
      // Only FOUND_WITH_NULL_URL (or FOUND_WITH_UNSAFE_URL) is a
      // potential product defect — see Step 5 of the task this fixes.
      potentialProductDefect: state !== READY_FIXTURE_STATE.FOUND_WITH_DERIVATIVE,
      derivativeNonNull: urlIsNonNullString,
      derivativeIsDisplayV1: urlIsDisplayV1,
      urlDiffersFromOriginal: photo.url !== originalUrl,
      originalExcluded: !rawResponseLeaksOriginal,
      statusFieldHidden,
      derivative: redactUrl(photo.url),
      redirectChain: search.redirectChains.flat(),
      pagesScanned: search.pagesScanned,
    }
  }

  const state = photo.url === null ? FAILED_FIXTURE_STATE.FOUND_WITH_NULL_URL : FAILED_FIXTURE_STATE.FOUND_WITH_NON_NULL_URL
  return {
    blocked: false,
    state,
    // For FAILED, a non-null url is the defect (the original or anything
    // else leaking where nothing should be shown).
    potentialProductDefect: state === FAILED_FIXTURE_STATE.FOUND_WITH_NON_NULL_URL,
    urlIsNull: photo.url === null,
    originalExcluded: !rawResponseLeaksOriginal,
    statusFieldHidden,
    redirectChain: search.redirectChains.flat(),
    pagesScanned: search.pagesScanned,
  }
}

export const OG_CLASSIFICATION = {
  SAFE_DERIVATIVE: 'SAFE_DERIVATIVE',
  SAFE_ABSENT_OR_FALLBACK: 'SAFE_ABSENT_OR_FALLBACK',
  UNSAFE_ORIGINAL: 'UNSAFE_ORIGINAL',
  UNSAFE_COVER: 'UNSAFE_COVER',
}

/**
 * STEP 6 — classifies the observed og:image. Absence is NOT a failure (a
 * missing/default OG image is a perfectly safe outcome) — only
 * UNSAFE_ORIGINAL and UNSAFE_COVER fail privacy.
 *
 * coverUrl (raw, in-memory only, from the DB fixture — never printed) lets
 * this distinguish an actually-unsafe event.coverUrl from the one other
 * non-derivative value resolveEventSocialImageSafe can legitimately
 * return: event.socialCoverUrl, a dedicated field never derived from
 * unprocessed user photos (see lib/server/event-social-image.js — coverUrl
 * itself is excluded from that resolver's chain entirely; observing it
 * anyway would mean that code-level guarantee had regressed).
 */
export function classifyOgImage({ ogImageUrl, originalUrl, coverUrl }) {
  if (containsRawUrl(ogImageUrl || '', originalUrl)) return OG_CLASSIFICATION.UNSAFE_ORIGINAL
  if (coverUrl && ogImageUrl === coverUrl) return OG_CLASSIFICATION.UNSAFE_COVER
  if (!ogImageUrl) return OG_CLASSIFICATION.SAFE_ABSENT_OR_FALLBACK
  if (ogImageUrl.includes('/derivatives/display-v1/')) return OG_CLASSIFICATION.SAFE_DERIVATIVE
  // Present, not the original, not coverUrl, not display-v1-shaped — most
  // consistent with event.socialCoverUrl (the resolver's other safe,
  // non-derivative branch). Not weakened to "assume safe" without reason:
  // it is safe specifically because it positively is NOT the original and
  // NOT the known-unsafe coverUrl value.
  return OG_CLASSIFICATION.SAFE_ABSENT_OR_FALLBACK
}

export const DOWNLOAD_CONTRACT_CLASSIFICATION = {
  LIVE_CONTRACT_PASS: 'LIVE_CONTRACT_PASS',
  LIVE_CONTRACT_FAIL: 'LIVE_CONTRACT_FAIL',
  SOURCE_CONTRACT_PASS: 'SOURCE_CONTRACT_PASS',
}

/**
 * STEP 7 — the download URL is normally built by client-side JS at click
 * time, not embedded in the initial SSR HTML — so its PATTERN being absent
 * from a live page fetch is the expected, common case, not evidence of
 * failure. Only positive evidence of the forbidden `photoUrl=` pattern is
 * a live failure; positive evidence of the required `photoId=` pattern is
 * a live pass; absence of both defers to the already-passing source-level
 * tests (tests/guest-photo-url-consumer-inventory.test.js) rather than
 * reporting a false failure.
 */
export function classifyDownloadContract({ photoIdParamPatternFound, photoUrlParamPatternFound }) {
  if (photoUrlParamPatternFound) return DOWNLOAD_CONTRACT_CLASSIFICATION.LIVE_CONTRACT_FAIL
  if (photoIdParamPatternFound) return DOWNLOAD_CONTRACT_CLASSIFICATION.LIVE_CONTRACT_PASS
  return DOWNLOAD_CONTRACT_CLASSIFICATION.SOURCE_CONTRACT_PASS
}

/** STEP 3 + STEP 4 — serialized page leak audit and OG meta, one fetch. */
export async function verifyPageAndOg({ fetchImpl, previewUrl, bypassSecret, slug, originalUrl, coverUrl }) {
  const redirectResult = await fetchWithSafeRedirects({
    fetchImpl,
    url: `${previewUrl}/event/${encodeURIComponent(slug)}`,
    headers: bypassHeaders(bypassSecret),
    trustedOrigin: new URL(previewUrl).origin,
  })
  if (redirectResult.blocked) {
    return { blocked: true, reason: redirectResult.reason, redirectChain: redirectResult.redirectChain }
  }
  const res = redirectResult.response

  if (res.status !== 200) {
    return { blocked: true, reason: `UNEXPECTED_HTTP_STATUS_${res.status}`, redirectChain: redirectResult.redirectChain }
  }

  const html = await res.text()
  const originalPresent = containsRawUrl(html, originalUrl)

  const ogMatch = /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i.exec(html)
  const ogImageUrl = ogMatch ? ogMatch[1] : null
  const ogClassification = classifyOgImage({ ogImageUrl, originalUrl, coverUrl })
  const ogIsOriginal = ogClassification === OG_CLASSIFICATION.UNSAFE_ORIGINAL
  const ogIsDisplayV1Derivative = ogClassification === OG_CLASSIFICATION.SAFE_DERIVATIVE

  const downloadContractRaw = scanDownloadContractInHtml(html)

  // downloadContract (STEP 7) is computed here, from the same fetched
  // `html`, rather than returned separately — html itself is NEVER
  // included in this function's return value (if a leak were ever
  // detected, returning the raw HTML would print the leaked original URL
  // straight into the JSON report, defeating the whole point).
  return {
    blocked: false,
    originalPresentInPage: originalPresent,
    ogImage: redactUrl(ogImageUrl),
    ogClassification,
    ogPrivacyPass: ogClassification === OG_CLASSIFICATION.SAFE_DERIVATIVE || ogClassification === OG_CLASSIFICATION.SAFE_ABSENT_OR_FALLBACK,
    ogIsOriginal,
    ogIsDisplayV1Derivative,
    ogPresent: ogImageUrl !== null,
    downloadContract: { ...downloadContractRaw, classification: classifyDownloadContract(downloadContractRaw) },
    redirectChain: redirectResult.redirectChain,
  }
}

/** Best-effort static scan of the fetched HTML for a download URL shape. Feeds classifyDownloadContract — see STEP 7. */
export function scanDownloadContractInHtml(html) {
  return {
    photoIdParamPatternFound: /\/api\/download\/photo\?photoId=/.test(html || ''),
    photoUrlParamPatternFound: /[?&]photoUrl=/.test(html || ''),
  }
}

/** STEP 7 — optional Vercel deployment runtime-log check. */
export async function fetchRuntimeLogSummary({ fetchImpl, vercelApiToken, deploymentId }) {
  if (!vercelApiToken || !deploymentId) {
    return { available: false, reason: 'NO_VERCEL_API_TOKEN_CONFIGURED' }
  }
  const res = await fetchImpl(`https://api.vercel.com/v2/deployments/${deploymentId}/events`, {
    headers: { Authorization: `Bearer ${vercelApiToken}` },
  })
  if (res.status !== 200) {
    return { available: false, reason: `VERCEL_API_HTTP_${res.status}` }
  }
  const events = await res.json()
  const lines = Array.isArray(events) ? events : []
  const unexpected5xx = lines.filter((e) => /\b5\d\d\b/.test(e.text || e.payload?.text || '')).length
  const prismaErrors = lines.filter((e) => /prisma/i.test(e.text || e.payload?.text || '') && /error/i.test(e.text || e.payload?.text || '')).length
  const resolverErrors = lines.filter((e) => /resolveGuestPhotoUrl|resolveEventSocialImageSafe/i.test(e.text || e.payload?.text || '') && /error/i.test(e.text || e.payload?.text || '')).length
  return { available: true, unexpected5xx, prismaErrors, resolverErrors, sampledLines: lines.length }
}

/**
 * Orchestrates the full report. Pure function of injected dependencies —
 * same shape as lib/server/display-backfill.js's main(argv, dependencies)
 * — so it is fully testable with synthetic fixtures and touches zero real
 * infrastructure unless createRealDependencies() is used to wire it up.
 */
export async function main(dependencies) {
  const {
    prisma,
    fetchImpl,
    previewUrl = DEFAULT_PREVIEW_URL,
    bypassSecret,
    vercelApiToken,
    deploymentId,
    logger = console,
  } = dependencies

  const { ready, failed } = await selectFixtures(prisma)
  if (!ready || !failed) {
    logger.error('REFUSING: could not find both a READY and a FAILED VISIBLE photo fixture in this database')
    return { exitCode: 1, reason: 'FIXTURES_NOT_FOUND' }
  }

  const readyDto = await verifyLiveDto({
    fetchImpl,
    previewUrl,
    bypassSecret,
    slug: ready.event.slug,
    photoId: ready.id,
    expectedStatus: 'READY',
    originalUrl: ready.url,
  })
  const failedDto = await verifyLiveDto({
    fetchImpl,
    previewUrl,
    bypassSecret,
    slug: failed.event.slug,
    photoId: failed.id,
    expectedStatus: 'FAILED',
    originalUrl: failed.url,
  })
  const readyPage = await verifyPageAndOg({ fetchImpl, previewUrl, bypassSecret, slug: ready.event.slug, originalUrl: ready.url, coverUrl: ready.event.coverUrl })
  const failedPage = await verifyPageAndOg({ fetchImpl, previewUrl, bypassSecret, slug: failed.event.slug, originalUrl: failed.url, coverUrl: failed.event.coverUrl })
  const runtimeLogs = await fetchRuntimeLogSummary({ fetchImpl, vercelApiToken, deploymentId })

  const report = {
    fixtures: {
      readyPhotoId: ready.id,
      readyEventSlug: ready.event.slug,
      failedPhotoId: failed.id,
      failedEventSlug: failed.event.slug,
    },
    liveDto: { ready: readyDto, failed: failedDto },
    serializedPage: { ready: readyPage, failed: failedPage },
    runtimeLogs,
  }

  logger.log(JSON.stringify(report, null, 2))
  return { exitCode: 0, report }
}

export async function createRealDependencies() {
  const { PrismaClient } = await import('@prisma/client')
  return {
    prisma: new PrismaClient(),
    fetchImpl: fetch,
    previewUrl: process.env.PREVIEW_URL || DEFAULT_PREVIEW_URL,
    bypassSecret: process.env.VERCEL_PROTECTION_BYPASS_SECRET,
    vercelApiToken: process.env.VERCEL_API_TOKEN,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID,
    logger: console,
  }
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  if (!process.env.DATABASE_URL) {
    console.error('[preview-verify] REFUSING: DATABASE_URL is required and not set')
    process.exit(1)
  }
  const deps = await createRealDependencies()
  const result = await main(deps)
  await deps.prisma.$disconnect().catch(() => {})
  process.exitCode = result.exitCode
}
