'use client'

import {
  Archive,
  Camera,
  CheckCircle2,
  Copy,
  Download,
  FolderHeart,
  ImagePlus,
  LinkIcon,
  Loader2,
  Lock,
  QrCode,
  RefreshCw,
  Share2,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DashboardPhotoCard } from './dashboard-photo-card'
import { EventCoverEditor, EventCoverRemove } from './event-cover-editor'
import { EventMomentsManager } from './event-moments-manager'
import { getEffectiveEventStatus } from '../lib/event-status'
import { resolveEffectiveEventAccessState } from '@/lib/event-access'
import { resolveAllUpsells } from '@/lib/upsell-context'
import { UpsellRow } from '@/components/upsell-row'
import { resolveEventRetentionState } from '@/lib/event-retention'
import { normalizeEvent } from '@/lib/dashboard-data-helpers'

export function EventDetailPanel({
  event,
  plan,
  subscriptionCanceledAt,
  photos,
  busyDetail,
  privateAssets,
  privateDeliveryLoading,
  privateDeliveryUploading,
  photographerLink,
  photographerLinkBusy,
  photographerLinkCopied,
  galleryDownloadBusy,
  checkoutBusy,
  photoBusyId,
  onShare,
  onQR,
  onGalleryDownload,
  onUpgradeProEvent,
  onUpgradeWeddingPro,
  onUpgradeProfessional,
  onDelete,
  onOpenLightbox,
  onModerate,
  onPhotoDelete,
  onPrivateUploadClick,
  onPrivateDownload,
  onPrivateDelete,
  onGeneratePhotoLink,
  onCopyPhotoLink,
  onRevokePhotoLink,
  onCoverUpdated,
  t,
  tPrivate,
  tCommon,
}) {
  event = normalizeEvent(event)
  if (!event) return null

  const state = resolveEffectiveEventAccessState({
    billingTier: event.billingTier,
    originalDownloadUnlocked: event.originalDownloadUnlocked,
    ownerPlan: plan,
  })

  const retentionState = resolveEventRetentionState({
    event,
    ownerPlan: plan,
    ownerSubscriptionCanceledAt: subscriptionCanceledAt,
  })

  const allEventUpsells = resolveAllUpsells(state)
  const eventUpgradeFeatures = new Set(['pro_event_upgrade', 'wedding_pro_upgrade'])
  const eventUpgradeUpsells = allEventUpsells.filter((u) => eventUpgradeFeatures.has(u.feature))
  const otherUpsells = allEventUpsells.filter((u) => !eventUpgradeFeatures.has(u.feature) && u.feature !== 'room_limit')

  // Source of truth for the total event photo count (visible photos only).
  // photos.length may include hidden/moderated photos, so it must not be used for the main stats count.
  const totalPhotoCount = Number.isFinite(event.photoCount) ? event.photoCount : photos.length

  const firstVisiblePhoto = photos.find((p) => p.status === 'VISIBLE')
  const heroUrl = event.coverUrl || firstVisiblePhoto?.url

  return (
    <div className="flex h-full flex-col">
      {/* Hero */}
      <div className="relative h-48 overflow-hidden bg-raised">
        {heroUrl ? (
          <img src={heroUrl} alt={event.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/10 to-primary/5">
            <Camera className="h-12 w-12 text-muted-foreground/25" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
        <div className="absolute bottom-4 left-5 right-5">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl font-bold tracking-tight text-white text-shadow">{event.name}</h2>
          </div>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-white/80">{t.code} {event.slug}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {/* Cover actions */}
        <div className="flex flex-wrap gap-2">
          <EventCoverEditor event={event} onCoverUpdated={onCoverUpdated} t={t} tCommon={tCommon} />
          <EventCoverRemove event={event} onCoverUpdated={onCoverUpdated} t={t} tCommon={tCommon} />
        </div>

        {/* Stats */}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-border bg-raised p-3">
            <div className="flex items-center gap-2">
              <ImagePlus className="h-4 w-4 text-accent-dark" />
              <span className="text-xs font-medium text-muted-foreground">{t.photos}</span>
            </div>
            <p className="mt-1 font-display text-xl font-bold text-foreground">{totalPhotoCount}</p>
          </div>
          <div className="rounded-xl border border-border bg-raised p-3">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-accent-dark" />
              <span className="text-xs font-medium text-muted-foreground">{t.status ?? 'Status'}</span>
            </div>
            <p className="mt-1 font-display text-xl font-bold text-foreground">
              {getEffectiveEventStatus({ event, plan, t })}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-5 space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" asChild className="cta-primary flex-1">
              <a href={`/event/${event.slug}`}>{t.openRoom}</a>
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => onShare(event)} className="flex-1 border-border bg-surface text-foreground hover:bg-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent-dark">
              <Share2 className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
              {t.share}
            </Button>
            <Button size="sm" variant="outline" onClick={() => onQR(event)} className="flex-1 border-border bg-surface text-foreground hover:bg-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent-dark">
              <QrCode className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
              {t.qr}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={galleryDownloadBusy || totalPhotoCount === 0}
              onClick={() => onGalleryDownload(event)}
              className="flex-1 border-border bg-surface text-foreground hover:bg-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent-dark"
            >
              {galleryDownloadBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin text-muted-foreground" /> : <Archive className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />}
              {t.downloadAll || 'Download all'}
            </Button>
          </div>
        </div>

        {/* Moments */}
        <div className="mt-5">
          <EventMomentsManager event={event} t={t} />
        </div>

        {/* Event-level upgrades */}
        <div className="mt-5 space-y-3 rounded-xl border border-border bg-raised p-4">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-accent-dark">{t.eventUpgradeTitle ?? 'Event upgrades'}</p>
          {state.accountPremium ? (
            <div className="mt-2">
              <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-accent-dark">
                <Sparkles className="mr-1 h-3 w-3" />
                {t.coveredByProfessional ?? 'Covered by Professional'}
              </span>
            </div>
          ) : (
            <>
              {eventUpgradeUpsells.map((upsell) => (
                <UpsellRow
                  key={upsell.feature}
                  upsell={upsell}
                  t={t}
                  onUpgrade={(plan, upsellType) => {
                    if (plan === 'pro_event') onUpgradeProEvent?.(upsellType)
                    if (plan === 'wedding_pro') onUpgradeWeddingPro?.(upsellType)
                  }}
                  checkoutBusy={checkoutBusy}
                  source="dashboard_event_panel"
                  eventSlug={event.slug}
                  eventId={event.id}
                  ownerPlan={plan}
                  billingTier={event.billingTier}
                  effectivePlan={state.effectivePlan}
                />
              ))}
              {eventUpgradeUpsells.length === 0 && (
                <div className="mt-2">
                  <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-accent-dark">
                    <Sparkles className="mr-1 h-3 w-3" />
                    {event.billingTier === 'wedding_pro' ? t.weddingPro : t.proEvent}
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Plan info */}
        <div className="mt-3 space-y-3 rounded-xl border border-border bg-raised p-4">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-accent-dark">{t.planInfo ?? 'Plan'}</p>
          {otherUpsells.map((upsell) => (
            <UpsellRow
              key={upsell.feature}
              upsell={upsell}
              t={t}
              onUpgrade={(plan, upsellType) => {
                if (plan === 'professional') onUpgradeProfessional?.(upsellType)
              }}
              checkoutBusy={checkoutBusy}
              source="dashboard_event_panel"
              eventSlug={event.slug}
              eventId={event.id}
              ownerPlan={plan}
              billingTier={event.billingTier}
              effectivePlan={state.effectivePlan}
            />
          ))}
          {otherUpsells.length === 0 && (
            <div className="mt-2">
              <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-accent-dark">
                <Sparkles className="mr-1 h-3 w-3" />
                {state.accountPremium ? (plan === 'business' ? (t.business ?? 'Business') : (t.professional ?? 'Professional')) : (event.billingTier === 'wedding_pro' ? t.weddingPro : t.proEvent)}
              </span>
            </div>
          )}
        </div>

        {/* Storage duration */}
        <div className="mt-3 rounded-xl border border-border bg-raised p-4">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-accent-dark">{t.storageDuration ?? 'Storage duration'}</p>
          <div className="mt-2 text-sm text-muted-foreground">
            {retentionState.policy === 'professional_active' ? (
              <span>{t.storedWhileSubscriptionActive ?? 'Stored while your subscription is active.'}</span>
            ) : retentionState.retentionUntil ? (
              <span>
                {t.storedUntil ?? 'Photos stored until'}:{' '}
                <span className="font-medium text-foreground">
                  {new Date(retentionState.retentionUntil).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                </span>
              </span>
            ) : (
              <span>{t.storedWhileSubscriptionActive ?? 'Stored while your subscription is active.'}</span>
            )}
          </div>
          {retentionState.isExpiringSoon && !retentionState.coveredByVault && (
            <div className="mt-2 text-xs text-amber-500">
              {t.storageExpiresSoon ?? 'Storage expires soon'}
            </div>
          )}
          {retentionState.canExtend && !retentionState.coveredByVault && (
            <div className="mt-2 text-xs text-muted-foreground">
              {t.snaproomsVault ?? 'SnapRooms Vault'} — {t.comingSoon ?? 'Coming soon'}
            </div>
          )}
        </div>

        {/* Photos */}
        <div className="mt-6">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-accent-dark">{t.roomPhotos}</p>
          {busyDetail ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t.loadingPhotos}
            </div>
          ) : photos.length === 0 ? (
            <div className="mt-3 rounded-xl border border-dashed border-border bg-raised p-8 text-center">
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

        {/* Private Delivery */}
        {state.hasPrivateDelivery && (
          <div className="mt-6 rounded-xl border border-primary/20 bg-surface shadow-card">
            <div className="p-4">
              <div className="flex items-center gap-2">
                <FolderHeart className="h-4 w-4 text-accent-dark" />
                <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-accent-dark">{tPrivate.privateDelivery}</span>
              </div>
              <h3 className="mt-2 font-display text-base font-bold tracking-tight text-foreground">{tPrivate.professionalFiles}</h3>
              <p className="mt-1 text-xs font-light leading-relaxed text-muted-foreground">{tPrivate.privateDeliveryDesc}</p>

              <div className="mt-3">
                <Button size="sm" className="cta-primary" disabled={privateDeliveryUploading} onClick={onPrivateUploadClick}>
                  {privateDeliveryUploading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
                  {privateDeliveryUploading ? tPrivate.uploading : tPrivate.uploadFile}
                </Button>
              </div>

              <div className="mt-4">
                {privateDeliveryLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {tPrivate.loadingPrivateFiles}
                  </div>
                ) : privateAssets.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-primary/10 bg-raised p-6 text-center">
                    <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-accent-dark">
                      <FolderHeart className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-semibold text-foreground">{tPrivate.noPrivateFiles}</p>
                    <p className="mt-1 text-xs font-light text-muted-foreground">{tPrivate.uploadOriginalDesc}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {privateAssets.map((asset) => (
                      <div key={asset.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-raised p-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{asset.originalName}</p>
                          <p className="mt-0.5 text-xs font-light text-muted-foreground">{(asset.size / (1024 * 1024)).toFixed(1)} MB · {asset.mimeType?.replace('image/', '').toUpperCase()}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="outline" className="h-8 border-border bg-surface hover:bg-elevated hover:text-foreground" onClick={() => onPrivateDownload(asset)}>
                            <Download className="mr-1.5 h-3.5 w-3.5" />
                            {tPrivate.download}
                          </Button>
                          <Button size="sm" variant="destructive" className="h-8" disabled={busyDetail} onClick={() => onPrivateDelete(asset.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Photographer Link */}
              <div className="mt-5 rounded-xl border border-border bg-raised p-4">
                <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-accent-dark">{tPrivate.photographerLink}</span>
                <p className="mt-1 text-xs font-light leading-relaxed text-muted-foreground">{tPrivate.photographerLinkDesc}</p>
                <div className="mt-3">
                  {!photographerLink && !event?.hasPhotographerUploadLink && (
                    <Button size="sm" variant="outline" className="border-border bg-surface hover:bg-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent-dark" disabled={photographerLinkBusy} onClick={onGeneratePhotoLink}>
                      {photographerLinkBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <LinkIcon className="mr-1.5 h-3.5 w-3.5" />}
                      {tPrivate.generateLink}
                    </Button>
                  )}
                  {!photographerLink && event?.hasPhotographerUploadLink && (
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs text-muted-foreground">{tPrivate.linkAlreadyExists}</p>
                      <Button size="sm" variant="outline" className="border-border bg-surface hover:bg-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent-dark" disabled={photographerLinkBusy} onClick={onGeneratePhotoLink}>
                        {photographerLinkBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                        {tPrivate.regenerate}
                      </Button>
                      <Button size="sm" variant="destructive" className="h-8" disabled={photographerLinkBusy} onClick={onRevokePhotoLink}>
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        {tPrivate.revoke}
                      </Button>
                    </div>
                  )}
                  {photographerLink && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
                        <span className="truncate text-xs text-foreground">{photographerLink}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" className="border-border bg-surface hover:bg-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent-dark" onClick={onCopyPhotoLink}>
                          {photographerLinkCopied ? <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
                          {photographerLinkCopied ? tPrivate.copied : tPrivate.copyLink}
                        </Button>
                        <Button size="sm" variant="outline" className="border-border bg-surface hover:bg-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent-dark" disabled={photographerLinkBusy} onClick={onGeneratePhotoLink}>
                          {photographerLinkBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                          {tPrivate.regenerate}
                        </Button>
                        <Button size="sm" variant="destructive" className="h-8" disabled={photographerLinkBusy} onClick={onRevokePhotoLink}>
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                          {tPrivate.revoke}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Delete action */}
        <div className="mt-6 border-t border-border pt-5">
          <button
            type="button"
            onClick={() => onDelete(event)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
            {t.deleteRoomTitle}
          </button>
        </div>
      </div>
    </div>
  )
}
