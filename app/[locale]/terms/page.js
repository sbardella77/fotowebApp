import { TermsPage } from '@/components/terms-page'
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
    title: t.meta.termsTitle,
    description: t.meta.termsDescription,
    alternates: {
      canonical: `/${locale}/terms`,
      languages: {
        en: '/en/terms',
        de: '/de/terms',
        it: '/it/terms',
        fr: '/fr/terms',
        es: '/es/terms',
        'pt-BR': '/pt-BR/terms',
        'x-default': '/en/terms',
      },
    },
  }
}

export default function Terms({ params }) {
  const { locale } = params
  if (!LOCALES.includes(locale)) notFound()
  const t = getDictionary(locale)
  const graph = getMarketingPageGraph({
    locale,
    path: '/terms',
    name: t.meta.termsTitle,
    description: t.meta.termsDescription,
  })
  return (
    <>
      <JsonLd data={graph} />
      <TermsPage locale={locale} page="terms" />
    </>
  )
}
