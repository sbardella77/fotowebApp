import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  isManagedEventCoverUrl,
  deleteManagedEventCover,
  getCoverStoragePath,
} from '@/lib/server/event-cover-storage'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HOST = 'https://abc.public.blob.vercel-storage.com'
const SLUG = 'event-a'
const VALID_URL = `${HOST}/covers/${SLUG}/123-cover.webp`

// ─── isManagedEventCoverUrl — VALID ──────────────────────────────────────────

describe('isManagedEventCoverUrl — valid managed cover URLs', () => {
  it('1: valid Vercel Blob URL for the owning event returns true', () => {
    expect(isManagedEventCoverUrl(VALID_URL, SLUG)).toBe(true)
  })

  it('accepts different filename extensions', () => {
    expect(isManagedEventCoverUrl(`${HOST}/covers/${SLUG}/cover.jpg`, SLUG)).toBe(true)
    expect(isManagedEventCoverUrl(`${HOST}/covers/${SLUG}/cover.png`, SLUG)).toBe(true)
  })
})

// ─── isManagedEventCoverUrl — INVALID ────────────────────────────────────────

describe('isManagedEventCoverUrl — invalid / unsafe URLs', () => {
  it('2: foreign slug returns false', () => {
    expect(isManagedEventCoverUrl(`${HOST}/covers/event-b/file.webp`, SLUG)).toBe(false)
  })

  it('3: prefix-collision slug (event-ab vs event-a) returns false', () => {
    expect(isManagedEventCoverUrl(`${HOST}/covers/event-ab/file.webp`, SLUG)).toBe(false)
  })

  it('4: query injection — marker in query string returns false', () => {
    const attacked = `${HOST}/covers/victim-event/victim.webp?x=/covers/${SLUG}/x`
    expect(isManagedEventCoverUrl(attacked, SLUG)).toBe(false)
  })

  it('5: fragment injection — marker in fragment returns false', () => {
    const attacked = `${HOST}/covers/victim-event/victim.webp#/covers/${SLUG}/x`
    expect(isManagedEventCoverUrl(attacked, SLUG)).toBe(false)
  })

  it('6: hostile suffix on hostname returns false', () => {
    const evil = `https://abc.blob.vercel-storage.com.evil.com/covers/${SLUG}/file.webp`
    expect(isManagedEventCoverUrl(evil, SLUG)).toBe(false)
  })

  it('7: bare hostname blob.vercel-storage.com (no subdomain) returns false', () => {
    const bare = `https://blob.vercel-storage.com/covers/${SLUG}/file.webp`
    expect(isManagedEventCoverUrl(bare, SLUG)).toBe(false)
  })

  it('8: credentials in URL return false', () => {
    const credUrl = `https://user@abc.public.blob.vercel-storage.com/covers/${SLUG}/file.webp`
    expect(isManagedEventCoverUrl(credUrl, SLUG)).toBe(false)
  })

  it('9: explicit non-default port returns false', () => {
    const portUrl = `https://abc.blob.vercel-storage.com:444/covers/${SLUG}/file.webp`
    expect(isManagedEventCoverUrl(portUrl, SLUG)).toBe(false)
  })

  it('10: percent encoding in pathname returns false', () => {
    const pctUrl = `${HOST}/covers/${SLUG}/file%20name.webp`
    expect(isManagedEventCoverUrl(pctUrl, SLUG)).toBe(false)
  })

  it('11: backslash in pathname returns false (pre-parse raw check)', () => {
    const bsUrl = `${HOST}/covers/${SLUG}/file\\name.webp`
    expect(isManagedEventCoverUrl(bsUrl, SLUG)).toBe(false)
  })

  it('12: dot segment in pathname returns false (canonicality: parsed.href !== input)', () => {
    // new URL() normalizes /covers/victim/../event-a/file.webp → /covers/event-a/file.webp
    // so parsed.href !== original → false
    const dotUrl = `${HOST}/covers/victim/../${SLUG}/file.webp`
    expect(isManagedEventCoverUrl(dotUrl, SLUG)).toBe(false)
  })

  it('12b: percent-encoded dot segment returns false (pre-parse % check)', () => {
    const pctDotUrl = `${HOST}/covers/victim/%2e%2e/${SLUG}/file.webp`
    expect(isManagedEventCoverUrl(pctDotUrl, SLUG)).toBe(false)
  })

  it('13a: double slash after covers returns false', () => {
    // new URL() does NOT normalize // in path → pathname = /covers//event-a/file.webp
    // caught by explicit pathname.includes('//') AND exact segment count
    expect(isManagedEventCoverUrl(`${HOST}/covers//${SLUG}/file.webp`, SLUG)).toBe(false)
  })

  it('13b: double slash after slug returns false', () => {
    expect(isManagedEventCoverUrl(`${HOST}/covers/${SLUG}//file.webp`, SLUG)).toBe(false)
  })

  it('13c: double slash at start of path returns false', () => {
    expect(isManagedEventCoverUrl(`${HOST}//covers/${SLUG}/file.webp`, SLUG)).toBe(false)
  })

  it('14: trailing slash / no filename returns false', () => {
    const noFile = `${HOST}/covers/${SLUG}/`
    expect(isManagedEventCoverUrl(noFile, SLUG)).toBe(false)
  })

  it('15: wrong namespace (events instead of covers) returns false', () => {
    const wrongNs = `${HOST}/events/${SLUG}/file.webp`
    expect(isManagedEventCoverUrl(wrongNs, SLUG)).toBe(false)
  })

  it('16: external URL not on Vercel Blob returns false', () => {
    const external = `https://example.com/covers/${SLUG}/file.webp`
    expect(isManagedEventCoverUrl(external, SLUG)).toBe(false)
  })

  it('17: slug injection — slug contains "/" returns false', () => {
    const injectedSlug = `${SLUG}/../victim`
    expect(isManagedEventCoverUrl(`${HOST}/covers/victim/file.webp`, injectedSlug)).toBe(false)
  })

  it('slug injection — slug contains "%" returns false', () => {
    expect(isManagedEventCoverUrl(VALID_URL, `${SLUG}%2f../victim`)).toBe(false)
  })

  it('slug injection — slug is "." returns false', () => {
    expect(isManagedEventCoverUrl(`${HOST}/covers/./file.webp`, '.')).toBe(false)
  })

  it('slug injection — slug is ".." returns false', () => {
    expect(isManagedEventCoverUrl(`${HOST}/covers/../file.webp`, '..')).toBe(false)
  })

  it('explicit default :443 returns false (canonicality: parsed.href strips port)', () => {
    // new URL() drops :443 (default for https) → parsed.href !== original
    const portUrl = `https://abc.public.blob.vercel-storage.com:443/covers/${SLUG}/file.webp`
    expect(isManagedEventCoverUrl(portUrl, SLUG)).toBe(false)
  })

  it('url is null returns false', () => {
    expect(isManagedEventCoverUrl(null, SLUG)).toBe(false)
  })

  it('url is empty string returns false', () => {
    expect(isManagedEventCoverUrl('', SLUG)).toBe(false)
  })

  it('slug is empty returns false', () => {
    expect(isManagedEventCoverUrl(VALID_URL, '')).toBe(false)
  })

  it('http (not https) URL returns false', () => {
    expect(isManagedEventCoverUrl(`http://abc.blob.vercel-storage.com/covers/${SLUG}/file.webp`, SLUG)).toBe(false)
  })
})

