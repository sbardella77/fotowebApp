import { TermsPage } from '@/components/terms-page'
import { notFound } from 'next/navigation'
import { LOCALES } from '@/lib/i18n/config'
import { getDictionary } from '@/lib/i18n/utils'

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
      },
    },
  }
}

export default function Terms({ params }) {
  const { locale } = params
  if (!LOCALES.includes(locale)) notFound()
  return <TermsPage locale={locale} page="terms" />
}
