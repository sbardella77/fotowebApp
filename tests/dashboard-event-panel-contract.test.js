import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dirname, '..')

function readSource(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8')
}

// ─── Sources ──────────────────────────────────────────────────────────────────

const DASHBOARD_PAGE = readSource('app/dashboard/page.js')
const DASHBOARD_SHELL = readSource('app/dashboard/components/dashboard-shell.jsx')
const TOP_BAR = readSource('app/dashboard/components/dashboard-top-bar.jsx')
const EVENT_CARD = readSource('app/dashboard/components/event-card.jsx')
const USE_MEDIA_QUERY = readSource('lib/hooks/use-media-query.js')

// ─── A. Exactly one EventDetailPanel call site ────────────────────────────────

describe('Dashboard page — single EventDetailPanel instance', () => {
  it('1: exactly one <EventDetailPanel call site remains', () => {
    const callSites = DASHBOARD_PAGE.match(/<EventDetailPanel/g) || []
    expect(callSites.length).toBe(1)
  })

  it('2: the mobile-only wrapper (xl:hidden second panel block) is gone', () => {
    expect(DASHBOARD_PAGE).not.toContain('Mobile / below-xl detail panel')
  })
})

// ─── B/C. DashboardShell — single mounted workspace instance (Phase 5C) ──────
//
// Phase 5A/5B rendered {rightPanel} in TWO places simultaneously (a CSS-hidden
// desktop column + the Sheet), which meant EventDetailPanel — and its nested
// EventMomentsManager fetch — could mount twice at once. Phase 5C replaces
// CSS-only hiding with a single `isDesktopWorkspace` boolean that gates which
// ONE of the two branches renders {rightPanel} at all, so exactly one branch
// is ever in the tree. See the architecture-decision comment above
// isDesktopWorkspace in dashboard-shell.jsx for why a CSS-only approach could
// not achieve this (Radix Dialog's `modal` behavior is a JS prop, not
// CSS-toggleable).

