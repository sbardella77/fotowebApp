import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dirname, '..')

function readSource(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8')
}

/**
 * Extracts the message-container block from DashboardTopBar:
 * from `{message && (` up to the closing `)}` that ends that JSX block.
 */
function extractTopBarMessageBlock(source) {
  const marker = '{message && ('
  const startIdx = source.indexOf(marker)
  if (startIdx === -1) return ''
  const endMarker = '\n      )}'
  const endIdx = source.indexOf(endMarker, startIdx)
  return endIdx === -1 ? source.slice(startIdx) : source.slice(startIdx, endIdx + endMarker.length)
}

// ─── Sources ──────────────────────────────────────────────────────────────────

const TOP_BAR = readSource('app/dashboard/components/dashboard-top-bar.jsx')
const DASHBOARD_PAGE = readSource('app/dashboard/page.js')
const DASHBOARD_SHELL = readSource('app/dashboard/components/dashboard-shell.jsx')

const TOP_BAR_MESSAGE_BLOCK = extractTopBarMessageBlock(TOP_BAR)

// ─── A. DashboardTopBar message renderer is visible on every viewport ────────

describe('DashboardTopBar message renderer — mobile visibility', () => {
  it('1: message block exists', () => {
    expect(TOP_BAR_MESSAGE_BLOCK).not.toBe('')
  })

  it('2: message container no longer hides below the sm breakpoint', () => {
    expect(TOP_BAR_MESSAGE_BLOCK).not.toContain('hidden sm:flex')
  })

  it('3: message container still renders as a flex row (styling preserved)', () => {
    expect(TOP_BAR_MESSAGE_BLOCK).toMatch(/className="flex min-w-0 items-center gap-2/)
  })

  it("3b: min-w-0 is present on the container (Phase 5C 320px-overflow fix — without it, truncate never gets a chance to constrain the message's width)", () => {
    expect(TOP_BAR_MESSAGE_BLOCK).toContain('min-w-0')
  })

  it('4: message content and dismiss callback are unchanged', () => {
    expect(TOP_BAR_MESSAGE_BLOCK).toContain('{message}')
    expect(TOP_BAR_MESSAGE_BLOCK).toContain('onDismissMessage')
  })

  it('4b: the DashboardShell wrapper around {topBar} also carries min-w-0 (Phase 5C — the full flex-item chain needs it, not just the innermost container, or truncate still never engages)', () => {
    expect(DASHBOARD_SHELL).toContain('<div className="min-w-0 flex-1">{topBar}</div>')
  })
})

// ─── B. Redundant authenticated-dashboard in-page renderer removed ───────────

describe('Dashboard page — duplicate message renderer removed', () => {
  it('5: page.js no longer renders a standalone dashboard-content message block', () => {
    // The removed block rendered a bare `{message}` inside a
    // `rounded-xl border border-border bg-surface p-4 ... shadow-subtle`
    // card directly ahead of the "Event Grid" comment. That exact marker
    // pairing must no longer be present.
    const eventGridIdx = DASHBOARD_PAGE.indexOf('{/* Event Grid */}')
    expect(eventGridIdx).toBeGreaterThan(-1)
    const precedingWindow = DASHBOARD_PAGE.slice(Math.max(0, eventGridIdx - 400), eventGridIdx)
    expect(precedingWindow).not.toMatch(/\{message &&[\s\S]*shadow-subtle/)
  })

  it('6: message is still passed into DashboardTopBar as the single source of truth', () => {
    expect(DASHBOARD_PAGE).toContain('message={message}')
  })
})

// ─── C. Login / forgot-password inline message renderers untouched ───────────

describe('Dashboard page — auth-form inline message renderers preserved', () => {
  it('7: exactly two inline destructive-text message renderers remain (login + forgot-password)', () => {
    const inlineRenderers = DASHBOARD_PAGE.match(/\{message && <p className="text-sm text-destructive">\{message\}<\/p>\}/g) || []
    expect(inlineRenderers.length).toBe(2)
  })
})
