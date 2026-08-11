import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

vi.mock('@/lib/server/prisma-client', () => ({ getPrismaClient: vi.fn() }))
vi.mock('@/lib/server/stripe', () => ({ getStripe: vi.fn() }))
vi.mock('@/lib/server/ops-alerts', () => ({ sendOpsAlert: vi.fn().mockResolvedValue({ sent: false }) }))
vi.mock('@/lib/analytics/track-server', () => ({ trackServerEvent: vi.fn() }))
vi.mock('@/lib/server/billing-emails', () => ({
  sendProEventPurchasedEmail: vi.fn().mockResolvedValue(undefined),
  sendWeddingProPurchasedEmail: vi.fn().mockResolvedValue(undefined),
  sendExtraFreeEventCreditGrantedEmail: vi.fn().mockResolvedValue(undefined),
  sendExtraFreeEventCreatedEmail: vi.fn().mockResolvedValue(undefined),
  sendExtraFreeEventFallbackCreditEmail: vi.fn().mockResolvedValue(undefined),
  sendProfessionalActivatedEmail: vi.fn().mockResolvedValue(undefined),
  sendProfessionalPaymentFailedEmail: vi.fn().mockResolvedValue(undefined),
  sendProfessionalPaymentRecoveredEmail: vi.fn().mockResolvedValue(undefined),
  sendProfessionalCanceledEmail: vi.fn().mockResolvedValue(undefined),
  sendProfessionalCancellationScheduledEmail: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/server/prisma-gallery-repository', () => ({
  prismaGalleryRepository: { createEvent: vi.fn() },
}))
// Only `claimStripeWebhookEvent` is mocked here: these tests are about what
// the atomic pro_event/wedding_pro branch does with a *given* claimed
// attempt, not about the claim/lease mechanism itself (already covered
// exhaustively in tests/stripe-webhook-receipt.test.js).
// markStripeWebhookEventProcessed/Failed keep their real implementation —
// wrapped in vi.fn() so calls are still countable — so fencing/finalization
// run for real against the fake transactional store below.
vi.mock('@/lib/server/stripe-webhook-receipt', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    claimStripeWebhookEvent: vi.fn(),
    markStripeWebhookEventProcessed: vi.fn(actual.markStripeWebhookEventProcessed),
    markStripeWebhookEventFailed: vi.fn(actual.markStripeWebhookEventFailed),
  }
})

import { POST } from '@/app/api/stripe/webhook/route'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { getStripe } from '@/lib/server/stripe'
import { trackServerEvent } from '@/lib/analytics/track-server'
import { sendProEventPurchasedEmail } from '@/lib/server/billing-emails'
import {
  claimStripeWebhookEvent,
  markStripeWebhookEventProcessed,
  markStripeWebhookEventFailed,
} from '@/lib/server/stripe-webhook-receipt'
import { createFakeTransactionalPrisma } from './helpers/fake-prisma.js'

const originalEnv = process.env

beforeAll(() => {
  process.env = { ...originalEnv, NODE_ENV: 'test', STRIPE_WEBHOOK_SECRET: 'whsec_test_secret' }
})

afterAll(() => {
  process.env = originalEnv
})

function createWebhookRequest({ payload = '{}', signature = 'sig_test' } = {}) {
  return {
    text: vi.fn().mockResolvedValue(payload),
    headers: { get: vi.fn((name) => (name === 'stripe-signature' ? signature : null)) },
  }
}

let eventIdSeq = 0
function buildStripeEvent(type, object, id) {
  eventIdSeq += 1
  return { id: id || `evt_pe_atomic_${eventIdSeq}`, type, data: { object } }
}

function buildSession({ intent, eventId, sessionId = 'cs_pe_test', ownerId = 'owner-1' } = {}) {
  return {
    id: sessionId,
    customer: 'cus_test',
    customer_email: 'owner@example.com',
    metadata: {
      intent,
      ownerId,
      ownerEmail: 'owner@example.com',
      eventId: eventId ?? '',
      roomSlug: 'event-slug',
    },
  }
}

function mockConstructEvent(event) {
  getStripe.mockReturnValue({ webhooks: { constructEvent: vi.fn(() => event) } })
}