// ─── deleteManagedEventCover — destructive regression tests ──────────────────

vi.mock('@/lib/server/storage', () => ({
  deleteStoredFile: vi.fn(),
}))

import { deleteStoredFile } from '@/lib/server/storage'

describe('deleteManagedEventCover — storage delete control', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deleteStoredFile.mockResolvedValue(undefined)
  })

  it('18: valid managed URL → storage delete called once with exact original URL', async () => {
    const result = await deleteManagedEventCover(VALID_URL, SLUG)
    expect(result).toBe(true)
    expect(deleteStoredFile).toHaveBeenCalledOnce()
    expect(deleteStoredFile).toHaveBeenCalledWith(VALID_URL)
  })

  it('19: foreign slug → storage delete NOT called', async () => {
    const result = await deleteManagedEventCover(`${HOST}/covers/other-event/file.webp`, SLUG)
    expect(result).toBe(true)
    expect(deleteStoredFile).not.toHaveBeenCalled()
  })

  it('20: query-marker attack → storage delete NOT called', async () => {
    const attacked = `${HOST}/covers/victim-event/victim.webp?x=/covers/${SLUG}/x`
    const result = await deleteManagedEventCover(attacked, SLUG)
    expect(result).toBe(true)
    expect(deleteStoredFile).not.toHaveBeenCalled()
  })

  it('21: fragment-marker attack → storage delete NOT called', async () => {
    const attacked = `${HOST}/covers/victim-event/victim.webp#/covers/${SLUG}/x`
    const result = await deleteManagedEventCover(attacked, SLUG)
    expect(result).toBe(true)
    expect(deleteStoredFile).not.toHaveBeenCalled()
  })

  it('22: external cover URL → storage delete NOT called', async () => {
    const external = `https://example.com/covers/${SLUG}/file.webp`
    const result = await deleteManagedEventCover(external, SLUG)
    expect(result).toBe(true)
    expect(deleteStoredFile).not.toHaveBeenCalled()
  })

  it('23: invalid/unsafe cover still returns non-blocking success (true)', async () => {
    const unsafe = `${HOST}/covers/victim/file.webp`
    const result = await deleteManagedEventCover(unsafe, SLUG)
    expect(result).toBe(true)
    expect(deleteStoredFile).not.toHaveBeenCalled()
  })

  it('24: storage error on truly managed URL returns false (best-effort contract)', async () => {
    deleteStoredFile.mockRejectedValue(new Error('storage unavailable'))
    const result = await deleteManagedEventCover(VALID_URL, SLUG)
    expect(result).toBe(false)
    expect(deleteStoredFile).toHaveBeenCalledOnce()
  })

  it('25: non-canonical URL (dot segment) → deleteStoredFile NOT called', async () => {
    const dotUrl = `${HOST}/covers/victim/../${SLUG}/file.webp`
    const result = await deleteManagedEventCover(dotUrl, SLUG)
    expect(result).toBe(true)
    expect(deleteStoredFile).not.toHaveBeenCalled()
  })

  it('26: non-canonical URL (double-slash path) → deleteStoredFile NOT called', async () => {
    const dsUrl = `${HOST}/covers//${SLUG}/file.webp`
    const result = await deleteManagedEventCover(dsUrl, SLUG)
    expect(result).toBe(true)
    expect(deleteStoredFile).not.toHaveBeenCalled()
  })

  it('27: valid managed URL → deleteStoredFile called with EXACT original string (not parsed.href)', async () => {
    // The exact original URL must be passed — not a reconstructed or parsed version
    await deleteManagedEventCover(VALID_URL, SLUG)
    expect(deleteStoredFile).toHaveBeenCalledWith(VALID_URL)
    // Verify it matches the original string character-for-character
    const calledWith = deleteStoredFile.mock.calls[0][0]
    expect(calledWith).toBe(VALID_URL)
  })
})

