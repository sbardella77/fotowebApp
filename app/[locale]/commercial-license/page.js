import { CommercialLicensePage } from '@/components/commercial-license-page'
import { notFound } from 'next/navigation'
import { LOCALES } from '@/lib/i18n/config'
import { getDictionary } from '@/lib/i18n/utils'

export async function generateMetadata({ params }) {
  const { locale } = params
  if (!LOCALES.includes(locale)) notFound()
  const t = getDictionary(locale)
  return {
    title: t.meta.commercialTitle,
    description: t.meta.commercialDescription,
    alternates: {
      canonical: `/${locale}/commercial-license`,
      languages: {
        en: '/en/commercial-license',
        de: '/de/commercial-license',
        it: '/it/commercial-license',
        fr: '/fr/commercial-license',
        es: '/es/commercial-license',
        'pt-BR': '/pt-BR/commercial-license',
      },
    },
  }
}

export default function CommercialLicense({ params }) {
  const { locale } = params
  if (!LOCALES.includes(locale)) notFound()
  return <CommercialLicensePage locale={locale} />
}
