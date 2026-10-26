import { getDictionary } from '@/lib/i18n/utils'
import { localizedPath } from '@/lib/i18n/config'
import { BASE_URL, ORGANIZATION_ID } from './constants'

export const SOFTWARE_APPLICATION_ID = `${BASE_URL}/#app`

/**
 * Public list prices shown on /pricing, in EUR. Display only — billing never
 * reads these; checkout prices come from server env. `dictKey` points at the
 * matching pricing-page label so tests/seo-geo-foundations.test.js fails if
 * the page and the structured data ever disagree.
 */
export const PLAN_OFFERS = [
  { nameKey: 'free', price: '0', dictKey: 'freeTierPrice' },
  { nameKey: 'proEvent', price: '29', dictKey: 'proEventPrice', unit: 'event' },
  { nameKey: 'weddingPro', price: '49', dictKey: 'weddingProPrice', unit: 'event' },
  { nameKey: 'professional', price: '24', dictKey: 'professionalPrice', unit: 'MON' },
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
    offers: PLAN_OFFERS.map(({ nameKey, price, unit }) => {
      const offer = {
        '@type': 'Offer',
        name: t.pricing[nameKey],
        price,
        priceCurrency: 'EUR',
        url: pricingUrl,
      }
      if (unit === 'MON') {
        offer.priceSpecification = {
          '@type': 'UnitPriceSpecification',
          price,
          priceCurrency: 'EUR',
          unitCode: 'MON',
        }
      }
      return offer
    }),
  }
}
