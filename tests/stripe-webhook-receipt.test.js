import { describe, it, expect } from 'vitest'
import { vi } from 'vitest'
import {
  STRIPE_WEBHOOK_PROCESSING_LEASE_MS,
  StripeWebhookClaimAction,
  StripeWebhookFencingError,
  claimStripeWebhookEvent,
  markStripeWebhookEventProcessed,
  markStripeWebhookEventFailed,
} from '../lib/server/stripe-webhook-receipt.js'

// ─── Time fixtures ──────────────────────────────────────────────────────────

const NOW = new Date('2026-08-11T10:00:00.000Z')
const STALE_PROCESSING_STARTED_AT = new Date(NOW.getTime() - STRIPE_WEBHOOK_PROCESSING_LEASE_MS - 1000)
const FRESH_PROCESSING_STARTED_AT = new Date(NOW.getTime() - STRIPE_WEBHOOK_PROCESSING_LEASE_MS + 1000)

// ─── Fake Prisma ─────────────────────────────────────────────────────────────
// No method awaits internally, so each call runs to completion atomically
// within its own microtask turn — the same guarantee a single Postgres
// UPDATE/INSERT statement gives us, which is what makes the concurrency
// tests below meaningful rather than trivially sequential.

function matchesWhere(r, where) {
  if (where.eventId !== undefined && r.eventId !== where.eventId) return false
  if (where.status !== undefined && r.status !== where.status) return false
  if (where.attempts !== undefined && r.attempts !== where.attempts) return false
  if (where.processingStartedAt !== undefined) {
    const cond = where.processingStartedAt
    if (cond && typeof cond === 'object' && 'lte' in cond) {
      if (!(r.processingStartedAt instanceof Date)) return false
      if (r.processingStartedAt.getTime() > cond.lte.getTime()) return false
    }
  }
  return true
}

function applyData(r, data) {
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && typeof value === 'object' && !(value instanceof Date) && 'increment' in value) {
      r[key] = (r[key] || 0) + value.increment
    } else {
      r[key] = value
    }
  }
}

function makeFakePrisma() {
  const records = []
  let seq = 0

  const stripeWebhookEvent = {
    findUnique: vi.fn(async ({ where }) => {
      const found = records.find((r) => r.eventId === where.eventId)
      return found ? { ...found } : null
    }),
    create: vi.fn(async ({ data }) => {
      if (records.some((r) => r.eventId === data.eventId)) {
        const err = new Error('Unique constraint failed on the fields: (`eventId`)')
        err.code = 'P2002'
        err.meta = { target: ['eventId'] }
        throw err
      }
      seq += 1
      const row = {
        id: `swe-${seq}`,
        eventId: data.eventId,
        eventType: data.eventType,
        status: data.status ?? 'PENDING',
        attempts: data.attempts ?? 0,
        lastError: data.lastError ?? null,
        receivedAt: data.receivedAt ?? new Date(),
        processingStartedAt: data.processingStartedAt ?? null,
        processedAt: data.processedAt ?? null,
        updatedAt: new Date(),
      }
      records.push(row)
      return { ...row }
    }),
    updateMany: vi.fn(async ({ where, data }) => {
      let count = 0
      for (const r of records) {
        if (!matchesWhere(r, where)) continue
        applyData(r, data)
        r.updatedAt = new Date()
        count += 1
      }
      return { count }
    }),
    _records: records,
  }

  return { stripeWebhookEvent }
}

function seedReceipt(prisma, overrides = {}) {
  const row = {
    id: `swe-seed-${prisma.stripeWebhookEvent._records.length + 1}`,
    eventId: 'evt_seed',
    eventType: 'checkout.session.completed',
    status: 'PENDING',
    attempts: 0,
    lastError: null,
    receivedAt: NOW,
    processingStartedAt: null,
    processedAt: null,
    updatedAt: NOW,
    ...overrides,
  }
  prisma.stripeWebhookEvent._records.push(row)
  return row
}

// ─── A-H: sequential state transitions ──────────────────────────────────────

