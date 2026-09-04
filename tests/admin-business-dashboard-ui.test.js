import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Source-level contract tests for the Admin Business Dashboard V1 UI,
// matching this repo's convention (see
// tests/manage-subscription-eligibility-gate.test.js) of asserting against
// the actual source rather than rendering components.

const ROOT = resolve(import.meta.dirname, '..')
const readSource = (relPath) => readFileSync(resolve(ROOT, relPath), 'utf8')

const DASHBOARD = readSource('app/admin/components/business-dashboard.jsx')
const ADMIN_PAGE = readSource('app/admin/page.js')

describe('Admin Business Dashboard V1 — page integration', () => {
  it('adds a Business tab alongside the existing Events tab, defaulting to Events', () => {
    expect(ADMIN_PAGE).toMatch(/<Tabs defaultValue="events"/)
    expect(ADMIN_PAGE).toMatch(/<TabsTrigger value="events"/)
    expect(ADMIN_PAGE).toMatch(/<TabsTrigger value="business"/)
    expect(ADMIN_PAGE).toMatch(/<BusinessDashboard\s*\/>/)
  })

  it('the existing Events tab content (create event, event list, event detail, photo moderation) is unchanged, not replaced', () => {
    expect(ADMIN_PAGE).toMatch(/Create event/)
    expect(ADMIN_PAGE).toMatch(/<AdminPhotoCard/)
    expect(ADMIN_PAGE).toMatch(/moderatePhoto\(photo\.id, 'approve'\)/)
  })

  it('unauthenticated admins see neither tab (no route/shell change, minimal complexity)', () => {
    expect(ADMIN_PAGE).toMatch(/authState\.authenticated \? \(/)
    expect(ADMIN_PAGE).toMatch(/Sign in to manage events and view business metrics/)
  })
})

describe('Admin Business Dashboard V1 — KPI cards', () => {
  it('Row 1 business-health KPI labels are present: Visitors, Signups, Core activated, Paid accounts', () => {
    expect(DASHBOARD).toMatch(/label="Visitors"/)
    expect(DASHBOARD).toMatch(/label="Signups"/)
    expect(DASHBOARD).toMatch(/label="Core activated"/)
    expect(DASHBOARD).toMatch(/label="Paid accounts"/)
  })

  it('Row 4 product-distribution labels are present: Events created, Rooms with share intent, Rooms reached', () => {
    expect(DASHBOARD).toMatch(/label="Events created"/)
    expect(DASHBOARD).toMatch(/label="Rooms with share intent"/)
    expect(DASHBOARD).toMatch(/label="Rooms reached"/)
  })

  it('Row 5 diagnostics labels (Share actions, Guest room views) are visually de-emphasized, not competing with Row 1', () => {
    expect(DASHBOARD).toMatch(/label="Share actions"/)
    expect(DASHBOARD).toMatch(/label="Guest room views"/)
    // Row 5's wrapper carries a reduced-opacity class and no `emphasis` size
    // bump on its cards — Row 1's cards do carry `emphasis`.
    const row5Start = DASHBOARD.indexOf('Row 5')
    const row5Block = DASHBOARD.slice(row5Start, row5Start + 600)
    expect(row5Block).toMatch(/opacity-90/)
    expect(row5Block).not.toMatch(/emphasis/)
  })

  it('every KPI card has a tooltip explaining its definition', () => {
    const cardCalls = DASHBOARD.match(/<KpiCard\s[\s\S]*?\/>/g) || []
    expect(cardCalls.length).toBeGreaterThan(0)
    for (const call of cardCalls) {
      expect(call).toMatch(/tooltip=/)
    }
  })

  it('Visitors and Paid Accounts tooltips use plain business language, not implementation jargon, per Phase 18 examples', () => {
    expect(DASHBOARD).toMatch(/Unique marketing visitors measured by PostHog\./)
    expect(DASHBOARD).toMatch(/Owners whose event received its first server-attributed guest photo\./)
    expect(DASHBOARD).toMatch(/Accounts currently classified as paid\/premium/)
  })

  it('zero-value KPIs are never hidden — no `value > 0 &&`-style guard exists around a KpiCard', () => {
    expect(DASHBOARD).not.toMatch(/value\s*>\s*0\s*&&[\s\S]{0,40}<KpiCard/)
    expect(DASHBOARD).not.toMatch(/current\s*>\s*0\s*&&[\s\S]{0,40}<KpiCard/)
  })

  it('KPI values are formatted with a null-safe formatter, never left to render raw null/undefined as text', () => {
    expect(DASHBOARD).toMatch(/const formatCount = \(value\) => \(value == null \? '—' : /)
  })
})

describe('Admin Business Dashboard V1 — range selector', () => {
  it('supports exactly 7d/30d/90d, defaulting to 30d, no custom date picker', () => {
    expect(DASHBOARD).toMatch(/value: '7d'/)
    expect(DASHBOARD).toMatch(/value: '30d'/)
    expect(DASHBOARD).toMatch(/value: '90d'/)
    expect(DASHBOARD).toMatch(/DEFAULT_RANGE = '30d'/)
    expect(DASHBOARD).not.toMatch(/DatePicker|Calendar\s*\(/)
  })

  it('one global range selector drives every metric via a single query param, not per-section pickers', () => {
    const fetchCalls = (DASHBOARD.match(/fetch\(`\/api\/admin\/metrics\/business/g) || []).length
    expect(fetchCalls).toBe(1)
  })
})

describe('Admin Business Dashboard V1 — funnel', () => {
  it('renders funnel stages generically (driven entirely by the API funnel.stages array, not a hardcoded stage list/count)', () => {
    expect(DASHBOARD).toMatch(/funnel\.stages\.map/)
    expect(DASHBOARD).toMatch(/stage\.conversionFromPrevious/)
    expect(DASHBOARD).toMatch(/stage\.count/)
    // No literal stage count (e.g. Array.from({length:5}) or similar) is
    // hardcoded for the funnel — it renders exactly whatever the API sends.
  })

  it('a null conversion rate renders as "—", never NaN/Infinity/undefined text', () => {
    expect(DASHBOARD).toMatch(/stage\.conversionFromPrevious == null \? '—'/)
  })

  it('explains the stage-funnel (not strict cohort) limitation via a tooltip', () => {
    expect(DASHBOARD).toMatch(/Stage funnel over the selected date window/)
    expect(DASHBOARD).toMatch(/not reliably linked to a specific signed-up/)
  })

  it('the funnel tooltip no longer references Paid as a period-scoped stage (the removed 400% source)', () => {
    expect(DASHBOARD).not.toMatch(/Paid reflects total accounts to date rather than this date range/)
    // The Funnel component's own copy (its InfoTooltip block) must not
    // mention "Paid" at all — the KPI card below is a separate concern and
    // is intentionally excluded from this check.
    const funnelBlockStart = DASHBOARD.indexOf('function Funnel(')
    const funnelBlockEnd = DASHBOARD.indexOf('\n}\n', funnelBlockStart)
    const funnelBlock = DASHBOARD.slice(funnelBlockStart, funnelBlockEnd)
    expect(funnelBlock.toLowerCase()).not.toContain('paid')
  })
})

describe('Admin Business Dashboard V1 — loading, error, and partial-failure states', () => {
  it('shows card skeletons on initial load, not a full-page blocking spinner', () => {
    expect(DASHBOARD).toMatch(/<KpiCardSkeleton/)
    expect(DASHBOARD).not.toMatch(/fixed inset-0[\s\S]{0,80}Loader2/)
  })

  it('has a distinct error state with a retry action', () => {
    expect(DASHBOARD).toMatch(/status === 'error'/)
    expect(DASHBOARD).toMatch(/Could not load business metrics/)
    expect(DASHBOARD).toMatch(/onClick=\{\(\) => load\(range\)\}/)
  })

  it('a PostHog-unavailable state shows a distinct banner and marks only PostHog-derived cards Unavailable, never zero', () => {
    expect(DASHBOARD).toMatch(/postHogUnavailable/)
    expect(DASHBOARD).toMatch(/Traffic analytics temporarily unavailable/)
    expect(DASHBOARD).toMatch(/unavailable=\{postHogUnavailable\}/)
    expect(DASHBOARD).toMatch(/Unavailable<\/span>/)
  })

  it('Postgres-only KPI cards (Signups, Core activated, Events created) never carry `unavailable=` — a PostHog outage cannot blank them', () => {
    const signupsCard = DASHBOARD.slice(DASHBOARD.indexOf('label="Signups"') - 50, DASHBOARD.indexOf('label="Signups"') + 250)
    expect(signupsCard).not.toMatch(/unavailable=/)
    const coreCard = DASHBOARD.slice(DASHBOARD.indexOf('label="Core activated"') - 50, DASHBOARD.indexOf('label="Core activated"') + 350)
    expect(coreCard).not.toMatch(/unavailable=/)
  })
})

describe('Admin Business Dashboard V1 — stale-range race protection', () => {
  it('uses AbortController to cancel an in-flight request when the range changes', () => {
    expect(DASHBOARD).toMatch(/new AbortController\(\)/)
    expect(DASHBOARD).toMatch(/signal: controller\.signal/)
    expect(DASHBOARD).toMatch(/abortRef\.current\.abort\(\)/)
  })

  it('an aborted/stale response is never applied to state', () => {
    expect(DASHBOARD).toMatch(/if \(controller\.signal\.aborted\) return/)
    expect(DASHBOARD).toMatch(/error\.name === 'AbortError'/)
  })
})

describe('Admin Business Dashboard V1 — mobile safety', () => {
  it('KPI card grids use responsive column classes, not a fixed pixel width', () => {
    expect(DASHBOARD).toMatch(/grid-cols-2/)
    // max-w-[...] (e.g. a tooltip bubble cap) never forces overflow; only a
    // bare, non-"max-" w-[NNNpx] would.
    expect(DASHBOARD).not.toMatch(/(?<!max-)w-\[\d{3,}px\]/)
  })

  it('the funnel stacks vertically on small screens (flex-col by default, row from sm:)', () => {
    expect(DASHBOARD).toMatch(/flex-col[^"]*sm:flex-row/)
  })

  it('the trend chart is wrapped in a responsive container, not a fixed-width canvas', () => {
    expect(DASHBOARD).toMatch(/<ResponsiveContainer width="100%"/)
  })

  it('the range selector uses compact touch targets that fit at 320px (no wide fixed-width buttons)', () => {
    expect(DASHBOARD).not.toMatch(/range selector[\s\S]{0,120}w-\[\d{3,}px\]/i)
  })
})

describe('Admin Business Dashboard V1 — privacy', () => {
  it('never references PII-shaped fields anywhere in the component', () => {
    const lower = DASHBOARD.toLowerCase()
    expect(lower).not.toContain('email')
    expect(lower).not.toContain('distinct_id')
    expect(lower).not.toContain('stripecustomerid')
    expect(lower).not.toContain('ownerid')
    expect(lower).not.toContain('sessionid')
  })
})

describe('Admin Business Dashboard V1 — chart series discipline', () => {
  it('the trend chart plots at most two series, not an overloaded multi-series chart', () => {
    const lineCount = (DASHBOARD.match(/<Line\b/g) || []).length
    expect(lineCount).toBeLessThanOrEqual(2)
  })
})