// ─── FASE 11 — Exact confused-deputy regression ───────────────────────────────

describe('deleteManagedEventCover — confused-deputy regression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deleteStoredFile.mockResolvedValue(undefined)
  })

  it('query-marker confused-deputy: attacker event slug, victim URL + query injection → blocked', async () => {
    const attackerSlug = 'attacker-event'
    const poisonedUrl = `${HOST}/covers/victim-event/victim.webp?marker=/covers/${attackerSlug}/`
    expect(isManagedEventCoverUrl(poisonedUrl, attackerSlug)).toBe(false)
    const result = await deleteManagedEventCover(poisonedUrl, attackerSlug)
    expect(result).toBe(true)
    expect(deleteStoredFile).not.toHaveBeenCalled()
  })

  it('fragment-marker confused-deputy: attacker event slug, victim URL + fragment injection → blocked', async () => {
    const attackerSlug = 'attacker-event'
    const poisonedUrl = `${HOST}/covers/victim-event/victim.webp#/covers/${attackerSlug}/`
    expect(isManagedEventCoverUrl(poisonedUrl, attackerSlug)).toBe(false)
    const result = await deleteManagedEventCover(poisonedUrl, attackerSlug)
    expect(result).toBe(true)
    expect(deleteStoredFile).not.toHaveBeenCalled()
  })
})

// ─── FASE 12 — Server-generated cover remains valid ──────────────────────────

describe('getCoverStoragePath + isManagedEventCoverUrl — legitimate cover', () => {
  it('getCoverStoragePath returns covers/{slug}/{filename}', () => {
    const path = getCoverStoragePath('event-a', '123-cover.webp')
    expect(path).toBe('covers/event-a/123-cover.webp')
  })

  it('canonical Vercel Blob URL from getCoverStoragePath is accepted by isManagedEventCoverUrl', () => {
    const pathname = getCoverStoragePath('event-a', '123-cover.webp')
    const canonicalUrl = `${HOST}/${pathname}`
    expect(isManagedEventCoverUrl(canonicalUrl, 'event-a')).toBe(true)
  })

  it('canonical URL for one slug is rejected for a different slug', () => {
    const pathname = getCoverStoragePath('event-a', '123-cover.webp')
    const canonicalUrl = `${HOST}/${pathname}`
    expect(isManagedEventCoverUrl(canonicalUrl, 'event-b')).toBe(false)
  })
})

// ─── Log privacy: storage error does not expose URL ──────────────────────────

describe('deleteManagedEventCover — log privacy on storage error', () => {
  it('storage error message logged is static (no URL emitted)', async () => {
    deleteStoredFile.mockRejectedValue(new Error('network error'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await deleteManagedEventCover(VALID_URL, SLUG)

    expect(consoleSpy).toHaveBeenCalledOnce()
    const [message] = consoleSpy.mock.calls[0]
    expect(message).not.toContain(VALID_URL)
    expect(message).not.toContain(SLUG)

    consoleSpy.mockRestore()
  })
})
