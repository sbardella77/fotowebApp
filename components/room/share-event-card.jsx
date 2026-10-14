'use client'

import { ShareButtonsRow } from '@/components/room/share-buttons-row'

export function ShareEventCard({ event, baseUrl, t, tCommon, copied, setCopied, showToast, onShowQR }) {
  return (
    <div className="rounded-2xl border border-border bg-surface shadow-card">
      <div className="p-5 sm:p-6">
        <p className="font-display text-base font-bold text-foreground">{t.shareThisEvent}</p>
        <p className="mt-1 text-sm font-light leading-relaxed text-muted-foreground">{t.inviteGuestsToAddPhotos}</p>
        <div className="mt-4">
          <ShareButtonsRow
            event={event}
            baseUrl={baseUrl}
            t={t}
            tCommon={tCommon}
            copied={copied}
            setCopied={setCopied}
            showToast={showToast}
            onShowQR={onShowQR}
            source="share_event_card"
            buttonClassName="gap-1.5 border-border bg-raised hover:bg-elevated hover:text-foreground"
          />
        </div>
      </div>
    </div>
  )
}
