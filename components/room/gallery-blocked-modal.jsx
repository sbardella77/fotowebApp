'use client'

import { Button } from '@/components/ui/button'

export function GalleryBlockedModal({ isEventOwner, t, tCommon, onUnlock, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-xl">
        <p className="font-display text-lg font-bold tracking-tight text-foreground">
          {isEventOwner ? t.downloadFullGalleryZip : t.fullGalleryDownloadLocked}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {isEventOwner ? t.saveAllOriginalsWithProEvent : t.hostCanUnlockGalleryDownload}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Button size="sm" className="w-full cta-primary" onClick={onUnlock}>
            {isEventOwner ? t.unlockGalleryDownload : t.createYourOwnRoom}
          </Button>
          <Button size="sm" variant="ghost" className="w-full" onClick={onClose}>
            {tCommon.maybeLater}
          </Button>
        </div>
      </div>
    </div>
  )
}
