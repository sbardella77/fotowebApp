import { PlannersLandingPage } from '@/components/planners-landing-page'
import { notFound } from 'next/navigation'
import { LOCALES } from '@/lib/i18n/config'
import { getDictionary } from '@/lib/i18n/utils'

export async function generateMetadata({ params }) {
  const { locale } = params
  if (!LOCALES.includes(locale)) notFound()
  const t = getDictionary(locale)
  return {
    title: t.meta.plannersTitle,
    description: t.meta.plannersDescription,
    alternates: {
      canonical: `/${locale}/for-event-planners`,
      languages: {
        en: '/en/for-event-planners',
        de: '/de/for-event-planners',
        it: '/it/for-event-planners',
        fr: '/fr/for-event-planners',
        es: '/es/for-event-planners',
      },
    },
  }
}

export default function ForEventPlanners({ params }) {
  const { locale } = params
  if (!LOCALES.includes(locale)) notFound()
  return <PlannersLandingPage locale={locale} />
}
