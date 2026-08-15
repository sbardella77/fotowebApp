'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  BarChart3,
  Eye,
  MousePointer,
  ShoppingCart,
  CheckCircle2,
  TrendingUp,
  AlertCircle,
  Camera,
  ImagePlus,
  FolderOpen,
  BarChart4,
  QrCode,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslations } from '@/components/i18n-provider'
import { resolveDashboardExperience } from '@/lib/dashboard-experience'
import { safeFetchJson } from '@/lib/dashboard-data-helpers'
import {
  classifyOwnerApiFailure,
  createOwnerSessionExpiryGate,
  OWNER_SESSION_EXPIRED_QUERY_PARAM,
} from '@/lib/client/owner-session-expiry'

function mapEventName(name) {
  if (name === 'upsell_impression') return 'impressions'
  if (name === 'upsell_click') return 'clicks'
  if (name === 'upsell_checkout_start') return 'checkoutStarts'
  if (name === 'upsell_conversion') return 'conversions'
  return name
}

function useAnalyticsData(days, enabled, consumeOwnerSessionFailure) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!enabled) {
      setData(null)
      setError(null)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const response = await fetch(`/api/owner/analytics/upsells?days=${days}`, { cache: 'no-store', signal: controller.signal })
        if (await consumeOwnerSessionFailure(response.status)) return
        if (!response.ok) {
          throw new Error(`Request failed: ${response.status}`)
        }
        const d = await response.json()
        setData(d)
      } catch (err) {
        if (err.name === 'AbortError') return
        setData(null)
        setError(err.message || 'Unable to load analytics')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [days, enabled, consumeOwnerSessionFailure])

  return { data, loading, error }
}

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
  return (
    <h2 className="font-display text-base font-semibold tracking-tight text-foreground">{children}</h2>
  )
}

function EmptyState({ title, description }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-raised py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-accent-dark">
        <AlertCircle className="h-6 w-6" />
      </div>
      <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 max-w-xs text-xs font-light text-muted-foreground">{description}</p>
    </div>
  )
}

