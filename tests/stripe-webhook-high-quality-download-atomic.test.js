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
// the atomic high_quality_download branch does with a *given* claimed
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
  return { id: id || `evt_hqd_atomic_${eventIdSeq}`, type, data: { object } }
}

function buildSession({ eventId, sessionId = 'cs_hqd_test' } = {}) {
  return {
    id: sessionId,
    customer: 'cus_test',
    customer_email: 'guest@example.com',
    metadata: {
      intent: 'high_quality_download',
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

describe('STEP 4.5: atomic finalization for checkout.session.completed / high_quality_download', () => {
  it('A: success — Event unlock, UpsellEvent, and receipt PROCESSED all commit together', async () => {
    const stripeEventId = 'evt_hqd_success'
    const session = buildSession({ eventId: 'event-1', sessionId: 'cs_hqd_1' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      event: [{ id: 'event-1', slug: 'event-slug', originalDownloadUnlocked: false, originalDownloadCheckoutSessionId: null }],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)

    const event = await prisma.event.findUnique({ where: { id: 'event-1' } })
    expect(event.originalDownloadUnlocked).toBe(true)
    expect(event.originalDownloadCheckoutSessionId).toBe('cs_hqd_1')

    expect(prisma.upsellEvent._rows).toHaveLength(1)

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSED')
    expect(receipt.attempts).toBe(1)

    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
  })

  it('B: an UpsellEvent write failure rolls back the Event unlock too — no partial fulfillment', async () => {
    const stripeEventId = 'evt_hqd_upsell_fail'
    const session = buildSession({ eventId: 'event-1', sessionId: 'cs_hqd_2' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      event: [{ id: 'event-1', slug: 'event-slug', originalDownloadUnlocked: false, originalDownloadCheckoutSessionId: null }],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    // Inject a failure into the UpsellEvent write the handler performs
    // inside its own transaction — the fake-prisma tx client is rebuilt
    // fresh per $transaction call, so this wraps the real one to intercept it.
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
    expect(event.originalDownloadUnlocked).toBe(false)
    expect(event.originalDownloadCheckoutSessionId).toBeNull()

    expect(prisma.upsellEvent._rows).toHaveLength(0)

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('FAILED')

    expect(markStripeWebhookEventFailed).toHaveBeenCalledTimes(1)
    expect(markStripeWebhookEventProcessed).not.toHaveBeenCalled()
  })

  it('C: rolls back Event and UpsellEvent writes when markProcessed hits fencing', async () => {
    const stripeEventId = 'evt_hqd_fencing'
    const session = buildSession({ eventId: 'event-1', sessionId: 'cs_hqd_3' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    // This worker believes it holds attempt=1...
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      event: [{ id: 'event-1', slug: 'event-slug', originalDownloadUnlocked: false, originalDownloadCheckoutSessionId: null }],
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
    expect(event.originalDownloadUnlocked).toBe(false)

    expect(prisma.upsellEvent._rows).toHaveLength(0)

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSING')
    expect(receipt.attempts).toBe(2)

    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
  })

  it('D: an Event.update P2025 stays a legitimate skip, never a finalized (tagged) receipt', async () => {
    const stripeEventId = 'evt_hqd_p2025'
    const session = buildSession({ eventId: 'event-1', sessionId: 'cs_hqd_4' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      event: [{ id: 'event-1', slug: 'event-slug', originalDownloadUnlocked: false, originalDownloadCheckoutSessionId: null }],
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

  it('E: an already-fulfilled Event skips the transaction — standalone finalization only', async () => {
    const stripeEventId = 'evt_hqd_already'
    const session = buildSession({ eventId: 'event-1', sessionId: 'cs_hqd_5' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      event: [{ id: 'event-1', slug: 'event-slug', originalDownloadUnlocked: true, originalDownloadCheckoutSessionId: 'cs_hqd_5' }],
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

  it('F: a missing metadata eventId skips the transaction — standalone finalization only', async () => {
    const stripeEventId = 'evt_hqd_no_metadata'
    const session = buildSession({ sessionId: 'cs_hqd_6' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
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

  it('G: trackServerEvent fires only after the transaction has committed', async () => {
    const stripeEventId = 'evt_hqd_side_effect_order'
    const session = buildSession({ eventId: 'event-1', sessionId: 'cs_hqd_7' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      event: [{ id: 'event-1', slug: 'event-slug', originalDownloadUnlocked: false, originalDownloadCheckoutSessionId: null }],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    let committedStateWhenTracked = null
    // Synchronous on purpose — matches the real trackServerEvent's own
    // synchronous, fire-and-forget nature, and avoids any ambiguity about
    // whether an async spy would still be pending by the time POST resolves.
    trackServerEvent.mockImplementation(() => {
      if (committedStateWhenTracked === null) {
        const eventRow = prisma.event._rows.find((r) => r.id === 'event-1')
        const receiptRow = prisma.stripeWebhookEvent._rows.find((r) => r.eventId === stripeEventId)
        committedStateWhenTracked = {
          eventUnlocked: eventRow?.originalDownloadUnlocked,
          upsellCount: prisma.upsellEvent._rows.length,
          receiptStatus: receiptRow?.status,
        }
      }
    })

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(200)
    expect(trackServerEvent).toHaveBeenCalled()
    expect(committedStateWhenTracked).toEqual({
      eventUnlocked: true,
      upsellCount: 1,
      receiptStatus: 'PROCESSED',
    })
  })

  it('H: markStripeWebhookEventProcessed runs exactly once, from inside the transaction', async () => {
    const stripeEventId = 'evt_hqd_no_double_finalize'
    const session = buildSession({ eventId: 'event-1', sessionId: 'cs_hqd_8' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      event: [{ id: 'event-1', slug: 'event-slug', originalDownloadUnlocked: false, originalDownloadCheckoutSessionId: null }],
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
