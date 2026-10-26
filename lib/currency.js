/**
 * Display currency for prices. Visitors in a euro-area country see EUR,
 * everyone else sees USD; an unknown country (local dev, some bots) sees
 * EUR. The same rule picks the Stripe Checkout currency
 * (lib/server/checkout-currency.js), so the amount shown is the amount
 * charged. Every live Stripe price carries a USD `currency_options` entry
 * with the same number (added 2026-10-26).
 *
 * Client-safe: no server imports.
 */

export const DEFAULT_CURRENCY = 'eur'
export const CURRENCIES = ['eur', 'usd']

// Euro area members (Bulgaria joined on 2026-01-01) plus the countries and
// territories that use the euro as their official currency.
export const EURO_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT', 'LV',
  'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES',
  'AD', 'MC', 'SM', 'VA', 'ME', 'XK',
  'GF', 'GP', 'MQ', 'YT', 'RE', 'PM', 'BL', 'MF', 'AX',
])

export function currencyForCountry(country) {
  if (!country || typeof country !== 'string') return DEFAULT_CURRENCY
  return EURO_COUNTRIES.has(country.trim().toUpperCase()) ? 'eur' : 'usd'
}

export function normalizeCurrency(value) {
  const c = typeof value === 'string' ? value.toLowerCase() : ''
  return CURRENCIES.includes(c) ? c : DEFAULT_CURRENCY
}

/**
 * List prices — the same number in both currencies. Must match the Stripe
 * prices; tests/currency.test.js pins them.
 */
export const PRICE_AMOUNTS = {
  free: 0,
  proEvent: 29,
  weddingPro: 49,
  professionalMonthly: 24,
  professionalAnnual: 240,
  annualSaving: 48,
  extraFreeEvent: 4.99,
  originalUnlock: 1.99,
}

const formatters = new Map()

function getFormatter(locale, currency, whole) {
  const key = `${locale}|${currency}|${whole}`
  if (!formatters.has(key)) {
    formatters.set(
      key,
      new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currency.toUpperCase(),
        // "$" rather than "US$"/"USD" in every locale, "€" for euros.
        currencyDisplay: 'narrowSymbol',
        minimumFractionDigits: whole ? 0 : 2,
        maximumFractionDigits: whole ? 0 : 2,
      })
    )
  }
  return formatters.get(key)
}

export function formatAmount(amount, currency = DEFAULT_CURRENCY, locale = 'en') {
  const whole = Number.isInteger(amount)
  return getFormatter(locale, normalizeCurrency(currency), whole).format(amount)
}

export function formatPrice(key, currency = DEFAULT_CURRENCY, locale = 'en') {
  const amount = PRICE_AMOUNTS[key]
  if (amount === undefined) throw new Error(`Unknown price key: ${key}`)
  return formatAmount(amount, currency, locale)
}

const TOKEN = /\{\{price\.([A-Za-z]+)\}\}/g

/** Replace {{price.key}} tokens in one string. */
export function fillPriceTokens(text, currency = DEFAULT_CURRENCY, locale = 'en') {
  if (typeof text !== 'string' || !text.includes('{{price.')) return text
  return text.replace(TOKEN, (match, key) =>
    PRICE_AMOUNTS[key] === undefined ? match : formatPrice(key, currency, locale)
  )
}

/** Deep copy of a dictionary (or any value) with every price token filled. */
export function fillPriceTokensDeep(value, currency = DEFAULT_CURRENCY, locale = 'en') {
  if (typeof value === 'string') return fillPriceTokens(value, currency, locale)
  if (Array.isArray(value)) return value.map((v) => fillPriceTokensDeep(v, currency, locale))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = fillPriceTokensDeep(v, currency, locale)
    return out
  }
  return value
}
