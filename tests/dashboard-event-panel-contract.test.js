import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dirname, '..')

function readSource(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8')
}

/**
 * Extracts the rightPanel block of DashboardShell:
 * from `{rightPanel && (` up to the matching closing `)}`.
 */
function extractRightPanelBlock(source) {
  const marker = '{rightPanel && ('
  const startIdx = source.indexOf(marker)
  if (startIdx === -1) return ''
  const endMarker = '\n            )}'
  const endIdx = source.indexOf(endMarker, startIdx)
  return endIdx === -1 ? source.slice(startIdx) : source.slice(startIdx, endIdx + endMarker.length)
}

// ─── Sources ──────────────────────────────────────────────────────────────────

const DASHBOARD_PAGE = readSource('app/dashboard/page.js')
const DASHBOARD_SHELL = readSource('app/dashboard/components/dashboard-shell.jsx')
const TOP_BAR = readSource('app/dashboard/components/dashboard-top-bar.jsx')

const RIGHT_PANEL_BLOCK = extractRightPanelBlock(DASHBOARD_SHELL)

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

// ─── B/C. DashboardShell responsive placement is CSS-only ────────────────────

describe('DashboardShell — responsive rightPanel placement', () => {
  it('3: rightPanel block exists', () => {
    expect(RIGHT_PANEL_BLOCK).not.toBe('')
  })

  it('4: rightPanel is no longer unconditionally hidden below xl', () => {
    // The old implementation gated the *entire* panel behind `hidden xl:block`,
    // which meant it never mounted below the xl breakpoint. That exact
    // combination must not remain on the panel wrapper.
    expect(RIGHT_PANEL_BLOCK).not.toMatch(/className="hidden xl:block/)
  })

  it('5: desktop-specific styling (sticky column, fixed width) is scoped to xl:', () => {
    expect(RIGHT_PANEL_BLOCK).toContain('xl:w-[420px]')
    expect(RIGHT_PANEL_BLOCK).toContain('xl:sticky')
    expect(RIGHT_PANEL_BLOCK).toContain('xl:top-16')
    expect(RIGHT_PANEL_BLOCK).toContain('xl:overflow-y-auto')
  })

  it('6: mobile card styling collapses away at xl (single component, responsive wrapper)', () => {
    expect(RIGHT_PANEL_BLOCK).toContain('bg-surface border border-border rounded-xl shadow-subtle')
    expect(RIGHT_PANEL_BLOCK).toContain('xl:border-0')
    expect(RIGHT_PANEL_BLOCK).toContain('xl:shadow-none')
  })

  it('7: rightPanel is rendered exactly once inside the block', () => {
    const renderCount = (RIGHT_PANEL_BLOCK.match(/\{rightPanel\}/g) || []).length
    expect(renderCount).toBe(1)
  })
})

// ─── D. No JS viewport detection anywhere in the new responsive path ─────────

describe('DashboardShell / dashboard page — no JS viewport logic', () => {
  it('8: no window.innerWidth, matchMedia, or useMediaQuery in dashboard-shell.jsx', () => {
    expect(DASHBOARD_SHELL).not.toMatch(/window\.innerWidth|matchMedia|useMediaQuery/)
  })

  it('9: no window.innerWidth, matchMedia, or useMediaQuery in page.js', () => {
    expect(DASHBOARD_PAGE).not.toMatch(/window\.innerWidth|matchMedia|useMediaQuery/)
  })

  it('10: no suppressHydrationWarning or dynamic ssr:false introduced', () => {
    expect(DASHBOARD_SHELL).not.toContain('suppressHydrationWarning')
    expect(DASHBOARD_SHELL).not.toMatch(/ssr:\s*false/)
  })
})

// ─── E. Message fix (STEP 7.5b) remains untouched by this STEP ───────────────

describe('DashboardTopBar message — unaffected by the panel fix', () => {
  it('11: message container still does not hide below sm', () => {
    expect(TOP_BAR).not.toContain('hidden sm:flex')
  })

  it('12: page.js still has no redundant in-page dashboard message renderer', () => {
    const eventGridIdx = DASHBOARD_PAGE.indexOf('{/* Event Grid */}')
    expect(eventGridIdx).toBeGreaterThan(-1)
    const precedingWindow = DASHBOARD_PAGE.slice(Math.max(0, eventGridIdx - 400), eventGridIdx)
    expect(precedingWindow).not.toMatch(/\{message &&[\s\S]*shadow-subtle/)
  })
})
