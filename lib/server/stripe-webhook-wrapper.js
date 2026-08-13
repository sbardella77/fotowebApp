import { NextResponse } from 'next/server'
import { sendOpsAlert } from '@/lib/server/ops-alerts'
import {
  markStripeWebhookEventProcessed,
  markStripeWebhookEventFailed,
  StripeWebhookFencingError,
} from '@/lib/server/stripe-webhook-receipt'

// Tags a `run()` result as "the handler already committed business writes
// and the fenced receipt transition together, atomically, inside its own
// prisma.$transaction". No handler produces this yet (see STEP 4.2) — this
// module only defines the contract.
export const StripeWebhookRunOutcome = Object.freeze({
  RECEIPT_ALREADY_FINALIZED: 'RECEIPT_ALREADY_FINALIZED',
})

function isValidHttpStatus(status) {
  return Number.isInteger(status) && status >= 100 && status <= 599
}

// Matches what any webhook `run()` can plausibly return: a
// NextResponse.json(...) result, which is a Response with a numeric
// `.status`. Not a general Response-type detector.
function isResponseLike(value) {
  return value !== null && typeof value === 'object' && isValidHttpStatus(value.status)
}

function isReceiptAlreadyFinalizedOutcome(value) {
  return value !== null && typeof value === 'object' && value.kind === StripeWebhookRunOutcome.RECEIPT_ALREADY_FINALIZED
}

// The one response for every flavor of "this worker's fencing token no
// longer matches the receipt's current generation": another worker already
// holds (or has completed) this delivery, so this worker's outcome — success
// or failure — is not authoritative. Never 2xx, never retried with the
// stale token. Same signal as claim-time IN_PROGRESS: ask Stripe to retry.
function stripeWebhookFencingLostResponse() {
  return NextResponse.json({ received: false, code: 'webhook_processing_in_progress' }, { status: 503 })
}

async function finalizeStripeWebhookFailure({ prisma, eventId, attempt, error }) {
  try {
    await markStripeWebhookEventFailed({ prisma, eventId, attempt, error })
  } catch (finalizeError) {
    console.error('[stripe/webhook] Failed to mark receipt FAILED:', finalizeError.message)
    await sendOpsAlert({
      severity: 'critical',
      type: 'stripe:webhook:finalize_failed_failed',
      title: 'Failed to finalize Stripe webhook receipt as FAILED',
      message: finalizeError.message,
      context: { stripeEventId: eventId, attempt, businessError: error?.message },
    })
  }
}

// Runs `run()` — the business handler for one claimed event.type — and
// finalizes the receipt from its outcome.
//
// `run()` may return either:
//   - a NextResponse (the only contract before STEP 4.2): the wrapper
//     finalizes the receipt itself, standalone, from the response status
//     alone (2xx -> PROCESSED, non-2xx -> FAILED). Deliberately does not
//     inspect response bodies, error codes, or business intent — that
//     classification already happened inside `run()`.
//   - { kind: 'RECEIPT_ALREADY_FINALIZED', response }: the handler's own
//     prisma.$transaction — business writes plus a fenced
//     markStripeWebhookEventProcessed against that same `tx` — has already
//     resolved and committed by the time this outcome is constructed. The
//     wrapper does nothing further except return `response` as-is: no
//     markProcessed, no markFailed. A handler must only ever build this
//     outcome after its own transaction has committed successfully, and
//     only to represent success — never before, and never for a failure.
//     Any side effect a handler runs before returning it (billing emails,
//     trackServerEvent, ops alerts) must stay non-throwing / best-effort,
//     exactly as every such helper already does today.
export async function processClaimedStripeWebhookEvent({ prisma, eventId, attempt, run }) {
  let response
  try {
    const outcome = await run()

    if (isReceiptAlreadyFinalizedOutcome(outcome)) {
      if (isResponseLike(outcome.response) && outcome.response.status >= 200 && outcome.response.status < 300) {
        return outcome.response
      }
      // A handler claimed RECEIPT_ALREADY_FINALIZED without a valid 2xx
      // response attached. This is an invariant violation, not a normal
      // failure: we cannot tell from here whether the atomic transaction
      // actually committed, so we must not guess — no markProcessed (could
      // be redundant, could be wrong), no markFailed (could incorrectly
      // overwrite a row that's already PROCESSED, or still legitimately
      // PROCESSING). Fail loud, non-2xx, and let the lease/reclaim
      // mechanism recover on retry either way.
      console.error('[stripe/webhook] Handler returned a malformed RECEIPT_ALREADY_FINALIZED outcome:', outcome)
      return NextResponse.json({ error: 'Invalid webhook handler outcome' }, { status: 500 })
    }

    if (!isResponseLike(outcome)) {
      console.error('[stripe/webhook] Handler returned neither a Response nor a recognized outcome:', outcome)
      return NextResponse.json({ error: 'Invalid webhook handler outcome' }, { status: 500 })
    }

    response = outcome
  } catch (error) {
    if (error instanceof StripeWebhookFencingError) {
      // A handler's atomic transaction lost its own fenced
      // markStripeWebhookEventProcessed/Failed check — Prisma already
      // rolled back that entire transaction, so none of this attempt's
      // business writes survived. Do not touch the receipt further: the
      // worker that reclaimed it owns the outcome now.
      console.warn('[stripe/webhook] Business transaction rolled back due to lost claim (fencing):', error.message)
      return stripeWebhookFencingLostResponse()
    }
    console.error('[stripe/webhook] Handler threw:', error.message)
    await finalizeStripeWebhookFailure({ prisma, eventId, attempt, error })
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }

  if (response.status >= 200 && response.status < 300) {
    try {
      await markStripeWebhookEventProcessed({ prisma, eventId, attempt })
      return response
    } catch (finalizeError) {
      if (finalizeError instanceof StripeWebhookFencingError) {
        console.warn('[stripe/webhook] Lost claim while finalizing PROCESSED (fencing):', finalizeError.message)
        return stripeWebhookFencingLostResponse()
      }
      console.error('[stripe/webhook] Failed to mark receipt PROCESSED:', finalizeError.message)
      await sendOpsAlert({
        severity: 'critical',
        type: 'stripe:webhook:finalize_processed_failed',
        title: 'Failed to finalize Stripe webhook receipt as PROCESSED',
        message: finalizeError.message,
        context: { stripeEventId: eventId, attempt },
      })
      // The business action already succeeded but we could not durably
      // record it. Never return the original 2xx here: ask Stripe to retry
      // so the receipt eventually reaches PROCESSED (or a fresh worker
      // reclaims a stale lease and finishes the job).
      return NextResponse.json({ received: false, code: 'webhook_receipt_finalization_failed' }, { status: 503 })
    }
  }

  await finalizeStripeWebhookFailure({
    prisma,
    eventId,
    attempt,
    error: new Error(`stripe-webhook: business handler returned HTTP ${response.status}`),
  })
  return response
}