describe('claimStripeWebhookEvent state machine', () => {
  it('A: first claim of a brand-new event returns PROCESS, sets PROCESSING, attempts=1', async () => {
    const prisma = makeFakePrisma()
    const result = await claimStripeWebhookEvent({ prisma, eventId: 'evt_a', eventType: 'checkout.session.completed', now: NOW })

    expect(result.action).toBe(StripeWebhookClaimAction.PROCESS)
    expect(result.receipt.status).toBe('PROCESSING')
    expect(result.receipt.attempts).toBe(1)
    expect(result.receipt.processingStartedAt.getTime()).toBe(NOW.getTime())
  })

  it('B: a second claim while non-stale returns IN_PROGRESS and leaves attempts untouched', async () => {
    const prisma = makeFakePrisma()
    await claimStripeWebhookEvent({ prisma, eventId: 'evt_b', eventType: 'x', now: NOW })

    const second = await claimStripeWebhookEvent({ prisma, eventId: 'evt_b', eventType: 'x', now: new Date(NOW.getTime() + 1000) })

    expect(second.action).toBe(StripeWebhookClaimAction.IN_PROGRESS)
    expect(second.receipt.attempts).toBe(1)
  })

  it('C: markStripeWebhookEventProcessed transitions PROCESSING -> PROCESSED', async () => {
    const prisma = makeFakePrisma()
    const claimed = await claimStripeWebhookEvent({ prisma, eventId: 'evt_c', eventType: 'x', now: NOW })

    const receipt = await markStripeWebhookEventProcessed({ prisma, eventId: 'evt_c', attempt: claimed.receipt.attempts, now: NOW })

    expect(receipt.status).toBe('PROCESSED')
    expect(receipt.processedAt.getTime()).toBe(NOW.getTime())
    expect(receipt.lastError).toBeNull()
  })

  it('D: claiming an already-PROCESSED event returns ALREADY_PROCESSED without touching attempts', async () => {
    const prisma = makeFakePrisma()
    const claimed = await claimStripeWebhookEvent({ prisma, eventId: 'evt_d', eventType: 'x', now: NOW })
    await markStripeWebhookEventProcessed({ prisma, eventId: 'evt_d', attempt: claimed.receipt.attempts, now: NOW })

    const result = await claimStripeWebhookEvent({ prisma, eventId: 'evt_d', eventType: 'x', now: NOW })

    expect(result.action).toBe(StripeWebhookClaimAction.ALREADY_PROCESSED)
    expect(result.receipt.attempts).toBe(1)
  })

  it('E: markStripeWebhookEventFailed transitions PROCESSING -> FAILED and stores lastError', async () => {
    const prisma = makeFakePrisma()
    const claimed = await claimStripeWebhookEvent({ prisma, eventId: 'evt_e', eventType: 'x', now: NOW })

    const receipt = await markStripeWebhookEventFailed({ prisma, eventId: 'evt_e', attempt: claimed.receipt.attempts, error: new Error('boom'), now: NOW })

    expect(receipt.status).toBe('FAILED')
    expect(receipt.lastError).toBe('boom')
    expect(receipt.processedAt).toBeNull()
  })

  it('F: claiming a FAILED event reclaims it, returns PROCESS, and increments attempts', async () => {
    const prisma = makeFakePrisma()
    const firstClaim = await claimStripeWebhookEvent({ prisma, eventId: 'evt_f', eventType: 'x', now: NOW })
    await markStripeWebhookEventFailed({ prisma, eventId: 'evt_f', attempt: firstClaim.receipt.attempts, error: 'oops', now: NOW })

    const retryTime = new Date(NOW.getTime() + 5000)
    const result = await claimStripeWebhookEvent({ prisma, eventId: 'evt_f', eventType: 'x', now: retryTime })

    expect(result.action).toBe(StripeWebhookClaimAction.PROCESS)
    expect(result.receipt.status).toBe('PROCESSING')
    expect(result.receipt.attempts).toBe(2)
    expect(result.receipt.processingStartedAt.getTime()).toBe(retryTime.getTime())
  })

  it('G: a stale PROCESSING event is reclaimed, returns PROCESS, and increments attempts', async () => {
    const prisma = makeFakePrisma()
    seedReceipt(prisma, {
      eventId: 'evt_g',
      status: 'PROCESSING',
      attempts: 1,
      processingStartedAt: STALE_PROCESSING_STARTED_AT,
    })

    const result = await claimStripeWebhookEvent({ prisma, eventId: 'evt_g', eventType: 'x', now: NOW })

    expect(result.action).toBe(StripeWebhookClaimAction.PROCESS)
    expect(result.receipt.attempts).toBe(2)
    expect(result.receipt.processingStartedAt.getTime()).toBe(NOW.getTime())
  })

  it('H: a non-stale PROCESSING event returns IN_PROGRESS without incrementing attempts', async () => {
    const prisma = makeFakePrisma()
    seedReceipt(prisma, {
      eventId: 'evt_h',
      status: 'PROCESSING',
      attempts: 1,
      processingStartedAt: FRESH_PROCESSING_STARTED_AT,
    })

    const result = await claimStripeWebhookEvent({ prisma, eventId: 'evt_h', eventType: 'x', now: NOW })

    expect(result.action).toBe(StripeWebhookClaimAction.IN_PROGRESS)
    expect(result.receipt.attempts).toBe(1)
  })
})

