'use client'

import { Plus, BarChart3, Share2, Upload, PackageOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function DashboardHeader({ experience, t, onCreateClick, onSecondaryAction }) {
  const title = t[experience?.header?.titleKey] || t.yourRooms || 'Your events'
  const description = t[experience?.header?.descriptionKey] || t.yourRoomsDesc || ''
  const primaryCta = experience?.primaryCta
  const secondaryCta = experience?.secondaryCta

  const primaryLabel =
    primaryCta === 'manage_delivery'
      ? (t.manageDelivery || 'Manage delivery')
      : (t[experience?.header?.ctaKey] || t.createNewRoom || 'Create event')

  const primaryIcon =
    primaryCta === 'manage_delivery' ? <PackageOpen className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />

  const secondaryConfig = {
    share_gallery: {
      label: t.shareGallery || 'Share gallery',
      icon: <Share2 className="mr-2 h-4 w-4" />,
    },
    upload_photos: {
      label: t.uploadPhotos || 'Upload photos',
      icon: <Upload className="mr-2 h-4 w-4" />,
    },
    view_analytics: {
      label: t.viewAnalytics || 'View Analytics',
      icon: <BarChart3 className="mr-2 h-4 w-4" />,
    },
  }

  const secondary = secondaryCta ? secondaryConfig[secondaryCta] : null

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-foreground">{title}</h1>
        <p className="mt-1.5 text-sm font-light text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        {secondary && onSecondaryAction && (
          <Button size="sm" variant="outline" className="shrink-0 border-border bg-surface text-foreground hover:bg-elevated" onClick={onSecondaryAction}>
            {secondary.icon}
            {secondary.label}
          </Button>
        )}
        <Button size="sm" className="cta-primary shrink-0" onClick={onCreateClick}>
          {primaryIcon}
          {primaryLabel}
        </Button>
      </div>
    </div>
  )
}
