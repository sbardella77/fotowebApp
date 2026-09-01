import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// This repo has no React rendering test harness (no @testing-library/react,
// no jsdom), so this is a source-contract test: it reads the component
// files as text and asserts on the specific ordering/wiring that fixes the
// confirmed bug — closeProfessionalUpgradeModal() ran before startCheckout
// ever set checkoutBusy=true, so the modal's own loading spinner/disabled
// state could never render. A full click-through confirmation (spinner
// visibly appears, modal stays mounted, Stripe opens) still requires human
// browser QA on Preview — this test only guards the source shape.

const ROOT = resolve(import.meta.dirname, '..')
const DASHBOARD_SOURCE = readFileSync(resolve(ROOT, 'app/dashboard/page.js'), 'utf8')
const MODAL_SOURCE = readFileSync(resolve(ROOT, 'app/dashboard/components/professional-upgrade-modal.jsx'), 'utf8')

function extractFunctionBody(source, functionName) {
  const start = source.indexOf(`const ${functionName} = `)
  expect(start, `${functionName} not found in source`).toBeGreaterThan(-1)
  // Grab a generous window; these are short handler functions.
  return source.slice(start, start + 800)
}

describe('Professional checkout modal no longer closes before loading state can render', () => {
  it('handleProfessionalUpgrade does not call closeProfessionalUpgradeModal before startCheckout', () => {
    const body = extractFunctionBody(DASHBOARD_SOURCE, 'handleProfessionalUpgrade')
    expect(body).not.toContain('closeProfessionalUpgradeModal()')
    expect(body).toContain("startCheckout('professional'")
  })

  it('closeProfessionalUpgradeModal still exists and remains wired to the modal for manual dismissal (Esc/outside click/X)', () => {
    expect(DASHBOARD_SOURCE).toContain('const closeProfessionalUpgradeModal = () => {')
    expect(DASHBOARD_SOURCE).toContain('onClose={closeProfessionalUpgradeModal}')
  })

  it('startCheckout still sets checkoutBusy synchronously and guards re-entrancy', () => {
    const body = extractFunctionBody(DASHBOARD_SOURCE, 'startCheckout')
    expect(body).toContain('if (checkoutBusy) return')
    expect(body).toContain('setCheckoutBusy(true)')
  })

  it('startCheckout still navigates away on success and resets busy state with a visible error on failure', () => {
    const start = DASHBOARD_SOURCE.indexOf('const startCheckout = async')
    const body = DASHBOARD_SOURCE.slice(start, start + 1400)
    expect(body).toContain('window.location.href = payload.url')
  })
  it('failure path resets checkoutBusy and surfaces the existing error message state', () => {
    const start = DASHBOARD_SOURCE.indexOf('const startCheckout = async')
    const body = DASHBOARD_SOURCE.slice(start, start + 1400)
    expect(body).toContain('setMessage(error.message || t.checkoutFailed)')
    expect(body).toContain('setCheckoutBusy(false)')
  })
})

describe("ProfessionalUpgradeModal's existing loading UI was reused, not redesigned", () => {
  it('both plan buttons still disable and show the Loader2 spinner while checkoutBusy is true', () => {
    expect(MODAL_SOURCE).toContain('disabled={checkoutBusy}')
    expect(MODAL_SOURCE).toContain('checkoutBusy ? (')
    expect(MODAL_SOURCE).toContain('<Loader2 className="h-4 w-4 animate-spin" />')
  })

  it('the modal still receives open/checkoutBusy as props (no new loading-state mechanism introduced)', () => {
    expect(MODAL_SOURCE).toContain('open,')
    expect(MODAL_SOURCE).toContain('checkoutBusy,')
  })
})
