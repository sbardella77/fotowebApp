import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Source-contract tests: this repo has no React rendering harness, so the
// Guest Room V4 funnel instrumentation is verified by reading the component
// source and asserting on exact markers/substrings, matching the pattern
// used by tests/room-upload-retry-classification.test.js and
// tests/blob-upload-client-contract.test.js.

const ROOM = readFileSync(resolve(import.meta.dirname, '..', 'components/room-page-client.jsx'), 'utf8')
const EVENTS = readFileSync(resolve(import.meta.dirname, '..', 'lib/analytics/events.js'), 'utf8')

function extractBetween(source, startMarker, endMarker) {
  const startIdx = source.indexOf(startMarker)
  if (startIdx === -1) throw new Error(`start marker not found: ${startMarker}`)
  const endIdx = source.indexOf(endMarker, startIdx)
  if (endIdx === -1) throw new Error(`end marker not found: ${endMarker}`)
  return source.slice(startIdx, endIdx)
}

function extractCall(source, marker) {
  const idx = source.indexOf(marker)
  if (idx === -1) throw new Error(`call marker not found: ${marker}`)
  const closeIdx = source.indexOf('})', idx)
  return source.slice(idx, closeIdx + 2)
}

describe('EVENT_PHOTOS_SELECTED constant', () => {
  it('is defined as photos_selected', () => {
    expect(EVENTS).toContain("export const EVENT_PHOTOS_SELECTED = 'photos_selected'")
  })

  it('is imported by room-page-client.jsx', () => {
    expect(ROOM).toContain('EVENT_PHOTOS_SELECTED,')
  })
})

describe('photos_selected emission point (onFilesSelected)', () => {
  const FN = extractBetween(ROOM, 'const onFilesSelected = async (event) => {', '\n  const beginUpload = async')

  it('fires after the zero-supported-files early return and before the moment-count branch', () => {
    const emptyReturnIdx = FN.indexOf('if (supportedFiles.length === 0) return')
    const trackIdx = FN.indexOf('trackEvent(EVENT_PHOTOS_SELECTED')
    const branchIdx = FN.indexOf('if (eventMoments.length > 1)')
    expect(emptyReturnIdx).toBeGreaterThan(-1)
    expect(trackIdx).toBeGreaterThan(emptyReturnIdx)
    expect(branchIdx).toBeGreaterThan(trackIdx)
  })

  it('is not reachable when the picker returns zero files or zero valid files', () => {
    const trackIdx = FN.indexOf('trackEvent(EVENT_PHOTOS_SELECTED')
    const before = FN.slice(0, trackIdx)
    expect(before).toContain('if (fileList.length === 0) return')
    expect(before).toContain('if (supportedFiles.length === 0) return')
    // No other return statement should exist between function start and the
    // photos_selected call — otherwise a third silent bail-out path could
    // exist that this test isn't aware of.
    const returnCount = (before.match(/\breturn\b/g) || []).length
    expect(returnCount).toBe(2)
  })

  it('carries photo_count, has_moments, moment_count, is_host, source', () => {
    const block = extractCall(FN, 'trackEvent(EVENT_PHOTOS_SELECTED')
    expect(block).toContain('room_slug: activeEvent?.slug')
    expect(block).toContain('photo_count: supportedFiles.length')
    expect(block).toContain('has_moments: eventMoments.length > 0')
    expect(block).toContain('moment_count: eventMoments.length')
    expect(block).toContain('is_host: isEventOwner')
    expect(block).toContain('source: lastCtaSourceRef.current')
  })

  it('does not include guestName, email, or filenames', () => {
    const block = extractCall(FN, 'trackEvent(EVENT_PHOTOS_SELECTED')
    expect(block).not.toContain('guestName')
    expect(block).not.toContain('email')
    expect(block).not.toMatch(/file\.name/)
  })
})

describe('room_viewed host/moments properties', () => {
  const block = extractCall(ROOM, 'trackEvent(EVENT_ROOM_VIEWED, {')
  const preamble = ROOM.slice(ROOM.indexOf('const viewedIsHost ='), ROOM.indexOf('trackEvent(EVENT_ROOM_VIEWED, {'))

  it('derives is_host from payload.event, not the stale isEventOwner memo', () => {
    // activeEvent/isEventOwner have not re-rendered yet at this point in
    // loadEvent (setActiveEvent was just called above), so host status must
    // be computed from payload.event directly to avoid stale/incorrect data.
    expect(preamble).toContain('payload.event?.ownerEmail')
    expect(preamble).toContain('ownerSession?.authenticated')
    expect(block).toContain('is_host: viewedIsHost')
  })

  it('derives has_moments/moment_count from payload.event, not stale activeEvent', () => {
    expect(preamble).toContain('const viewedMoments = payload.event?.moments || []')
    expect(block).toContain('has_moments: viewedMoments.length > 0')
    expect(block).toContain('moment_count: viewedMoments.length')
  })

  it('still fires only once per session via roomViewTracked guard', () => {
    const guardIdx = ROOM.indexOf('if (!roomViewTracked.current) {')
    const trackIdx = ROOM.indexOf('trackEvent(EVENT_ROOM_VIEWED, {')
    expect(guardIdx).toBeGreaterThan(-1)
    expect(trackIdx).toBeGreaterThan(guardIdx)
  })
})

