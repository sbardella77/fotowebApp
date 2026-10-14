'use client'

import { CheckCircle2, Copy, QrCode, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { trackEvent } from '@/lib/analytics/track-client'
import { EVENT_COPY_LINK_CLICKED, EVENT_NATIVE_SHARE_CLICKED, EVENT_QR_OPENED } from '@/lib/analytics/events'

/**
 * Copy link / native share / QR row shared by the owner-only room info card
 * and the "Share this event" card. `source` tags analytics events so the two
 * call sites stay distinguishable.
 */
export function ShareButtonsRow({ event, baseUrl, t, tCommon, copied, setCopied, showToast, onShowQR, source, buttonClassName = 'gap-1.5 border-border bg-elevated hover:bg-surface hover:text-foreground' }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" className={buttonClassName} onClick={async () => {
        trackEvent(EVENT_COPY_LINK_CLICKED, { room_slug: event?.slug, source })
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(`${baseUrl}/event/${event.slug}`); setCopied(true); showToast(t.linkCopied); setTimeout(() => setCopied(false), 2000)
          } else { showToast(t.copyNotSupported, 'error') }
        } catch { showToast(t.failedToCopy, 'error') }
      }}>
        {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? tCommon.copied : tCommon.copy}
      </Button>
      <Button size="sm" variant="outline" className={buttonClassName} onClick={async () => {
        trackEvent(EVENT_NATIVE_SHARE_CLICKED, { room_slug: event?.slug, source })
        const shareData = { title: t.joinRoomOnSnapRooms.replace('{name}', event.name), text: t.uploadYourPhotosTo.replace('{name}', event.name) + ' ' + t.useCode + ': ' + event.slug }
        if (typeof navigator !== 'undefined' && navigator.share) { try { await navigator.share(shareData); showToast(t.shared) } catch {} }
        else { try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(t.uploadYourPhotosTo.replace('{name}', event.name) + ' ' + t.useCode + ': ' + event.slug); showToast(t.inviteCopied) } else { showToast(t.shareNotSupported, 'error') } } catch { showToast(t.failedToCopy, 'error') } }
      }}>
        <Share2 className="h-3.5 w-3.5" />{t.nativeShare}
      </Button>
      <Button size="sm" variant="outline" className={buttonClassName} onClick={() => { trackEvent(EVENT_QR_OPENED, { room_slug: event?.slug, source }); onShowQR() }}>
        <QrCode className="h-3.5 w-3.5" />{t.showQR}
      </Button>
    </div>
  )
}
