import { getDictionary } from '@/lib/i18n/utils'
import { localizedPath } from '@/lib/i18n/config'
import { BASE_URL, ORGANIZATION_ID } from './constants'
import { PRICE_AMOUNTS } from '@/lib/currency'

const OFFER_CURRENCIES = ['EUR', 'USD']

export const SOFTWARE_APPLICATION_ID = `${BASE_URL}/#app`

/**
 * Public list prices shown on /pricing — the same number in EUR and USD. Display only — billing never
 * reads these; checkout prices come from server env. `dictKey` points at the
 * matching pricing-page label so tests/seo-geo-foundations.test.js fails if
 * the page and the structured data ever disagree.
 */
export const PLAN_OFFERS = [
  { nameKey: 'free', price: String(PRICE_AMOUNTS.free), dictKey: 'freeTierPrice' },
  { nameKey: 'proEvent', price: String(PRICE_AMOUNTS.proEvent), dictKey: 'proEventPrice', unit: 'event' },
  { nameKey: 'weddingPro', price: String(PRICE_AMOUNTS.weddingPro), dictKey: 'weddingProPrice', unit: 'event' },
  { nameKey: 'professional', price: String(PRICE_AMOUNTS.professionalMonthly), dictKey: 'professionalPrice', unit: 'MON' },
]

/**
 * SoftwareApplication node with the plan offers — what AI answers and
 * comparison snippets read for "what is SnapRooms / how much does it cost".
 * Only emitted on the home and pricing pages.
 */
export function getSoftwareApplicationNode({ locale }) {
  const t = getDictionary(locale)
  const pricingUrl = `${BASE_URL}${localizedPath(locale, '/pricing')}`

  return {
    '@type': 'SoftwareApplication',
    '@id': SOFTWARE_APPLICATION_ID,
    name: 'SnapRooms',
    url: BASE_URL,
    description: t.meta.homeDescription,
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Web browser (iOS, Android, desktop)',
    publisher: { '@id': ORGANIZATION_ID },
    // Same list price in EUR (euro area) and USD (everywhere else); see
    // lib/currency.js.
    offers: OFFER_CURRENCIES.flatMap((currency) =>
      PLAN_OFFERS.map(({ nameKey, price, unit }) => {
        const offer = {
          '@type': 'Offer',
          name: t.pricing[nameKey],
          price,
          priceCurrency: currency,
          url: pricingUrl,
        }
        if (unit === 'MON') {
          offer.priceSpecification = {
            '@type': 'UnitPriceSpecification',
            price,
            priceCurrency: currency,
            unitCode: 'MON',
          }
        }
        return offer
      })
    ),
  }
}
