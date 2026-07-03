/**
 * SnapRooms — billing health cron endpoint.
 *
 * Designed to be called by an external cron scheduler (e.g. Better Stack,
 * Vercel Cron, GitHub Actions). Returns a synthetic summary of potentially
 * stuck or failed billing-related records.
 *
 * Auth: `CRON_SECRET` env var, sent as `Authorization: Bearer <token>`
 *       or `X-Cron-Secret: <token>`.
 */

import { NextResponse } from 'next/server'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { sendOpsAlert } from '@/lib/server/ops-alerts'

export const dynamic = 'force-dynamic'

const STUCK_CHECKOUT_CREATED_MINUTES = 15
const STUCK_PENDING_MINUTES = 15
const STUCK_JOB_MINUTES = 30

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000)
}

function getCronSecret(request) {
  const auth = request.headers.get('authorization') || ''
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim()
  }
  return request.headers.get('x-cron-secret') || ''
}

export async function GET(request) {
  const secret = getCronSecret(request)
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const prisma = await getPrismaClient()
  if (!prisma) {
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
  }

  const checkedAt = new Date().toISOString()
  const issues = []

  try {
    // Extra Free Event checkouts stuck in checkout_created (payment may have
    // succeeded but webhook did not process them).
    const stuckCheckoutCreated = await prisma.extraFreeEventCheckout.findMany({
      where: {
        status: 'checkout_created',
        updatedAt: { lt: minutesAgo(STUCK_CHECKOUT_CREATED_MINUTES) },
      },
      orderBy: { updatedAt: 'asc' },
      take: 20,
      select: { id: true, ownerId: true, status: true, stripeCheckoutSessionId: true, updatedAt: true },
    })
    if (stuckCheckoutCreated.length > 0) {
      issues.push({
        type: 'extra_free_event:stuck_checkout_created',
        count: stuckCheckoutCreated.length,
        records: stuckCheckoutCreated,
      })
    }

    // Extra Free Event checkouts stuck in pending (checkout session never created).
    const stuckPending = await prisma.extraFreeEventCheckout.findMany({
      where: {
        status: 'pending',
        stripeCheckoutSessionId: null,
        updatedAt: { lt: minutesAgo(STUCK_PENDING_MINUTES) },
      },
      orderBy: { updatedAt: 'asc' },
      take: 20,
      select: { id: true, ownerId: true, status: true, updatedAt: true },
    })
    if (stuckPending.length > 0) {
      issues.push({
        type: 'extra_free_event:stuck_pending',
        count: stuckPending.length,
        records: stuckPending,
      })
    }

    // Failed Extra Free Event checkouts (auto-create failed, fallback credit granted).
    const failedCheckouts = await prisma.extraFreeEventCheckout.findMany({
      where: { status: 'failed' },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: { id: true, ownerId: true, status: true, stripeCheckoutSessionId: true, errorMessage: true, updatedAt: true },
    })
    if (failedCheckouts.length > 0) {
      issues.push({
        type: 'extra_free_event:failed_checkouts',
        count: failedCheckouts.length,
        records: failedCheckouts,
      })
    }

    // Gallery ZIP jobs stuck in PENDING for too long.
    const stuckJobs = await prisma.galleryDownloadJob.findMany({
      where: {
        status: { in: ['PENDING', 'PROCESSING'] },
        updatedAt: { lt: minutesAgo(STUCK_JOB_MINUTES) },
      },
      orderBy: { updatedAt: 'asc' },
      take: 20,
      select: { id: true, eventId: true, status: true, attempts: true, updatedAt: true },
    })
    if (stuckJobs.length > 0) {
      issues.push({
        type: 'gallery_job:stuck',
        count: stuckJobs.length,
        records: stuckJobs,
      })
    }

    // Gallery ZIP jobs that explicitly failed.
    const failedJobs = await prisma.galleryDownloadJob.findMany({
      where: { status: 'FAILED' },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: { id: true, eventId: true, status: true, error: true, updatedAt: true },
    })
    if (failedJobs.length > 0) {
      issues.push({
        type: 'gallery_job:failed',
        count: failedJobs.length,
        records: failedJobs,
      })
    }

    // Professional subscriptions whose grace period has expired.
    const overduePastDue = await prisma.owner.findMany({
      where: {
        subscriptionStatus: 'past_due',
        subscriptionGraceUntil: { lt: new Date() },
      },
      orderBy: { subscriptionGraceUntil: 'asc' },
      take: 20,
      select: { id: true, email: true, subscriptionStatus: true, subscriptionGraceUntil: true },
    })
    if (overduePastDue.length > 0) {
      issues.push({
        type: 'subscription:past_due_grace_expired',
        count: overduePastDue.length,
        records: overduePastDue,
      })
    }
  } catch (error) {
    console.error('[cron/check-billing-health] Health check query failed:', error)
    await sendOpsAlert({
      severity: 'critical',
      type: 'ops:cron:billing_health_query_failed',
      title: 'Billing health cron query failed',
      message: error.message,
      context: { checkedAt },
    })
    return NextResponse.json({ error: 'Health check query failed' }, { status: 500 })
  }

  if (issues.length > 0) {
    await sendOpsAlert({
      severity: 'warning',
      type: 'ops:cron:billing_health_issues',
      title: 'Billing health check found issues',
      message: `Found ${issues.length} issue type(s) during billing health check.`,
      context: {
        checkedAt,
        issueTypes: issues.map((i) => i.type),
        counts: issues.reduce((acc, i) => {
          acc[i.type] = i.count
          return acc
        }, {}),
      },
    })
  }

  return NextResponse.json({ ok: true, checkedAt, issueCount: issues.length, issues })
}
