import './globals.css'
import { Syne, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google'
import { cookies } from 'next/headers'
import { AnalyticsProvider } from '@/components/analytics-provider'
import { I18nProvider } from '@/components/i18n-provider'
import { LocaleHtmlAttributes } from '@/components/locale-html-attributes'
import { LOCALES, DEFAULT_LOCALE, LOCALE_COOKIE_NAME } from '@/lib/i18n/config'

const syne = Syne({
  subsets: ['latin'],
  weight: ['700', '800'],
  variable: '--font-syne',
  display: 'swap',
})

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-ibm-plex-sans',
  display: 'swap',
})

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-ibm-plex-mono',
  display: 'swap',
})

const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://snaprooms.app'

export const metadata = {
  metadataBase: new URL(baseUrl),
  title: 'SnapRooms — Collect Every Guest Photo in One Room',
  description: 'Create a photo room for weddings, parties, and events. Guests upload instantly by link or QR code — no app, no signup.',
  applicationName: 'SnapRooms',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-icon.png',
  },
  appleWebApp: {
    capable: true,
    title: 'SnapRooms',
  },
}

function App({ children }) {
  const cookieLocale = cookies().get(LOCALE_COOKIE_NAME)?.value
  const locale = LOCALES.includes(cookieLocale) ? cookieLocale : DEFAULT_LOCALE

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: 'window.addEventListener("error",function(e){if(e.error instanceof DOMException&&e.error.name==="DataCloneError"&&e.message&&e.message.includes("PerformanceServerTiming")){e.stopImmediatePropagation();e.preventDefault()}},true);' }} />
      </head>
      <body
        className={`${syne.variable} ${ibmPlexSans.variable} ${ibmPlexMono.variable} min-h-screen bg-background font-sans text-foreground antialiased`}
      >
        <I18nProvider initialLocale={locale}>
          <LocaleHtmlAttributes />
          <AnalyticsProvider>
            {children}
          </AnalyticsProvider>
        </I18nProvider>
      </body>
    </html>
  )
}

export default App
