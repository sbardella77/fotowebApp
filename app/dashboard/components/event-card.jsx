'use client'

import { Camera, ExternalLink, ImagePlus, Loader2, MoreVertical, Pencil, QrCode, Share2, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getEffectiveEventTierLabel } from '../lib/event-status'

export function EventCard({
  event,
  plan,
  selected,
  editing,
  editName,
  busyDetail,
  onManage,
  onManageMobile,
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
      className={`relative overflow-hidden rounded-xl border bg-surface transition-colors duration-200 ${
        selected
          ? 'border-primary/40 shadow-[0_0_0_1px_hsl(var(--accent)/0.15)]'
          : 'border-border'
      }`}
    >
      {/* Cover */}
      <div className="relative h-40 overflow-hidden bg-secondary">
        {coverUrl ? (
          <img src={coverUrl} alt={event.name} className="h-full w-full object-cover" />
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
          <div className="space-y-3">
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

            <div className="mt-4 space-y-2">
              {/* Primary: Manage — desktop (xl+) selects the event for the contextual right panel */}
              <Button
                size="sm"
                className="hidden w-full cta-primary xl:inline-flex"
                onClick={() => onManage(event)}
              >
                {t.manageEvent}
              </Button>
              {/* Primary: Manage — below xl, also opens the immediate workspace Sheet.
                  Taller than the desktop variant (h-11 ≈ 44px): this is the
                  highest-frequency touch target on the card, tapped on every
                  mobile/tablet visit. */}
              <Button
                size="sm"
                className="flex h-11 w-full cta-primary xl:hidden"
                onClick={(e) => onManageMobile(event, e.currentTarget)}
              >
                {t.manageEvent}
              </Button>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onShare(event)}
                  className="h-10 flex-1 border-border bg-surface text-foreground hover:bg-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent-dark"
                >
                  <Share2 className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                  {t.share}
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={t.moreActions}
                      className="h-10 w-10 shrink-0 border-border bg-surface px-0 text-foreground hover:bg-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent-dark"
                    >
                      <MoreVertical className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="border-border bg-surface">
                    <DropdownMenuItem asChild className="py-2.5">
                      <a href={`/event/${event.slug}`}>
                        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                        {t.viewEvent}
                      </a>
                    </DropdownMenuItem>
                    <DropdownMenuItem className="py-2.5" onSelect={() => onQR(event)}>
                      <QrCode className="h-3.5 w-3.5 text-muted-foreground" />
                      {t.qr}
                    </DropdownMenuItem>
                    <DropdownMenuItem className="py-2.5" onSelect={() => onRenameStart(event)}>
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                      {t.rename}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="py-2.5 text-destructive focus:bg-destructive/10 focus:text-destructive"
                      onSelect={() => onDelete(event)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {tCommon.delete}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
