import { PrivatePartyLandingPage } from '@/components/private-party-landing-page'
import { notFound } from 'next/navigation'
import { LOCALES } from '@/lib/i18n/config'
import { getDictionary } from '@/lib/i18n/utils'

export async function generateMetadata({ params }) {
  const { locale } = params
  if (!LOCALES.includes(locale)) notFound()
  const t = getDictionary(locale)
  return {
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
  }
}

export default function PrivatePartyPhotoSharing({ params }) {
  const { locale } = params
  if (!LOCALES.includes(locale)) notFound()
  return <PrivatePartyLandingPage locale={locale} />
}
