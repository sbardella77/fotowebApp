'use client'

import { useEffect, useState } from 'react'
import { Camera } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getEffectiveEventStatus } from '../lib/event-status'
import { resolveEffectiveEventAccessState } from '@/lib/event-access'
import { resolveAllUpsells } from '@/lib/upsell-context'
import { resolveEventRetentionState } from '@/lib/event-retention'
import { normalizeEvent } from '@/lib/dashboard-data-helpers'
import { EventWorkspaceOverview } from './event-workspace-overview'
import { EventWorkspacePhotos } from './event-workspace-photos'
import { EventWorkspaceDelivery } from './event-workspace-delivery'
import { EventWorkspaceSettings } from './event-workspace-settings'

const TAB_LIST_CLASS =
  'flex h-auto w-full items-center justify-start gap-1 overflow-x-auto rounded-none border-b border-border bg-transparent p-0 pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'

const TAB_TRIGGER_CLASS =
  'shrink-0 whitespace-nowrap rounded-none border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dark data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-none'

const TAB_CONTENT_CLASS = 'mt-0 p-5 data-[state=inactive]:hidden'

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
  onOwnerSessionFailure,
  t,
  tPrivate,
  tCommon,
}) {
  const normalizedEvent = normalizeEvent(event)

  // Hooks must run unconditionally on every render (the `if (!normalizedEvent)
  // return null` below happens after them) — see the mount-fetch comment in
  // EventMomentsManager for the established slug-keyed reset idiom this
  // mirrors. Switching to a DIFFERENT event resets the active tab back to
  // Overview; re-fetching the SAME event (slug unchanged) does not, since the
  // effect is keyed on slug, not on event-object identity.
  const [activeTab, setActiveTab] = useState('overview')
  useEffect(() => {
    setActiveTab('overview')
  }, [normalizedEvent?.slug])

  if (!normalizedEvent) return null
  event = normalizedEvent

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
  const isWeddingProEvent = event.billingTier === 'wedding_pro'
  const isProEvent = event.billingTier === 'pro_event'
  const isAccountPremium = state.accountPremium
  let eventUpgradeUpsells = allEventUpsells.filter((u) => eventUpgradeFeatures.has(u.feature))
  if (isWeddingProEvent) {
    eventUpgradeUpsells = []
  } else if (isProEvent) {
    eventUpgradeUpsells = eventUpgradeUpsells.filter((u) => u.feature === 'wedding_pro_upgrade')
  }
  const otherUpsells = allEventUpsells.filter((u) => !eventUpgradeFeatures.has(u.feature) && u.feature !== 'room_limit')

  // Source of truth for the total event photo count (visible photos only).
  // photos.length may include hidden/moderated photos, so it must not be used for the main stats count.
  const totalPhotoCount = Number.isFinite(event.photoCount) ? event.photoCount : photos.length

  const firstVisiblePhoto = photos.find((p) => p.status === 'VISIBLE')
  const heroUrl = event.coverUrl || firstVisiblePhoto?.url

  return (
    <div className="flex h-full flex-col">
      {/* Hero */}
      <div className="relative h-48 shrink-0 overflow-hidden bg-secondary">
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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-1 flex-col overflow-hidden">
        <TabsList className={TAB_LIST_CLASS}>
          <TabsTrigger value="overview" className={TAB_TRIGGER_CLASS}>{t.workspaceOverview}</TabsTrigger>
          <TabsTrigger value="photos" className={TAB_TRIGGER_CLASS}>{t.workspacePhotos}</TabsTrigger>
          <TabsTrigger value="delivery" className={TAB_TRIGGER_CLASS}>{t.workspaceDelivery}</TabsTrigger>
          <TabsTrigger value="settings" className={TAB_TRIGGER_CLASS}>{t.workspaceSettings}</TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-y-auto">
          <TabsContent value="overview" forceMount className={TAB_CONTENT_CLASS}>
            <EventWorkspaceOverview
              event={event}
              plan={plan}
              totalPhotoCount={totalPhotoCount}
              onShare={onShare}
              onQR={onQR}
              onCoverUpdated={onCoverUpdated}
              onOwnerSessionFailure={onOwnerSessionFailure}
              t={t}
              tCommon={tCommon}
            />
          </TabsContent>

          <TabsContent value="photos" forceMount className={TAB_CONTENT_CLASS}>
            <EventWorkspacePhotos
              event={event}
              photos={photos}
              busyDetail={busyDetail}
              photoBusyId={photoBusyId}
              onModerate={onModerate}
              onPhotoDelete={onPhotoDelete}
              onOpenLightbox={onOpenLightbox}
              onOwnerSessionFailure={onOwnerSessionFailure}
              t={t}
            />
          </TabsContent>

          <TabsContent value="delivery" forceMount className={TAB_CONTENT_CLASS}>
            <EventWorkspaceDelivery
              event={event}
              hasPrivateDelivery={state.hasPrivateDelivery}
              totalPhotoCount={totalPhotoCount}
              galleryDownloadBusy={galleryDownloadBusy}
              onGalleryDownload={onGalleryDownload}
              privateAssets={privateAssets}
              privateDeliveryLoading={privateDeliveryLoading}
              privateDeliveryUploading={privateDeliveryUploading}
              onPrivateUploadClick={onPrivateUploadClick}
              onPrivateDownload={onPrivateDownload}
              onPrivateDelete={onPrivateDelete}
              busyDetail={busyDetail}
              photographerLink={photographerLink}
              photographerLinkBusy={photographerLinkBusy}
              photographerLinkCopied={photographerLinkCopied}
              onGeneratePhotoLink={onGeneratePhotoLink}
              onCopyPhotoLink={onCopyPhotoLink}
              onRevokePhotoLink={onRevokePhotoLink}
              t={t}
            />
          </TabsContent>

          <TabsContent value="settings" forceMount className={TAB_CONTENT_CLASS}>
            <EventWorkspaceSettings
              event={event}
              plan={plan}
              isAccountPremium={isAccountPremium}
              isWeddingProEvent={isWeddingProEvent}
              isProEvent={isProEvent}
              eventUpgradeUpsells={eventUpgradeUpsells}
              otherUpsells={otherUpsells}
              effectivePlan={state.effectivePlan}
              checkoutBusy={checkoutBusy}
              onUpgradeProEvent={onUpgradeProEvent}
              onUpgradeWeddingPro={onUpgradeWeddingPro}
              onUpgradeProfessional={onUpgradeProfessional}
              retentionState={retentionState}
              onDelete={onDelete}
              t={t}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}
