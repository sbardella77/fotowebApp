import { BirthdayLandingPage } from '@/components/birthday-landing-page'
import { notFound } from 'next/navigation'
import { LOCALES } from '@/lib/i18n/config'
import { getDictionary } from '@/lib/i18n/utils'

export async function generateMetadata({ params }) {
  const { locale } = params
  if (!LOCALES.includes(locale)) notFound()
  const t = getDictionary(locale)
  return {
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
      },
    },
  }
}

export default function BirthdayPhotoSharing({ params }) {
  const { locale } = params
  if (!LOCALES.includes(locale)) notFound()
  return <BirthdayLandingPage locale={locale} />
}