// ─── I-K: concurrency ────────────────────────────────────────────────────────

describe('claimStripeWebhookEvent concurrency', () => {
  it('I: two concurrent first claims yield exactly one PROCESS, the other IN_PROGRESS, attempts settles at 1', async () => {
    const prisma = makeFakePrisma()

    const [a, b] = await Promise.all([
      claimStripeWebhookEvent({ prisma, eventId: 'evt_i', eventType: 'x', now: NOW }),
      claimStripeWebhookEvent({ prisma, eventId: 'evt_i', eventType: 'x', now: NOW }),
    ])

    const actions = [a.action, b.action].sort()
    expect(actions).toEqual([StripeWebhookClaimAction.IN_PROGRESS, StripeWebhookClaimAction.PROCESS].sort())

    const final = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: 'evt_i' } })
    expect(final.attempts).toBe(1)
    expect(final.status).toBe('PROCESSING')
    expect(prisma.stripeWebhookEvent._records.filter((r) => r.eventId === 'evt_i')).toHaveLength(1)
  })

  it('J: two concurrent reclaims of the same stale PROCESSING event yield exactly one PROCESS', async () => {
    const prisma = makeFakePrisma()
    seedReceipt(prisma, {
      eventId: 'evt_j',
      status: 'PROCESSING',
      attempts: 1,
      processingStartedAt: STALE_PROCESSING_STARTED_AT,
    })

    const [a, b] = await Promise.all([
      claimStripeWebhookEvent({ prisma, eventId: 'evt_j', eventType: 'x', now: NOW }),
      claimStripeWebhookEvent({ prisma, eventId: 'evt_j', eventType: 'x', now: NOW }),
    ])

    const actions = [a.action, b.action].sort()
    expect(actions).toEqual([StripeWebhookClaimAction.IN_PROGRESS, StripeWebhookClaimAction.PROCESS].sort())

    const final = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: 'evt_j' } })
    expect(final.attempts).toBe(2)
  })

  it('K: a concurrent create() race is absorbed as P2002, not surfaced as an error, and leaves one row', async () => {
    const prisma = makeFakePrisma()

    const results = await Promise.allSettled([
      claimStripeWebhookEvent({ prisma, eventId: 'evt_k', eventType: 'x', now: NOW }),
      claimStripeWebhookEvent({ prisma, eventId: 'evt_k', eventType: 'x', now: NOW }),
    ])

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
    expect(prisma.stripeWebhookEvent.create).toHaveBeenCalledTimes(2)
    expect(prisma.stripeWebhookEvent._records.filter((r) => r.eventId === 'evt_k')).toHaveLength(1)
  })
})

// ─── L-P: guards, isolation, sanitization, validation ───────────────────────

