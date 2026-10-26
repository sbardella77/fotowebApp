import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  currencyForCountry,
  fillPriceTokens,
  formatPrice,
  normalizeCurrency,
  PRICE_AMOUNTS,
} from '@/lib/currency'
import { dictionaries } from '@/lib/i18n/dictionaries'
import { getPricedDictionary } from '@/lib/i18n/priced-dictionary'
import { getDictionary } from '@/lib/i18n/utils'
import { LOCALES } from '@/lib/i18n/config'
import { currencyForHeaders } from '@/lib/server/request-currency'
import { resolveCheckoutCurrency } from '@/lib/server/checkout-currency'

const ROOT = resolve(import.meta.dirname, '..')

describe('currencyForCountry', () => {
  it.each(['IT', 'DE', 'ES', 'FR', 'NL', 'BG', 'HR', 'it', ' pt '])('%s pays in EUR', (c) => {
    expect(currencyForCountry(c)).toBe('eur')
  })

  it.each(['US', 'GB', 'CH', 'CA', 'BR', 'MX', 'PL', 'SE', 'IN'])('%s pays in USD', (c) => {
    expect(currencyForCountry(c)).toBe('usd')
  })

  it('falls back to EUR when the country is unknown', () => {
    expect(currencyForCountry(null)).toBe('eur')
    expect(currencyForCountry('')).toBe('eur')
  })

  it('reads the Vercel country header', () => {
    expect(currencyForHeaders(new Headers({ 'x-vercel-ip-country': 'US' }))).toBe('usd')
    expect(currencyForHeaders(new Headers({ 'x-vercel-ip-country': 'ES' }))).toBe('eur')
    expect(currencyForHeaders(new Headers())).toBe('eur')
  })

  it('normalizes unknown currencies to EUR', () => {
    expect(normalizeCurrency('USD')).toBe('usd')
    expect(normalizeCurrency('gbp')).toBe('eur')
  })
})

describe('list prices', () => {
  it('match the live Stripe prices (EUR and USD use the same number)', () => {
    expect(PRICE_AMOUNTS).toEqual({
      free: 0,
      proEvent: 29,
      weddingPro: 49,
      professionalMonthly: 24,
      professionalAnnual: 240,
      annualSaving: 48,
      extraFreeEvent: 4.99,
      originalUnlock: 1.99,
    })
    expect(PRICE_AMOUNTS.professionalMonthly * 12 - PRICE_AMOUNTS.professionalAnnual).toBe(PRICE_AMOUNTS.annualSaving)
  })

  it('format with the right symbol and decimals per locale', () => {
    expect(formatPrice('proEvent', 'eur', 'en')).toBe('€29')
    expect(formatPrice('proEvent', 'usd', 'en')).toBe('$29')
    expect(formatPrice('originalUnlock', 'usd', 'en')).toBe('$1.99')
    expect(formatPrice('originalUnlock', 'eur', 'de').replace(/\s/g, ' ')).toBe('1,99 €')
    expect(formatPrice('weddingPro', 'usd', 'it').replace(/\s/g, ' ')).toBe('49 $')
  })

  it('fills tokens and leaves unknown ones alone', () => {
    expect(fillPriceTokens('Save {{price.annualSaving}}', 'usd', 'en')).toBe('Save $48')
    expect(fillPriceTokens('{{price.nope}}', 'usd', 'en')).toBe('{{price.nope}}')
    expect(fillPriceTokens('no tokens', 'usd', 'en')).toBe('no tokens')
  })
})

describe('dictionaries', () => {
  const raw = readFileSync(resolve(ROOT, 'lib/i18n/dictionaries.js'), 'utf8')

  it('never hardcode a euro amount: prices are {{price.*}} tokens', () => {
    expect(raw).not.toMatch(/€/)
  })

  it('only use known price tokens', () => {
    for (const [, key] of raw.matchAll(/\{\{price\.([A-Za-z]+)\}\}/g)) {
      expect(PRICE_AMOUNTS[key], key).toBeDefined()
    }
  })

  it.each(LOCALES)('%s has no unfilled token once priced, in either currency', (locale) => {
    for (const currency of ['eur', 'usd']) {
      expect(JSON.stringify(getPricedDictionary(locale, currency))).not.toContain('{{price.')
    }
  })

  it('getDictionary fills EUR by default and USD on request', () => {
    expect(getDictionary('en').pricing.proEventPrice).toBe('€29')
    expect(getDictionary('en', 'usd').pricing.proEventPrice).toBe('$29')
    expect(getDictionary('en', 'usd').room.unlockForEveryone).toContain('$1.99')
    expect(dictionaries.en.pricing.proEventPrice).toBe('{{price.proEvent}}')
  })

  it('caches one priced dictionary per locale and currency', () => {
    expect(getPricedDictionary('it', 'usd')).toBe(getPricedDictionary('it', 'usd'))
    expect(getPricedDictionary('it', 'usd')).not.toBe(getPricedDictionary('it', 'eur'))
  })
})

describe('no hardcoded euro prices in UI code', () => {
  it.each([
    'components/pricing-page.jsx',
    'components/photo-lightbox.jsx',
    'app/dashboard/page.js',
    'app/dashboard/components/professional-upgrade-modal.jsx',
  ])('%s', (file) => {
    expect(readFileSync(resolve(ROOT, file), 'utf8')).not.toMatch(/€\s?\d|\d\s?€/)
  })
})

describe('resolveCheckoutCurrency', () => {
  const us = new Headers({ 'x-vercel-ip-country': 'US' })
  const usdPrice = { currency: 'eur', currency_options: { eur: {}, usd: {} } }
  const stripeWith = (customer, price = usdPrice) => ({
    customers: { retrieve: async () => customer },
    prices: { retrieve: async () => price },
  })

  it('uses the visitor currency for a new customer', async () => {
    expect(await resolveCheckoutCurrency({ stripe: stripeWith({}), customerId: null, headerList: us })).toBe('usd')
    expect(await resolveCheckoutCurrency({ stripe: stripeWith({ currency: null }), customerId: 'cus_1', headerList: us })).toBe('usd')
  })

  it('keeps a returning customer in the currency Stripe already bound them to', async () => {
    expect(await resolveCheckoutCurrency({ stripe: stripeWith({ currency: 'eur' }), customerId: 'cus_1', headerList: us })).toBe('eur')
  })

  it('falls back to the visitor currency if the lookup fails', async () => {
    const stripe = { customers: { retrieve: async () => { throw new Error('boom') } } }
    expect(await resolveCheckoutCurrency({ stripe, customerId: 'cus_1', headerList: us })).toBe('usd')
  })

  it('uses the price currency when the price has no option for the visitor currency', async () => {
    const eurOnly = { currency: 'eur', currency_options: { eur: {} } }
    expect(await resolveCheckoutCurrency({ stripe: stripeWith({}, eurOnly), customerId: null, headerList: us, priceId: 'price_1' })).toBe('eur')
    expect(await resolveCheckoutCurrency({ stripe: stripeWith({}), customerId: null, headerList: us, priceId: 'price_1' })).toBe('usd')
  })
})

describe('checkout routes pass the currency to Stripe', () => {
  it.each([
    ['app/api/stripe/checkout-session/route.js', 'resolveCheckoutCurrency('],
    ['app/api/stripe/unlock-download/route.js', 'resolveCheckoutCurrency('],
  ])('%s', (file, resolver) => {
    const source = readFileSync(resolve(ROOT, file), 'utf8')
    expect(source).toContain(resolver)
    expect(source).toMatch(/line_items: \[\{ price: priceId, quantity: 1 \}\],\n\s+currency,/)
  })
})
