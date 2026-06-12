import './globals.css'
import { Space_Grotesk, Inter, JetBrains_Mono } from 'next/font/google'
import { cookies } from 'next/headers'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { AnalyticsProvider } from '@/components/analytics-provider'
import { I18nProvider } from '@/components/i18n-provider'
import { LocaleHtmlAttributes } from '@/components/locale-html-attributes'
import { LOCALES, DEFAULT_LOCALE, LOCALE_COOKIE_NAME } from '@/lib/i18n/config'

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-space-grotesk',
  display: 'swap',
})

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://snaprooms.app'

export const metadata = {
  metadataBase: new URL(baseUrl),
  title: 'SnapRooms — Collect Every Guest Photo in One Event',
  description: 'Create a photo event for weddings, parties, and gatherings. Guests upload instantly by link or QR code — no app, no signup.',
  applicationName: 'SnapRooms',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
  },
  appleWebApp: {
    capable: true,
    title: 'SnapRooms',
  },
}

export const viewport = {
  themeColor: '#F8F6F1',
}

function App({ children }) {
  const cookieLocale = cookies().get(LOCALE_COOKIE_NAME)?.value
  const locale = LOCALES.includes(cookieLocale) ? cookieLocale : DEFAULT_LOCALE

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <link rel="preload" as="image" href="/snaprooms-logo.svg" type="image/svg+xml" />
        <script dangerouslySetInnerHTML={{ __html: 'window.addEventListener("error",function(e){if(e.error instanceof DOMException&&e.error.name==="DataCloneError"&&e.message&&e.message.includes("PerformanceServerTiming")){e.stopImmediatePropagation();e.preventDefault()}},true);' }} />
      </head>
      <body
        className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable} min-h-screen bg-background font-sans text-foreground antialiased`}
      >
        <I18nProvider initialLocale={locale}>
          <LocaleHtmlAttributes />
          <AnalyticsProvider>
            {children}
          </AnalyticsProvider>
        </I18nProvider>
        <SpeedInsights />
      </body>
    </html>
  )
}

export default App
