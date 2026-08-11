export const STRIPE_WEBHOOK_PROCESSING_LEASE_MS = 90_000

const MAX_LAST_ERROR_LENGTH = 2000
const MAX_CLAIM_RETRIES = 10

export const StripeWebhookClaimAction = Object.freeze({
  PROCESS: 'PROCESS',
  ALREADY_PROCESSED: 'ALREADY_PROCESSED',
  IN_PROGRESS: 'IN_PROGRESS',
})

// Sentinel returned internally when a conditional updateMany lost a race and
// the caller must re-read the receipt and re-evaluate the state machine.
const RETRY = Symbol('stripe-webhook-receipt/retry')

// Thrown by markStripeWebhookEventProcessed/Failed when the caller's `attempt`
// fencing token no longer matches the row's current generation — i.e. a
// worker whose claim was reclaimed as stale is trying to finalize a
// processing run it no longer owns.
export class StripeWebhookFencingError extends Error {
  constructor(message) {
    super(message)
    this.name = 'StripeWebhookFencingError'
  }
}

function assertPrismaDelegate(prisma) {
  if (!prisma || typeof prisma !== 'object') {
    throw new Error('stripe-webhook-receipt: prisma client is required')
  }
  if (!prisma.stripeWebhookEvent || typeof prisma.stripeWebhookEvent.findUnique !== 'function') {
    throw new Error('stripe-webhook-receipt: prisma.stripeWebhookEvent delegate is required')
  }
}

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`stripe-webhook-receipt: ${name} must be a non-empty string`)
  }
}

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`stripe-webhook-receipt: ${name} must be a positive integer`)
  }
}

function isUniqueConstraintError(error) {
  return Boolean(error) && error.code === 'P2002'
}

function sanitizeLastError(error) {
  if (error === null || error === undefined) return null
  const message = typeof error === 'string' ? error : (error.message || String(error))
  return message.length > MAX_LAST_ERROR_LENGTH ? message.slice(0, MAX_LAST_ERROR_LENGTH) : message
}

async function getOrCreateReceipt(prisma, eventId, eventType, now) {
  const existing = await prisma.stripeWebhookEvent.findUnique({ where: { eventId } })
  if (existing) return existing

  try {
    return await prisma.stripeWebhookEvent.create({
      data: { eventId, eventType, status: 'PENDING', receivedAt: now },
    })
  } catch (error) {
    // Concurrent first-seen delivery: the other request's create() won the
    // unique constraint race. Re-read and let the state machine take over.
    if (!isUniqueConstraintError(error)) throw error
  }

  const afterRace = await prisma.stripeWebhookEvent.findUnique({ where: { eventId } })
  if (!afterRace) {
    throw new Error(`stripe-webhook-receipt: create race for eventId=${eventId} left no receipt behind`)
  }
  return afterRace
}

async function atomicClaim(prisma, where, now) {
  const result = await prisma.stripeWebhookEvent.updateMany({
    where,
    data: {
      status: 'PROCESSING',
      processingStartedAt: now,
      attempts: { increment: 1 },
    },
  })

  if (result.count !== 1) return RETRY

  const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: where.eventId } })
  return { action: StripeWebhookClaimAction.PROCESS, receipt }
}

async function tryClaim(prisma, receipt, now) {
  switch (receipt.status) {
    case 'PROCESSED':
      return { action: StripeWebhookClaimAction.ALREADY_PROCESSED, receipt }

    case 'PENDING':
      return atomicClaim(prisma, { eventId: receipt.eventId, status: 'PENDING' }, now)

    case 'FAILED':
      return atomicClaim(prisma, { eventId: receipt.eventId, status: 'FAILED' }, now)

    case 'PROCESSING': {
      const staleCutoff = new Date(now.getTime() - STRIPE_WEBHOOK_PROCESSING_LEASE_MS)
      const isStale = receipt.processingStartedAt != null && receipt.processingStartedAt.getTime() <= staleCutoff.getTime()
      if (!isStale) {
        return { action: StripeWebhookClaimAction.IN_PROGRESS, receipt }
      }
      // Guard the reclaim on the stale processingStartedAt we just read so
      // two concurrent reclaimers can't both win the same lease.
      return atomicClaim(
        prisma,
        { eventId: receipt.eventId, status: 'PROCESSING', processingStartedAt: { lte: staleCutoff } },
        now
      )
    }

    default:
      throw new Error(`stripe-webhook-receipt: unexpected status "${receipt.status}" for eventId=${receipt.eventId}`)
  }
}

export async function claimStripeWebhookEvent({ prisma, eventId, eventType, now = new Date() }) {
  assertPrismaDelegate(prisma)
  assertNonEmptyString(eventId, 'eventId')
  assertNonEmptyString(eventType, 'eventType')

  for (let iteration = 0; iteration < MAX_CLAIM_RETRIES; iteration++) {
    const receipt = await getOrCreateReceipt(prisma, eventId, eventType, now)
    const outcome = await tryClaim(prisma, receipt, now)
    if (outcome !== RETRY) return outcome
  }

  throw new Error(`stripe-webhook-receipt: exceeded ${MAX_CLAIM_RETRIES} claim retries for eventId=${eventId}`)
}

export async function markStripeWebhookEventProcessed({ prisma, eventId, attempt, now = new Date() }) {
  assertPrismaDelegate(prisma)
  assertNonEmptyString(eventId, 'eventId')
  assertPositiveInteger(attempt, 'attempt')

  // `attempts` is the fencing token: only the worker whose claim produced
  // this exact generation may finalize it. A worker whose claim was later
  // reclaimed as stale will fail this compare-and-swap instead of clobbering
  // the newer owner's in-flight (or already-finalized) work.
  const result = await prisma.stripeWebhookEvent.updateMany({
    where: { eventId, status: 'PROCESSING', attempts: attempt },
    data: { status: 'PROCESSED', processedAt: now, lastError: null },
  })

  if (result.count !== 1) {
    throw new StripeWebhookFencingError(
      `stripe-webhook-receipt: markStripeWebhookEventProcessed rejected for eventId=${eventId} attempt=${attempt} — stale or invalid processing claim (matched ${result.count})`
    )
  }

  return prisma.stripeWebhookEvent.findUnique({ where: { eventId } })
}

export async function markStripeWebhookEventFailed({ prisma, eventId, attempt, error, now = new Date() }) {
  assertPrismaDelegate(prisma)
  assertNonEmptyString(eventId, 'eventId')
  assertPositiveInteger(attempt, 'attempt')

  const result = await prisma.stripeWebhookEvent.updateMany({
    where: { eventId, status: 'PROCESSING', attempts: attempt },
    data: { status: 'FAILED', lastError: sanitizeLastError(error) },
  })

  if (result.count !== 1) {
    throw new StripeWebhookFencingError(
      `stripe-webhook-receipt: markStripeWebhookEventFailed rejected for eventId=${eventId} attempt=${attempt} — stale or invalid processing claim (matched ${result.count})`
    )
  }

  return prisma.stripeWebhookEvent.findUnique({ where: { eventId } })
}
