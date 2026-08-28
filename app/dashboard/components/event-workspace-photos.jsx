'use client'

import { ImagePlus } from 'lucide-react'
import { DashboardPhotoCard } from './dashboard-photo-card'
import { EventMomentsManager } from './event-moments-manager'
import { Skeleton } from '@/components/ui/skeleton'

export function EventWorkspacePhotos({
  event,
  photos,
  busyDetail,
  photoBusyId,
  onModerate,
  onPhotoDelete,
  onOpenLightbox,
  onOwnerSessionFailure,
  t,
}) {
  return (
    <div>
      {/* Moderation is the primary job of this tab; Moments is a supporting
          organizational tool, kept below and visually lighter so it doesn't
          compete with it. */}
      <div>
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-accent-dark">{t.roomPhotos}</p>
        {busyDetail ? (
          <div className="mt-3 grid grid-cols-2 gap-2" aria-busy="true" aria-live="polite">
            <span className="sr-only">{t.loadingPhotos}</span>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="overflow-hidden rounded-xl border border-border bg-surface">
                <Skeleton className="aspect-square w-full rounded-none" />
                <div className="space-y-2 p-3">
                  <Skeleton className="h-4 w-2/3" />
                  <div className="grid grid-cols-3 gap-2">
                    <Skeleton className="h-10" />
                    <Skeleton className="h-10" />
                    <Skeleton className="h-10" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : photos.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-border bg-secondary p-8 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-accent-dark">
              <ImagePlus className="h-5 w-5" />
            </div>
            <p className="text-sm font-semibold text-foreground">{t.noPhotosYet}</p>
            <p className="mt-1 text-xs font-light text-muted-foreground">{t.shareToStart}</p>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {photos.map((photo, index) => (
              <DashboardPhotoCard
                key={photo.id}
                busyId={photoBusyId}
                photo={photo}
                onApprove={() => onModerate(photo.id, 'approve')}
                onDelete={() => onPhotoDelete(photo.id)}
                onOpenLightbox={() => onOpenLightbox(index)}
                onReject={() => onModerate(photo.id, 'reject')}
              />
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 border-t border-border pt-5">
        <EventMomentsManager event={event} t={t} onOwnerSessionFailure={onOwnerSessionFailure} />
      </div>
    </div>
  )
}
