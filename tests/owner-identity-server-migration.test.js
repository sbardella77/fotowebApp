import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// PostHog Identity Privacy Hardening V1 — server-side contract tests.
// Source-contract style (matching tests/room-page-client-funnel-analytics.js
// and tests/dashboard-event-workspace-ia-contract.test.js): asserts on the
// exact trackServerEvent distinctId expressions rather than executing the
// full route dispatcher (which has its own deep, pre-existing runtime
// coverage in tests/stripe-webhook-*.test.js — this file must not weaken or
// duplicate that, only prove the identity contract at each call site).

const ROUTE = readFileSync(resolve(import.meta.dirname, '..', 'app/api/[[...path]]/route.js'), 'utf8')
const WEBHOOK = readFileSync(resolve(import.meta.dirname, '..', 'app/api/stripe/webhook/route.js'), 'utf8')
const CHECKOUT = readFileSync(resolve(import.meta.dirname, '..', 'app/api/stripe/checkout-session/route.js'), 'utf8')
const UNLOCK = readFileSync(resolve(import.meta.dirname, '..', 'app/api/stripe/unlock-download/route.js'), 'utf8')
const EXTRA_EVENT = readFileSync(resolve(import.meta.dirname, '..', 'lib/server/extra-free-event-fulfillment.js'), 'utf8')

const EMAIL_DISTINCT_ID_PATTERNS = [
  /distinctId:\s*owner\.email/,
  /distinctId:\s*ownerEmail/,
  /distinctId:\s*payload\.email/,
  /distinctId:\s*payload\.ownerEmail/,
  /distinctId:\s*email\b/,
  /distinctId:.*session\.metadata\?\.ownerEmail/,
  /distinctId:.*session\.customer_email/,
]

function assertNoEmailDistinctId(source, label) {
  for (const pattern of EMAIL_DISTINCT_ID_PATTERNS) {
    expect(source, `${label} must not match ${pattern}`).not.toMatch(pattern)
  }
}

describe('owner auth (app/api/[[...path]]/route.js) — no email-derived distinct_id', () => {
  it('imports getOwnerAnalyticsId from the shared identity module', () => {
    expect(ROUTE).toContain("import { getOwnerAnalyticsId } from '@/lib/analytics/identity'")
  })

  it('has zero email-derived distinctId expressions', () => {
    assertNoEmailDistinctId(ROUTE, 'route.js')
  })

  it('EVENT_OWNER_LOGGED_IN uses getOwnerAnalyticsId(owner.id) with personProfile:true', () => {
    expect(ROUTE).toContain("trackServerEvent(EVENT_OWNER_LOGGED_IN, { method: 'password_api' }, { distinctId: getOwnerAnalyticsId(owner.id), personProfile: true })")
  })

  it('EVENT_OWNER_CLAIM_COMPLETED uses getOwnerAnalyticsId(owner.id) with personProfile:true', () => {
    expect(ROUTE).toContain('trackServerEvent(EVENT_OWNER_CLAIM_COMPLETED, {}, { distinctId: getOwnerAnalyticsId(owner.id), personProfile: true })')
  })

  it('EVENT_FREE_ROOM_LIMIT_HIT (both create-event and claim-room call sites) uses getOwnerAnalyticsId(owner.id)', () => {
    const matches = ROUTE.match(/EVENT_FREE_ROOM_LIMIT_HIT,[\s\S]{0,220}?distinctId: getOwnerAnalyticsId\(owner\.id\)/g) || []
    expect(matches.length).toBe(2)
  })

  it('private-delivery and photographer-link-management events resolve identity via event.ownerId (already-loaded Event row), not a re-fetch', () => {
    const matches = ROUTE.match(/distinctId: getOwnerAnalyticsId\(event\.ownerId\)/g) || []
    expect(matches.length).toBe(6)
  })

  it('the two authenticated Owner API responses expose ownerId (their own id only, never another Owner\'s)', () => {
    expect(ROUTE).toMatch(/jsonPrivate\(\{ authenticated: true, email, ownerId: owner\?\.id \|\| null \}\)/)
    expect(ROUTE).toContain('jsonPrivate({ authenticated: true, email, ownerId: owner.id })')
  })

  it('room-scoped events (photo/room limit hit, photographer upload) use a non-person room: identity with personProfile:false (PostHog Non-Person Identity Hardening)', () => {
    // These are genuinely room-scoped (photo-limit-hit fires for a guest
    // uploader, photographer-upload fires for a token-holding third party —
    // neither is an authenticated Owner). V1 left the bare event.slug /
    // photographer_<slug> string as distinctId; this follow-up migrates
    // them to an explicit non-person capture so they can never create a
    // PostHog Person, while keeping the room identity itself in properties.
    expect(ROUTE).not.toContain('distinctId: event.slug')
    expect(ROUTE).not.toContain('distinctId: `photographer_${event.slug}`')
    const roomMatches = ROUTE.match(/distinctId: `room:\$\{event\.slug\}`, personProfile: false/g) || []
    expect(roomMatches.length).toBeGreaterThanOrEqual(5)
  })

  it('rate-limit diagnostic events no longer use clientIp as distinctId, and drop raw IP from properties entirely (data minimization)', () => {
    expect(ROUTE).not.toMatch(/distinctId: clientIp/)
    expect(ROUTE).not.toMatch(/client_ip: clientIp/)
    const rateLimitMatches = ROUTE.match(/distinctId: 'rate_limit:[a-z_]+', personProfile: false/g) || []
    expect(rateLimitMatches.length).toBe(3)
  })
})

