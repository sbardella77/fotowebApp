import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Regression coverage for the "Manage subscription" client/server eligibility
// mismatch: page.js used to OR the server-computed canManageSubscription
// with a local heuristic (['professional','business','pro'].includes(plan)
// || subscriptionCanceledAt), which could show the button for an owner
// whose plan says 'professional' but who has no real Stripe customer/
// subscription (exactly the Preview account that surfaced this bug) — the
// server-side portal endpoint correctly rejects that state, but the client
// showed the CTA anyway. The fix removes the local fallback entirely so
// canManageSubscription (from GET /api/owner/plan, which already accounts
// for stripeSubscriptionId/subscriptionCanceledAt server-side) is the only
// input to CTA visibility.

const ROOT = resolve(import.meta.dirname, '..')
const readSource = (relPath) => readFileSync(resolve(ROOT, relPath), 'utf8')

const PAGE = readSource('app/dashboard/page.js')
const SIDEBAR = readSource('app/dashboard/components/dashboard-sidebar.jsx')

describe('Manage Subscription CTA visibility — single source of truth (P1 fix)', () => {
  it('6a. no local plan/tier fallback remains anywhere in page.js', () => {
    expect(PAGE).not.toMatch(/\['professional',\s*'business',\s*'pro'\]/)
    expect(PAGE).not.toMatch(/effectiveCanManageSubscription/)
  })

  it('canManageSubscription state is a direct boolean cast of the server payload, never OR-combined with plan/tier/legacy fields', () => {
    const assignment = PAGE.match(/setCanManageSubscription\(([^)]*)\)/)
    expect(assignment).not.toBeNull()
    expect(assignment[1].trim()).toBe('!!payload.canManageSubscription')
    // Guard against a future re-introduction of a client-side OR fallback.
    expect(PAGE).not.toMatch(/canManageSubscription\s*\|\|/)
  })

  it('1/2. the sidebar CTA prop is wired directly to canManageSubscription (true -> visible, false -> hidden), not a derived value', () => {
    expect(PAGE).toMatch(/canManageSubscription=\{canManageSubscription\}/)
  })

  it('the two billing-banner "manage subscription" CTAs (payment-failed and cancellation-scheduled) also gate on canManageSubscription directly', () => {
    const gateOccurrences = (PAGE.match(/\{canManageSubscription\s*&&\s*\(/g) || []).length
    // sidebar prop assignment (1) is a separate pattern; these two banner
    // CTAs are the `{canManageSubscription && (` conditional-render form.
    expect(gateOccurrences).toBe(2)
  })

  it('3. a professional-labelled plan with canManageSubscription=false renders no CTA (the exact Preview bug state)', () => {
    // Structural proof: since canManageSubscription is a plain boolean prop
    // with no OR-fallback (asserted above), and the sidebar's render gate is
    // exactly `canManageSubscription && (...)` (asserted below), a false
    // value hides the button regardless of what `plan` says — there is no
    // remaining code path that can override it based on plan.
    expect(SIDEBAR).toMatch(/\{canManageSubscription\s*&&\s*\(/)
    expect(SIDEBAR).not.toMatch(/canManageSubscription\s*\|\|/)
  })

  it('4/5. free plan / one-off purchasers (pro_event, wedding_pro, extra_event) never set canManageSubscription client-side independent of the server', () => {
    // These product states never touch Owner.plan or Owner.stripeSubscriptionId
    // (per the billing audit), so the server-computed canManageSubscription
    // stays false for them — and with the fallback removed, nothing in
    // page.js can turn that into a visible CTA.
    expect(PAGE).not.toMatch(/plan\s*===\s*['"]pro_event['"]/)
    expect(PAGE).not.toMatch(/plan\s*===\s*['"]wedding_pro['"]/)
    expect(PAGE).not.toMatch(/plan\s*===\s*['"]extra_event['"]/)
  })

  it('the sidebar button itself has no independent visibility logic beyond the canManageSubscription prop', () => {
    const buttonBlockStart = SIDEBAR.indexOf('{canManageSubscription && (')
    expect(buttonBlockStart).toBeGreaterThan(-1)
    const buttonBlockEnd = SIDEBAR.indexOf(')}', buttonBlockStart)
    const buttonBlock = SIDEBAR.slice(buttonBlockStart, buttonBlockEnd)
    expect(buttonBlock).not.toMatch(/\bplan\b/)
  })
})
