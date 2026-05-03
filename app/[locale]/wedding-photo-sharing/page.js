import { WeddingLandingPage } from '@/components/wedding-landing-page'
import { notFound } from 'next/navigation'
import { LOCALES } from '@/lib/i18n/config'
import { getDictionary } from '@/lib/i18n/utils'

export async function generateMetadata({ params }) {
  const { locale } = params
  if (!LOCALES.includes(locale)) notFound()
  const t = getDictionary(locale)
  return {
    title: t.meta.weddingTitle,
    description: t.meta.weddingDescription,
    alternates: {
      canonical: `/${locale}/wedding-photo-sharing`,
      languages: {
        en: '/en/wedding-photo-sharing',
        de: '/de/wedding-photo-sharing',
        it: '/it/wedding-photo-sharing',
        fr: '/fr/wedding-photo-sharing',
        es: '/es/wedding-photo-sharing',
      },
    },
  }
}

export default function WeddingPhotoSharing({ params }) {
  const { locale } = params
  if (!LOCALES.includes(locale)) notFound()
  return <WeddingLandingPage locale={locale} />
}
