import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve(import.meta.dirname, '..')
const read = (relPath) => readFileSync(resolve(ROOT, relPath), 'utf8')

describe('server-side PostHog event property minimization (PRIVACY-SERVER-001)', () => {
  const webhookSource = read('app/api/stripe/webhook/route.js')
  const fulfillmentSource = read('lib/server/extra-free-event-fulfillment.js')
  const routeSource = read('app/api/[[...path]]/route.js')

  it('stripe_customer_id is never sent as a PostHog event property in the Stripe webhook handler', () => {
    expect(webhookSource).not.toContain('stripe_customer_id')
  })

  it('stripe_customer_id is never sent as a PostHog event property in the extra-free-event fulfillment module', () => {
    expect(fulfillmentSource).not.toContain('stripe_customer_id')
  })

  it('session.customer is still used as a non-person distinctId where it previously was — removal is scoped to the properties object, not distinctId/personProfile', () => {
    expect(webhookSource).toMatch(/distinctId:\s*session\.customer\s*\|\|\s*eventId,\s*personProfile:\s*false/g)
  })

  it('stripe_session_id, stripe_subscription_id, and other approved transaction-scoped identifiers remain present', () => {
    expect(webhookSource).toContain('stripe_session_id: session.id')
    expect(webhookSource).toContain('stripe_subscription_id: session.subscription')
    expect(fulfillmentSource).toContain('stripe_session_id: session.id')
  })

  it('raw file_name is never sent as a PostHog event property in the private-delivery/photographer upload-start events', () => {
    expect(routeSource).not.toMatch(/trackServerEvent\(\s*EVENT_PRIVATE_DELIVERY_UPLOAD_STARTED[\s\S]{0,120}file_name/)
    expect(routeSource).not.toMatch(/trackServerEvent\(\s*EVENT_PHOTOGRAPHER_UPLOAD_STARTED[\s\S]{0,120}file_name/)
  })

  it('file_size is retained on both upload-start events (only file_name was removed)', () => {
    expect(routeSource).toMatch(/EVENT_PRIVATE_DELIVERY_UPLOAD_STARTED,\s*\{\s*room_slug:\s*slug,\s*file_size:\s*payload\.fileSize\s*\}/)
    expect(routeSource).toMatch(/EVENT_PHOTOGRAPHER_UPLOAD_STARTED,\s*\{\s*room_slug:\s*event\.slug,\s*file_size:\s*payload\.fileSize\s*\}/)
  })

  it('room_slug/event_id/asset_id remain unchanged (explicitly out of scope for this task)', () => {
    expect(webhookSource).toContain('room_slug: session.metadata?.roomSlug || null')
    expect(routeSource).toContain('room_slug: slug, file_size: payload.fileSize')
    expect(routeSource).toContain('room_slug: event.slug, file_size: payload.fileSize')
  })

  it('all previously-existing server event names remain present (no event renamed or removed)', () => {
    const names = [
      'EVENT_ORIGINAL_DOWNLOAD_CHECKOUT_COMPLETED',
      'EVENT_UPSELL_CONVERSION',
      'EVENT_CHECKOUT_COMPLETED',
      'EVENT_PRIVATE_DELIVERY_UPLOAD_STARTED',
      'EVENT_PHOTOGRAPHER_UPLOAD_STARTED',
    ]
    for (const name of names) {
      const inWebhook = webhookSource.includes(name)
      const inFulfillment = fulfillmentSource.includes(name)
      const inRoute = routeSource.includes(name)
      expect(inWebhook || inFulfillment || inRoute).toBe(true)
    }
  })

  it('trackServerEvent architecture (distinctId/personProfile contract) is untouched', () => {
    const trackServerSource = read('lib/analytics/track-server.js')
    expect(trackServerSource).toContain('if (!distinctId)')
    expect(trackServerSource).toContain('personProfile !== true && personProfile !== false')
    expect(trackServerSource).toContain('$process_person_profile: false')
  })

})
