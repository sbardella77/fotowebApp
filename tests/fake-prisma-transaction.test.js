import { describe, it, expect } from 'vitest'
import { createFakeTransactionalPrisma } from './helpers/fake-prisma.js'
import { markStripeWebhookEventProcessed, StripeWebhookFencingError } from '../lib/server/stripe-webhook-receipt.js'

function seedReceipt({ eventId, status, attempts }) {
  return {
    id: `swe-seed-${eventId}`,
    eventId,
    eventType: 'checkout.session.completed',
    status,
    attempts,
    lastError: null,
    receivedAt: new Date(),
    processingStartedAt: new Date(),
    processedAt: null,
    updatedAt: new Date(),
  }
}

describe('fake-prisma $transaction commit/rollback semantics', () => {
  it('A: a successful transaction commits its write to the root store', async () => {
    const prisma = createFakeTransactionalPrisma({ owner: [{ id: 'owner-1', plan: 'free' }] })

    await prisma.$transaction(async (tx) => {
      await tx.owner.update({ where: { id: 'owner-1' }, data: { plan: 'professional' } })
    })

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.plan).toBe('professional')
  })

  it('B: a thrown error rolls back the transaction, root is untouched', async () => {
    const prisma = createFakeTransactionalPrisma({ owner: [{ id: 'owner-1', plan: 'free' }] })

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.owner.update({ where: { id: 'owner-1' }, data: { plan: 'professional' } })
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.plan).toBe('free')
  })

  it('C: a throw after multiple writes rolls back all of them together', async () => {
    const eventId = 'evt_multi_rollback'
    const prisma = createFakeTransactionalPrisma({
      owner: [{ id: 'owner-1', plan: 'free' }],
      stripeWebhookEvent: [seedReceipt({ eventId, status: 'PROCESSING', attempts: 1 })],
    })

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.owner.update({ where: { id: 'owner-1' }, data: { plan: 'professional' } })
        await tx.upsellEvent.create({ data: { eventName: 'checkout_completed', ownerId: 'owner-1' } })
        await tx.stripeWebhookEvent.updateMany({
          where: { eventId, status: 'PROCESSING', attempts: 1 },
          data: { status: 'PROCESSED', processedAt: new Date(), lastError: null },
        })
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.plan).toBe('free')

    const upsell = await prisma.upsellEvent.findFirst({ where: { ownerId: 'owner-1' } })
    expect(upsell).toBeNull()

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId } })
    expect(receipt.status).toBe('PROCESSING')
    expect(receipt.attempts).toBe(1)
  })

  it('D: a successful transaction commits multiple writes together', async () => {
    const eventId = 'evt_multi_commit'
    const prisma = createFakeTransactionalPrisma({
      owner: [{ id: 'owner-1', plan: 'free' }],
      stripeWebhookEvent: [seedReceipt({ eventId, status: 'PROCESSING', attempts: 1 })],
    })

    await prisma.$transaction(async (tx) => {
      await tx.owner.update({ where: { id: 'owner-1' }, data: { plan: 'professional' } })
      await tx.upsellEvent.create({ data: { eventName: 'checkout_completed', ownerId: 'owner-1' } })
      await tx.stripeWebhookEvent.updateMany({
        where: { eventId, status: 'PROCESSING', attempts: 1 },
        data: { status: 'PROCESSED', processedAt: new Date(), lastError: null },
      })
    })

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.plan).toBe('professional')

    const upsell = await prisma.upsellEvent.findFirst({ where: { ownerId: 'owner-1' } })
    expect(upsell).not.toBeNull()

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId } })
    expect(receipt.status).toBe('PROCESSED')
  })

  it('E: a fenced updateMany against a stale attempt returns count=0 and leaves the receipt untouched', async () => {
    const eventId = 'evt_fenced_raw'
    const prisma = createFakeTransactionalPrisma({
      stripeWebhookEvent: [seedReceipt({ eventId, status: 'PROCESSING', attempts: 2 })],
    })

    const result = await prisma.stripeWebhookEvent.updateMany({
      where: { eventId, status: 'PROCESSING', attempts: 1 },
      data: { status: 'PROCESSED', processedAt: new Date(), lastError: null },
    })

    expect(result.count).toBe(0)
    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId } })
    expect(receipt.status).toBe('PROCESSING')
    expect(receipt.attempts).toBe(2)
  })

  // The most important test of STEP 4.1: uses the REAL markStripeWebhookEventProcessed
  // (not a mock) inside a transaction, against a receipt that a "worker B" has
  // already reclaimed (attempts=2) while "worker A" (attempt=1) was still mid-flight.
  // Proves three things at once: the real receipt helper works unmodified against
  // this fake's tx client, its fencing check fires correctly, and the fake's
  // rollback actually discards A's business write, not just that the call threw.
  it('F: a fenced markStripeWebhookEventProcessed inside a transaction rolls back the whole transaction', async () => {
    const eventId = 'evt_fence_transaction'
    const prisma = createFakeTransactionalPrisma({
      owner: [{ id: 'owner-1', plan: 'free' }],
      // Simulates worker B having already reclaimed the stale lease and moved
      // the generation to attempts=2 before worker A (still holding attempt=1)
      // gets to finalize.
      stripeWebhookEvent: [seedReceipt({ eventId, status: 'PROCESSING', attempts: 2 })],
    })

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.owner.update({ where: { id: 'owner-1' }, data: { plan: 'professional' } })
        await markStripeWebhookEventProcessed({ prisma: tx, eventId, attempt: 1 })
      })
    ).rejects.toBeInstanceOf(StripeWebhookFencingError)

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.plan).toBe('free')

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId } })
    expect(receipt.status).toBe('PROCESSING')
    expect(receipt.attempts).toBe(2)
  })

  it('a transaction sees its own writes immediately; the root does not see them until commit', async () => {
    const prisma = createFakeTransactionalPrisma({ owner: [{ id: 'owner-1', plan: 'free' }] })

    let sawInsideTx = null
    await prisma.$transaction(async (tx) => {
      await tx.owner.update({ where: { id: 'owner-1' }, data: { plan: 'professional' } })
      sawInsideTx = await tx.owner.findUnique({ where: { id: 'owner-1' } })

      const rootDuringTx = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
      expect(rootDuringTx.plan).toBe('free')
    })

    expect(sawInsideTx.plan).toBe('professional')
    const rootAfter = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(rootAfter.plan).toBe('professional')
  })
})
