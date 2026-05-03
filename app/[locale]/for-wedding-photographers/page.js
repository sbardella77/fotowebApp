import { PhotographersLandingPage } from '@/components/photographers-landing-page'
import { notFound } from 'next/navigation'
import { LOCALES } from '@/lib/i18n/config'
import { getDictionary } from '@/lib/i18n/utils'

export async function generateMetadata({ params }) {
  const { locale } = params
  if (!LOCALES.includes(locale)) notFound()
  const t = getDictionary(locale)
  return {
    title: t.meta.photographersTitle,
    description: t.meta.photographersDescription,
    alternates: {
      canonical: `/${locale}/for-wedding-photographers`,
      languages: {
        en: '/en/for-wedding-photographers',
        de: '/de/for-wedding-photographers',
        it: '/it/for-wedding-photographers',
        fr: '/fr/for-wedding-photographers',
        es: '/es/for-wedding-photographers',
      },
    },
  }
}

export default function ForWeddingPhotographers({ params }) {
  const { locale } = params
  if (!LOCALES.includes(locale)) notFound()
  return <PhotographersLandingPage locale={locale} />
}