describe('stripe-webhook-receipt guards', () => {
  it('L: markStripeWebhookEventProcessed on a non-PROCESSING receipt throws', async () => {
    const prisma = makeFakePrisma()
    seedReceipt(prisma, { eventId: 'evt_l', status: 'PENDING' })

    await expect(markStripeWebhookEventProcessed({ prisma, eventId: 'evt_l', attempt: 1, now: NOW })).rejects.toThrow()
    await expect(markStripeWebhookEventProcessed({ prisma, eventId: 'evt_missing', attempt: 1, now: NOW })).rejects.toThrow()
  })

  it('M: markStripeWebhookEventFailed on a non-PROCESSING receipt throws', async () => {
    const prisma = makeFakePrisma()
    seedReceipt(prisma, { eventId: 'evt_m', status: 'FAILED' })

    await expect(markStripeWebhookEventFailed({ prisma, eventId: 'evt_m', attempt: 1, error: 'x', now: NOW })).rejects.toThrow()
  })

  it('N: distinct eventIds are claimed and mutated independently', async () => {
    const prisma = makeFakePrisma()
    const a = await claimStripeWebhookEvent({ prisma, eventId: 'evt_n1', eventType: 'x', now: NOW })
    const b = await claimStripeWebhookEvent({ prisma, eventId: 'evt_n2', eventType: 'x', now: NOW })

    expect(a.action).toBe(StripeWebhookClaimAction.PROCESS)
    expect(b.action).toBe(StripeWebhookClaimAction.PROCESS)
    expect(a.receipt.id).not.toBe(b.receipt.id)

    await markStripeWebhookEventFailed({ prisma, eventId: 'evt_n1', attempt: a.receipt.attempts, error: 'x', now: NOW })

    const n2 = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: 'evt_n2' } })
    expect(n2.status).toBe('PROCESSING')
  })

  it('O: an overlong error message is truncated to 2000 characters', async () => {
    const prisma = makeFakePrisma()
    const claimed = await claimStripeWebhookEvent({ prisma, eventId: 'evt_o', eventType: 'x', now: NOW })

    const longMessage = 'x'.repeat(3000)
    const receipt = await markStripeWebhookEventFailed({ prisma, eventId: 'evt_o', attempt: claimed.receipt.attempts, error: longMessage, now: NOW })

    expect(receipt.lastError).toHaveLength(2000)
  })

  it('P: invalid inputs throw a clear error instead of a NextResponse or silent failure', async () => {
    const prisma = makeFakePrisma()

    await expect(claimStripeWebhookEvent({ prisma: null, eventId: 'x', eventType: 'y', now: NOW })).rejects.toThrow(/prisma client is required/)
    await expect(claimStripeWebhookEvent({ prisma: {}, eventId: 'x', eventType: 'y', now: NOW })).rejects.toThrow(/stripeWebhookEvent delegate is required/)
    await expect(claimStripeWebhookEvent({ prisma, eventId: '', eventType: 'y', now: NOW })).rejects.toThrow(/eventId/)
    await expect(claimStripeWebhookEvent({ prisma, eventId: 'x', eventType: '', now: NOW })).rejects.toThrow(/eventType/)
    await expect(markStripeWebhookEventProcessed({ prisma, eventId: '', attempt: 1, now: NOW })).rejects.toThrow(/eventId/)
    await expect(markStripeWebhookEventFailed({ prisma, eventId: '', attempt: 1, error: 'x', now: NOW })).rejects.toThrow(/eventId/)
  })
})

// ─── Attempt fencing: a stale worker must not be able to finalize a ────────
// ─── generation it no longer owns after another worker reclaimed it ────────

async function setupStaleTakeover(prisma, eventId) {
  const A = await claimStripeWebhookEvent({ prisma, eventId, eventType: 'x', now: NOW })
  const staleNow = new Date(NOW.getTime() + STRIPE_WEBHOOK_PROCESSING_LEASE_MS + 1000)
  const B = await claimStripeWebhookEvent({ prisma, eventId, eventType: 'x', now: staleNow })
  return { A, B, staleNow }
}

