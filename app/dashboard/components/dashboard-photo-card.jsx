'use client'

import { Eye, EyeOff, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function DashboardPhotoCard({ photo, onApprove, onReject, onDelete, onOpenLightbox, busyId }) {
  const safePhoto = photo || {}
  const id = safePhoto.id || ''
  const originalName = safePhoto.originalName || 'Untitled'
  const url = safePhoto.url || ''
  const uploaderName = safePhoto.uploaderName || 'Guest upload'
  const status = safePhoto.status || 'VISIBLE'
  const isBusy = busyId === id
  const isVisible = status === 'VISIBLE'
  const isHidden = status === 'HIDDEN'

  return (
    <div className="overflow-hidden surface-elevated rounded-xl transition-transform duration-200 hover:-translate-y-px">
      <button className="block w-full text-left" onClick={onOpenLightbox} type="button">
        {url ? (
          <img alt={originalName} className="aspect-square w-full object-cover" src={url} />
        ) : (
          <div className="aspect-square w-full bg-raised flex items-center justify-center text-muted-foreground text-xs">
            No image
          </div>
        )}
      </button>
      <div className="space-y-3 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{originalName}</p>
            <p className="truncate text-xs font-light text-muted-foreground">{uploaderName}</p>
          </div>
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium capitalize ${
              isVisible
                ? 'border-primary/20 bg-primary/10 text-accent-dark'
                : 'border-border bg-raised text-muted-foreground'
            }`}
          >
            {status.toLowerCase()}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Button disabled={isBusy || isVisible} size="sm" onClick={onApprove} className="h-9">
            {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
          </Button>
          <Button disabled={isBusy || isHidden} size="sm" variant="outline" onClick={onReject} className="h-9 border-border bg-raised hover:bg-elevated">
            <EyeOff className="h-3.5 w-3.5" />
          </Button>
          <Button disabled={isBusy} size="sm" variant="destructive" onClick={onDelete} className="h-9">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
