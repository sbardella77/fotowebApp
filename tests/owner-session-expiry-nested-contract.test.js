import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve(import.meta.dirname, '..')

function readSource(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8')
}

const DASHBOARD_PAGE = readSource('app/dashboard/page.js')
const EVENT_DETAIL_PANEL = readSource('app/dashboard/components/event-detail-panel.jsx')
const EVENT_WORKSPACE_OVERVIEW = readSource('app/dashboard/components/event-workspace-overview.jsx')
const EVENT_WORKSPACE_PHOTOS = readSource('app/dashboard/components/event-workspace-photos.jsx')
const EVENT_MOMENTS_MANAGER = readSource('app/dashboard/components/event-moments-manager.jsx')
const EVENT_COVER_EDITOR = readSource('app/dashboard/components/event-cover-editor.jsx')
const ROOM_CLIENT = readSource('components/room-page-client.jsx')
const PHOTOGRAPHER_CLIENT = readSource('components/photographer-upload-page-client.jsx')

// ─── A. EventDetailPanel receives and forwards the callback ──────────────────

describe('A. EventDetailPanel receives and forwards onOwnerSessionFailure', () => {
  it('1: page.js passes consumeOwnerSessionFailure into the single <EventDetailPanel> call site', () => {
    const idx = DASHBOARD_PAGE.indexOf('<EventDetailPanel')
    expect(idx).toBeGreaterThan(-1)
    const closeIdx = DASHBOARD_PAGE.indexOf('/>', idx)
    const propsBlock = DASHBOARD_PAGE.slice(idx, closeIdx)
    expect(propsBlock).toContain('onOwnerSessionFailure={consumeOwnerSessionFailure}')
  })

  it('2: event-detail-panel.jsx destructures onOwnerSessionFailure from props', () => {
    expect(EVENT_DETAIL_PANEL).toMatch(/onOwnerSessionFailure,/)
  })

  it('3a: EventDetailPanel forwards onOwnerSessionFailure to EventWorkspaceOverview (Phase 5B extraction)', () => {
    const idx = EVENT_DETAIL_PANEL.indexOf('<EventWorkspaceOverview')
    expect(idx).toBeGreaterThan(-1)
    const closeIdx = EVENT_DETAIL_PANEL.indexOf('/>', idx)
    expect(EVENT_DETAIL_PANEL.slice(idx, closeIdx)).toContain('onOwnerSessionFailure={onOwnerSessionFailure}')
  })

  it('3b: EventCoverEditor/EventCoverRemove both receive onOwnerSessionFailure forwarded from EventWorkspaceOverview', () => {
    expect(EVENT_WORKSPACE_OVERVIEW).toContain('<EventCoverEditor event={event} onCoverUpdated={onCoverUpdated} onOwnerSessionFailure={onOwnerSessionFailure}')
    expect(EVENT_WORKSPACE_OVERVIEW).toContain('<EventCoverRemove event={event} onCoverUpdated={onCoverUpdated} onOwnerSessionFailure={onOwnerSessionFailure}')
  })

  it('4a: EventDetailPanel forwards onOwnerSessionFailure to EventWorkspacePhotos (Phase 5B extraction)', () => {
    const idx = EVENT_DETAIL_PANEL.indexOf('<EventWorkspacePhotos')
    expect(idx).toBeGreaterThan(-1)
    const closeIdx = EVENT_DETAIL_PANEL.indexOf('/>', idx)
    expect(EVENT_DETAIL_PANEL.slice(idx, closeIdx)).toContain('onOwnerSessionFailure={onOwnerSessionFailure}')
  })

  it('4b: EventMomentsManager receives onOwnerSessionFailure forwarded from EventWorkspacePhotos', () => {
    expect(EVENT_WORKSPACE_PHOTOS).toContain('<EventMomentsManager event={event} t={t} onOwnerSessionFailure={onOwnerSessionFailure} />')
  })
})

// ─── B-E. EventMomentsManager: load / create / rename / delete ───────────────

function extractFunctionBody(source, marker, endMarker = '\n  }') {
  const startIdx = source.indexOf(marker)
  if (startIdx === -1) return ''
  const endIdx = source.indexOf(endMarker, startIdx)
  return endIdx === -1 ? source.slice(startIdx) : source.slice(startIdx, endIdx)
}

