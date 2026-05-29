'use client'

import { Plus, BarChart3 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function DashboardHeader({ experience, t, onCreateClick, onAnalyticsClick }) {
  const title = t[experience?.header?.titleKey] || t.yourRooms || 'Your events'
  const description = t[experience?.header?.descriptionKey] || t.yourRoomsDesc || ''
  const ctaKey = experience?.primaryCta

  const ctaLabel =
    ctaKey === 'view_analytics'
      ? (t.viewAnalytics || 'View Analytics')
      : ctaKey === 'manage_event'
      ? (t.manageEvent || 'Manage event')
      : (t[experience?.header?.ctaKey] || t.createNewRoom || 'Create event')

  const ctaAction =
    ctaKey === 'view_analytics' && onAnalyticsClick
      ? onAnalyticsClick
      : onCreateClick

  const ctaIcon =
    ctaKey === 'view_analytics' ? <BarChart3 className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-foreground">{title}</h1>
        <p className="mt-1.5 text-sm font-light text-muted-foreground">{description}</p>
      </div>
      <Button size="sm" className="cta-primary shrink-0" onClick={ctaAction}>
        {ctaIcon}
        {ctaLabel}
      </Button>
    </div>
  )
}
