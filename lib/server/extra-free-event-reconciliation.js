/**
 * Extra Free Event checkout reconciliation — READ-ONLY diagnostic
 * classifier (BILLING PR 2A).
 *
 * This module has ZERO capability to mutate anything: no
 * ExtraFreeEventCheckout write, no credit grant, no Event creation, no
 * fulfillment invocation, no Stripe mutation, no webhook replay. It never
 * imports lib/server/extra-free-event-fulfillment.js or any other DB-write
 * helper. It exists purely to determine, and report in aggregate, what
 * Stripe's authoritative current state is for stale 'checkout_created' rows
 * — nothing here decides what (if anything) should be done about it.
 *
 * Allowed Stripe calls: stripe.checkout.sessions.retrieve(...) and,
 * conditionally, stripe.paymentIntents.retrieve(...). Nothing else.
 * Allowed Prisma calls: prisma.extraFreeEventCheckout.findMany(...). Nothing
 * else — no update/updateMany/create/upsert/delete/deleteMany/$executeRaw*.
 *
 * The returned result is aggregate-only: counts and safe age statistics.
 * No row id, Stripe session id, PaymentIntent id, ownerId, or any other
 * per-record identifier is ever included in the return value or logged.
 */

const DEFAULT_CANDIDATE_AGE_MS = 60 * 60 * 1000 // 1 hour — a query-efficiency/diagnostic gate only, never evidence of expiration.
const DEFAULT_LIMIT = 25

export const ReconciliationBucket = Object.freeze({
  OPEN_UNPAID: 'openUnpaid',
  EXPIRED_UNPAID: 'expiredUnpaid',
  COMPLETE_PAID_LOCAL_UNFULFILLED: 'completePaidLocalUnfulfilled',
  COMPLETE_PAID_LOCAL_FULFILLED: 'completePaidLocalFulfilled',
  COMPLETE_UNPAID_OR_PENDING: 'completeUnpaidOrPending',
  UNEXPECTED: 'unexpected',
  STRIPE_RETRIEVE_FAILED: 'stripeRetrieveFailed',
  LOCAL_AMBIGUOUS: 'localAmbiguous',
})

const ALL_BUCKETS = Object.values(ReconciliationBucket)

function emptyAggregate() {
  const buckets = Object.fromEntries(ALL_BUCKETS.map((b) => [b, 0]))
  return {
    mode: 'dry-run',
    checked: 0,
    ...buckets,
    completeUnpaidOrPendingBreakdown: {
      paymentIntentProcessing: 0,
      paymentIntentRequiresPaymentMethod: 0,
      paymentIntentCanceled: 0,
      paymentIntentSucceeded: 0,
      paymentIntentOther: 0,
      paymentIntentUnavailable: 0,
    },
    candidateCount: 0,
    oldestAgeMinutes: null,
    newestAgeMinutes: null,
  }
}

/**
 * Determines local fulfillment state purely from the candidate's own
 * already-selected fields — no additional query. Given the candidate query
 * itself filters to status='checkout_created', a fulfilled row should never
 * appear here at all; `completedAt` set without `createdEventId`/
 * `autoCreatedAt` on a row still reporting `checkout_created` is a genuine
 * local data inconsistency, not something safe to silently call
 * "not fulfilled" — that case is surfaced as ambiguous instead.
 */
function classifyLocalState(candidate) {
  const fulfilled = Boolean(candidate.createdEventId || candidate.autoCreatedAt)
  const ambiguous = Boolean(candidate.completedAt) && !fulfilled
  if (ambiguous) return 'ambiguous'
  return fulfilled ? 'fulfilled' : 'not_fulfilled'
}

function classifyPaymentIntentStatus(status) {
  switch (status) {
    case 'processing':
      return 'paymentIntentProcessing'
    case 'requires_payment_method':
    case 'requires_action':
    case 'requires_confirmation':
    case 'requires_capture':
      return 'paymentIntentRequiresPaymentMethod'
    case 'canceled':
      return 'paymentIntentCanceled'
    case 'succeeded':
      return 'paymentIntentSucceeded'
    default:
      return 'paymentIntentOther'
  }
}

/**
 * @param {{
 *   prisma: object,
 *   stripe: object,
 *   now?: () => Date,
 *   candidateAgeMs?: number,
 *   limit?: number,
 * }} args
 * @returns {Promise<object>} aggregate-only diagnostic result — see emptyAggregate().
 */
