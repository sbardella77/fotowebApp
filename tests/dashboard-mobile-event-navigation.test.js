import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { dictionaries } from '@/lib/i18n/dictionaries'
import { LOCALES } from '@/lib/i18n/config'

// P0 fix: below the `xl` breakpoint, EventDetailPanel renders inside a
// Sheet whose only exit used to be the default Radix close (X) icon,
// unlabeled and rendered on top of the event cover photo, with no way to
// reach logout at all (the owner sidebar containing it isn't mounted below
// `xl`). This file locks in the fix: an explicit, always-visible "All
// events" control plus a reachable logout, scoped to the mobile Sheet only.

const ROOT = resolve(import.meta.dirname, '..')
const readSource = (relPath) => readFileSync(resolve(ROOT, relPath), 'utf8')

const SHELL = readSource('app/dashboard/components/dashboard-shell.jsx')
const PAGE = readSource('app/dashboard/page.js')
const EVENT_DETAIL_PANEL = readSource('app/dashboard/components/event-detail-panel.jsx')

function extractMobileSheetBlock(source) {
  const marker = '{!isDesktopWorkspace && ('
  const start = source.indexOf(marker)
  expect(start, 'expected the mobile-only Sheet block to exist in dashboard-shell.jsx').toBeGreaterThan(-1)
  // The block is closed by the file's final `)}\n    </div>` — slice to end
  // of file, which is safe since nothing meaningful follows it in this file.
  return source.slice(start)
}

function extractDesktopColumnBlock(source) {
  const marker = 'isDesktopWorkspace && rightPanel && ('
  const start = source.indexOf(marker)
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf('</main>', start)
  return source.slice(start, end)
}

const MOBILE_SHEET_BLOCK = extractMobileSheetBlock(SHELL)
const DESKTOP_COLUMN_BLOCK = extractDesktopColumnBlock(SHELL)

describe('mobile single-event workspace exposes explicit "all events" navigation (P0 fix)', () => {
  it('1. the mobile Sheet renders a control wired to onBackToEvents, labelled with t.allEvents', () => {
    expect(MOBILE_SHEET_BLOCK).toMatch(/onClick=\{onBackToEvents\}/)
    expect(MOBILE_SHEET_BLOCK).toContain('{t.allEvents}')
  })

  it('6. the back control is not hidden/sr-only — it renders real, visible text, not just an icon or a screen-reader label', () => {
    // Slice just the back-button element so we don't accidentally match
    // unrelated `hidden`/`sr-only` classes elsewhere in the Sheet block.
    const buttonStart = MOBILE_SHEET_BLOCK.indexOf('onClick={onBackToEvents}')
    const buttonBlock = MOBILE_SHEET_BLOCK.slice(Math.max(0, buttonStart - 200), buttonStart + 300)
    // Check the Tailwind `hidden` utility class specifically (not the
    // unrelated `aria-hidden="true"` on the decorative chevron icon, which
    // is correct — the icon is decorative, the text label is what matters).
    expect(buttonBlock).not.toMatch(/className="[^"]*\bhidden\b[^"]*"/)
    expect(buttonBlock).not.toContain('sr-only')
    expect(buttonBlock).not.toMatch(/opacity-0\b/)
  })

  it('2. onBackToEvents (defined in page.js) navigates via an explicit router target, not browser history alone', () => {
    expect(PAGE).toMatch(/onBackToEvents=\{\(\)\s*=>\s*\{[\s\S]{0,120}router\.push\('\/dashboard'\)/)
    expect(PAGE).not.toMatch(/onBackToEvents=\{\(\)\s*=>\s*(window\.)?history\.back\(\)\}/)
  })

  it("2b. 'All events' has a real translation in every supported locale (dashboard namespace)", () => {
    for (const locale of LOCALES) {
      expect(typeof dictionaries[locale].dashboard.allEvents).toBe('string')
      expect(dictionaries[locale].dashboard.allEvents.length).toBeGreaterThan(0)
    }
    expect(dictionaries.it.dashboard.allEvents).toBe('Tutti gli eventi')
    expect(dictionaries.de.dashboard.allEvents).toBe('Alle Events')
    expect(dictionaries.en.dashboard.allEvents).toBe('All events')
    expect(dictionaries.es.dashboard.allEvents).toBe('Todos los eventos')
    expect(dictionaries.fr.dashboard.allEvents).toBe('Tous les événements')
  })

  it('3. logout remains reachable from the mobile workspace via the existing onLogout handler, not a new mechanism', () => {
    expect(MOBILE_SHEET_BLOCK).toMatch(/onClick=\{onLogout\}/)
    expect(MOBILE_SHEET_BLOCK).toContain('aria-label={t.signOut}')
    // page.js must wire the shell's onLogout to the same logout() already
    // used by the sidebar — no parallel logout mechanism was invented.
    expect(PAGE).toMatch(/onLogout=\{logout\}[\s\S]{0,400}sidebar=\{/)
  })

  it('4. event tabs are unaffected — all four workspace tabs remain present', () => {
    expect(EVENT_DETAIL_PANEL).toContain('{t.workspaceOverview}')
    expect(EVENT_DETAIL_PANEL).toContain('{t.workspacePhotos}')
    expect(EVENT_DETAIL_PANEL).toContain('{t.workspaceDelivery}')
    expect(EVENT_DETAIL_PANEL).toContain('{t.workspaceSettings}')
    // Horizontal scroll stays available as the overflow strategy for long
    // localized tab labels, rather than hiding/compressing them.
    expect(EVENT_DETAIL_PANEL).toContain('overflow-x-auto')
  })

  it('5. desktop (xl+, persistent right column) is untouched — no back/logout control was added there', () => {
    expect(DESKTOP_COLUMN_BLOCK).not.toMatch(/onBackToEvents/)
    expect(DESKTOP_COLUMN_BLOCK).not.toMatch(/onLogout/)
  })

  it('the new header sits above the workspace content, with its own solid background (not overlaid on the event cover photo)', () => {
    const headerIdx = MOBILE_SHEET_BLOCK.indexOf('onClick={onBackToEvents}')
    const rightPanelIdx = MOBILE_SHEET_BLOCK.indexOf('{rightPanel}')
    expect(headerIdx).toBeGreaterThan(-1)
    expect(rightPanelIdx).toBeGreaterThan(headerIdx)
    const headerContainerStart = MOBILE_SHEET_BLOCK.lastIndexOf('<div', headerIdx)
    const headerContainer = MOBILE_SHEET_BLOCK.slice(headerContainerStart, headerIdx)
    expect(headerContainer).toContain('bg-background')
  })

  it('DashboardShell accepts t/onBackToEvents/onLogout as props', () => {
    expect(SHELL).toMatch(/onBackToEvents,\s*\n\s*onLogout,\s*\n\s*t,/)
  })
})
