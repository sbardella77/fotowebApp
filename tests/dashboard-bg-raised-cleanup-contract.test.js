import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join } from 'path'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dirname, '..')
const DASHBOARD_DIR = resolve(ROOT, 'app/dashboard')

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) out.push(...walk(full))
    else if (/\.(jsx?|js)$/.test(entry)) out.push(full)
  }
  return out
}

const DASHBOARD_FILES = walk(DASHBOARD_DIR)

// ─── A. bg-raised (the unregistered, no-op Tailwind class) is fully gone ──────
//
// bg-raised was never registered in tailwind.config.js's colors, so it
// silently rendered no CSS at all everywhere it was used. Phase 5C replaced
// every dashboard-scoped occurrence with bg-secondary, which resolves to the
// exact same underlying color the original author intended (--secondary and
// the removed bg-raised both alias the same --bg-raised CSS custom property
// in app/globals.css) — a like-for-like fix, not a visual change.

describe('Dashboard — bg-raised fully removed from dashboard scope (Phase 5C)', () => {
  it('1: no app/dashboard/**/*.{js,jsx} file contains the literal string "bg-raised"', () => {
    const offenders = []
    for (const file of DASHBOARD_FILES) {
      const source = readFileSync(file, 'utf8')
      if (source.includes('bg-raised')) offenders.push(file.replace(ROOT + '/', ''))
    }
    expect(offenders).toEqual([])
  })

  it('2: bg-secondary is present in the files that used to reference bg-raised (sanity — the replacement actually landed, not just deleted)', () => {
    const sampleFiles = [
      'app/dashboard/components/event-workspace-overview.jsx',
      'app/dashboard/components/event-workspace-settings.jsx',
      'app/dashboard/components/dashboard-sidebar.jsx',
      'app/dashboard/components/event-card.jsx',
      'app/dashboard/components/event-detail-panel.jsx',
    ]
    for (const rel of sampleFiles) {
      const source = readFileSync(resolve(ROOT, rel), 'utf8')
      expect(source).toContain('bg-secondary')
    }
  })
})
