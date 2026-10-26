import { PrivatePartyLandingPage } from '@/components/private-party-landing-page'
import { notFound } from 'next/navigation'
import { LOCALES } from '@/lib/i18n/config'
import { getDictionary } from '@/lib/i18n/utils'
import { JsonLd } from '@/lib/structured-data/json-ld'
import { getMarketingPageGraph } from '@/lib/structured-data/page-graph'
import { collectFaqPairs } from '@/lib/structured-data/faq'
import { withSocialMetadata } from '@/lib/seo/social-metadata'
import { getRequestCurrency } from '@/lib/server/request-currency'

export async function generateMetadata({ params }) {
  const { locale } = params
  if (!LOCALES.includes(locale)) notFound()
  const t = getDictionary(locale)
  return withSocialMetadata(locale, {
    title: t.meta.privatePartyTitle,
    description: t.meta.privatePartyDescription,
    alternates: {
      canonical: `/${locale}/private-party-photo-sharing`,
      languages: {
        en: '/en/private-party-photo-sharing',
        de: '/de/private-party-photo-sharing',
        it: '/it/private-party-photo-sharing',
        fr: '/fr/private-party-photo-sharing',
        es: '/es/private-party-photo-sharing',
        'pt-BR': '/pt-BR/private-party-photo-sharing',
        'x-default': '/en/private-party-photo-sharing',
      },
    },
  })
}

export default function PrivatePartyPhotoSharing({ params }) {
  const { locale } = params
  if (!LOCALES.includes(locale)) notFound()
  // Visible FAQ answers quote prices in the visitor currency; the FAQPage
  // schema must say the same.
  const t = getDictionary(locale, getRequestCurrency())
  const graph = getMarketingPageGraph({
    locale,
    path: '/private-party-photo-sharing',
    name: t.meta.privatePartyTitle,
    description: t.meta.privatePartyDescription,
    questions: collectFaqPairs(t.privateParty, 'faq', 7),
  })
  return (
    <>
      <JsonLd data={graph} />
      <PrivatePartyLandingPage locale={locale} />
    </>
  )
}
