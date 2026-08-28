import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dirname, '..')

function readSource(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8')
}

// ─── Sources ──────────────────────────────────────────────────────────────────

const PANEL = readSource('app/dashboard/components/event-detail-panel.jsx')
const OVERVIEW = readSource('app/dashboard/components/event-workspace-overview.jsx')
const PHOTOS = readSource('app/dashboard/components/event-workspace-photos.jsx')
const DELIVERY = readSource('app/dashboard/components/event-workspace-delivery.jsx')
const SETTINGS = readSource('app/dashboard/components/event-workspace-settings.jsx')

// ─── A. Four workspace tabs exist, i18n-driven ────────────────────────────────

describe('EventDetailPanel — four workspace tabs', () => {
  it('1: exactly four TabsTrigger values: overview, photos, delivery, settings', () => {
    const values = [...PANEL.matchAll(/<TabsTrigger value="(\w+)"/g)].map((m) => m[1])
    expect(values).toEqual(['overview', 'photos', 'delivery', 'settings'])
  })

  it('2: each tab label comes from the dashboard dictionary, not a hardcoded string', () => {
    expect(PANEL).toContain('{t.workspaceOverview}')
    expect(PANEL).toContain('{t.workspacePhotos}')
    expect(PANEL).toContain('{t.workspaceDelivery}')
    expect(PANEL).toContain('{t.workspaceSettings}')
  })

  it('3: exactly four TabsContent panels, one per tab value', () => {
    const values = [...PANEL.matchAll(/<TabsContent value="(\w+)"/g)].map((m) => m[1])
    expect(values).toEqual(['overview', 'photos', 'delivery', 'settings'])
  })
})

// ─── B. Mounting safety: forceMount + CSS-hidden, not conditional unmount ────

describe('EventDetailPanel — inactive tabs stay mounted but truly hidden', () => {
  it('4: every TabsContent uses forceMount (no child unmounts on tab switch)', () => {
    const contentBlocks = PANEL.match(/<TabsContent[^>]*>/g) || []
    expect(contentBlocks.length).toBe(4)
    for (const block of contentBlocks) {
      expect(block).toContain('forceMount')
    }
  })

  it('5: inactive panels are hidden via data-[state=inactive]:hidden (removed from a11y tree and tab order, not just visually transparent)', () => {
    expect(PANEL).toContain('data-[state=inactive]:hidden')
    // Applied as the shared TAB_CONTENT_CLASS constant, not ad hoc per panel.
    const usages = (PANEL.match(/data-\[state=inactive\]:hidden/g) || []).length
    expect(usages).toBeGreaterThan(0)
  })
})

// ─── C. Event switching resets to Overview ────────────────────────────────────

describe('EventDetailPanel — switching to a different event resets the active tab', () => {
  it('6: activeTab defaults to overview', () => {
    expect(PANEL).toContain("useState('overview')")
  })

  it('7: a slug-keyed effect resets activeTab to overview (mirrors the EventMomentsManager reset idiom, not a remount-via-key)', () => {
    const idx = PANEL.indexOf("setActiveTab('overview')")
    expect(idx).toBeGreaterThan(-1)
    // Must be inside a useEffect keyed on the event's slug specifically —
    // NOT on the whole event object (which would also fire on every
    // same-event refetch, e.g. after a moderation action or rename).
    const window_ = PANEL.slice(Math.max(0, idx - 200), idx + 100)
    expect(window_).toContain('useEffect')
    expect(window_).toContain('[normalizedEvent?.slug]')
  })

  it('8: hooks run before the early `if (!normalizedEvent) return null` (rules-of-hooks safety)', () => {
    const useStateIdx = PANEL.indexOf("useState('overview')")
    const earlyReturnIdx = PANEL.indexOf('if (!normalizedEvent) return null')
    expect(useStateIdx).toBeGreaterThan(-1)
    expect(earlyReturnIdx).toBeGreaterThan(-1)
    expect(useStateIdx).toBeLessThan(earlyReturnIdx)
  })

  it('9: no key={event.slug} remount trick was used instead (would blow away EventMomentsManager/EventCoverEditor mounted state on every switch)', () => {
    expect(PANEL).not.toMatch(/key=\{(normalizedEvent|event)\??\.slug\}/)
  })
})

// ─── D. Content grouping matches the target IA ────────────────────────────────

describe('Content grouping — Overview', () => {
  it('10: Overview contains stats, quick actions (View event / Share / QR), and cover management', () => {
    expect(OVERVIEW).toContain('{t.viewEvent}')
    expect(OVERVIEW).toContain('onShare(event)')
    expect(OVERVIEW).toContain('onQR(event)')
    expect(OVERVIEW).toContain('<EventCoverEditor')
    expect(OVERVIEW).toContain('<EventCoverRemove')
  })

  it('11: Overview does NOT contain Download all, Moments, moderation, upgrades, or Delete (those live in other tabs)', () => {
    expect(OVERVIEW).not.toContain('onGalleryDownload')
    expect(OVERVIEW).not.toContain('EventMomentsManager')
    expect(OVERVIEW).not.toContain('DashboardPhotoCard')
    expect(OVERVIEW).not.toContain('UpsellRow')
    expect(OVERVIEW).not.toContain('onDelete')
  })
})