describe('B. EventMomentsManager — load moments: 401 handler precedes the generic throw', () => {
  it('5: fetchMoments consumes onOwnerSessionFailure before the generic !res.ok throw', () => {
    const body = extractFunctionBody(EVENT_MOMENTS_MANAGER, 'const fetchMoments = useCallback(async (signal) => {')
    expect(body).not.toBe('')
    const consumeIdx = body.indexOf('onOwnerSessionFailure && (await onOwnerSessionFailure(res.status))) return')
    const throwIdx = body.indexOf("throw new Error(errData.error || 'Failed to load moments')")
    expect(consumeIdx).toBeGreaterThan(-1)
    expect(throwIdx).toBeGreaterThan(-1)
    expect(consumeIdx).toBeLessThan(throwIdx)
  })

  it('6: fetchMoments useCallback dependency array includes onOwnerSessionFailure (exhaustive-deps, no silencing)', () => {
    expect(EVENT_MOMENTS_MANAGER).toContain('}, [event?.slug, onOwnerSessionFailure])')
  })
})

describe('C. EventMomentsManager — create moment: same contract', () => {
  it('7: handleCreate consumes onOwnerSessionFailure before the generic !res.ok throw', () => {
    const body = extractFunctionBody(EVENT_MOMENTS_MANAGER, 'const handleCreate = async () => {')
    const consumeIdx = body.indexOf('onOwnerSessionFailure && (await onOwnerSessionFailure(res.status))) return')
    const throwIdx = body.indexOf("throw new Error(data.error || 'Failed to create moment')")
    expect(consumeIdx).toBeGreaterThan(-1)
    expect(throwIdx).toBeGreaterThan(-1)
    expect(consumeIdx).toBeLessThan(throwIdx)
  })
})

describe('D. EventMomentsManager — rename moment: same contract', () => {
  it('8: handleRename consumes onOwnerSessionFailure before the generic !res.ok throw', () => {
    const body = extractFunctionBody(EVENT_MOMENTS_MANAGER, 'const handleRename = async (momentId) => {')
    const consumeIdx = body.indexOf('onOwnerSessionFailure && (await onOwnerSessionFailure(res.status))) return')
    const throwIdx = body.indexOf("throw new Error(data.error || 'Failed to rename moment')")
    expect(consumeIdx).toBeGreaterThan(-1)
    expect(throwIdx).toBeGreaterThan(-1)
    expect(consumeIdx).toBeLessThan(throwIdx)
  })
})

describe('E. EventMomentsManager — delete moment: same contract', () => {
  it('9: handleDelete consumes onOwnerSessionFailure before the generic !res.ok throw', () => {
    const body = extractFunctionBody(EVENT_MOMENTS_MANAGER, 'const handleDelete = async (momentId) => {')
    const consumeIdx = body.indexOf('onOwnerSessionFailure && (await onOwnerSessionFailure(res.status))) return')
    const throwIdx = body.indexOf("throw new Error(data.error || 'Failed to delete moment')")
    expect(consumeIdx).toBeGreaterThan(-1)
    expect(throwIdx).toBeGreaterThan(-1)
    expect(consumeIdx).toBeLessThan(throwIdx)
  })
})

// ─── F. EventCoverEditor upload ───────────────────────────────────────────────

describe('F. EventCoverEditor — cover upload: same contract', () => {
  it('10: saveCover consumes onOwnerSessionFailure before the generic !response.ok throw', () => {
    const body = extractFunctionBody(EVENT_COVER_EDITOR, 'const saveCover = async () => {')
    const consumeIdx = body.indexOf('onOwnerSessionFailure && (await onOwnerSessionFailure(response.status))) return')
    const throwIdx = body.indexOf("throw new Error(payload.error || 'Unable to save cover')")
    expect(consumeIdx).toBeGreaterThan(-1)
    expect(throwIdx).toBeGreaterThan(-1)
    expect(consumeIdx).toBeLessThan(throwIdx)
  })

  it('11: on a consumed 401, no success callback/dialog-close runs (return precedes onCoverUpdated/setOpen/reset)', () => {
    const body = extractFunctionBody(EVENT_COVER_EDITOR, 'const saveCover = async () => {')
    const consumeIdx = body.indexOf('onOwnerSessionFailure && (await onOwnerSessionFailure(response.status))) return')
    const onCoverUpdatedIdx = body.indexOf('onCoverUpdated(payload.event)')
    expect(consumeIdx).toBeLessThan(onCoverUpdatedIdx)
  })
})

// ─── G. EventCoverRemove ───────────────────────────────────────────────────────

