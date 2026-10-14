'use client'

import { Copy, QrCode, Share2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { trackEvent } from '@/lib/analytics/track-client'
import {
  EVENT_WHATSAPP_SHARE_CLICKED,
  EVENT_COPY_LINK_CLICKED,
  EVENT_NATIVE_SHARE_CLICKED,
  EVENT_QR_OPENED,
} from '@/lib/analytics/events'

export function ViralShareSection({ event, baseUrl, t, showToast, onDismiss, onShowQR }) {
  return (
    <div className="mt-2 rounded-2xl border border-success/20 bg-success/5">
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display text-base font-bold text-foreground">{t.inviteOthers}</p>
            <p className="mt-1 text-sm font-light leading-relaxed text-muted-foreground">{t.viralDesc}</p>
          </div>
          <Button variant="ghost" size="icon" aria-label={t.dismiss} className="shrink-0 text-muted-foreground hover:text-foreground" onClick={onDismiss}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button size="sm" className="gap-1.5 bg-[#25D366] text-foreground hover:bg-[#128C7E] border-transparent" onClick={() => { trackEvent(EVENT_WHATSAPP_SHARE_CLICKED, { room_slug: event?.slug, source: 'viral_section' }); try { window.open(`https://wa.me/?text=${encodeURIComponent(`📸 Photos from ${event.name}\n\nAdd yours here 👇\n${baseUrl}/event/${event.slug}`)}`, '_blank') } catch (e) { console.warn(e) } }}>
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            {t.shareOnWhatsApp}
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 border-border bg-raised hover:bg-elevated hover:text-foreground" onClick={async () => { trackEvent(EVENT_COPY_LINK_CLICKED, { room_slug: event?.slug, source: 'viral_section' }); try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(`${baseUrl}/event/${event.slug}`); showToast(t.copied + '!') } else { showToast(t.copy + ' ' + t.error, 'error') } } catch { showToast(t.error, 'error') } }}>
            <Copy className="h-3.5 w-3.5" />{t.copyLink}
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 border-border bg-raised hover:bg-elevated hover:text-foreground" onClick={async () => { trackEvent(EVENT_NATIVE_SHARE_CLICKED, { room_slug: event?.slug, source: 'viral_section' }); const shareData = { title: t.joinRoomOnSnapRooms.replace('{name}', event.name), text: t.uploadYourPhotosTo.replace('{name}', event.name), url: `${baseUrl}/event/${event.slug}` }; if (typeof navigator !== 'undefined' && navigator.share) { try { await navigator.share(shareData); showToast(t.shared) } catch {} } else { try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(`${baseUrl}/event/${event.slug}`); showToast(t.copied + '!') } else { showToast(t.share + ' ' + t.error, 'error') } } catch { showToast(t.error, 'error') } } }}>
            <Share2 className="h-3.5 w-3.5" />{t.nativeShare}
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 border-border bg-raised hover:bg-elevated hover:text-foreground" onClick={() => { trackEvent(EVENT_QR_OPENED, { room_slug: event?.slug, source: 'viral_section' }); onShowQR() }}>
            <QrCode className="h-3.5 w-3.5" />{t.showQR}
          </Button>
        </div>
      </div>
    </div>
  )
}
