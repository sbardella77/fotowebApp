import { CorporateLandingPage } from '@/components/corporate-landing-page'
import { notFound } from 'next/navigation'
import { LOCALES } from '@/lib/i18n/config'
import { getDictionary } from '@/lib/i18n/utils'

export async function generateMetadata({ params }) {
  const { locale } = params
  if (!LOCALES.includes(locale)) notFound()
  const t = getDictionary(locale)
  return {
    title: t.meta.corporateTitle,
    description: t.meta.corporateDescription,
    alternates: {
      canonical: `/${locale}/corporate-event-photo-sharing`,
      languages: {
        en: '/en/corporate-event-photo-sharing',
        it: '/it/corporate-event-photo-sharing',
        fr: '/fr/corporate-event-photo-sharing',
        es: '/es/corporate-event-photo-sharing',
      },
    },
  }
}

export default function CorporateEventPhotoSharing({ params }) {
  const { locale } = params
  if (!LOCALES.includes(locale)) notFound()
  return <CorporateLandingPage locale={locale} />
}