describe('Content grouping — Photos', () => {
  it('12: Photos contains both Moments and the moderation grid', () => {
    expect(PHOTOS).toContain('<EventMomentsManager')
    expect(PHOTOS).toContain('<DashboardPhotoCard')
  })

  it('13: moderation is the primary block (appears before Moments in source order), not dominated by Moments', () => {
    const moderationIdx = PHOTOS.indexOf('roomPhotos')
    const momentsIdx = PHOTOS.indexOf('<EventMomentsManager')
    expect(moderationIdx).toBeGreaterThan(-1)
    expect(momentsIdx).toBeGreaterThan(-1)
    expect(moderationIdx).toBeLessThan(momentsIdx)
  })

  it('14: Photos does not duplicate cover, delivery, or settings content', () => {
    expect(PHOTOS).not.toContain('EventCoverEditor')
    expect(PHOTOS).not.toContain('privateAssets')
    expect(PHOTOS).not.toContain('UpsellRow')
  })
})

describe('Content grouping — Delivery', () => {
  it('15: Delivery contains Download all, Private Delivery, and the photographer link block', () => {
    expect(DELIVERY).toContain('onGalleryDownload')
    expect(DELIVERY).toContain('hasPrivateDelivery')
    expect(DELIVERY).toContain('onGeneratePhotoLink')
    expect(DELIVERY).toContain('onRevokePhotoLink')
  })

  it('16: Private Delivery gating is preserved exactly (still conditional, not always rendered)', () => {
    expect(DELIVERY).toContain('{hasPrivateDelivery && (')
  })

  it('17: Delivery does not duplicate Overview/Photos/Settings content', () => {
    expect(DELIVERY).not.toContain('EventCoverEditor')
    expect(DELIVERY).not.toContain('EventMomentsManager')
    expect(DELIVERY).not.toContain('DashboardPhotoCard')
    expect(DELIVERY).not.toContain('UpsellRow')
  })
})

describe('Content grouping — Settings', () => {
  it('18: Settings contains event upgrades, plan info, storage duration, and Delete', () => {
    expect(SETTINGS).toContain('eventUpgradeTitle')
    expect(SETTINGS).toContain('planInfo')
    expect(SETTINGS).toContain('storageDuration')
    expect(SETTINGS).toContain('onDelete(event)')
  })

  it('19: Delete sits in a clearly separated "danger zone", not a generic card equal to the others', () => {
    const dangerIdx = SETTINGS.indexOf('dangerZone')
    const deleteIdx = SETTINGS.indexOf('onDelete(event)')
    expect(dangerIdx).toBeGreaterThan(-1)
    expect(dangerIdx).toBeLessThan(deleteIdx)
    expect(SETTINGS).toContain('text-destructive')
  })

  it('20: no Archive action was invented', () => {
    expect(SETTINGS.toLowerCase()).not.toContain('archive')
  })

  it('21: Settings does not duplicate Overview/Photos/Delivery content', () => {
    expect(SETTINGS).not.toContain('EventCoverEditor')
    expect(SETTINGS).not.toContain('EventMomentsManager')
    expect(SETTINGS).not.toContain('DashboardPhotoCard')
    expect(SETTINGS).not.toContain('onGalleryDownload')
  })
})

// ─── E. Analytics preservation ────────────────────────────────────────────────

describe('Analytics — no new taxonomy, no relocated trackEvent calls', () => {
  it('22: none of the four workspace files call trackEvent directly (all tracked actions still fire from page.js callback props, unchanged)', () => {
    for (const source of [OVERVIEW, PHOTOS, DELIVERY, SETTINGS, PANEL]) {
      expect(source).not.toMatch(/\btrackEvent\(/)
    }
  })

  it('23: EventDetailPanel itself introduces no new analytics import', () => {
    expect(PANEL).not.toContain("from '@/lib/analytics")
  })
})

// ─── F. No JS viewport detection (extends the Phase 5A rule to the new files) ─

describe('No JS viewport detection introduced by the workspace refactor', () => {
  it('24: none of the five new/changed files use window.innerWidth, matchMedia, or useMediaQuery', () => {
    for (const source of [PANEL, OVERVIEW, PHOTOS, DELIVERY, SETTINGS]) {
      expect(source).not.toMatch(/window\.innerWidth|matchMedia|useMediaQuery/)
    }
  })
})
