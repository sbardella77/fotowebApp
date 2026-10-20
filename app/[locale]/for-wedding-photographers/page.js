import { PhotographersLandingPage } from '@/components/photographers-landing-page'
import { notFound } from 'next/navigation'
import { LOCALES } from '@/lib/i18n/config'
import { getDictionary } from '@/lib/i18n/utils'
import { JsonLd } from '@/lib/structured-data/json-ld'
import { getMarketingPageGraph } from '@/lib/structured-data/page-graph'

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
        'pt-BR': '/pt-BR/for-wedding-photographers',
        'x-default': '/en/for-wedding-photographers',
      },
    },
  }
}

export default function ForWeddingPhotographers({ params }) {
  const { locale } = params
  if (!LOCALES.includes(locale)) notFound()
  const t = getDictionary(locale)
  const graph = getMarketingPageGraph({
    locale,
    path: '/for-wedding-photographers',
    name: t.meta.photographersTitle,
    description: t.meta.photographersDescription,
  })
  return (
    <>
      <JsonLd data={graph} />
      <PhotographersLandingPage locale={locale} />
    </>
  )
}
