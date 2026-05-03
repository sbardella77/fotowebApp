import { notFound } from 'next/navigation'
import { LOCALES } from '@/lib/i18n/config'
import { getDictionary } from '@/lib/i18n/utils'
import { HomePageClient } from '@/components/home-page-client'

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
        it: '/it',
        fr: '/fr',
        es: '/es',
      },
    },
  }
}

export default function HomePage({ params }) {
  const { locale } = params
  if (!LOCALES.includes(locale)) notFound()
  return <HomePageClient locale={locale} />
}
