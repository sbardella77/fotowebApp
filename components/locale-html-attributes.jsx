'use client'

import { useEffect } from 'react'
import { useLocale } from './i18n-provider'

/**
 * Sets <html lang="..."> dynamically on the client.
 * Next.js App Router nested layouts cannot override <html>,
 * so we use a small client effect to keep it accurate.
 */
export function LocaleHtmlAttributes() {
  const locale = useLocale()

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale
      document.documentElement.dir = 'ltr'
    }
  }, [locale])

  return null
}
