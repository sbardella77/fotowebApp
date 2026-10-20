import { notFound } from 'next/navigation'
import { LOCALES } from '@/lib/i18n/config'
import { getDictionary } from '@/lib/i18n/utils'
import { HomePageClient } from '@/components/home-page-client'
import { JsonLd } from '@/lib/structured-data/json-ld'
import { getMarketingPageGraph } from '@/lib/structured-data/page-graph'

export async function generateMetadata({ params }) {
  const { locale } = params
  if (!LOCALES.includes(locale)) notFound()
  const t = getDictionary(locale)
  return {
    title: t.meta.homeTitle,
    description: t.meta.homeDescription,
    alternates: {
      canonical: `/${locale}`,
      languages: {
        en: '/en',
        de: '/de',
        it: '/it',
        fr: '/fr',
        es: '/es',
        'pt-BR': '/pt-BR',
        'x-default': '/en',
      },
    },
  }
}

export default function HomePage({ params }) {
  const { locale } = params
  if (!LOCALES.includes(locale)) notFound()
  const t = getDictionary(locale)
  const graph = getMarketingPageGraph({
    locale,
    path: '/',
    name: t.meta.homeTitle,
    description: t.meta.homeDescription,
  })
  return (
    <>
      <JsonLd data={graph} />
      <HomePageClient locale={locale} />
    </>
  )
}
