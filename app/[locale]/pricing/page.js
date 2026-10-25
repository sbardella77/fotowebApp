import { PricingPage } from '@/components/pricing-page'
import { notFound } from 'next/navigation'
import { LOCALES } from '@/lib/i18n/config'
import { getDictionary } from '@/lib/i18n/utils'
import { normalizePricingPlanParam } from '@/lib/pricing-deep-link'
import { JsonLd } from '@/lib/structured-data/json-ld'
import { getMarketingPageGraph } from '@/lib/structured-data/page-graph'
import { collectFaqPairs } from '@/lib/structured-data/faq'

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
        'x-default': '/en/pricing',
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
  const t = getDictionary(locale)
  const graph = getMarketingPageGraph({
    locale,
    path: '/pricing',
    name: t.pricing.title + ' — SnapRooms',
    description: t.pricing.description,
    questions: collectFaqPairs(t.pricing, 'pricingFaq', 9),
  })
  return (
    <>
      <JsonLd data={graph} />
      <PricingPage locale={locale} fromDashboard={fromDashboard} highlightPlan={highlightPlan} eventSlug={eventSlug} billingInterval={billingInterval} />
    </>
  )
}
