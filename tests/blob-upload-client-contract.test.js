import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dirname, '..')

function readClient(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8')
}

/**
 * Extracts the source text of the Vercel-blob branch:
 * from `uploadStrategy === 'vercel-blob-client'` up to (but not including)
 * the `} else {` that starts the local/chunked fallback.
 */
function extractVercelBranch(source) {
  const marker = "uploadStrategy === 'vercel-blob-client'"
  const startIdx = source.indexOf(marker)
  if (startIdx === -1) return ''
  const elseIdx = source.indexOf('} else {', startIdx)
  return elseIdx === -1 ? source.slice(startIdx) : source.slice(startIdx, elseIdx)
}

/**
 * Extracts a slice around the local/chunked complete fetch call.
 * The Room client Vercel branch ends with `return true` — there is no
 * `} else {`. Both branches call fetch('/api/uploads/complete'), so we
 * return a window around the SECOND occurrence (local path).
 */
function extractRoomLocalCompleteFetch(source) {
  const marker = "fetch('/api/uploads/complete'"
  const firstIdx = source.indexOf(marker)
  if (firstIdx === -1) return ''
  const secondIdx = source.indexOf(marker, firstIdx + 1)
  if (secondIdx === -1) return ''
  return source.slice(secondIdx, secondIdx + 500)
}

/**
 * Extracts the JSON.stringify body of the fetch('/api/uploads/init') call
 * from the Room client.
 */
function extractRoomInitBody(source) {
  const fetchMarker = "fetch('/api/uploads/init'"
  const fetchIdx = source.indexOf(fetchMarker)
  if (fetchIdx === -1) return ''
  const bodyMarker = 'body: JSON.stringify({'
  const bodyIdx = source.indexOf(bodyMarker, fetchIdx)
  if (bodyIdx === -1) return ''
  // Find the matching }) — init body ends before the retry/fallback logic
  const closeIdx = source.indexOf('})', bodyIdx) + 2
  return source.slice(bodyIdx, closeIdx)
}

// ─── Sources ──────────────────────────────────────────────────────────────────

const ROOM = readClient('components/room-page-client.jsx')
const DASHBOARD = readClient('app/dashboard/page.js')
const PHOTOGRAPHER = readClient('components/photographer-upload-page-client.jsx')

const ROOM_VB = extractVercelBranch(ROOM)
const ROOM_LOCAL_COMPLETE = extractRoomLocalCompleteFetch(ROOM)
const ROOM_INIT_BODY = extractRoomInitBody(ROOM)
const DASHBOARD_VB = extractVercelBranch(DASHBOARD)
const PHOTOGRAPHER_VB = extractVercelBranch(PHOTOGRAPHER)

// ─── Room Photo Client ────────────────────────────────────────────────────────