describe('Stripe checkout-session (app/api/stripe/checkout-session/route.js) — owner-only, no email', () => {
  it('imports getOwnerAnalyticsId', () => {
    expect(CHECKOUT).toContain("import { getOwnerAnalyticsId } from '@/lib/analytics/identity'")
  })

  it('has zero email-derived distinctId expressions', () => {
    assertNoEmailDistinctId(CHECKOUT, 'checkout-session/route.js')
  })

  it('all three checkout-analytics call sites use getOwnerAnalyticsId(owner.id)', () => {
    const matches = CHECKOUT.match(/distinctId: getOwnerAnalyticsId\(owner\.id\)/g) || []
    expect(matches.length).toBe(3)
  })
})

describe('Stripe webhook (app/api/stripe/webhook/route.js) — owner events migrated, guest-or-owner events keep email out entirely', () => {
  it('imports getOwnerAnalyticsId', () => {
    expect(WEBHOOK).toContain("import { getOwnerAnalyticsId } from '@/lib/analytics/identity'")
  })

  it('has zero email-derived distinctId expressions', () => {
    assertNoEmailDistinctId(WEBHOOK, 'webhook/route.js')
  })

  it('pro_event/wedding_pro/professional/extra_event owner checkout completions use getOwnerAnalyticsId', () => {
    const byOwnerId = WEBHOOK.match(/distinctId: getOwnerAnalyticsId\(ownerId\)/g) || []
    const byOwnerDotId = WEBHOOK.match(/distinctId: getOwnerAnalyticsId\(owner\.id\)/g) || []
    // 501/516 (pro_event/wedding_pro) + 1745/1761 (legacy extra_event) = 4
    expect(byOwnerId.length).toBe(4)
    // 618/632 (professional subscription) = 2
    expect(byOwnerDotId.length).toBe(2)
  })

  it('the high_quality_download event (guest or owner, no auth required) drops customer_email entirely rather than gaining a fabricated owner identity', () => {
    const matches = WEBHOOK.match(/distinctId: session\.customer \|\| eventId/g) || []
    expect(matches.length).toBe(2)
    expect(WEBHOOK).not.toMatch(/distinctId:.*session\.customer_email/)
  })
})

describe('unlock-download (app/api/stripe/unlock-download/route.js) — owner branch migrated, guest branch never sees email', () => {
  it('imports getOwnerAnalyticsId', () => {
    expect(UNLOCK).toContain("import { getOwnerAnalyticsId } from '@/lib/analytics/identity'")
  })

  it('has zero email-derived distinctId expressions', () => {
    assertNoEmailDistinctId(UNLOCK, 'unlock-download/route.js')
  })

  it('resolves owner identity via getOwnerAnalyticsId(owner?.id) as a real Person when present, or a non-person room: identity otherwise — never session.customer_email', () => {
    expect(UNLOCK).toContain('const unlockOwnerId = getOwnerAnalyticsId(owner?.id)')
    expect(UNLOCK).toMatch(/unlockOwnerId\s*\n?\s*\?\s*\{ distinctId: unlockOwnerId, personProfile: true \}\s*\n?\s*:\s*\{ distinctId: `room:\$\{event\.slug\}`, personProfile: false \}/)
  })
})

describe('extra-free-event-fulfillment.js — all 6 owner-checkout analytics call sites migrated', () => {
  it('imports getOwnerAnalyticsId', () => {
    expect(EXTRA_EVENT).toContain("import { getOwnerAnalyticsId } from '@/lib/analytics/identity'")
  })

  it('has zero email-derived distinctId expressions', () => {
    assertNoEmailDistinctId(EXTRA_EVENT, 'extra-free-event-fulfillment.js')
  })

  it('all 6 trackServerEvent call sites use getOwnerAnalyticsId(ownerId)', () => {
    const matches = EXTRA_EVENT.match(/distinctId: getOwnerAnalyticsId\(ownerId\)/g) || []
    expect(matches.length).toBe(6)
  })
})

describe('repo-wide static privacy gate (Phase 10) — no authenticated Owner PostHog identity is derived from email anywhere', () => {
  it('none of the five migrated server files contain any email-derived distinctId pattern', () => {
    for (const [label, source] of [
      ['route.js', ROUTE],
      ['webhook/route.js', WEBHOOK],
      ['checkout-session/route.js', CHECKOUT],
      ['unlock-download/route.js', UNLOCK],
      ['extra-free-event-fulfillment.js', EXTRA_EVENT],
    ]) {
      assertNoEmailDistinctId(source, label)
    }
  })
})
