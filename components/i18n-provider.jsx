'use client'

import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { LOCALES, DEFAULT_LOCALE, LOCALE_COOKIE_NAME, LOCALIZED_PUBLIC_PATHS } from '@/lib/i18n/config'
import { dictionaries } from '@/lib/i18n/dictionaries'

const I18nContext = createContext(null)

export function I18nProvider({ children, initialLocale = DEFAULT_LOCALE }) {
  const [locale, setLocaleState] = useState(initialLocale)
  const router = useRouter()
  const pathname = usePathname()

  const dictionary = dictionaries[locale] || dictionaries[DEFAULT_LOCALE]

  const setLocale = useCallback(
    (newLocale) => {
      if (!LOCALES.includes(newLocale) || newLocale === locale) return

      // Persist preference
      try {
        const secureFlag = typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : ''
        document.cookie = `${LOCALE_COOKIE_NAME}=${newLocale}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax${secureFlag}`
      } catch {
        // ignore cookie errors
      }

      // Switch URL to new locale while preserving path
      const segments = pathname.split('/')
      const currentHasLocale = LOCALES.includes(segments[1])

      if (currentHasLocale) {
        segments[1] = newLocale
        const newPath = segments.join('/')
        setLocaleState(newLocale)
        router.push(newPath)
        return
      }

      // For non-localized paths, only prepend locale if it's a known public page.
      // Private routes (event, dashboard, etc.) don't have locale-prefixed versions;
      // we just reload so the cookie is picked up by the root layout.
      const isPublicPage = LOCALIZED_PUBLIC_PATHS.some(
        (p) => pathname === p || pathname.startsWith(`${p}/`)
      )

      if (isPublicPage) {
        const newPath = `/${newLocale}${pathname}`
        setLocaleState(newLocale)
        router.push(newPath)
      } else {
        setLocaleState(newLocale)
        if (typeof window !== 'undefined') {
          window.location.reload()
        }
      }
    },
    [locale, pathname, router]
  )

  // Keep html lang attribute in sync on the client
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale
    }
  }, [locale])

  return (
    <I18nContext.Provider
      value={{
        locale,
        setLocale,
        dictionary,
        t: dictionary,
      }}
    >
      {children}
    </I18nContext.Provider>
  )
}

export function useLocale() {
  const ctx = useContext(I18nContext)
  if (!ctx) return DEFAULT_LOCALE
  return ctx.locale
}

export function useSetLocale() {
  const ctx = useContext(I18nContext)
  if (!ctx) return () => {}
  return ctx.setLocale
}

export function useDictionary() {
  const ctx = useContext(I18nContext)
  if (!ctx) return dictionaries[DEFAULT_LOCALE]
  return ctx.dictionary
}

export function useTranslations(namespace) {
  const dict = useDictionary()
  return dict[namespace] || {}
}
