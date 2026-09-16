import { PricingPage } from '@/components/pricing-page'
import { notFound } from 'next/navigation'
import { LOCALES } from '@/lib/i18n/config'
import { getDictionary } from '@/lib/i18n/utils'
import { normalizePricingPlanParam } from '@/lib/pricing-deep-link'

export async function generateMetadata({ params }) {
  const { locale } = params
  if (!LOCALES.includes(locale)) notFound()
  const t = getDictionary(locale)
  return {
    title: t.pricing.title + ' — SnapRooms',
    description: t.pricing.description,
    alternates: {
      canonical: `/${locale}/pricing`,
      languages: {
        en: '/en/pricing',
        de: '/de/pricing',
        it: '/it/pricing',
        fr: '/fr/pricing',
        es: '/es/pricing',
        'pt-BR': '/pt-BR/pricing',
      },
    },
  }
}

export const dynamic = 'force-dynamic'

export default function Pricing({ params, searchParams }) {
  const { locale } = params
  if (!LOCALES.includes(locale)) notFound()
  const fromDashboard = searchParams?.from === 'dashboard'
  const highlightPlan = normalizePricingPlanParam(searchParams?.plan)
  const eventSlug = searchParams?.eventSlug || null
  const billingInterval = searchParams?.billing === 'annual' ? 'annual' : null
  return <PricingPage locale={locale} fromDashboard={fromDashboard} highlightPlan={highlightPlan} eventSlug={eventSlug} billingInterval={billingInterval} />
}
