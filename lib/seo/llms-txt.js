import { LOCALES, LOCALE_LABELS, localizedPath } from '@/lib/i18n/config'
import { getDictionary } from '@/lib/i18n/utils'
import { BASE_URL } from '@/lib/structured-data/constants'
import { PLAN_OFFERS } from '@/lib/structured-data/software-application'
import { PRICE_AMOUNTS } from '@/lib/currency'

/**
 * /llms.txt — a plain-text map of the public site for AI assistants and
 * answer engines (https://llmstxt.org). Built from the same dictionary and
 * plan data the pages render, so it cannot describe a product the site
 * does not show.
 */
const PAGES = [
  ['/', 'homeTitle', 'homeDescription'],
  ['/pricing', null, null],
  ['/wedding-photo-sharing', 'weddingTitle', 'weddingDescription'],
  ['/birthday-photo-sharing', 'birthdayTitle', 'birthdayDescription'],
  ['/private-party-photo-sharing', 'privatePartyTitle', 'privatePartyDescription'],
  ['/corporate-event-photo-sharing', 'corporateTitle', 'corporateDescription'],
  ['/for-wedding-photographers', 'photographersTitle', 'photographersDescription'],
  ['/for-event-planners', 'plannersTitle', 'plannersDescription'],
]

const LEGAL = [
  ['/privacy', 'privacyTitle'],
  ['/terms', 'termsTitle'],
  ['/commercial-license', 'commercialTitle'],
]

export function buildLlmsTxt() {
  const t = getDictionary('en')
  const url = (path, locale = 'en') => `${BASE_URL}${localizedPath(locale, path)}`
  const pricingTitle = `${t.pricing.title} — SnapRooms`

  const plans = PLAN_OFFERS.map(({ nameKey, price, unit }) => {
    const per =
      unit === 'MON'
        ? ` per month (or €${PRICE_AMOUNTS.professionalAnnual} / $${PRICE_AMOUNTS.professionalAnnual} per year)`
        : unit === 'event'
          ? ' per event'
          : ''
    return `- ${t.pricing[nameKey]}: €${price} / $${price}${per}`
  })

  return [
    '# SnapRooms',
    '',
    `> ${t.meta.homeDescription}`,
    '',
    'SnapRooms creates a private event gallery. The organizer shares a link or QR code; guests open it in their phone browser and upload photos with no app and no account. Everyone sees one shared gallery, can like photos, and share them to Instagram, TikTok, Facebook or WhatsApp. Paid plans add video uploads, a full-gallery ZIP download and removal of SnapRooms branding. Guests always upload for free.',
    '',
    '## Pages',
    '',
    ...PAGES.map(([path, titleKey, descKey]) =>
      titleKey
        ? `- [${t.meta[titleKey]}](${url(path)}): ${t.meta[descKey]}`
        : `- [${pricingTitle}](${url(path)}): ${t.pricing.description}`
    ),
    '',
    '## Pricing',
    '',
    'Prices are in EUR in euro-area countries and the same amount in USD everywhere else.',
    '',
    ...plans,
    `- ${t.pricing.business}: custom pricing for studios, agencies and organizations`,
    `- Details: ${url('/pricing')}`,
    '',
    '## Languages',
    '',
    ...LOCALES.map((locale) => `- ${LOCALE_LABELS[locale]}: ${url('/', locale)}`),
    '',
    '## Optional',
    '',
    ...LEGAL.map(([path, titleKey]) => `- [${t.meta[titleKey]}](${url(path)})`),
    '',
  ].join('\n')
}
