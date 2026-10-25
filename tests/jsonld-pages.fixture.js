/**
 * Shared fixture describing, per marketing path, how its JSON-LD name/
 * description/FAQ data is derived — mirrors exactly what each
 * each app/[locale] page file passes to getMarketingPageGraph(), so tests can
 * build the same graph without executing Next's page components (which
 * need request-scoped notFound()/params machinery to run safely, matching
 * the approach already used by tests/seo-x-default-contract.test.js).
 */
export const JSONLD_PAGES = [
  {
    path: '/',
    getNameDescription: (t) => [t.meta.homeTitle, t.meta.homeDescription],
    faq: null,
  },
  {
    path: '/pricing',
    getNameDescription: (t) => [t.pricing.title + ' — SnapRooms', t.pricing.description],
    faq: { namespaceKey: 'pricing', prefix: 'pricingFaq', count: 9 },
  },
  {
    path: '/wedding-photo-sharing',
    getNameDescription: (t) => [t.meta.weddingTitle, t.meta.weddingDescription],
    faq: { namespaceKey: 'wedding', prefix: 'faq', count: 8 },
  },
  {
    path: '/birthday-photo-sharing',
    getNameDescription: (t) => [t.meta.birthdayTitle, t.meta.birthdayDescription],
    faq: { namespaceKey: 'birthday', prefix: 'faq', count: 7 },
  },
  {
    path: '/private-party-photo-sharing',
    getNameDescription: (t) => [t.meta.privatePartyTitle, t.meta.privatePartyDescription],
    faq: { namespaceKey: 'privateParty', prefix: 'faq', count: 7 },
  },
  {
    path: '/corporate-event-photo-sharing',
    getNameDescription: (t) => [t.meta.corporateTitle, t.meta.corporateDescription],
    faq: { namespaceKey: 'corporate', prefix: 'faq', count: 7 },
  },
  {
    path: '/for-wedding-photographers',
    getNameDescription: (t) => [t.meta.photographersTitle, t.meta.photographersDescription],
    faq: null,
  },
  {
    path: '/for-event-planners',
    getNameDescription: (t) => [t.meta.plannersTitle, t.meta.plannersDescription],
    faq: null,
  },
  {
    path: '/privacy',
    getNameDescription: (t) => [t.meta.privacyTitle, t.meta.privacyDescription],
    faq: null,
  },
  {
    path: '/terms',
    getNameDescription: (t) => [t.meta.termsTitle, t.meta.termsDescription],
    faq: null,
  },
  {
    path: '/commercial-license',
    getNameDescription: (t) => [t.meta.commercialTitle, t.meta.commercialDescription],
    faq: null,
  },
]
