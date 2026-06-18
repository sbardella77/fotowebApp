/**
 * SnapRooms — Pricing CTA state resolver.
 *
 * Pure function that decides which label and href a pricing CTA should
 * display based on the visitor's authentication state and the plan intent.
 *
 * Keeping this logic pure makes it trivial to unit test without mounting
 * React components or mocking fetch.
 */

/**
 * @typedef {'free' | 'pro-event' | 'wedding-pro' | 'professional' | 'business' | 'generic'} PricingIntent
 */

/**
 * Resolve the CTA configuration for a pricing card or inline CTA.
 *
 * @param {{ authenticated: boolean; intent: PricingIntent }} params
 * @returns {{
 *   labelKey: string;
 *   href: string;
 *   helperKey?: string;
 * }}
 */
export function resolvePricingCtaState({ authenticated, intent }) {
  const isBusiness = intent === 'business'
  const isFree = intent === 'free'
  const isEventPlan = intent === 'pro-event' || intent === 'wedding-pro'
  const isProfessional = intent === 'professional'

  if (isBusiness) {
    return {
      labelKey: 'contactSales',
      href: 'mailto:hello@snaprooms.app',
    }
  }

  if (authenticated) {
    if (isEventPlan) {
      return {
        labelKey: 'pricingUpgradeFromDashboard',
        href: '/dashboard',
        helperKey: 'pricingChooseEventInDashboard',
      }
    }

    if (isProfessional) {
      return {
        labelKey: 'pricingStartProfessionalFromDashboard',
        href: '/dashboard?upgrade=professional&from=pricing',
      }
    }

    return {
      labelKey: 'pricingGoToDashboard',
      href: '/dashboard',
    }
  }

  if (isFree) {
    return {
      labelKey: 'createFreeRoomBtn',
      href: '/',
    }
  }

  const next = encodeURIComponent(`/pricing?plan=${intent}`)
  return {
    labelKey: 'pricingSignInToUpgrade',
    href: `/dashboard/login?next=${next}`,
  }
}