describe('G. EventCoverRemove — cover remove: same contract, generic-error UX untouched', () => {
  it('12: handleRemove consumes onOwnerSessionFailure before the generic !response.ok throw', () => {
    const body = extractFunctionBody(EVENT_COVER_EDITOR, 'const handleRemove = async () => {')
    const consumeIdx = body.indexOf('onOwnerSessionFailure && (await onOwnerSessionFailure(response.status))) return')
    const throwIdx = body.indexOf("throw new Error(payload.error || 'Unable to remove cover')")
    expect(consumeIdx).toBeGreaterThan(-1)
    expect(throwIdx).toBeGreaterThan(-1)
    expect(consumeIdx).toBeLessThan(throwIdx)
  })

  it("13: the pre-existing silent console.error-only catch for non-401 failures is unchanged", () => {
    const body = extractFunctionBody(EVENT_COVER_EDITOR, 'const handleRemove = async () => {', '\n  }\n\n  if (!event')
    expect(body).toContain("console.error('[removeCover] error:', err)")
  })
})

// ─── H/I. Nested components stay dependency-free of the gate/session-check ───

describe('H/I. Nested components do not own any session-expiry infrastructure', () => {
  const NESTED_FILES = [EVENT_MOMENTS_MANAGER, EVENT_COVER_EDITOR, EVENT_DETAIL_PANEL, EVENT_WORKSPACE_OVERVIEW, EVENT_WORKSPACE_PHOTOS]

  it('14: event-moments-manager.jsx does not import createOwnerSessionExpiryGate', () => {
    expect(EVENT_MOMENTS_MANAGER).not.toContain('createOwnerSessionExpiryGate')
    expect(EVENT_MOMENTS_MANAGER).not.toContain('owner-session-expiry')
  })

  it('15: event-cover-editor.jsx does not import createOwnerSessionExpiryGate', () => {
    expect(EVENT_COVER_EDITOR).not.toContain('createOwnerSessionExpiryGate')
    expect(EVENT_COVER_EDITOR).not.toContain('owner-session-expiry')
  })

  it('16: event-detail-panel.jsx and its Phase 5B workspace extractions do not import createOwnerSessionExpiryGate', () => {
    for (const source of NESTED_FILES) {
      expect(source).not.toContain('createOwnerSessionExpiryGate')
      expect(source).not.toContain('owner-session-expiry')
    }
  })

  it('17: none of the nested/workspace files call /api/owner/session', () => {
    for (const source of NESTED_FILES) {
      expect(source).not.toContain('/api/owner/session')
    }
  })

  it('18: none of the nested/workspace files introduce their own authState/login/redirect/sessionExpired message state', () => {
    for (const source of NESTED_FILES) {
      expect(source).not.toContain('authState')
      expect(source).not.toContain('router.push')
      expect(source).not.toContain('sessionExpired')
    }
  })
})

// ─── J. Guest/photographer components remain untouched ───────────────────────

describe('J. Guest/photographer-token components are unaffected', () => {
  it('19: room-page-client.jsx does not import or reference owner-session-expiry', () => {
    expect(ROOM_CLIENT).not.toContain('owner-session-expiry')
    expect(ROOM_CLIENT).not.toContain('onOwnerSessionFailure')
  })

  it('20: photographer-upload-page-client.jsx does not import or reference owner-session-expiry', () => {
    expect(PHOTOGRAPHER_CLIENT).not.toContain('owner-session-expiry')
    expect(PHOTOGRAPHER_CLIENT).not.toContain('onOwnerSessionFailure')
  })
})

// ─── K. EventDetailPanel count remains 1 ──────────────────────────────────────

describe('K. EventDetailPanel instance count unchanged by this STEP', () => {
  it('21: exactly one <EventDetailPanel call site in page.js', () => {
    const callSites = DASHBOARD_PAGE.match(/<EventDetailPanel/g) || []
    expect(callSites.length).toBe(1)
  })
})

// ─── Callback stability ────────────────────────────────────────────────────────

describe('Callback stability: consumeOwnerSessionFailure has a stable identity', () => {
  it('22: consumeOwnerSessionFailure is created via useCallback with correct dependencies', () => {
    const marker = 'const consumeOwnerSessionFailure = useCallback(async (status) => {'
    const startIdx = DASHBOARD_PAGE.indexOf(marker)
    expect(startIdx).toBeGreaterThan(-1)
    const window_ = DASHBOARD_PAGE.slice(startIdx, startIdx + 500)
    expect(window_).toContain('}, [checkOwnerSessionStillValid, handleOwnerSessionExpired])')
  })

  it('23: checkOwnerSessionStillValid and handleOwnerSessionExpired are themselves stable (useCallback)', () => {
    expect(DASHBOARD_PAGE).toContain('const checkOwnerSessionStillValid = useCallback(async () => {')
    expect(DASHBOARD_PAGE).toContain('const handleOwnerSessionExpired = useCallback(() => {')
  })

  it('24: useCallback is imported in page.js', () => {
    expect(DASHBOARD_PAGE).toMatch(/import \{[^}]*useCallback[^}]*\} from 'react'/)
  })
})
