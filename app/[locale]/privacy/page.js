import { PrivacyPage } from '@/components/privacy-page'
import { notFound } from 'next/navigation'
import { LOCALES } from '@/lib/i18n/config'
import { getDictionary } from '@/lib/i18n/utils'

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
      },
    },
  }
}

export default function Privacy({ params }) {
  const { locale } = params
  if (!LOCALES.includes(locale)) notFound()
  return <PrivacyPage locale={locale} />
}
