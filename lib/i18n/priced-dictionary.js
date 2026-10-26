import { dictionaries } from '@/lib/i18n/dictionaries'
import { DEFAULT_LOCALE } from '@/lib/i18n/config'
import { fillPriceTokensDeep, normalizeCurrency } from '@/lib/currency'

const cache = new Map()

/**
 * The locale's dictionary with every {{price.*}} token filled in `currency`.
 * Built once per (locale, currency) and cached; callers must not mutate it.
 */
export function getPricedDictionary(locale, currency) {
  const safeLocale = dictionaries[locale] ? locale : DEFAULT_LOCALE
  const safeCurrency = normalizeCurrency(currency)
  const key = `${safeLocale}|${safeCurrency}`
  if (!cache.has(key)) {
    cache.set(key, fillPriceTokensDeep(dictionaries[safeLocale], safeCurrency, safeLocale))
  }
  return cache.get(key)
}
