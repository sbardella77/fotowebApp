import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// PostHog Non-Person Identity Hardening — proves the classification contract:
// only a real authenticated Owner (or a genuine browser-anonymous person)
// should ever become a PostHog Person. Rooms, rate-limit diagnostics,
// photographer-link uploads, and guest-or-owner Stripe purchases with no
// resolvable Owner must never create/update a Person profile, per PostHog's
// documented $process_person_profile:false mechanism (confirmed supported
// by the installed posthog-node SDK — see lib/analytics/track-server.js).

const ROUTE = readFileSync(resolve(import.meta.dirname, '..', 'app/api/[[...path]]/route.js'), 'utf8')
const WEBHOOK = readFileSync(resolve(import.meta.dirname, '..', 'app/api/stripe/webhook/route.js'), 'utf8')
const UNLOCK = readFileSync(resolve(import.meta.dirname, '..', 'app/api/stripe/unlock-download/route.js'), 'utf8')
const CHECKOUT = readFileSync(resolve(import.meta.dirname, '..', 'app/api/stripe/checkout-session/route.js'), 'utf8')
const EXTRA_EVENT = readFileSync(resolve(import.meta.dirname, '..', 'lib/server/extra-free-event-fulfillment.js'), 'utf8')
const ROOM = readFileSync(resolve(import.meta.dirname, '..', 'components/room-page-client.jsx'), 'utf8')

