import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { LOCALES, DEFAULT_LOCALE, LOCALE_COOKIE_NAME } from '@/lib/i18n/config'

export default function PrivatePartyRedirect() {
  const cookieLocale = cookies().get(LOCALE_COOKIE_NAME)?.value
  const locale = LOCALES.includes(cookieLocale) ? cookieLocale : DEFAULT_LOCALE
  redirect(`/${locale}/private-party-photo-sharing`)
}