describe('upload_cta_clicked host/moments properties', () => {
  it('hero CTA includes is_host, has_moments, moment_count alongside source: hero', () => {
    const block = extractCall(ROOM, "trackEvent(EVENT_UPLOAD_CTA_CLICKED, { room_slug: activeEvent?.slug, source: 'hero'")
    expect(block).toContain('is_host: isEventOwner')
    expect(block).toContain('has_moments: (activeEvent?.moments?.length || 0) > 0')
    expect(block).toContain('moment_count: activeEvent?.moments?.length || 0')
  })

  it('sticky CTA includes is_host, has_moments, moment_count alongside source: sticky', () => {
    const block = extractCall(ROOM, "trackEvent(EVENT_UPLOAD_CTA_CLICKED, { room_slug: activeEvent?.slug, source: 'sticky'")
    expect(block).toContain('is_host: isEventOwner')
    expect(block).toContain('has_moments: (activeEvent?.moments?.length || 0) > 0')
    expect(block).toContain('moment_count: activeEvent?.moments?.length || 0')
  })
})

describe('CTA source ref propagation', () => {
  it('declares lastCtaSourceRef as a ref initialized to an empty string', () => {
    expect(ROOM).toContain("const lastCtaSourceRef = useRef('')")
  })

  it('sets lastCtaSourceRef at all four picker-opening entry points', () => {
    expect(ROOM).toContain("lastCtaSourceRef.current = 'hero'")
    expect(ROOM).toContain("lastCtaSourceRef.current = 'sticky'")
    expect(ROOM).toContain("lastCtaSourceRef.current = 'upload_more'")
    expect(ROOM).toContain("lastCtaSourceRef.current = 'gallery_empty_state'")
  })

  it('reads lastCtaSourceRef.current in both photos_selected and beginUpload funnelProps', () => {
    const occurrences = (ROOM.match(/source: lastCtaSourceRef\.current/g) || []).length
    expect(occurrences).toBeGreaterThanOrEqual(2)
  })
})

describe('beginUpload funnelProps propagated to started/completed/second/failed', () => {
  const FN = extractBetween(ROOM, 'const beginUpload = async (filesToUpload, momentId) => {', '\n  const openLightbox')

  it('computes funnelProps once with has_moments, moment_count, is_host, source', () => {
    const idx = FN.indexOf('const funnelProps = {')
    expect(idx).toBeGreaterThan(-1)
    const block = FN.slice(idx, FN.indexOf('}', idx) + 1)
    expect(block).toContain('has_moments: eventMoments.length > 0')
    expect(block).toContain('moment_count: eventMoments.length')
    expect(block).toContain('is_host: isEventOwner')
    expect(block).toContain('source: lastCtaSourceRef.current')
  })

  it('spreads funnelProps into upload_started', () => {
    expect(FN).toContain(
      'trackEvent(EVENT_UPLOAD_STARTED, { room_slug: activeEvent?.slug, batch_size: filesToUpload.length, is_second_upload: uploadCompletedTracked.current, ...funnelProps })'
    )
  })

  it('spreads funnelProps into upload_completed and second_upload_completed', () => {
    expect(FN).toContain(
      "trackEvent(EVENT_SECOND_UPLOAD_COMPLETED, { room_slug: activeEvent?.slug, batch_size: filesToUpload.length, ...funnelProps })"
    )
    expect(FN).toContain(
      "trackEvent(EVENT_UPLOAD_COMPLETED, { room_slug: activeEvent?.slug, batch_size: filesToUpload.length, ...funnelProps })"
    )
  })

  it('spreads funnelProps into upload_failed while preserving the partial flag', () => {
    expect(FN).toContain(
      'trackEvent(EVENT_UPLOAD_FAILED, { room_slug: activeEvent?.slug, batch_size: filesToUpload.length, partial: someSucceeded, ...funnelProps })'
    )
  })

  it('does not include guestName, email, or filenames in funnelProps', () => {
    const idx = FN.indexOf('const funnelProps = {')
    const block = FN.slice(idx, FN.indexOf('}', idx) + 1)
    expect(block).not.toContain('guestName')
    expect(block).not.toContain('email')
  })
})

describe('partial upload semantics unchanged', () => {
  it('upload_completed / second_upload_completed still only fire on allSucceeded', () => {
    const idx = ROOM.indexOf('const allSucceeded = results.every(Boolean)')
    expect(idx).toBeGreaterThan(-1)
    const ifBlock = ROOM.slice(idx, ROOM.indexOf('} else {', idx))
    expect(ifBlock).toContain('EVENT_SECOND_UPLOAD_COMPLETED')
    expect(ifBlock).toContain('EVENT_UPLOAD_COMPLETED')
  })

  it('upload_failed still carries partial: someSucceeded on any non-full-success batch', () => {
    const idx = ROOM.indexOf('const someSucceeded = results.some(Boolean)')
    expect(idx).toBeGreaterThan(-1)
    const block = extractCall(ROOM.slice(idx), 'trackEvent(EVENT_UPLOAD_FAILED')
    expect(block).toContain('partial: someSucceeded')
  })
})

describe('regression: upload flow structure unaffected by instrumentation', () => {
  it('uploadSingleFile function boundary markers still exist untouched', () => {
    expect(ROOM).toContain('const uploadSingleFile = async')
    expect(ROOM).toContain('const MAX_FILE_SIZE =')
  })

  it('onFilesSelected still routes to staging for >1 moment and direct upload otherwise', () => {
    const FN = extractBetween(ROOM, 'const onFilesSelected = async (event) => {', '\n  const beginUpload = async')
    expect(FN).toContain('setPendingFiles(supportedFiles)')
    expect(FN).toContain('await beginUpload(supportedFiles, eventMoments[0]?.id ?? \'\')')
  })
})
