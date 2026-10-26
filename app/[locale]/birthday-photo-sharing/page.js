import { BirthdayLandingPage } from '@/components/birthday-landing-page'
import { notFound } from 'next/navigation'
import { LOCALES } from '@/lib/i18n/config'
import { getDictionary } from '@/lib/i18n/utils'
import { JsonLd } from '@/lib/structured-data/json-ld'
import { getMarketingPageGraph } from '@/lib/structured-data/page-graph'
import { collectFaqPairs } from '@/lib/structured-data/faq'
import { withSocialMetadata } from '@/lib/seo/social-metadata'

export async function generateMetadata({ params }) {
  const { locale } = params
  if (!LOCALES.includes(locale)) notFound()
  const t = getDictionary(locale)
  return withSocialMetadata(locale, {
    title: t.meta.birthdayTitle,
    description: t.meta.birthdayDescription,
    alternates: {
      canonical: `/${locale}/birthday-photo-sharing`,
      languages: {
        en: '/en/birthday-photo-sharing',
        de: '/de/birthday-photo-sharing',
        it: '/it/birthday-photo-sharing',
        fr: '/fr/birthday-photo-sharing',
        es: '/es/birthday-photo-sharing',
        'pt-BR': '/pt-BR/birthday-photo-sharing',
        'x-default': '/en/birthday-photo-sharing',
      },
    },
  })
}

export default function BirthdayPhotoSharing({ params }) {
  const { locale } = params
  if (!LOCALES.includes(locale)) notFound()
  const t = getDictionary(locale)
  const graph = getMarketingPageGraph({
    locale,
    path: '/birthday-photo-sharing',
    name: t.meta.birthdayTitle,
    description: t.meta.birthdayDescription,
    questions: collectFaqPairs(t.birthday, 'faq', 7),
  })
  return (
    <>
      <JsonLd data={graph} />
      <BirthdayLandingPage locale={locale} />
    </>
  )
}
