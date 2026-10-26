import { normalizeCurrency } from '@/lib/currency'
import { currencyForHeaders } from '@/lib/server/request-currency'

/**
 * Currency for a Stripe Checkout session: the visitor's display currency
 * (same rule as the prices shown on the site), unless the Stripe customer
 * is already bound to a currency by an earlier subscription or invoice —
 * Stripe refuses to mix currencies on one customer, so a returning EUR
 * customer keeps paying in EUR even when browsing from abroad.
 *
 * Every live price has EUR plus a USD `currency_options` entry, so passing
 * `currency` to checkout.sessions.create selects the matching amount. A
 * price without the chosen currency (e.g. a test-mode price on Preview)
 * falls back to the price's own currency instead of failing the checkout.
 */
export async function resolveCheckoutCurrency({ stripe, customerId, headerList, priceId }) {
  let currency = currencyForHeaders(headerList)
  if (customerId) {
    try {
      const customer = await stripe.customers.retrieve(customerId)
      if (customer && !customer.deleted && customer.currency) {
        currency = normalizeCurrency(customer.currency)
      }
    } catch {
      // Customer lookup is best-effort; keep the visitor's currency.
    }
  }
  return ensurePriceSupports({ stripe, priceId, currency })
}

async function ensurePriceSupports({ stripe, priceId, currency }) {
  if (!priceId) return currency
  try {
    const price = await stripe.prices.retrieve(priceId, { expand: ['currency_options'] })
    const available = new Set([price.currency, ...Object.keys(price.currency_options || {})])
    return available.has(currency) ? currency : normalizeCurrency(price.currency)
  } catch {
    return currency
  }
}