function seedReceipt({ eventId, status, attempts, eventType = 'checkout.session.completed' }) {
  return {
    id: `swe-seed-${eventId}`,
    eventId,
    eventType,
    status,
    attempts,
    lastError: null,
    receivedAt: new Date(),
    processingStartedAt: new Date(),
    processedAt: null,
    updatedAt: new Date(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('STEP 4.6: atomic finalization for checkout.session.completed / pro_event & wedding_pro', () => {
  it('A: pro_event success — Event upgrade, UpsellEvent, and receipt PROCESSED all commit together', async () => {
    const stripeEventId = 'evt_pe_success'
    const session = buildSession({ intent: 'pro_event', eventId: 'event-1', sessionId: 'cs_pe_1' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      event: [{ id: 'event-1', slug: 'event-slug', billingTier: 'free', stripeCheckoutSessionId: null }],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)

    const event = await prisma.event.findUnique({ where: { id: 'event-1' } })
    expect(event.billingTier).toBe('pro_event')
    expect(event.stripeCheckoutSessionId).toBe('cs_pe_1')

    expect(prisma.upsellEvent._rows).toHaveLength(1)

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSED')
    expect(receipt.attempts).toBe(1)

    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
  })

  it('B: wedding_pro success — same atomic commit property', async () => {
    const stripeEventId = 'evt_wp_success'
    const session = buildSession({ intent: 'wedding_pro', eventId: 'event-1', sessionId: 'cs_wp_1' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      event: [{ id: 'event-1', slug: 'event-slug', billingTier: 'free', stripeCheckoutSessionId: null }],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)

    const event = await prisma.event.findUnique({ where: { id: 'event-1' } })
    expect(event.billingTier).toBe('wedding_pro')
    expect(event.stripeCheckoutSessionId).toBe('cs_wp_1')

    expect(prisma.upsellEvent._rows).toHaveLength(1)

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSED')

    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
  })

  it('C: an UpsellEvent write failure rolls back the Event upgrade too — no partial fulfillment', async () => {
    const stripeEventId = 'evt_pe_upsell_fail'
    const session = buildSession({ intent: 'pro_event', eventId: 'event-1', sessionId: 'cs_pe_2' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      event: [{ id: 'event-1', slug: 'event-slug', billingTier: 'free', stripeCheckoutSessionId: null }],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    const realTransaction = prisma.$transaction
    prisma.$transaction = vi.fn((fn) =>
      realTransaction((tx) => {
        tx.upsellEvent.create = vi.fn().mockRejectedValue(new Error('upsell write failed'))
        return fn(tx)
      })
    )
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(500)

    const event = await prisma.event.findUnique({ where: { id: 'event-1' } })
    expect(event.billingTier).toBe('free')
    expect(event.stripeCheckoutSessionId).toBeNull()

    expect(prisma.upsellEvent._rows).toHaveLength(0)

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('FAILED')

    expect(markStripeWebhookEventFailed).toHaveBeenCalledTimes(1)
    expect(markStripeWebhookEventProcessed).not.toHaveBeenCalled()
  })

  it('D: rolls back Event and UpsellEvent writes when markProcessed hits fencing', async () => {
    const stripeEventId = 'evt_pe_fencing'
    const session = buildSession({ intent: 'pro_event', eventId: 'event-1', sessionId: 'cs_pe_3' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    // This worker believes it holds attempt=1...
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      event: [{ id: 'event-1', slug: 'event-slug', billingTier: 'free', stripeCheckoutSessionId: null }],
      // ...but the receipt already shows attempts=2: another worker
      // reclaimed this delivery's stale lease first.
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 2 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.code).toBe('webhook_processing_in_progress')

    const event = await prisma.event.findUnique({ where: { id: 'event-1' } })
    expect(event.billingTier).toBe('free')

    expect(prisma.upsellEvent._rows).toHaveLength(0)

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSING')
    expect(receipt.attempts).toBe(2)

    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
  })

  it('E: an Event.update P2025 stays a legitimate skip, never a finalized (tagged) receipt', async () => {
    const stripeEventId = 'evt_pe_p2025'
    const session = buildSession({ intent: 'pro_event', eventId: 'event-1', sessionId: 'cs_pe_4' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      event: [{ id: 'event-1', slug: 'event-slug', billingTier: 'free', stripeCheckoutSessionId: null }],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    const realTransaction = prisma.$transaction
    prisma.$transaction = vi.fn((fn) =>
      realTransaction((tx) => {
        tx.event.update = vi.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('Record to update not found.', { code: 'P2025', clientVersion: '6.9.0' })
        )
        return fn(tx)
      })
    )
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)

    expect(prisma.upsellEvent._rows).toHaveLength(0)

    // Finalized via the wrapper's standalone markProcessed on the legacy
    // 200 response, not via a tagged outcome from an uncommitted transaction.
    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSED')
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
  })

  it('F: an already-fulfilled Event (matching stripeCheckoutSessionId) skips the transaction', async () => {
    const stripeEventId = 'evt_pe_already'
    const session = buildSession({ intent: 'pro_event', eventId: 'event-1', sessionId: 'cs_pe_5' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      event: [{ id: 'event-1', slug: 'event-slug', billingTier: 'pro_event', stripeCheckoutSessionId: 'cs_pe_5' }],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.upsellEvent._rows).toHaveLength(0)

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSED')
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
  })

  it('G: billingTier already equal to the requested intent skips the transaction', async () => {
    const stripeEventId = 'evt_pe_already_tier'
    const session = buildSession({ intent: 'pro_event', eventId: 'event-1', sessionId: 'cs_pe_6' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      event: [{ id: 'event-1', slug: 'event-slug', billingTier: 'pro_event', stripeCheckoutSessionId: 'cs_pe_old' }],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)
    expect(prisma.$transaction).not.toHaveBeenCalled()

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSED')
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
  })

  it('H: a pro_event purchase on an Event already at wedding_pro is not a downgrade — skips the transaction', async () => {
    const stripeEventId = 'evt_pe_no_downgrade'
    const session = buildSession({ intent: 'pro_event', eventId: 'event-1', sessionId: 'cs_pe_7' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      event: [{ id: 'event-1', slug: 'event-slug', billingTier: 'wedding_pro', stripeCheckoutSessionId: 'cs_pe_old' }],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)
    expect(prisma.$transaction).not.toHaveBeenCalled()

    const event = await prisma.event.findUnique({ where: { id: 'event-1' } })
    expect(event.billingTier).toBe('wedding_pro')

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSED')
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
  })

  it('I: the purchase email fires only after the transaction has committed', async () => {
    const stripeEventId = 'evt_pe_email_order'
    const session = buildSession({ intent: 'pro_event', eventId: 'event-1', sessionId: 'cs_pe_8' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      event: [{ id: 'event-1', slug: 'event-slug', billingTier: 'free', stripeCheckoutSessionId: null }],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    let committedStateWhenEmailed = null
    sendProEventPurchasedEmail.mockImplementation(async ({ event }) => {
      const eventRow = await prisma.event.findUnique({ where: { id: event.id } })
      const receiptRow = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
      committedStateWhenEmailed = {
        billingTier: eventRow?.billingTier,
        upsellCount: prisma.upsellEvent._rows.length,
        receiptStatus: receiptRow?.status,
      }
    })

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(200)
    expect(sendProEventPurchasedEmail).toHaveBeenCalledTimes(1)
    expect(committedStateWhenEmailed).toEqual({
      billingTier: 'pro_event',
      upsellCount: 1,
      receiptStatus: 'PROCESSED',
    })
  })

  it('J: trackServerEvent (PostHog) fires only after the transaction has committed', async () => {
    const stripeEventId = 'evt_pe_posthog_order'
    const session = buildSession({ intent: 'wedding_pro', eventId: 'event-1', sessionId: 'cs_pe_9' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      event: [{ id: 'event-1', slug: 'event-slug', billingTier: 'free', stripeCheckoutSessionId: null }],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    let committedStateWhenTracked = null
    // Synchronous on purpose — matches the real trackServerEvent's own
    // synchronous, fire-and-forget nature.
    trackServerEvent.mockImplementation(() => {
      if (committedStateWhenTracked === null) {
        const eventRow = prisma.event._rows.find((r) => r.id === 'event-1')
        const receiptRow = prisma.stripeWebhookEvent._rows.find((r) => r.eventId === stripeEventId)
        committedStateWhenTracked = {
          billingTier: eventRow?.billingTier,
          upsellCount: prisma.upsellEvent._rows.length,
          receiptStatus: receiptRow?.status,
        }
      }
    })

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(200)
    expect(trackServerEvent).toHaveBeenCalled()
    expect(committedStateWhenTracked).toEqual({
      billingTier: 'wedding_pro',
      upsellCount: 1,
      receiptStatus: 'PROCESSED',
    })
  })

  it('K: markStripeWebhookEventProcessed runs exactly once, from inside the transaction', async () => {
    const stripeEventId = 'evt_pe_no_double_finalize'
    const session = buildSession({ intent: 'pro_event', eventId: 'event-1', sessionId: 'cs_pe_10' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      event: [{ id: 'event-1', slug: 'event-slug', billingTier: 'free', stripeCheckoutSessionId: null }],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(200)
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: stripeEventId, attempt: 1 })
    )
    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
  })
})
