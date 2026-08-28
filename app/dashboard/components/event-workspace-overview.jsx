'use client'

import { ImagePlus, Lock, QrCode, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EventCoverEditor, EventCoverRemove } from './event-cover-editor'
import { getEffectiveEventStatus } from '../lib/event-status'

export function EventWorkspaceOverview({
  event,
  plan,
  totalPhotoCount,
  onShare,
  onQR,
  onCoverUpdated,
  onOwnerSessionFailure,
  t,
  tCommon,
}) {
  return (
    <div>
      {/* Status / stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-secondary p-3">
          <div className="flex items-center gap-2">
            <ImagePlus className="h-4 w-4 text-accent-dark" />
            <span className="text-xs font-medium text-muted-foreground">{t.photos}</span>
          </div>
          <p className="mt-1 font-display text-xl font-bold text-foreground">{totalPhotoCount}</p>
        </div>
        <div className="rounded-xl border border-border bg-secondary p-3">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-accent-dark" />
            <span className="text-xs font-medium text-muted-foreground">{t.status ?? 'Status'}</span>
          </div>
          <p className="mt-1 font-display text-xl font-bold text-foreground">
            {getEffectiveEventStatus({ event, plan, t })}
          </p>
        </div>
      </div>

      {/* Quick actions */}
      <div className="mt-5 space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" asChild className="h-10 cta-primary flex-1">
            <a href={`/event/${event.slug}`}>{t.viewEvent}</a>
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => onShare(event)} className="h-10 flex-1 border-border bg-surface text-foreground hover:bg-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent-dark">
            <Share2 className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
            {t.share}
          </Button>
          <Button size="sm" variant="outline" onClick={() => onQR(event)} className="h-10 flex-1 border-border bg-surface text-foreground hover:bg-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent-dark">
            <QrCode className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
            {t.qr}
          </Button>
        </div>
      </div>

      {/* Cover management */}
      <div className="mt-5 flex flex-wrap gap-2">
        <EventCoverEditor event={event} onCoverUpdated={onCoverUpdated} onOwnerSessionFailure={onOwnerSessionFailure} t={t} tCommon={tCommon} />
        <EventCoverRemove event={event} onCoverUpdated={onCoverUpdated} onOwnerSessionFailure={onOwnerSessionFailure} t={t} tCommon={tCommon} />
      </div>
    </div>
  )
}