// ── track-server.js runtime contract ────────────────────────────────────────
describe('trackServerEvent — explicit personProfile contract, no silent fallback', () => {
  const ORIGINAL_ENV = { ...process.env }
  let capturedCalls
  let mockPosthogInstance

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV, NEXT_PUBLIC_POSTHOG_KEY: 'test-key' }
    capturedCalls = []
    mockPosthogInstance = { capture: vi.fn((args) => capturedCalls.push(args)) }
    vi.doMock('posthog-node', () => ({
      PostHog: vi.fn(function PostHogMock() {
        return mockPosthogInstance
      }),
    }))
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
    vi.doUnmock('posthog-node')
  })

  it('1 & 8. a Person call (personProfile:true) captures with the given distinctId and no suppression property', async () => {
    const { trackServerEvent } = await import('@/lib/analytics/track-server')
    trackServerEvent('owner_logged_in', { method: 'password_api' }, { distinctId: 'owner:abc123', personProfile: true })
    expect(capturedCalls).toHaveLength(1)
    expect(capturedCalls[0].distinctId).toBe('owner:abc123')
    expect(capturedCalls[0].properties.$process_person_profile).toBeUndefined()
  })

  it('10. a non-person call (personProfile:false) injects $process_person_profile:false', async () => {
    const { trackServerEvent } = await import('@/lib/analytics/track-server')
    trackServerEvent('free_photo_limit_hit', { room_slug: 'wedding-2026' }, { distinctId: 'room:wedding-2026', personProfile: false })
    expect(capturedCalls).toHaveLength(1)
    expect(capturedCalls[0].distinctId).toBe('room:wedding-2026')
    expect(capturedCalls[0].properties.$process_person_profile).toBe(false)
    // Original properties are preserved alongside the suppression flag.
    expect(capturedCalls[0].properties.room_slug).toBe('wedding-2026')
  })

  it('5. a call with no distinctId is dropped, never collapsed into a shared fallback Person', async () => {
    const { trackServerEvent } = await import('@/lib/analytics/track-server')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    trackServerEvent('some_event', {}, { personProfile: false })
    expect(capturedCalls).toHaveLength(0)
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('a call with no explicit personProfile is dropped, never defaults silently', async () => {
    const { trackServerEvent } = await import('@/lib/analytics/track-server')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    trackServerEvent('some_event', {}, { distinctId: 'owner:abc123' })
    expect(capturedCalls).toHaveLength(0)
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('the literal string "server_anonymous" is never used as a distinctId value anywhere in the module', async () => {
    const source = readFileSync(resolve(import.meta.dirname, '..', 'lib/analytics/track-server.js'), 'utf8')
    // Only allowed to appear inside a comment explaining what NOT to do.
    const codeLines = source.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
    expect(codeLines.join('\n')).not.toContain('server_anonymous')
  })
})

// ── Static classification contract per call site ────────────────────────────
describe('2 & 9. room/event limit-hit events: non-person identity, room context preserved as properties', () => {
  it('all three EVENT_FREE_PHOTO_LIMIT_HIT call sites use room:<slug> with personProfile:false', () => {
    const matches = ROUTE.match(/distinctId: `room:\$\{(?:event\.slug|error\.details\.eventSlug)\}`, personProfile: false/g) || []
    expect(matches.length).toBeGreaterThanOrEqual(3)
  })

  it('room_slug and event_id remain available as event properties (not identity)', () => {
    expect(ROUTE).toMatch(/room_slug: event\.slug,\s*\n\s*event_id: event\.id/)
  })

  it('bare event.slug / photographer_<slug> as distinctId no longer exists anywhere', () => {
    expect(ROUTE).not.toMatch(/distinctId: event\.slug/)
    expect(ROUTE).not.toMatch(/distinctId: `photographer_/)
  })
})

describe('3. photographer-link upload events: non-person room identity, not a fabricated photographer Person', () => {
  it('all three photographer upload call sites use room:<slug> with personProfile:false', () => {
    const matches = ROUTE.match(/EVENT_PHOTOGRAPHER_UPLOAD_(?:STARTED|COMPLETED)[\s\S]{0,150}?distinctId: `room:\$\{event\.slug\}`, personProfile: false/g) || []
    expect(matches.length).toBe(3)
  })

  it('room_slug remains available as a property on every photographer upload event', () => {
    const matches = ROUTE.match(/EVENT_PHOTOGRAPHER_UPLOAD_(?:STARTED|COMPLETED),\s*\{ room_slug: event\.slug/g) || []
    expect(matches.length).toBe(3)
  })
})

describe('4. rate-limit-hit events: no IP as Person identity, and raw IP dropped from properties (data minimization)', () => {
  it('none of the three rate-limit call sites uses clientIp as distinctId', () => {
    expect(ROUTE).not.toMatch(/distinctId: clientIp/)
  })

  it('all three use a technical rate_limit:<reason> identity with personProfile:false', () => {
    const matches = ROUTE.match(/distinctId: 'rate_limit:[a-z_]+', personProfile: false/g) || []
    expect(matches.length).toBe(3)
  })

  it('raw client_ip is no longer captured as an event property either', () => {
    expect(ROUTE).not.toMatch(/EVENT_RATE_LIMIT_HIT, \{ reason: '[a-z_]+', client_ip: clientIp \}/)
  })

  it('the reason property (which endpoint was rate-limited) is preserved — the operationally useful dimension', () => {
    const matches = ROUTE.match(/EVENT_RATE_LIMIT_HIT, \{ reason: '[a-z_]+' \}/g) || []
    expect(matches.length).toBe(3)
  })
})

describe('6. guest browser events: no persistent guest identity is ever invented', () => {
  it('room-page-client.jsx (guest-facing) still never calls identify() or resetAnalyticsIdentity', () => {
    expect(ROOM).not.toContain('identifyUser')
    expect(ROOM).not.toMatch(/\.identify\(/)
  })

  it('contributorId is never wired into any distinctId expression', () => {
    expect(ROOM).not.toMatch(/distinctId.*contributorId/)
  })
})

describe('7. Stripe guest purchase (high_quality_download, no Owner auth): no Stripe customer/session as Person', () => {
  it('the two guest-or-owner webhook call sites use personProfile:false', () => {
    const matches = WEBHOOK.match(/distinctId: session\.customer \|\| eventId, personProfile: false/g) || []
    expect(matches.length).toBe(2)
  })

  it('unlock-download guest branch (no owner) uses a non-person room identity, not a Stripe id', () => {
    expect(UNLOCK).toContain('const unlockOwnerId = getOwnerAnalyticsId(owner?.id)')
    expect(UNLOCK).toMatch(/: \{ distinctId: `room:\$\{event\.slug\}`, personProfile: false \}/)
  })

  it('unlock-download owner branch still uses a real Person identity when an Owner exists', () => {
    expect(UNLOCK).toMatch(/\? \{ distinctId: unlockOwnerId, personProfile: true \}/)
  })
})

describe('1 & 8. authenticated Owner events (route.js, webhook, checkout-session, extra-free-event-fulfillment) still use owner:<id> with personProfile:true', () => {
  it('every getOwnerAnalyticsId(...)-based distinctId site carries personProfile:true', () => {
    for (const [label, source] of [
      ['route.js', ROUTE],
      ['webhook/route.js', WEBHOOK],
      ['checkout-session/route.js', CHECKOUT],
      ['extra-free-event-fulfillment.js', EXTRA_EVENT],
    ]) {
      const distinctIdLines = source.split('\n').filter((l) => l.includes('distinctId: getOwnerAnalyticsId'))
      expect(distinctIdLines.length, `${label} should have Owner distinctId lines`).toBeGreaterThan(0)
      for (const line of distinctIdLines) {
        expect(line, `${label}: "${line.trim()}" must carry personProfile: true`).toContain('personProfile: true')
      }
    }
  })

  it('unlock-download owner branch also carries personProfile:true', () => {
    expect(UNLOCK).toMatch(/\{ distinctId: unlockOwnerId, personProfile: true \}/)
  })
})

describe('static identity gate: zero unexplained non-person distinct_id patterns remain', () => {
  it('no raw event.slug, photographer_<slug>, or clientIp distinctId usage remains in route.js', () => {
    expect(ROUTE).not.toMatch(/distinctId: event\.slug/)
    expect(ROUTE).not.toMatch(/distinctId: `photographer_\$\{event\.slug\}`/)
    expect(ROUTE).not.toMatch(/distinctId: clientIp/)
  })

  it('every trackServerEvent(...) call site in the five migrated files has an explicit personProfile option', () => {
    for (const [label, source] of [
      ['route.js', ROUTE],
      ['webhook/route.js', WEBHOOK],
      ['checkout-session/route.js', CHECKOUT],
      ['unlock-download/route.js', UNLOCK],
      ['extra-free-event-fulfillment.js', EXTRA_EVENT],
    ]) {
      const distinctIdLines = source.split('\n').filter((l) => l.includes('distinctId:'))
      for (const line of distinctIdLines) {
        expect(line, `${label}: "${line.trim()}" must carry an explicit personProfile`).toMatch(/personProfile: (true|false)/)
      }
    }
  })
})
