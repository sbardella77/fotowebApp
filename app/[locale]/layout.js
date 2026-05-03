import { notFound } from 'next/navigation'
import { LOCALES } from '@/lib/i18n/config'
import { I18nProvider } from '@/components/i18n-provider'
import { LocaleHtmlAttributes } from '@/components/locale-html-attributes'

export default function LocaleLayout({ children, params }) {
  const { locale } = params
  if (!LOCALES.includes(locale)) {
    notFound()
  }

  return (
    <I18nProvider initialLocale={locale}>
      <LocaleHtmlAttributes />
      {children}
    </I18nProvider>
  )
}
