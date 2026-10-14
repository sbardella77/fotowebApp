'use client'

import { Copy, QrCode, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslations } from '@/components/i18n-provider'
import { trackEvent } from '@/lib/analytics/track-client'
import { EVENT_WHATSAPP_SHARE_CLICKED, EVENT_COPY_LINK_CLICKED } from '@/lib/analytics/events'

export function NewRoomShareBanner({ event, baseUrl, onDismiss, showToast, onShowQR }) {
  const t = useTranslations('room')
  const eventUrl = `${baseUrl}/event/${event.slug}`
  const shareText = `📸 ${event.name}\n\n${eventUrl}`

  const openWhatsApp = () => {
    trackEvent(EVENT_WHATSAPP_SHARE_CLICKED, { room_slug: event?.slug, source: 'new_room_banner' })
    try { window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank') } catch (e) { console.warn(e) }
  }
  const openTelegram = () => {
    try { window.open(`https://t.me/share/url?url=${encodeURIComponent(eventUrl)}&text=${encodeURIComponent(`📸 ${event.name}`)}`, '_blank') } catch (e) { console.warn(e) }
  }
  const copyLink = async () => {
    trackEvent(EVENT_COPY_LINK_CLICKED, { room_slug: event?.slug, source: 'new_room_banner' })
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(eventUrl)
        showToast(t.copied + '!')
      } else { showToast(t.copy + ' ' + t.error, 'error') }
    } catch { showToast(t.error, 'error') }
  }

  return (
    <div className="mt-6 rounded-2xl border border-border bg-surface shadow-card">
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display text-base font-bold text-foreground">{t.inviteOthers}</p>
            <p className="mt-1 text-sm font-light leading-relaxed text-muted-foreground">{t.noAppNeeded}</p>
          </div>
          <Button variant="ghost" size="icon" aria-label={t.dismiss} className="shrink-0 text-muted-foreground hover:text-foreground" onClick={onDismiss}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Button size="sm" className="gap-1.5 bg-[#25D366] text-foreground hover:bg-[#128C7E] border-transparent" onClick={openWhatsApp}>
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            {t.whatsapp}
          </Button>
          <Button size="sm" className="gap-1.5 bg-[#0088cc] text-foreground hover:bg-[#0077b3] border-transparent" onClick={openTelegram}>
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
            {t.telegram}
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 border-border bg-raised hover:bg-elevated hover:text-foreground" onClick={copyLink}>
            <Copy className="h-3.5 w-3.5" />{t.copyLink}
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 border-border bg-raised hover:bg-elevated hover:text-foreground" onClick={onShowQR}>
            <QrCode className="h-3.5 w-3.5" />{t.showQR}
          </Button>
        </div>
      </div>
    </div>
  )
}