export async function inspectExtraFreeEventCheckouts({
  prisma,
  stripe,
  now = () => new Date(),
  candidateAgeMs = DEFAULT_CANDIDATE_AGE_MS,
  limit = DEFAULT_LIMIT,
}) {
  if (!prisma || typeof prisma.extraFreeEventCheckout?.findMany !== 'function') {
    throw new Error('inspectExtraFreeEventCheckouts: prisma.extraFreeEventCheckout.findMany is required')
  }
  if (!stripe || typeof stripe.checkout?.sessions?.retrieve !== 'function') {
    throw new Error('inspectExtraFreeEventCheckouts: stripe.checkout.sessions.retrieve is required')
  }

  const nowDate = now()
  const cutoff = new Date(nowDate.getTime() - candidateAgeMs)

  const candidates = await prisma.extraFreeEventCheckout.findMany({
    where: {
      status: 'checkout_created',
      stripeCheckoutSessionId: { not: null },
      updatedAt: { lt: cutoff },
    },
    orderBy: { updatedAt: 'asc' },
    take: limit,
    select: {
      id: true,
      status: true,
      stripeCheckoutSessionId: true,
      updatedAt: true,
      completedAt: true,
      createdEventId: true,
      autoCreatedAt: true,
    },
  })

  const result = emptyAggregate()
  result.checked = candidates.length
  result.candidateCount = candidates.length

  if (candidates.length === 0) {
    return result
  }

  const ageMinutesList = candidates.map((c) => Math.round((nowDate.getTime() - new Date(c.updatedAt).getTime()) / 60000))
  result.oldestAgeMinutes = Math.max(...ageMinutesList)
  result.newestAgeMinutes = Math.min(...ageMinutesList)

  for (const candidate of candidates) {
    const localState = classifyLocalState(candidate)
    if (localState === 'ambiguous') {
      result[ReconciliationBucket.LOCAL_AMBIGUOUS] += 1
      continue
    }

    let session
    try {
      session = await stripe.checkout.sessions.retrieve(candidate.stripeCheckoutSessionId)
    } catch {
      // Never log the raw Stripe error (may embed the session id/other
      // context) — an aggregate counter is the only signal this produces.
      result[ReconciliationBucket.STRIPE_RETRIEVE_FAILED] += 1
      continue
    }

    if (session.id !== candidate.stripeCheckoutSessionId) {
      result[ReconciliationBucket.UNEXPECTED] += 1
      continue
    }
    if (session.metadata?.intent !== 'extra_event') {
      result[ReconciliationBucket.UNEXPECTED] += 1
      continue
    }
    if (session.mode !== 'payment') {
      result[ReconciliationBucket.UNEXPECTED] += 1
      continue
    }

    const localFulfilled = localState === 'fulfilled'

    if (session.status === 'open' && session.payment_status === 'unpaid') {
      result[ReconciliationBucket.OPEN_UNPAID] += 1
      continue
    }

    if (session.status === 'expired' && session.payment_status === 'unpaid') {
      result[ReconciliationBucket.EXPIRED_UNPAID] += 1
      continue
    }

    if (session.status === 'complete' && session.payment_status === 'paid') {
      result[localFulfilled ? ReconciliationBucket.COMPLETE_PAID_LOCAL_FULFILLED : ReconciliationBucket.COMPLETE_PAID_LOCAL_UNFULFILLED] += 1
      continue
    }

    if (session.status === 'complete' && session.payment_status !== 'paid') {
      result[ReconciliationBucket.COMPLETE_UNPAID_OR_PENDING] += 1

      const paymentIntentRef = session.payment_intent
      if (paymentIntentRef) {
        const paymentIntentId = typeof paymentIntentRef === 'string' ? paymentIntentRef : paymentIntentRef.id
        try {
          const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)
          const key = classifyPaymentIntentStatus(paymentIntent.status)
          result.completeUnpaidOrPendingBreakdown[key] += 1
        } catch {
          result.completeUnpaidOrPendingBreakdown.paymentIntentUnavailable += 1
        }
      }
      continue
    }

    // Any other status/payment_status combination Stripe could theoretically
    // report (session.status is null before creation completes, or a
    // combination this matrix doesn't anticipate) — never inferred as
    // business fact.
    result[ReconciliationBucket.UNEXPECTED] += 1
  }

  return result
}