export default function AnalyticsPage() {
  const router = useRouter()
  const t = useTranslations('dashboard')
  const [auth, setAuth] = useState({ loading: true, ok: false })
  const [days, setDays] = useState(30)
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false)
  const [overview, setOverview] = useState(null)
  const [overviewLoading, setOverviewLoading] = useState(true)

  // Analytics owns its own session-expiry gate — it does not share
  // page.js's dashboard-level gate/authState/message. One stable instance
  // per mounted Analytics page, same lazy-useRef pattern as the dashboard.
  const sessionExpiryGateRef = useRef(null)
  if (!sessionExpiryGateRef.current) {
    sessionExpiryGateRef.current = createOwnerSessionExpiryGate()
  }

  // Verification primitive only — never itself routed through the gate.
  const checkOwnerSessionStillValid = useCallback(async () => {
    const response = await fetch('/api/owner/session', { cache: 'no-store' })
    const { payload } = await safeFetchJson(response, { fallback: { authenticated: false } })
    return Boolean(payload.authenticated)
  }, [])

  // Mid-session expiry inside Analytics has no inline login form to fall
  // back to (unlike the main dashboard) — send the owner back to /dashboard
  // with a one-shot marker so the existing localized dashboard.sessionExpired
  // message is shown there. useRouter()'s router identity is stable across
  // renders, so this callback (and everything that depends on it) stays
  // referentially stable too.
  const handleOwnerSessionExpired = useCallback(() => {
    router.replace(`/dashboard?${OWNER_SESSION_EXPIRED_QUERY_PARAM}=1`, { scroll: false })
  }, [router])

  const consumeOwnerSessionFailure = useCallback(async (status) => {
    if (classifyOwnerApiFailure(status) !== 'SESSION_EXPIRED') return false
    await sessionExpiryGateRef.current.handleCandidate401(checkOwnerSessionStillValid, handleOwnerSessionExpired)
    return true
  }, [checkOwnerSessionStillValid, handleOwnerSessionExpired])

  // Owner-scoped analytics data must never be requested before the initial
  // /owner/session check has confirmed a real, current session — otherwise a
  // direct unauthenticated visit could produce a genuine Owner 401 that gets
  // (incorrectly) treated as a mid-session expiry. auth.ok only ever becomes
  // true after that confirmation, so combining it here makes the dependency
  // explicit at the call site rather than relying solely on the (also true,
  // but less obvious) transitive gating via overview -> experience -> analyticsLevel.
  const { data, loading, error } = useAnalyticsData(days, analyticsEnabled && auth.ok, consumeOwnerSessionFailure)

  // Initial auth gate: unauthenticated access to /dashboard/analytics stays
  // a plain redirect to /dashboard, with NO sessionExpired marker — this is
  // "never had a session" (or a page load before any Owner action), not a
  // genuine mid-session expiry, and must stay distinct from it.
  useEffect(() => {
    fetch('/api/owner/session', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.authenticated) setAuth({ loading: false, ok: true })
        else router.push('/dashboard')
      })
      .catch(() => router.push('/dashboard'))
  }, [router])

  // Gated on auth.ok — never fires while the initial session check is still
  // loading, and never fires at all if that check comes back unauthenticated
  // (the effect above is already redirecting away in that case). This is
  // what prevents a direct unauthenticated visit from ever producing an
  // Owner 401 here that could be mistaken for a mid-session expiry.
  useEffect(() => {
    if (!auth.ok) return
    const run = async () => {
      setOverviewLoading(true)
      try {
        const response = await fetch('/api/owner/analytics/overview', { cache: 'no-store' })
        if (await consumeOwnerSessionFailure(response.status)) return
        const d = response.ok ? await response.json() : null
        setOverview(d)
      } catch {
        setOverview(null)
      } finally {
        setOverviewLoading(false)
      }
    }
    run()
  }, [auth.ok, consumeOwnerSessionFailure])

  const totals = useMemo(() => {
    if (!data?.byEventName) return { impressions: 0, clicks: 0, checkoutStarts: 0, conversions: 0 }
    const find = (name) => data.byEventName.find((e) => e.eventName === name)?._count?.id || 0
    return {
      impressions: find('upsell_impression'),
      clicks: find('upsell_click'),
      checkoutStarts: find('upsell_checkout_start'),
      conversions: find('upsell_conversion'),
    }
  }, [data])

  const ctr = totals.impressions > 0 ? ((totals.clicks / totals.impressions) * 100).toFixed(1) : '0.0'
  const convRate = totals.clicks > 0 ? ((totals.conversions / totals.clicks) * 100).toFixed(1) : '0.0'
  const abandonment = totals.checkoutStarts > 0 ? (((totals.checkoutStarts - totals.conversions) / totals.checkoutStarts) * 100).toFixed(1) : '0.0'

  const upsellRows = useMemo(() => {
    if (!data?.byUpsellType) return []
    const rows = {}
    data.byUpsellType.forEach((item) => {
      if (!rows[item.upsellType]) rows[item.upsellType] = { type: item.upsellType, impressions: 0, clicks: 0, checkoutStarts: 0, conversions: 0 }
      const key = mapEventName(item.eventName)
      if (rows[item.upsellType][key] !== undefined) {
        rows[item.upsellType][key] = item._count.id
      }
    })
    return Object.values(rows)
      .map((r) => ({
        ...r,
        ctr: r.impressions > 0 ? ((r.clicks / r.impressions) * 100).toFixed(1) : '0.0',
        convRate: r.clicks > 0 ? ((r.conversions / r.clicks) * 100).toFixed(1) : '0.0',
      }))
      .sort((a, b) => b.conversions - a.conversions)
  }, [data])

  const surfaceRows = useMemo(() => {
    if (!data?.bySource) return []
    const rows = {}
    data.bySource.forEach((item) => {
      if (!rows[item.source]) rows[item.source] = { source: item.source, impressions: 0, clicks: 0, conversions: 0 }
      const key = mapEventName(item.eventName)
      if (rows[item.source][key] !== undefined) {
        rows[item.source][key] = item._count.id
      }
    })
    return Object.values(rows)
      .map((r) => ({
        ...r,
        ctr: r.impressions > 0 ? ((r.clicks / r.impressions) * 100).toFixed(1) : '0.0',
        convRate: r.clicks > 0 ? ((r.conversions / r.clicks) * 100).toFixed(1) : '0.0',
      }))
      .sort((a, b) => b.conversions - a.conversions)
  }, [data])

  const planRows = useMemo(() => {
    if (!data?.byCtaPlan) return []
    const rows = {}
    data.byCtaPlan.forEach((item) => {
      if (!rows[item.ctaPlan]) rows[item.ctaPlan] = { plan: item.ctaPlan, clicks: 0, conversions: 0 }
      if (item.eventName === 'upsell_click') rows[item.ctaPlan].clicks = item._count.id
      if (item.eventName === 'upsell_conversion') rows[item.ctaPlan].conversions = item._count.id
    })
    return Object.values(rows)
      .map((r) => ({
        ...r,
        convRate: r.clicks > 0 ? ((r.conversions / r.clicks) * 100).toFixed(1) : '0.0',
      }))
      .sort((a, b) => b.conversions - a.conversions)
  }, [data])

  const experience = useMemo(() => {
    if (!overview) return null
    return resolveDashboardExperience({
      plan: overview.plan || 'free',
      events: [],
      metrics: {
        eventsCount: overview.eventsCount || 0,
        totalPhotos: overview.totalPhotos || 0,
        hasPremiumEvents: overview.hasPremiumEvents,
        hasWeddingPro: overview.hasWeddingPro,
        hasProEvent: overview.hasProEvent,
      },
    })
  }, [overview])

  const analyticsLevel = experience?.analyticsLevel || 'lite'

  useEffect(() => {
    setAnalyticsEnabled(analyticsLevel === 'complete')
  }, [analyticsLevel])

  if (auth.loading || overviewLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  const hasData = totals.impressions > 0 || totals.clicks > 0

  return (
    <div className="min-h-screen bg-background font-body text-foreground">
      {/* Top bar */}
      <header className="border-b border-border bg-background/70 backdrop-blur-xl">
        <div className="container flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-muted-foreground hover:text-foreground" onClick={() => router.push('/dashboard')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-accent-dark" />
              <h1 className="font-display text-base font-bold tracking-tight text-foreground">
                {analyticsLevel === 'lite' ? (t.eventInsightsTitle || 'Event Insights') : t.analyticsTitle}
              </h1>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-5xl px-4 py-8">
        <p className="text-sm font-light text-muted-foreground">
          {analyticsLevel === 'lite' ? (t.eventInsightsSubtitle || 'Track how your events are growing.') : t.analyticsSubtitle}
        </p>

        {analyticsLevel === 'lite' ? (
          <LiteAnalyticsContent overview={overview} t={t} router={router} />
        ) : (
          <CompleteAnalyticsContent
            days={days}
            setDays={setDays}
            loading={loading}
            error={error}
            hasData={hasData}
            totals={totals}
            ctr={ctr}
            convRate={convRate}
            abandonment={abandonment}
            upsellRows={upsellRows}
            surfaceRows={surfaceRows}
            planRows={planRows}
            t={t}
          />
        )}
      </main>
    </div>
  )
}

function LiteAnalyticsContent({ overview, t, router }) {
  const eventsCount = overview?.eventsCount || 0
  const totalPhotos = overview?.totalPhotos || 0
  const avgPhotos = eventsCount > 0 ? Math.round(totalPhotos / eventsCount) : 0

  if (eventsCount === 0) {
    return (
      <div className="mt-8">
        <EmptyState
          title={t.eventInsightsTitle || 'Event Insights'}
          description={t.createFirstEventInsights || 'Create your first event to start seeing insights.'}
        />
        <div className="mt-6 flex justify-center">
          <Button size="sm" className="cta-primary" onClick={() => router.push('/dashboard')}>
            {t.createRoom || 'Create event'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-8 space-y-8">
      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Camera} label={t.totalEvents || 'Total events'} value={eventsCount.toLocaleString()} />
        <KpiCard icon={ImagePlus} label={t.totalPhotosReceived || 'Photos received'} value={totalPhotos.toLocaleString()} />
        <KpiCard icon={FolderOpen} label={t.activeEvents || 'Active events'} value={eventsCount.toLocaleString()} />
        <KpiCard icon={BarChart4} label={t.avgPhotosPerEvent || 'Avg photos per event'} value={avgPhotos.toLocaleString()} />
      </div>

      {totalPhotos < 10 && (
        <div className="rounded-xl border border-border bg-surface p-5 shadow-subtle">
          <div className="flex items-start gap-3">
            <QrCode className="h-5 w-5 text-accent-dark shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground">{t.shareQrForMorePhotos || 'Share your QR code to collect more guest photos.'}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t.shareToStart || 'Share the event link so guests can start adding photos.'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CompleteAnalyticsContent({ days, setDays, loading, error, hasData, totals, ctr, convRate, abandonment, upsellRows, surfaceRows, planRows, t }) {
  return (
    <>
      {/* Filters */}
      <div className="mt-6 flex items-center gap-2">
        {[7, 30, 9999].map((d) => (
          <Button
            key={d}
            size="sm"
            variant={days === d ? 'secondary' : 'ghost'}
            onClick={() => setDays(d)}
            className="text-xs"
          >
            {d === 9999 ? t.analyticsFilterAll : d === 7 ? t.analyticsFilter7d : t.analyticsFilter30d}
          </Button>
        ))}
      </div>

      {loading && (
        <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          {t.loading || 'Loading...'}
        </div>
      )}

      {!loading && error && (
        <div className="mt-8">
          <EmptyState title={t.analyticsError || 'Unable to load analytics'} description={error} />
        </div>
      )}

      {!loading && !error && !hasData && (
        <div className="mt-8">
          <EmptyState title={t.analyticsNoData} description={t.analyticsNoDataDesc} />
        </div>
      )}

      {!loading && !error && hasData && (
        <div className="mt-8 space-y-8">
          {/* KPI Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard icon={Eye} label={t.analyticsKpiImpressions} value={totals.impressions.toLocaleString()} />
            <KpiCard icon={MousePointer} label={t.analyticsKpiClicks} value={totals.clicks.toLocaleString()} />
            <KpiCard icon={CheckCircle2} label={t.analyticsKpiConversions} value={totals.conversions.toLocaleString()} />
            <KpiCard
              icon={TrendingUp}
              label={t.analyticsKpiCtr}
              value={`${ctr}%`}
              sub={`${convRate}% ${t.analyticsKpiConvRate?.toLowerCase() || 'conv. rate'}`}
            />
          </div>

          {/* Funnel */}
          <div>
            <SectionTitle>{t.analyticsFunnel}</SectionTitle>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: t.analyticsImpressions, value: totals.impressions, color: 'bg-primary/10 text-primary' },
                { label: t.analyticsClicks, value: totals.clicks, color: 'bg-accent-dark/10 text-accent-dark' },
                { label: t.analyticsCheckoutStarts, value: totals.checkoutStarts, color: 'bg-warning/10 text-warning' },
                { label: t.analyticsConversions, value: totals.conversions, color: 'bg-success/10 text-success' },
              ].map((step, i) => (
                <div key={i} className="relative rounded-xl border border-border bg-surface p-4 text-center shadow-subtle">
                  <p className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{step.label}</p>
                  <p className="mt-2 font-display text-2xl font-bold text-foreground">{step.value.toLocaleString()}</p>
                  {i > 0 && (
                    <p className="mt-1 text-xs font-medium text-muted-foreground">
                      {(() => {
                        const prev = [totals.impressions, totals.clicks, totals.checkoutStarts, totals.conversions][i === 3 ? 2 : i - 1]
                        return prev > 0 ? `${((step.value / prev) * 100).toFixed(1)}%` : '0.0%'
                      })()}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Top Upsells */}
          <div>
            <SectionTitle>{t.analyticsTopUpsells}</SectionTitle>
            <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface shadow-subtle">
              <div className="grid grid-cols-12 gap-2 border-b border-border bg-raised px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <div className="col-span-3">{t.analyticsUpsell}</div>
                <div className="col-span-2 text-right">{t.analyticsImpressions}</div>
                <div className="col-span-2 text-right">{t.analyticsClicks}</div>
                <div className="col-span-2 text-right">CTR</div>
                <div className="col-span-2 text-right">{t.analyticsConversions}</div>
                <div className="col-span-1 text-right">Rate</div>
              </div>
              <div className="divide-y divide-border">
                {upsellRows.map((row) => (
                  <div key={row.type} className="grid grid-cols-12 gap-2 px-4 py-3 text-sm">
                    <div className="col-span-3 font-medium text-foreground">{row.type}</div>
                    <div className="col-span-2 text-right text-muted-foreground">{row.impressions.toLocaleString()}</div>
                    <div className="col-span-2 text-right text-muted-foreground">{row.clicks.toLocaleString()}</div>
                    <div className="col-span-2 text-right font-medium text-accent-dark">{row.ctr}%</div>
                    <div className="col-span-2 text-right font-medium text-success">{row.conversions.toLocaleString()}</div>
                    <div className="col-span-1 text-right text-muted-foreground">{row.convRate}%</div>
                  </div>
                ))}
                {upsellRows.length === 0 && (
                  <div className="px-4 py-6 text-center text-xs text-muted-foreground">{t.analyticsNoData}</div>
                )}
              </div>
            </div>
          </div>

          {/* Top Surfaces */}
          <div>
            <SectionTitle>{t.analyticsTopSurfaces}</SectionTitle>
            <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface shadow-subtle">
              <div className="grid grid-cols-10 gap-2 border-b border-border bg-raised px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <div className="col-span-4">{t.analyticsSurface}</div>
                <div className="col-span-2 text-right">{t.analyticsImpressions}</div>
                <div className="col-span-2 text-right">{t.analyticsClicks}</div>
                <div className="col-span-2 text-right">{t.analyticsConversions}</div>
              </div>
              <div className="divide-y divide-border">
                {surfaceRows.map((row) => (
                  <div key={row.source} className="grid grid-cols-10 gap-2 px-4 py-3 text-sm">
                    <div className="col-span-4 font-medium text-foreground">{row.source}</div>
                    <div className="col-span-2 text-right text-muted-foreground">{row.impressions.toLocaleString()}</div>
                    <div className="col-span-2 text-right text-muted-foreground">{row.clicks.toLocaleString()}</div>
                    <div className="col-span-2 text-right font-medium text-success">{row.conversions.toLocaleString()}</div>
                  </div>
                ))}
                {surfaceRows.length === 0 && (
                  <div className="px-4 py-6 text-center text-xs text-muted-foreground">{t.analyticsNoData}</div>
                )}
              </div>
            </div>
          </div>

          {/* Plan Conversions */}
          <div>
            <SectionTitle>{t.analyticsPlanConversions}</SectionTitle>
            <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface shadow-subtle">
              <div className="grid grid-cols-6 gap-2 border-b border-border bg-raised px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <div className="col-span-2">{t.analyticsPlan}</div>
                <div className="col-span-2 text-right">{t.analyticsClicks}</div>
                <div className="col-span-2 text-right">{t.analyticsConversions}</div>
              </div>
              <div className="divide-y divide-border">
                {planRows.map((row) => (
                  <div key={row.plan} className="grid grid-cols-6 gap-2 px-4 py-3 text-sm">
                    <div className="col-span-2 font-medium text-foreground">{row.plan}</div>
                    <div className="col-span-2 text-right text-muted-foreground">{row.clicks.toLocaleString()}</div>
                    <div className="col-span-2 text-right font-medium text-success">{row.conversions.toLocaleString()} ({row.convRate}%)</div>
                  </div>
                ))}
                {planRows.length === 0 && (
                  <div className="px-4 py-6 text-center text-xs text-muted-foreground">{t.analyticsNoData}</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
