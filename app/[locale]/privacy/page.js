import { PrivacyPage } from '@/components/privacy-page'
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
    title: t.meta.privacyTitle,
    description: t.meta.privacyDescription,
    alternates: {
      canonical: `/${locale}/privacy`,
      languages: {
        en: '/en/privacy',
        de: '/de/privacy',
        it: '/it/privacy',
        fr: '/fr/privacy',
        es: '/es/privacy',
        'pt-BR': '/pt-BR/privacy',
        'x-default': '/en/privacy',
      },
    },
  }
}

export default function Privacy({ params }) {
  const { locale } = params
  if (!LOCALES.includes(locale)) notFound()
  const t = getDictionary(locale)
  const graph = getMarketingPageGraph({
    locale,
    path: '/privacy',
    name: t.meta.privacyTitle,
    description: t.meta.privacyDescription,
  })
  return (
    <>
      <JsonLd data={graph} />
      <PrivacyPage locale={locale} />
    </>
  )
}
