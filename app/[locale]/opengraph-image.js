import { ImageResponse } from 'next/og'
import { LOCALES, DEFAULT_LOCALE } from '@/lib/i18n/config'
import { getDictionary } from '@/lib/i18n/utils'
import { BASE_URL } from '@/lib/structured-data/constants'

// Link-preview card for every localized marketing page (WhatsApp, Facebook,
// LinkedIn, X, iMessage). One card per locale, rendered at build/first request.
export const alt = 'SnapRooms'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpengraphImage({ params }) {
  const locale = LOCALES.includes(params?.locale) ? params.locale : DEFAULT_LOCALE
  const t = getDictionary(locale)
  const badge = t.landing.badge

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 80px',
          background: '#F8F6F1',
          color: '#1F1F1F',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <img src={`${BASE_URL}/icon-512.png`} width={64} height={64} alt="" style={{ borderRadius: 14 }} />
          <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>SnapRooms</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>{t.landing.headline1}</div>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2, color: '#8A9A1B' }}>{t.landing.headline2}</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 30, color: '#5C5C5C' }}>
          <div style={{ display: 'flex' }}>{badge}</div>
          <div style={{ display: 'flex' }}>snaprooms.app</div>
        </div>
      </div>
    ),
    size
  )
}
