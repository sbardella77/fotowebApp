'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  Legend,
} from 'recharts'
import { AlertTriangle, HelpCircle, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'

const RANGES = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
]
const DEFAULT_RANGE = '30d'

const numberFormatter = new Intl.NumberFormat('en-US')
const formatCount = (value) => (value == null ? '—' : numberFormatter.format(value))
const formatPercent = (value) => (value == null ? '—' : `${value}%`)

function InfoTooltip({ children }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex text-muted-foreground/60 hover:text-muted-foreground" aria-label="What is this metric?">
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[240px] text-xs font-light">{children}</TooltipContent>
    </Tooltip>
  )
}

function DeltaBadge({ percentageChange }) {
  if (!percentageChange) return null
  const { value, trend } = percentageChange
  if (trend === 'new') {
    return <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[0.65rem] font-medium text-emerald-600">New</span>
  }
  if (value == null) return null
  const isUp = trend === 'up'
  const isDown = trend === 'down'
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[0.65rem] font-medium ${
        isUp ? 'bg-emerald-500/10 text-emerald-600' : isDown ? 'bg-red-500/10 text-red-600' : 'bg-muted text-muted-foreground'
      }`}
    >
      {isUp ? <TrendingUp className="h-3 w-3" /> : isDown ? <TrendingDown className="h-3 w-3" /> : null}
      {value > 0 ? '+' : ''}
      {value}%
    </span>
  )
}

function KpiCard({ label, value, percentageChange, tooltip, unavailable, emphasis }) {
  return (
    <Card className="border-border bg-surface shadow-card">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center gap-1.5">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
          {tooltip ? <InfoTooltip>{tooltip}</InfoTooltip> : null}
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          {unavailable ? (
            <span className="text-lg font-medium text-muted-foreground/60">Unavailable</span>
          ) : (
            <span className={`font-display font-bold tracking-tight text-foreground ${emphasis ? 'text-3xl sm:text-4xl' : 'text-2xl sm:text-3xl'}`}>
              {formatCount(value)}
            </span>
          )}
          {!unavailable ? <DeltaBadge percentageChange={percentageChange} /> : null}
        </div>
      </CardContent>
    </Card>
  )
}

function FunnelStage({ stage, isFirst }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1 text-center">
      {!isFirst ? (
        <span className="text-xs font-medium text-muted-foreground">
          ↓ {stage.conversionFromPrevious == null ? '—' : `${stage.conversionFromPrevious}%`}
        </span>
      ) : (
        <span className="text-xs text-transparent select-none">↓</span>
      )}
      <div className="w-full rounded-xl border border-border bg-raised px-3 py-3">
        <p className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">{stage.label}</p>
        <p className="mt-1 font-display text-xl font-bold tracking-tight text-foreground">
          {stage.count == null ? '—' : formatCount(stage.count)}
        </p>
      </div>
    </div>
  )
}

function Funnel({ funnel }) {
  if (!funnel) return null
  return (
    <Card className="border-border bg-surface shadow-card">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-1.5">
          <CardTitle className="font-display text-base font-bold tracking-tight text-foreground">Business funnel</CardTitle>
          <InfoTooltip>
            Stage funnel over the selected date window — each stage counts activity in that window, not a
            person-by-person journey. PostHog visitor identity is not reliably linked to a specific signed-up
            account, and Paid reflects total accounts to date rather than this date range.
          </InfoTooltip>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-2">
          {funnel.stages.map((stage, index) => (
            <FunnelStage key={stage.key} stage={stage} isFirst={index === 0} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function TrendChart({ trends }) {
  const visitorsAvailable = Array.isArray(trends?.visitors)
  const signups = trends?.signups || []
  const merged = signups.map((point, index) => ({
    date: point.date.slice(5), // MM-DD, compact for small screens
    signups: point.count,
    visitors: visitorsAvailable ? trends.visitors[index]?.visitors ?? 0 : undefined,
  }))

  return (
    <Card className="border-border bg-surface shadow-card">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-1.5">
          <CardTitle className="font-display text-base font-bold tracking-tight text-foreground">Growth trend</CardTitle>
          <InfoTooltip>Daily visitors and signups over the selected period.</InfoTooltip>
        </div>
      </CardHeader>
      <CardContent>
        {!visitorsAvailable ? (
          <p className="mb-2 flex items-center gap-1.5 text-xs font-light text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            Visitors trend temporarily unavailable — showing signups only.
          </p>
        ) : null}
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={merged} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} width={32} />
              <RechartsTooltip
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                labelFormatter={(label) => `Date: ${label}`}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {visitorsAvailable ? (
                <Line type="monotone" dataKey="visitors" name="Visitors" stroke="var(--color-primary, #6366f1)" strokeWidth={2} dot={false} />
              ) : null}
              <Line type="monotone" dataKey="signups" name="Signups" stroke="#10b981" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

function KpiCardSkeleton() {
  return (
    <Card className="border-border bg-surface shadow-card">
      <CardContent className="p-4 sm:p-5">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-3 h-8 w-16" />
      </CardContent>
    </Card>
  )
}

export default function BusinessDashboard() {
  const [range, setRange] = useState(DEFAULT_RANGE)
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [refreshing, setRefreshing] = useState(false)
  const abortRef = useRef(null)

  const load = useCallback(async (selectedRange) => {
    if (abortRef.current) {
      abortRef.current.abort()
    }
    const controller = new AbortController()
    abortRef.current = controller

    setStatus((prev) => (prev === 'ready' ? 'ready' : 'loading'))
    setRefreshing(true)

    try {
      const response = await fetch(`/api/admin/metrics/business?range=${selectedRange}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`)
      }
      const payload = await response.json()
      // A stale response for a range the admin already switched away from
      // must never overwrite the current selection.
      if (controller.signal.aborted) return
      setData(payload)
      setStatus('ready')
    } catch (error) {
      if (error.name === 'AbortError') return
      setStatus('error')
    } finally {
      if (!controller.signal.aborted) {
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    load(range)
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [range, load])

  const postHogUnavailable = data?.postHog?.status === 'unavailable'

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-bold tracking-tight text-foreground">Business dashboard</h2>
            <p className="mt-1 text-sm font-light text-muted-foreground">
              Acquisition, activation and monetization at a glance.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-full border border-border bg-surface p-1">
              {RANGES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setRange(option.value)}
                  disabled={status === 'loading'}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    range === option.value
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {refreshing && status === 'ready' ? <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
          </div>
        </div>

        {postHogUnavailable ? (
          <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm font-light text-amber-700">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Traffic analytics temporarily unavailable — product metrics below are unaffected.
            <Button size="sm" variant="outline" className="ml-auto h-7 rounded-full text-xs" onClick={() => load(range)}>
              Retry
            </Button>
          </div>
        ) : null}

        {status === 'error' ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-surface p-8 text-center">
            <AlertTriangle className="h-6 w-6 text-muted-foreground/50" />
            <p className="text-sm font-light text-muted-foreground">Could not load business metrics.</p>
            <Button size="sm" variant="outline" className="rounded-full" onClick={() => load(range)}>
              Retry
            </Button>
          </div>
        ) : status === 'loading' && !data ? (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <KpiCardSkeleton key={i} />
              ))}
            </div>
            <Card className="border-border bg-surface shadow-card">
              <CardContent className="p-5">
                <Skeleton className="h-[220px] w-full" />
              </CardContent>
            </Card>
          </>
        ) : data ? (
          <>
            {/* Row 1 — Business health */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard
                label="Visitors"
                value={data.acquisition.visitors.current}
                unavailable={postHogUnavailable}
                tooltip="Unique marketing visitors measured by PostHog."
                emphasis
              />
              <KpiCard
                label="Signups"
                value={data.acquisition.signups.current}
                percentageChange={data.acquisition.signups.percentageChange}
                tooltip="Owner accounts created in the selected period."
                emphasis
              />
              <KpiCard
                label="Core activated"
                value={data.activation.coreActivatedOwners.current}
                percentageChange={data.activation.coreActivatedOwners.percentageChange}
                tooltip="Owners whose event received its first server-attributed guest photo."
                emphasis
              />
              <KpiCard
                label="Paid accounts"
                value={data.monetization.paidAccounts}
                tooltip="Accounts currently classified as paid/premium by SnapRooms billing state. Total to date, not limited to the selected period."
                emphasis
              />
            </div>

            {/* Row 2 — Funnel */}
            <Funnel funnel={data.funnel} />

            {/* Row 3 — Growth trend */}
            <TrendChart trends={data.trends} />

            {/* Row 4 — Product distribution */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <KpiCard
                label="Events created"
                value={data.activation.eventsCreated.current}
                percentageChange={data.activation.eventsCreated.percentageChange}
                tooltip="Events created in the selected period."
              />
              <KpiCard
                label="Rooms with share intent"
                value={data.engagement.roomsWithShareIntent}
                unavailable={postHogUnavailable}
                tooltip="Rooms where a share action (WhatsApp, copy link, QR, native share) was triggered."
              />
              <KpiCard
                label="Rooms reached"
                value={data.engagement.roomsReached}
                unavailable={postHogUnavailable}
                tooltip="Rooms that received at least one guest view via a shared link."
              />
            </div>

            {/* Row 5 — Diagnostics (secondary) */}
            <div className="grid grid-cols-2 gap-3 opacity-90 sm:grid-cols-2">
              <KpiCard
                label="Share actions"
                value={data.engagement.shareActions}
                unavailable={postHogUnavailable}
                tooltip="Total share-intent actions triggered across all rooms."
              />
              <KpiCard
                label="Guest room views"
                value={data.engagement.guestRoomViews}
                unavailable={postHogUnavailable}
                tooltip="Total guest views of shared rooms."
              />
            </div>
          </>
        ) : null}
      </div>
    </TooltipProvider>
  )
}