describe('DashboardShell — single mounted workspace instance', () => {
  it('3: the desktop branch is gated by isDesktopWorkspace, not just rightPanel truthiness', () => {
    expect(DASHBOARD_SHELL).toContain('{isDesktopWorkspace && rightPanel && (')
  })

  it('4: the Sheet branch is gated by the exact logical complement, !isDesktopWorkspace', () => {
    expect(DASHBOARD_SHELL).toContain('{!isDesktopWorkspace && (')
  })

  it('5: the old always-mounted CSS-hiding markers are gone (hidden xl:block, xl:hidden on SheetContent)', () => {
    expect(DASHBOARD_SHELL).not.toMatch(/className="hidden xl:block/)
    expect(DASHBOARD_SHELL).not.toMatch(/<SheetContent[\s\S]*?xl:hidden/)
  })

  it('6: desktop column styling no longer needs xl: prefixes (the branch itself is JS-gated to xl+)', () => {
    const idx = DASHBOARD_SHELL.indexOf('{isDesktopWorkspace && rightPanel && (')
    const closeIdx = DASHBOARD_SHELL.indexOf('\n              </div>\n            )}', idx)
    const block = DASHBOARD_SHELL.slice(idx, closeIdx)
    expect(block).toContain('w-[420px]')
    expect(block).toContain('shrink-0')
    expect(block).toContain('sticky')
    expect(block).toContain('top-16')
    expect(block).toContain('overflow-y-auto')
    // and NOT the old xl:-prefixed forms, proving this was simplified rather
    // than just additively patched
    expect(block).not.toMatch(/xl:w-\[420px\]|xl:shrink-0|xl:sticky|xl:top-16|xl:overflow-y-auto/)
  })

  it('7: rightPanel appears in source exactly twice — once per branch — never both branches active at once', () => {
    // A static source count of 2 is expected and correct here: one textual
    // occurrence per mutually-exclusive branch. Runtime exclusivity is what
    // tests 3/4 establish (complementary boolean conditions), not this count.
    const renderCount = (DASHBOARD_SHELL.match(/\{rightPanel\}/g) || []).length
    expect(renderCount).toBe(2)
  })
})

// ─── D. Justified, narrow viewport detection (Phase 5C architecture decision) ─
//
// Phase 5A forbade window.innerWidth/matchMedia/useMediaQuery here because a
// CSS-only approach was sufficient for panel *placement*. Phase 5C's P0 fix
// (exactly one mounted workspace instance) cannot be achieved CSS-only —
// see the architecture-decision comment in dashboard-shell.jsx. The rule is
// now: viewport detection is allowed, but ONLY via the single shared
// useMediaQuery hook, used exactly once, isolated to this one decision.

describe('DashboardShell — viewport detection is deliberate, narrow, and hook-based', () => {
  it('8: dashboard-shell.jsx uses the shared useMediaQuery hook, not raw window.innerWidth/matchMedia', () => {
    expect(DASHBOARD_SHELL).toContain("import { useMediaQuery } from '@/lib/hooks/use-media-query'")
    expect(DASHBOARD_SHELL).toContain("useMediaQuery('(min-width: 1280px)')")
    expect(DASHBOARD_SHELL).not.toMatch(/window\.innerWidth|window\.matchMedia/)
  })

  it('9: useMediaQuery is called exactly once in dashboard-shell.jsx (single source of truth)', () => {
    const callSites = DASHBOARD_SHELL.match(/useMediaQuery\(/g) || []
    expect(callSites.length).toBe(1)
  })

  it('10: page.js still has no viewport detection of its own — the decision stays centralized in the shell', () => {
    expect(DASHBOARD_PAGE).not.toMatch(/window\.innerWidth|matchMedia|useMediaQuery/)
  })

  it('11: no suppressHydrationWarning or dynamic ssr:false introduced', () => {
    expect(DASHBOARD_SHELL).not.toContain('suppressHydrationWarning')
    expect(DASHBOARD_SHELL).not.toMatch(/ssr:\s*false/)
  })

  it('12: the hook itself is SSR-safe — defaults to false and only touches window inside an effect', () => {
    expect(USE_MEDIA_QUERY).toContain("useState(false)")
    const useEffectIdx = USE_MEDIA_QUERY.indexOf('useEffect(')
    const windowIdx = USE_MEDIA_QUERY.indexOf('window.matchMedia')
    expect(useEffectIdx).toBeGreaterThan(-1)
    expect(windowIdx).toBeGreaterThan(useEffectIdx)
  })
})

// ─── E. Message fix (STEP 7.5b) remains untouched by this STEP ───────────────

describe('DashboardTopBar message — unaffected by the panel fix', () => {
  it('13: message container still does not hide below sm', () => {
    expect(TOP_BAR).not.toContain('hidden sm:flex')
  })

  it('14: page.js still has no redundant in-page dashboard message renderer', () => {
    const eventGridIdx = DASHBOARD_PAGE.indexOf('{/* Event Grid */}')
    expect(eventGridIdx).toBeGreaterThan(-1)
    const precedingWindow = DASHBOARD_PAGE.slice(Math.max(0, eventGridIdx - 400), eventGridIdx)
    expect(precedingWindow).not.toMatch(/\{message &&[\s\S]*shadow-subtle/)
  })
})

// ─── F. Mobile/tablet Manage Sheet contract (Phase 5A, revised for 5C) ────────

describe('DashboardShell — mobile/tablet Manage Sheet', () => {
  it('15: Sheet is fully controlled by props, not internal/viewport state', () => {
    expect(DASHBOARD_SHELL).toContain('<Sheet open={mobileWorkspaceOpen} onOpenChange={onMobileWorkspaceOpenChange}>')
  })

  it('16: Sheet is inert at xl+ via JS-conditional mounting (Phase 5C), not CSS-only hiding (Phase 5A)', () => {
    // Superseded: Phase 5A relied on `xl:hidden` to hide an always-mounted
    // Sheet at xl+. Phase 5C instead never mounts the Sheet branch at all at
    // xl+ (see the single-mounted-instance describe block above) — the whole
    // <Sheet> element is wrapped in `{!isDesktopWorkspace && (...)}`.
    const sheetIdx = DASHBOARD_SHELL.indexOf('<Sheet ')
    expect(sheetIdx).toBeGreaterThan(-1)
    const precedingWindow = DASHBOARD_SHELL.slice(Math.max(0, sheetIdx - 60), sheetIdx)
    expect(precedingWindow).toContain('{!isDesktopWorkspace && (')
  })

  it('17: rightPanel is rendered inside the Sheet branch', () => {
    const sheetIdx = DASHBOARD_SHELL.indexOf('<Sheet ')
    expect(sheetIdx).toBeGreaterThan(-1)
    expect(DASHBOARD_SHELL.slice(sheetIdx)).toContain('{rightPanel}')
  })

  it('18: the Sheet has an accessible title (Radix Dialog a11y requirement)', () => {
    expect(DASHBOARD_SHELL).toContain('<SheetTitle')
  })
})

describe('EventCard — explicit Manage action, no implicit whole-card click', () => {
  it('19: the card container has no onClick / no implicit selection semantics', () => {
    expect(EVENT_CARD).not.toMatch(/onClick=\{on(Select|Manage)/)
    expect(EVENT_CARD).not.toContain('cursor-pointer')
  })

  it('20: a desktop Manage control (xl+, no Sheet) and a mobile/tablet Manage control (opens Sheet) both exist', () => {
    expect(EVENT_CARD).toContain('onClick={() => onManage(event)}')
    // The mobile/tablet variant also forwards its own DOM node so the Sheet
    // can restore focus to it on close (see dashboard-shell.jsx's Sheet,
    // which has no shared Sheet.Root ancestor with this button to rely on
    // Radix's own Trigger-based focus restore).
    expect(EVENT_CARD).toContain('onClick={(e) => onManageMobile(event, e.currentTarget)}')
  })

  it('21: the two Manage controls are mutually exclusive via CSS breakpoints, not JS', () => {
    // This is a SEPARATE, still-valid CSS-only mechanism from the
    // DashboardShell single-instance fix above — EventCard's own two Manage
    // buttons stay CSS-toggled (no Radix modal behavior involved here), so
    // no viewport JS is needed or introduced for this specific mechanism.
    expect(EVENT_CARD).toMatch(/hidden w-full cta-primary xl:inline-flex/)
    // h-11 (Phase 5C touch-target fix) sits between flex and w-full here —
    // the mobile Manage button is intentionally taller than its desktop
    // sibling, since it's the highest-frequency touch target on the card.
    expect(EVENT_CARD).toMatch(/flex h-11 w-full cta-primary xl:hidden/)
    expect(EVENT_CARD).not.toMatch(/window\.innerWidth|matchMedia|useMediaQuery/)
  })

  it('22: overflow menu groups View event / QR / Rename / Delete via the existing DropdownMenu primitive', () => {
    expect(EVENT_CARD).toContain("from '@/components/ui/dropdown-menu'")
    expect(EVENT_CARD).toContain('{t.viewEvent}')
    expect(EVENT_CARD).toContain('onSelect={() => onQR(event)}')
    expect(EVENT_CARD).toContain('onSelect={() => onRenameStart(event)}')
    expect(EVENT_CARD).toContain('onSelect={() => onDelete(event)}')
  })

  it('23: Delete stays visually/destructively distinct inside the overflow menu', () => {
    expect(EVENT_CARD).toMatch(/text-destructive[\s\S]{0,80}onSelect=\{\(\) => onDelete\(event\)\}/)
  })

  it('24: no Archive action was invented', () => {
    expect(EVENT_CARD.toLowerCase()).not.toContain('archive')
  })
})

describe('Dashboard page — EVENT_ROOM_SELECTED_IN_DASHBOARD fires from one canonical handler', () => {
  it('25: exactly one trackEvent(EVENT_ROOM_SELECTED_IN_DASHBOARD call site in page.js', () => {
    const callSites = DASHBOARD_PAGE.match(/trackEvent\(EVENT_ROOM_SELECTED_IN_DASHBOARD/g) || []
    expect(callSites.length).toBe(1)
  })

  it('26: EventCard is wired with onManage/onManageMobile, not a legacy onSelect', () => {
    expect(DASHBOARD_PAGE).toContain('onManage={handleManageEvent}')
    expect(DASHBOARD_PAGE).toContain('onManageMobile={handleManageEventMobile}')
    const cardIdx = DASHBOARD_PAGE.indexOf('<EventCard')
    expect(cardIdx).toBeGreaterThan(-1)
    const cardPropsWindow = DASHBOARD_PAGE.slice(cardIdx, cardIdx + 800)
    expect(cardPropsWindow).not.toMatch(/\bonSelect=/)
  })
})
