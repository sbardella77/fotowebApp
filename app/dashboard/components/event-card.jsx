'use client'

import { Camera, ImagePlus, Loader2, Pencil, QrCode, Share2, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getEffectiveEventTierLabel } from '../lib/event-status'

export function EventCard({
  event,
  plan,
  selected,
  editing,
  editName,
  busyDetail,
  onSelect,
  onRenameStart,
  onRenameSave,
  onRenameCancel,
  onEditNameChange,
  onShare,
  onQR,
  onDelete,
  t,
  tCommon,
}) {
  const coverUrl = event.coverUrl || event.photos?.[0]?.url
  const photoCount = event.photoCount || event.photos?.length || 0

  return (
    <div
      onClick={onSelect}
      className={`group relative overflow-hidden rounded-xl border bg-surface transition-all duration-200 hover:-translate-y-px hover:shadow-elevated cursor-pointer ${
        selected
          ? 'border-primary/40 shadow-[0_0_0_1px_hsl(var(--accent)/0.15)]'
          : 'border-border hover:border-[hsl(var(--border-visible))]'
      }`}
    >
      {/* Cover */}
      <div className="relative h-40 overflow-hidden bg-raised">
        {coverUrl ? (
          <img src={coverUrl} alt={event.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/10 to-primary/5">
            <Camera className="h-10 w-10 text-muted-foreground/30" />
          </div>
        )}
        {getEffectiveEventTierLabel({ event, plan, t }) && (
          <div className="absolute right-3 top-3">
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-accent-dark backdrop-blur-sm">
              <Sparkles className="h-2.5 w-2.5" />
              {getEffectiveEventTierLabel({ event, plan, t })}
            </span>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/40 to-transparent" />
        <div className="absolute bottom-3 left-4 right-4">
          <p className="truncate text-sm font-semibold text-white text-shadow">{event.name}</p>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-white/80">{t.code} {event.slug}</p>
        </div>
      </div>

      {/* Body */}
      <div className="p-4">
        {editing ? (
          <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
            <Input
              value={editName}
              onChange={(e) => onEditNameChange?.(e.target.value)}
              className="h-9 rounded-lg border-input bg-surface text-foreground"
              disabled={busyDetail}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onRenameSave?.()
                if (e.key === 'Escape') onRenameCancel?.()
              }}
              autoFocus
            />
            <div className="flex gap-2">
              <Button size="sm" className="h-8" disabled={busyDetail} onClick={onRenameSave}>
                {busyDetail ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : tCommon.save}
              </Button>
              <Button size="sm" variant="ghost" className="h-8" onClick={onRenameCancel}>
                {tCommon.cancel}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <ImagePlus className="h-3.5 w-3.5 text-accent-dark" />
                <span className="font-light">{photoCount} {t.photos}</span>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" asChild className="cta-primary" onClick={(e) => e.stopPropagation()}>
                <a href={`/event/${event.slug}`}>{t.openRoom}</a>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation()
                  onShare(event)
                }}
                className="border-border bg-surface text-foreground hover:bg-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent-dark"
              >
                <Share2 className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                {t.share}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation()
                  onQR(event)
                }}
                className="border-border bg-surface text-foreground hover:bg-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent-dark"
              >
                <QrCode className="mr-1.5 h-3.5 w-3.5" />
                {t.qr}
              </Button>
            </div>

            <div className="mt-4 flex gap-3 pt-4 border-t border-border">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-xs font-light text-muted-foreground hover:text-foreground transition-colors"
                onClick={(e) => {
                  e.stopPropagation()
                  onRenameStart(event)
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
                {t.rename}
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-xs font-light text-destructive hover:text-destructive/80 transition-colors"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(event)
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {tCommon.delete}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