describe('Room Photo Client — Vercel blob branch', () => {
  it('1: contains uploadStrategy discriminator', () => {
    expect(ROOM).toContain("uploadStrategy === 'vercel-blob-client'")
  })

  it('2: first arg to upload() is session.pathname — no hardcoded fallback', () => {
    expect(ROOM_VB).toMatch(/upload\(\s*session\.pathname\s*,/)
    expect(ROOM_VB).not.toMatch(/session\.pathname\s*\|\|/)
  })

  it('3: handleUploadUrl comes from session — no hardcoded fallback', () => {
    expect(ROOM_VB).toContain('handleUploadUrl: session.handleUploadUrl')
    expect(ROOM_VB).not.toMatch(/handleUploadUrl.*\|\|/)
  })

  it('4: clientPayload contains only sessionId from session', () => {
    expect(ROOM_VB).toContain('clientPayload: JSON.stringify({')
    expect(ROOM_VB).toContain('sessionId: session.sessionId')
  })

  it('5: clientPayload does not include forbidden blob-result fields', () => {
    const payload = ROOM_VB.slice(
      ROOM_VB.indexOf('clientPayload:'),
      ROOM_VB.indexOf('})', ROOM_VB.indexOf('clientPayload:')) + 2,
    )
    for (const key of ['blobUrl', 'blobPathname', 'eventSlug', 'fileName', 'fileSize', 'mimeType', 'originalName']) {
      expect(payload).not.toContain(key)
    }
  })

  it('6: complete body contains sessionId from session', () => {
    expect(ROOM_VB).toContain("body: JSON.stringify({\n              sessionId: session.sessionId,\n            })")
  })

  it('7: complete body does not include blob-result or guest-metadata fields', () => {
    const bodyStart = ROOM_VB.indexOf("body: JSON.stringify({")
    const bodyEnd = ROOM_VB.indexOf('})', bodyStart) + 2
    const completeBody = ROOM_VB.slice(bodyStart, bodyEnd)
    for (const key of ['blobUrl', 'blobPathname', 'originalName', 'mimeType', 'size', 'uploaderName', 'caption', 'momentId']) {
      expect(completeBody).not.toContain(key)
    }
  })

  it('8: complete request targets /api/uploads/complete', () => {
    expect(ROOM_VB).toContain("fetch('/api/uploads/complete'")
  })

  it('9: result of upload() is not assigned (no blob.url reference)', () => {
    expect(ROOM_VB).not.toMatch(/const\s+blob\s*=\s*await\s+upload\(/)
    expect(ROOM_VB).not.toContain('blob.url')
    expect(ROOM_VB).not.toContain('blob.pathname')
  })
})

// ─── Private Delivery Client (dashboard) ─────────────────────────────────────

describe('Private Delivery Client — Vercel blob branch', () => {
  it('10: contains uploadStrategy discriminator', () => {
    expect(DASHBOARD).toContain("uploadStrategy === 'vercel-blob-client'")
  })

  it('11: first arg to upload() is session.pathname — no hardcoded fallback', () => {
    expect(DASHBOARD_VB).toMatch(/upload\(\s*session\.pathname\s*,/)
    expect(DASHBOARD_VB).not.toMatch(/session\.pathname\s*\|\|/)
  })

  it('12: handleUploadUrl comes from session — no hardcoded fallback', () => {
    expect(DASHBOARD_VB).toContain('handleUploadUrl: session.handleUploadUrl')
    expect(DASHBOARD_VB).not.toMatch(/handleUploadUrl.*\|\|/)
  })

  it('13: clientPayload contains only sessionId from session', () => {
    expect(DASHBOARD_VB).toContain('clientPayload: JSON.stringify({')
    expect(DASHBOARD_VB).toContain('sessionId: session.sessionId')
  })

  it('14: clientPayload does not include forbidden blob-result fields', () => {
    const payload = DASHBOARD_VB.slice(
      DASHBOARD_VB.indexOf('clientPayload:'),
      DASHBOARD_VB.indexOf('})', DASHBOARD_VB.indexOf('clientPayload:')) + 2,
    )
    for (const key of ['blobUrl', 'blobPathname', 'eventSlug', 'fileName', 'fileSize', 'mimeType']) {
      expect(payload).not.toContain(key)
    }
  })

  it('15: complete body contains sessionId from session', () => {
    expect(DASHBOARD_VB).toContain("body: JSON.stringify({\n            sessionId: session.sessionId,\n          })")
  })

  it('16: complete body does not include blob-result fields', () => {
    const bodyStart = DASHBOARD_VB.indexOf("body: JSON.stringify({")
    const bodyEnd = DASHBOARD_VB.indexOf('})', bodyStart) + 2
    const completeBody = DASHBOARD_VB.slice(bodyStart, bodyEnd)
    for (const key of ['blobUrl', 'blobPathname', 'originalName', 'mimeType', 'size']) {
      expect(completeBody).not.toContain(key)
    }
  })

  it('17: complete endpoint path contains private-delivery/complete', () => {
    expect(DASHBOARD_VB).toContain('private-delivery/complete')
  })

  it('18: complete request uses csrfFetch — not plain fetch', () => {
    // csrfFetch(`...private-delivery/complete`, { ... }) — find the csrfFetch
    // call that contains the complete URL (URL starts after csrfFetch()
    const csrfIdx = DASHBOARD_VB.indexOf("csrfFetch(`/api/owner/events/")
    expect(csrfIdx).toBeGreaterThan(-1)
    const callSlice = DASHBOARD_VB.slice(csrfIdx, csrfIdx + 200)
    expect(callSlice).toContain('private-delivery/complete')
  })

  it('19: result of upload() is not assigned (no blob.url reference)', () => {
    expect(DASHBOARD_VB).not.toMatch(/const\s+blob\s*=\s*await\s+upload\(/)
    expect(DASHBOARD_VB).not.toContain('blob.url')
    expect(DASHBOARD_VB).not.toContain('blob.pathname')
  })
})

// ─── Photographer Upload Client ───────────────────────────────────────────────

describe('Photographer Upload Client — Vercel blob branch', () => {
  it('20: contains uploadStrategy discriminator', () => {
    expect(PHOTOGRAPHER).toContain("uploadStrategy === 'vercel-blob-client'")
  })

  it('21: first arg to upload() is session.pathname — no hardcoded fallback', () => {
    expect(PHOTOGRAPHER_VB).toMatch(/upload\(\s*session\.pathname\s*,/)
    expect(PHOTOGRAPHER_VB).not.toMatch(/session\.pathname\s*\|\|/)
  })

  it('22: handleUploadUrl comes from session — no hardcoded fallback', () => {
    expect(PHOTOGRAPHER_VB).toContain('handleUploadUrl: session.handleUploadUrl')
    expect(PHOTOGRAPHER_VB).not.toMatch(/handleUploadUrl.*\|\|/)
  })

  it('23: clientPayload contains only sessionId from session', () => {
    expect(PHOTOGRAPHER_VB).toContain('clientPayload: JSON.stringify({')
    expect(PHOTOGRAPHER_VB).toContain('sessionId: session.sessionId')
  })

  it('24: clientPayload does not include forbidden blob-result fields', () => {
    const payload = PHOTOGRAPHER_VB.slice(
      PHOTOGRAPHER_VB.indexOf('clientPayload:'),
      PHOTOGRAPHER_VB.indexOf('})', PHOTOGRAPHER_VB.indexOf('clientPayload:')) + 2,
    )
    for (const key of ['blobUrl', 'blobPathname', 'eventSlug', 'fileName', 'fileSize', 'mimeType']) {
      expect(payload).not.toContain(key)
    }
  })

  it('25: complete body contains only sessionId from session', () => {
    expect(PHOTOGRAPHER_VB).toContain("body: JSON.stringify({\n            sessionId: session.sessionId,\n          })")
  })

  it('26: complete body does not include blob-result fields or token', () => {
    const bodyStart = PHOTOGRAPHER_VB.indexOf("body: JSON.stringify({")
    const bodyEnd = PHOTOGRAPHER_VB.indexOf('})', bodyStart) + 2
    const completeBody = PHOTOGRAPHER_VB.slice(bodyStart, bodyEnd)
    for (const key of ['blobUrl', 'blobPathname', 'originalName', 'mimeType', 'size', 'token']) {
      expect(completeBody).not.toContain(key)
    }
  })

  it('27: result of upload() is not assigned (no blob.url reference)', () => {
    expect(PHOTOGRAPHER_VB).not.toMatch(/const\s+blob\s*=\s*await\s+upload\(/)
    expect(PHOTOGRAPHER_VB).not.toContain('blob.url')
    expect(PHOTOGRAPHER_VB).not.toContain('blob.pathname')
  })
})

// ─── Room metadata binding: init vs complete branches ─────────────────────────

describe('Room Photo Client — metadata binding between init and complete branches', () => {
  it('28: init body sends uploaderName: guestName', () => {
    expect(ROOM_INIT_BODY).toContain('uploaderName: guestName')
  })

  it('29: init body sends momentId', () => {
    expect(ROOM_INIT_BODY).toContain('momentId')
  })

  it('30: Vercel complete does NOT contain uploaderName', () => {
    const bodyStart = ROOM_VB.indexOf('body: JSON.stringify({')
    const bodyEnd = ROOM_VB.indexOf('})', bodyStart) + 2
    const completeBody = ROOM_VB.slice(bodyStart, bodyEnd)
    expect(completeBody).not.toContain('uploaderName')
  })

  it('31: Vercel complete does NOT contain momentId', () => {
    const bodyStart = ROOM_VB.indexOf('body: JSON.stringify({')
    const bodyEnd = ROOM_VB.indexOf('})', bodyStart) + 2
    const completeBody = ROOM_VB.slice(bodyStart, bodyEnd)
    expect(completeBody).not.toContain('momentId')
  })

  it('32: Vercel complete contains ONLY sessionId (no other keys)', () => {
    const bodyStart = ROOM_VB.indexOf('body: JSON.stringify({')
    const bodyEnd = ROOM_VB.indexOf('})', bodyStart) + 2
    const completeBody = ROOM_VB.slice(bodyStart, bodyEnd)
    expect(completeBody).toContain('sessionId')
    for (const key of ['uploaderName', 'caption', 'momentId', 'blobUrl', 'blobPathname', 'originalName', 'mimeType', 'size', 'eventSlug']) {
      expect(completeBody).not.toContain(key)
    }
  })

  it('33: local complete contains uploaderName', () => {
    expect(ROOM_LOCAL_COMPLETE).not.toBe('')
    expect(ROOM_LOCAL_COMPLETE).toContain('uploaderName')
  })

  it('34: local complete contains momentId', () => {
    expect(ROOM_LOCAL_COMPLETE).not.toBe('')
    expect(ROOM_LOCAL_COMPLETE).toContain('momentId')
  })
})
