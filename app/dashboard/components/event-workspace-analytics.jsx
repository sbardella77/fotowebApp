'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Eye, ImagePlus, Loader2, Lock, TrendingUp } from 'lucide-react'
import { safeFetchJson } from '@/lib/dashboard-data-helpers'

function KpiCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-subtle">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <p className="mt-2 font-display text-2xl font-bold text-foreground">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

function SectionTitle({ children }) {
  return <h2 className="font-display text-base font-semibold tracking-tight text-foreground">{children}</h2>
}

function EmptyState({ title, description }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-secondary py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-accent-dark">
        <AlertCircle className="h-6 w-6" />
      </div>
      <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 max-w-xs text-xs font-light text-muted-foreground">{description}</p>
    </div>
  )
}

export function EventWorkspaceAnalytics({ event, onOwnerSessionFailure, t }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!event?.slug) return
    let cancelled = false
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`/api/owner/events/${event.slug}/analytics`, { cache: 'no-store' })
        if (onOwnerSessionFailure && (await onOwnerSessionFailure(response.status))) return
        const { ok, payload } = await safeFetchJson(response, { fallback: {} })
        if (cancelled) return
        if (!ok) throw new Error(payload.error || t.analyticsError || 'Unable to load analytics')
        setData(payload)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [event?.slug, onOwnerSessionFailure, t.analyticsError])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t.loading || 'Loading...'}
      </div>
    )
  }

  if (error) {
    return <EmptyState title={t.analyticsError || 'Unable to load analytics'} description={error} />
  }

  if (!data) return null

  const { views, uploads, viewToUploadRate, originalQualityUnlocked, upsellFunnel } = data
  const viewToUploadPct = viewToUploadRate != null ? `${(viewToUploadRate * 100).toFixed(1)}%` : '—'

  const funnelSteps = [
    { label: t.analyticsImpressions, value: upsellFunnel?.impressions || 0 },
    { label: t.analyticsClicks, value: upsellFunnel?.clicks || 0 },
    { label: t.analyticsCheckoutStarts, value: upsellFunnel?.checkoutStarts || 0 },
    { label: t.analyticsConversions, value: upsellFunnel?.conversions || 0 },
  ]

  return (
    <div className="space-y-8">
      {views === 0 && uploads === 0 ? (
        <EmptyState
          title={t.eventAnalyticsNoData || 'No activity yet'}
          description={t.eventAnalyticsNoDataDesc || 'Share this event to start seeing views and uploads here.'}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard icon={Eye} label={t.eventAnalyticsViews || 'Gallery views'} value={views.toLocaleString()} />
            <KpiCard icon={ImagePlus} label={t.eventAnalyticsUploads || 'Photos uploaded'} value={uploads.toLocaleString()} />
            <KpiCard
              icon={TrendingUp}
              label={t.eventAnalyticsViewToUpload || 'View → upload rate'}
              value={viewToUploadPct}
            />
            <KpiCard
              icon={originalQualityUnlocked ? CheckCircle2 : Lock}
              label={t.eventAnalyticsOriginalQuality || 'Original Quality'}
              value={originalQualityUnlocked ? (t.eventAnalyticsUnlocked || 'Unlocked') : (t.eventAnalyticsLocked || 'Not unlocked')}
            />
          </div>

          <div>
            <SectionTitle>{t.analyticsFunnel}</SectionTitle>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {funnelSteps.map((step, i) => (
                <div key={i} className="relative rounded-xl border border-border bg-surface p-4 text-center shadow-subtle">
                  <p className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{step.label}</p>
                  <p className="mt-2 font-display text-2xl font-bold text-foreground">{step.value.toLocaleString()}</p>
                  {i > 0 && (
                    <p className="mt-1 text-xs font-medium text-muted-foreground">
                      {(() => {
                        const prev = funnelSteps[i - 1].value
                        return prev > 0 ? `${((step.value / prev) * 100).toFixed(1)}%` : '0.0%'
                      })()}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