describe('attempt fencing (stale worker cannot finalize a reclaimed generation)', () => {
  it('1: a stale worker cannot mark the newer generation as processed', async () => {
    const prisma = makeFakePrisma()
    const { A, B, staleNow } = await setupStaleTakeover(prisma, 'evt_x1')
    expect(A.receipt.attempts).toBe(1)
    expect(B.action).toBe(StripeWebhookClaimAction.PROCESS)
    expect(B.receipt.attempts).toBe(2)

    // A resumes after the lease expired and tries to finalize with its stale token.
    await expect(
      markStripeWebhookEventProcessed({ prisma, eventId: 'evt_x1', attempt: A.receipt.attempts, now: staleNow })
    ).rejects.toThrow(StripeWebhookFencingError)

    const stateAfterRejectedA = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: 'evt_x1' } })
    expect(stateAfterRejectedA.status).toBe('PROCESSING')
    expect(stateAfterRejectedA.attempts).toBe(2)

    // B, the current owner, finalizes normally with the correct token.
    const processed = await markStripeWebhookEventProcessed({ prisma, eventId: 'evt_x1', attempt: B.receipt.attempts, now: staleNow })
    expect(processed.status).toBe('PROCESSED')
  })

  it('2: a stale worker cannot mark the newer generation as failed', async () => {
    const prisma = makeFakePrisma()
    const { A, staleNow } = await setupStaleTakeover(prisma, 'evt_x2')

    await expect(
      markStripeWebhookEventFailed({ prisma, eventId: 'evt_x2', attempt: A.receipt.attempts, error: 'stale worker error', now: staleNow })
    ).rejects.toThrow(StripeWebhookFencingError)

    const state = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: 'evt_x2' } })
    expect(state.status).toBe('PROCESSING')
    expect(state.attempts).toBe(2)
  })

  it('3: the current owner (post-reclaim) can mark its own generation as failed', async () => {
    const prisma = makeFakePrisma()
    const { B, staleNow } = await setupStaleTakeover(prisma, 'evt_x3')

    const result = await markStripeWebhookEventFailed({ prisma, eventId: 'evt_x3', attempt: B.receipt.attempts, error: 'real failure', now: staleNow })

    expect(result.status).toBe('FAILED')
    expect(result.attempts).toBe(2)
  })

  it('4: after a FAILED retry bumps the generation, the previous attempt can no longer finalize', async () => {
    const prisma = makeFakePrisma()
    const { B, staleNow } = await setupStaleTakeover(prisma, 'evt_retry')
    await markStripeWebhookEventFailed({ prisma, eventId: 'evt_retry', attempt: B.receipt.attempts, error: 'x', now: staleNow })

    const retryNow = new Date(staleNow.getTime() + 1000)
    const C = await claimStripeWebhookEvent({ prisma, eventId: 'evt_retry', eventType: 'x', now: retryNow })
    expect(C.action).toBe(StripeWebhookClaimAction.PROCESS)
    expect(C.receipt.attempts).toBe(3)

    await expect(
      markStripeWebhookEventProcessed({ prisma, eventId: 'evt_retry', attempt: B.receipt.attempts, now: retryNow })
    ).rejects.toThrow(StripeWebhookFencingError)
    await expect(
      markStripeWebhookEventFailed({ prisma, eventId: 'evt_retry', attempt: B.receipt.attempts, error: 'x', now: retryNow })
    ).rejects.toThrow(StripeWebhookFencingError)

    const final = await markStripeWebhookEventProcessed({ prisma, eventId: 'evt_retry', attempt: C.receipt.attempts, now: retryNow })
    expect(final.status).toBe('PROCESSED')
  })

  it('5: a first claim returns a receipt whose attempts is the fencing token 1', async () => {
    const prisma = makeFakePrisma()
    const result = await claimStripeWebhookEvent({ prisma, eventId: 'evt_5', eventType: 'x', now: NOW })

    expect(result.action).toBe(StripeWebhookClaimAction.PROCESS)
    expect(result.receipt.attempts).toBe(1)
  })

  it('6: a FAILED retry and a stale reclaim both return the freshly incremented attempt as the new fencing token', async () => {
    const prisma = makeFakePrisma()

    const firstClaim = await claimStripeWebhookEvent({ prisma, eventId: 'evt_6a', eventType: 'x', now: NOW })
    await markStripeWebhookEventFailed({ prisma, eventId: 'evt_6a', attempt: firstClaim.receipt.attempts, error: 'x', now: NOW })
    const retried = await claimStripeWebhookEvent({ prisma, eventId: 'evt_6a', eventType: 'x', now: NOW })
    expect(retried.receipt.attempts).toBe(2)

    seedReceipt(prisma, { eventId: 'evt_6b', status: 'PROCESSING', attempts: 5, processingStartedAt: STALE_PROCESSING_STARTED_AT })
    const reclaimed = await claimStripeWebhookEvent({ prisma, eventId: 'evt_6b', eventType: 'x', now: NOW })
    expect(reclaimed.action).toBe(StripeWebhookClaimAction.PROCESS)
    expect(reclaimed.receipt.attempts).toBe(6)
  })

  it('7: attempt fencing validation rejects missing, zero, negative, and non-integer values', async () => {
    const prisma = makeFakePrisma()
    const invalidAttempts = [undefined, 0, -1, 1.5, 'abc', null]

    for (const attempt of invalidAttempts) {
      await expect(markStripeWebhookEventProcessed({ prisma, eventId: 'evt_7', attempt, now: NOW })).rejects.toThrow(/attempt must be a positive integer/)
      await expect(markStripeWebhookEventFailed({ prisma, eventId: 'evt_7', attempt, error: 'x', now: NOW })).rejects.toThrow(/attempt must be a positive integer/)
    }
  })
})
