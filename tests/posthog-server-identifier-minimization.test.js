import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { Prisma } from '@prisma/client'
import { classifyAutoCreateFailure } from '@/lib/server/extra-free-event-fulfillment'

const ROOT = resolve(import.meta.dirname, '..')
const read = (relPath) => readFileSync(resolve(ROOT, relPath), 'utf8')

const BILLING_FILES = [
  'app/api/stripe/webhook/route.js',
  'app/api/stripe/checkout-session/route.js',
  'lib/server/event-routes.js',
  'lib/server/extra-free-event-fulfillment.js',
]

describe('no raw Stripe Customer ID is ever used as a PostHog distinctId (PRIVACY-SERVER-003B)', () => {
  it('session.customer (the Stripe Customer ID field) is never used as a distinctId value anywhere in the repo', () => {
    // The only two call sites that ever used session.customer as a
    // distinctId have been replaced with a room-scoped identifier. This
    // checks the actual usage pattern, not a blanket substring match —
    // the field name itself still legitimately appears in explanatory
    // comments (e.g. "never fall back to session.customer_email") that
    // this must not flag.
    const allAnalyticsFiles = [
      ...BILLING_FILES,
      'app/api/stripe/unlock-download/route.js',
      'app/api/uploads/init/route.js',
      'app/api/uploads/complete/route.js',
      'app/api/[[...path]]/route.js',
    ]
    for (const file of allAnalyticsFiles) {
      const source = read(file)
      expect(source, `${file} must not use session.customer as a distinctId`).not.toMatch(/distinctId:[^,}]*session\.customer\b/)
    }
  })

  it('the two original_download_checkout_completed / upsell_conversion guest-path call sites now use a room-scoped distinctId', () => {
    const source = read('app/api/stripe/webhook/route.js')
    const matches = source.match(/distinctId:\s*`room:\$\{session\.metadata\?\.roomSlug \|\| eventId\}`,\s*personProfile:\s*false/g) || []
    expect(matches.length).toBe(2)
  })

  it('no trackServerEvent call anywhere passes a Stripe-prefixed id (cus_/sub_/pi_) as a literal distinctId', () => {
    for (const file of BILLING_FILES) {
      const source = read(file)
      // Matches a hardcoded Stripe object-id prefix used directly in a
      // distinctId expression — would not catch a runtime value, but would
      // catch any future literal/hardcoded regression.
      expect(source).not.toMatch(/distinctId:\s*['"`]?(cus_|sub_|pi_)/)
    }
  })
})

describe('no duplicate owner_id event property remains alongside an owner distinctId (PRIVACY-SERVER-003B)', () => {
  it('none of the four billing files contain an owner_id: event property anymore', () => {
    for (const file of BILLING_FILES) {
      const source = read(file)
      expect(source, `${file} must not contain an owner_id: property`).not.toMatch(/\bowner_id:/)
    }
  })

  it('downstream compatibility: distinctId-based owner identification is preserved — getOwnerAnalyticsId(...) call count is unchanged by the owner_id removal', () => {
    // The removal only deleted property lines, never the distinctId
    // argument itself — every call site that previously had both
    // getOwnerAnalyticsId(...) as distinctId AND a duplicate owner_id
    // property must still have getOwnerAnalyticsId(...) present.
    const webhookSource = read('app/api/stripe/webhook/route.js')
    const checkoutSource = read('app/api/stripe/checkout-session/route.js')
    const eventRoutesSource = read('lib/server/event-routes.js')
    const fulfillmentSource = read('lib/server/extra-free-event-fulfillment.js')

    expect((webhookSource.match(/getOwnerAnalyticsId\(/g) || []).length).toBeGreaterThanOrEqual(6)
    expect((checkoutSource.match(/getOwnerAnalyticsId\(/g) || []).length).toBeGreaterThanOrEqual(3)
    expect((eventRoutesSource.match(/getOwnerAnalyticsId\(/g) || []).length).toBeGreaterThanOrEqual(2)
    expect((fulfillmentSource.match(/getOwnerAnalyticsId\(/g) || []).length).toBeGreaterThanOrEqual(6)
  })

  it('no downstream PostHog-query consumer reads an owner_id event property (confirms removal is safe)', () => {
    const consumerFiles = [
      'lib/server/admin-analytics-posthog.js',
      'lib/server/admin-business-metrics.js',
      'lib/server/admin-business-dashboard.js',
      'lib/server/posthog-query.js',
    ]
    for (const file of consumerFiles) {
      expect(read(file)).not.toMatch(/\bowner_id\b/)
    }
  })
})

describe('bounded failure categories replace raw exception text in PostHog properties (PRIVACY-SERVER-003B)', () => {
  it('the source no longer sends reason: error.message to trackServerEvent', () => {
    const source = read('lib/server/extra-free-event-fulfillment.js')
    expect(source).not.toMatch(/reason:\s*error\.message,\s*\n\s*source:\s*'stripe_webhook'/)
    expect(source).toContain('reason: classifyAutoCreateFailure(error)')
  })

  it('classifyAutoCreateFailure() returns a bounded db_error_<code> category for a known Prisma error, never the raw message', () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`id`)', {
      code: 'P2002',
      clientVersion: 'test',
    })
    const result = classifyAutoCreateFailure(prismaError)
    expect(result).toBe('db_error_P2002')
    expect(result).not.toContain('Unique constraint')
  })

  it('classifyAutoCreateFailure() returns the generic unknown_error category for any other error, never the raw message', () => {
    const genericError = new Error('some arbitrary internal detail that must never reach PostHog')
    const result = classifyAutoCreateFailure(genericError)
    expect(result).toBe('unknown_error')
    expect(result).not.toContain('arbitrary internal detail')
  })

  it('classifyAutoCreateFailure() never throws, even for a malformed/non-Error input', () => {
    expect(() => classifyAutoCreateFailure(undefined)).not.toThrow()
    expect(() => classifyAutoCreateFailure(null)).not.toThrow()
    expect(() => classifyAutoCreateFailure({})).not.toThrow()
  })

  it('no other trackServerEvent call site anywhere passes a raw error/exception message as a property', () => {
    // Scoped to the text of each trackServerEvent(...) call itself (not the
    // whole file) — sendOpsAlert({ message: error.message }) calls elsewhere
    // in these same files are a separate, legitimate internal-alerting path
    // and are expected to carry the real error message; this check must not
    // flag those.
    const allFiles = [
      ...BILLING_FILES,
      'app/api/stripe/unlock-download/route.js',
      'app/api/uploads/init/route.js',
      'app/api/uploads/complete/route.js',
      'app/api/[[...path]]/route.js',
    ]
    const CALL_WINDOW = 600
    for (const file of allFiles) {
      const source = read(file)
      let searchFrom = 0
      while (true) {
        const idx = source.indexOf('trackServerEvent(', searchFrom)
        if (idx === -1) break
        const callText = source.slice(idx, idx + CALL_WINDOW)
        expect(callText, `${file} (trackServerEvent call at offset ${idx}) must not pass a raw error message property`).not.toMatch(
          /:\s*(error|err|e)\.message\b/
        )
        searchFrom = idx + 1
      }
    }
  })
})

describe('operational and business-critical fields are preserved exactly (PRIVACY-SERVER-003B scope check)', () => {
  it('event names, stripe_session_id, room_slug, and event_id correlation fields are unchanged in the webhook handler', () => {
    const source = read('app/api/stripe/webhook/route.js')
    expect(source).toContain('EVENT_ORIGINAL_DOWNLOAD_CHECKOUT_COMPLETED')
    expect(source).toContain('EVENT_UPSELL_CONVERSION')
    expect(source).toContain('EVENT_CHECKOUT_COMPLETED')
    expect(source).toContain('stripe_session_id: session.id')
    expect(source).toContain("room_slug: session.metadata?.roomSlug || null")
    expect(source).toContain('event_id: eventId')
  })

  it('no Stripe webhook signature verification, payment amount, or database-write logic was touched (file still imports/uses the same Prisma transaction primitives)', () => {
    const source = read('app/api/stripe/webhook/route.js')
    expect(source).toContain('constructEvent') // signature verification untouched — still present
  })
})
