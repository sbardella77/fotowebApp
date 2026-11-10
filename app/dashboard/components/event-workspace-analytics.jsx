'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Eye, ImagePlus, Loader2, Lock, TrendingUp } from 'lucide-react'
import { safeFetchJson } from '@/lib/dashboard-data-helpers'

// The analytics tab lives in the narrow event side panel, so layouts here are
// sized for the panel, not the viewport: a four-column grid at a desktop
// breakpoint would squeeze each card to ~90px and clip labels and values.
function KpiCard({ icon: Icon, label, value, children }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface p-4 shadow-subtle">
      <div className="flex items-start gap-2 text-muted-foreground">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="text-xs font-medium leading-snug">{label}</span>
      </div>
      {children || <p className="mt-2 truncate font-display text-2xl font-bold tabular-nums text-foreground">{value}</p>}
    </div>
  )
}

function FunnelStep({ label, value, max, rate }) {
  const width = max > 0 ? Math.max((value / max) * 100, value > 0 ? 2 : 0) : 0
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-sm text-foreground">{label}</span>
        <span className="shrink-0 font-display text-base font-bold tabular-nums text-foreground">{value.toLocaleString()}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
      </div>
      {rate && <p className="mt-1 text-xs text-muted-foreground">{rate}</p>}
    </li>
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
        if (!ok) throw new Error(payload.error || t.eventAnalyticsError || 'Unable to load analytics')
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
  }, [event?.slug, onOwnerSessionFailure, t.eventAnalyticsError])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t.loading || 'Loading...'}
      </div>
    )
  }

  if (error) {
    return <EmptyState title={t.eventAnalyticsError || 'Unable to load analytics'} description={error} />
  }

  if (!data) return null

  const { views, uploads, viewToUploadRate, originalQualityUnlocked, upsellFunnel } = data
  // uploads / views: guests often upload many photos in one visit, so this is
  // a per-view count, not a percentage (184 photos over 1 view read "18400%").
  const photosPerView = viewToUploadRate != null ? viewToUploadRate.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'

  const funnelSteps = [
    { label: t.analyticsImpressions, value: upsellFunnel?.impressions || 0 },
    { label: t.analyticsClicks, value: upsellFunnel?.clicks || 0 },
    { label: t.analyticsCheckoutStarts, value: upsellFunnel?.checkoutStarts || 0 },
    { label: t.analyticsConversions, value: upsellFunnel?.conversions || 0 },
  ]
  const funnelMax = funnelSteps[0].value
  const stepRate = (i) => {
    const prev = funnelSteps[i - 1]?.value
    if (!prev) return null
    const pct = `${((funnelSteps[i].value / prev) * 100).toFixed(1)}%`
    return (t.eventAnalyticsStepRate || '{rate} of previous step').replace('{rate}', pct)
  }

  return (
    <div className="space-y-8">
      {views === 0 && uploads === 0 ? (
        <EmptyState
          title={t.eventAnalyticsNoData || 'No activity yet'}
          description={t.eventAnalyticsNoDataDesc || 'Share this event to start seeing views and uploads here.'}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <KpiCard icon={Eye} label={t.eventAnalyticsViews || 'Gallery views'} value={views.toLocaleString()} />
            <KpiCard icon={ImagePlus} label={t.eventAnalyticsUploads || 'Photos uploaded'} value={uploads.toLocaleString()} />
            <KpiCard icon={TrendingUp} label={t.eventAnalyticsPhotosPerView || 'Photos per view'} value={photosPerView} />
            <KpiCard icon={originalQualityUnlocked ? CheckCircle2 : Lock} label={t.eventAnalyticsOriginalQuality || 'Original quality'}>
              <p
                className={`mt-3 inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                  originalQualityUnlocked ? 'bg-primary/15 text-accent-dark' : 'bg-secondary text-muted-foreground'
                }`}
              >
                {originalQualityUnlocked ? (t.eventAnalyticsUnlocked || 'Unlocked') : (t.eventAnalyticsLocked || 'Locked')}
              </p>
            </KpiCard>
          </div>

          <div>
            <SectionTitle>{t.eventAnalyticsFunnelTitle || t.analyticsFunnel || 'Upgrade funnel'}</SectionTitle>
            <div className="mt-4 rounded-xl border border-border bg-surface p-4 shadow-subtle">
              {funnelMax === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t.eventAnalyticsFunnelEmpty || 'No upgrade prompts have been shown for this event yet.'}
                </p>
              ) : (
                <ol className="space-y-4">
                  {funnelSteps.map((step, i) => (
                    <FunnelStep key={i} label={step.label} value={step.value} max={funnelMax} rate={i > 0 ? stepRate(i) : null} />
                  ))}
                </ol>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
