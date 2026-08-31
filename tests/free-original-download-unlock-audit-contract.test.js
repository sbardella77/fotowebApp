import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve(import.meta.dirname, '..')

function readComponent(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8')
}

// FRONTEND V4 — Free Event Original Quality €1.99 audit.
//
// Root-cause finding: this is NOT an unimplemented/no-op CTA. The full chain
// exists and is genuinely wired end-to-end — UI click handler -> real Stripe
// Checkout Session creation route -> webhook completion -> transactional
// entitlement write (Event.originalDownloadUnlocked). It fails in Production
// specifically because STRIPE_PRICE_ID_HIGH_QUALITY_DOWNLOAD does not exist
// in the Production environment (confirmed live via `vercel env ls
// production` — every sibling Stripe price id exists except this one).
//
// Per the task's own decision framework this is CASE C ("existing flow
// connected but broken"), not CASE A ("unimplemented") — so the CTA must NOT
// be hidden, and the env var must NOT be set by this fix (env changes are
// explicitly out of scope). This file exists only to (a) document the root
// cause in a way CI can catch if it regresses further, and (b) prove this
// task did not silently touch any of this code while investigating it.
describe('Free original-quality unlock — chain is complete, root cause is a missing Production env var', () => {
  it('the lightbox still shows the €1.99 unlock CTA for a guest on a locked Free event (unchanged — not hidden)', () => {
    const source = readComponent('components/photo-lightbox.jsx')
    expect(source).toContain('t.unlockForEveryone')
    expect(source).toContain('t.unlockOriginalForEvent')
    expect(source).toContain('t.unlockOriginalCta')
  })

  it('the unlock click handler still calls the real checkout API (not a stub/no-op)', () => {
    const source = readComponent('components/photo-lightbox.jsx')
    expect(source).toContain("csrfFetch('/api/stripe/unlock-download'")
    expect(source).toMatch(/window\.location\.href = payload\.url/)
  })

  it('the checkout route requires STRIPE_PRICE_ID_HIGH_QUALITY_DOWNLOAD — the confirmed-missing Production env var', () => {
    const source = readComponent('app/api/stripe/unlock-download/route.js')
    expect(source).toContain('process.env.STRIPE_PRICE_ID_HIGH_QUALITY_DOWNLOAD')
    // A missing price id fails loudly server-side (500 + logged error) —
    // it does not silently succeed with a fake session.
    expect(source).toContain("Stripe price not configured for download unlock")
  })

  it('the webhook still completes the entitlement transactionally on payment success (unchanged)', () => {
    const source = readComponent('app/api/stripe/webhook/route.js')
    expect(source).toContain("intent === 'high_quality_download'")
    expect(source).toMatch(/originalDownloadUnlocked:\s*true/)
  })

  it('this task did not add any new Stripe/checkout/webhook/entitlement code (audit only, per explicit instruction)', () => {
    // Guards against a future edit silently turning "audit and report" into
    // "quietly implement/link" for this specific flow.
    const source = readComponent('app/api/stripe/unlock-download/route.js')
    expect(source).not.toContain('STRIPE_PRICE_ID_HIGH_QUALITY_DOWNLOAD_FALLBACK')
    expect(source).not.toMatch(/priceId\s*=\s*priceId\s*\|\|/)
  })
})

describe('Standard Quality download is unaffected by the Bug A audit', () => {
  it('Standard Quality remains present and wired to its own unconditional handler', () => {
    const source = readComponent('components/photo-lightbox.jsx')
    expect(source).toContain('t.standardQuality')
    expect(source).toContain('handleDownloadStandard')
    // Standard Quality has no gating condition around it (always rendered),
    // unlike the Original Quality branch which is gated on canDownloadOriginal/isOwner.
    const standardIdx = source.indexOf('onClick={handleDownloadStandard}')
    const originalIdx = source.indexOf('canDownloadOriginal ? (')
    expect(standardIdx).toBeGreaterThan(-1)
    expect(originalIdx).toBeGreaterThan(standardIdx)
  })
})

describe('Paid-event / already-unlocked behavior is unaffected', () => {
  it('canDownloadOriginal already-unlocked path (paid events, or an unlocked Free event) renders the real download option, not the paywall', () => {
    const source = readComponent('components/photo-lightbox.jsx')
    expect(source).toMatch(/canDownloadOriginal \? \(\s*<DropdownMenuItem[\s\S]*?onClick={handleDownloadOriginal}/)
  })
})
