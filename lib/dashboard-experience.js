/**
 * SnapRooms — Adaptive Dashboard Experience Resolver
 *
 * Single source of truth for dashboard UX based on user profile.
 *
 * Consumes:
 *   - plan   (account-level: 'free' | 'professional' | 'business' | 'pro')
 *   - events (array of owner events with billingTier)
 *
 * Returns a flat configuration object used by:
 *   - DashboardSidebar (navigation, upsell visibility)
 *   - DashboardTopBar (plan badge)
 *   - DashboardHeader (title, description, primary CTA)
 *   - InsightCard (stats, upsell strategy)
 *   - DashboardPage (module visibility, progressive disclosure)
 *
 * RULE: No dashboard component should read plan or events directly
 * if it can consume this resolver instead.
 */

import { resolveEffectiveEventAccessState } from './event-access'

export const DASHBOARD_AUDIENCES = {
  CONSUMER: 'consumer',
  EVENT_PRO: 'event_pro',
  WEDDING_PRO: 'wedding_pro',
  PROFESSIONAL: 'professional',
}

export function resolveDashboardExperience({ plan, events = [] }) {
  const { accountPremium } = resolveEffectiveEventAccessState({ ownerPlan: plan })

  if (accountPremium) {
    return resolveProfessionalExperience({ plan, events })
  }

  const hasWeddingPro = events.some((e) => e.billingTier === 'wedding_pro')
  const hasProEvent = events.some((e) => e.billingTier === 'pro_event')

  if (hasWeddingPro) {
    return resolveWeddingProExperience({ plan, events })
  }

  if (hasProEvent) {
    return resolveEventProExperience({ plan, events })
  }

  return resolveConsumerExperience({ plan, events })
}

function resolveConsumerExperience({ plan, events }) {
  return {
    audience: DASHBOARD_AUDIENCES.CONSUMER,
    primaryGoal: 'create_event',
    visibleModules: [
      'events',
      'create_event',
      'share_qr',
      'received_photos',
      'download_photos',
      'search_sort',
    ],
    hiddenModules: [
      'analytics',
      'clients',
      'team',
      'private_delivery',
      'photographer_upload',
      'advanced_cover',
      'moderation_bulk',
    ],
    primaryCta: 'create_event',
    upsellStrategy: 'light',
    sidebarItems: ['dashboard', 'pricing'],
    showSidebarUpsell: true,
    planBadge: {
      label: 'Free',
      variant: 'free',
    },
    header: {
      titleKey: 'yourRooms',
      descriptionKey: 'yourRoomsDesc',
      ctaKey: 'createNewRoom',
    },
    insight: {
      showStats: true,
      showUpgradeBanner: true,
    },
  }
}

function resolveEventProExperience({ plan, events }) {
  return {
    audience: DASHBOARD_AUDIENCES.EVENT_PRO,
    primaryGoal: 'manage_event',
    visibleModules: [
      'events',
      'manage_event',
      'cover_editor',
      'zip_gallery',
      'watermark_free',
      'photographer_upload',
      'moderation',
      'search_sort',
    ],
    hiddenModules: [
      'analytics',
      'clients',
      'team',
      'consumer_tutorial',
    ],
    primaryCta: 'manage_event',
    upsellStrategy: 'feature_oriented',
    sidebarItems: ['dashboard', 'analytics', 'pricing'],
    showSidebarUpsell: true,
    planBadge: {
      label: 'Pro Event',
      variant: 'pro',
    },
    header: {
      titleKey: 'yourRooms',
      descriptionKey: 'yourRoomsDesc',
      ctaKey: 'createNewRoom',
    },
    insight: {
      showStats: true,
      showUpgradeBanner: true,
    },
  }
}

function resolveWeddingProExperience({ plan, events }) {
  return {
    audience: DASHBOARD_AUDIENCES.WEDDING_PRO,
    primaryGoal: 'manage_event',
    visibleModules: [
      'events',
      'manage_event',
      'cover_editor',
      'zip_gallery',
      'watermark_free',
      'private_delivery',
      'photographer_upload',
      'moderation',
      'search_sort',
    ],
    hiddenModules: [
      'analytics',
      'clients',
      'team',
      'consumer_tutorial',
    ],
    primaryCta: 'manage_event',
    upsellStrategy: 'feature_oriented',
    sidebarItems: ['dashboard', 'analytics', 'pricing'],
    showSidebarUpsell: true,
    planBadge: {
      label: 'Wedding Pro',
      variant: 'premium',
    },
    header: {
      titleKey: 'yourRooms',
      descriptionKey: 'yourRoomsDesc',
      ctaKey: 'createNewRoom',
    },
    insight: {
      showStats: true,
      showUpgradeBanner: true,
    },
  }
}

function resolveProfessionalExperience({ plan, events }) {
  return {
    audience: DASHBOARD_AUDIENCES.PROFESSIONAL,
    primaryGoal: 'business_growth',
    visibleModules: [
      'events',
      'analytics',
      'event_history',
      'conversion_performance',
      'branding_studio',
      'clients_future',
      'team_future',
      'templates_future',
      'search_sort',
    ],
    hiddenModules: [
      'consumer_tutorial',
      'basic_onboarding',
      'useless_cta',
    ],
    primaryCta: 'view_analytics',
    upsellStrategy: 'minimal',
    sidebarItems: ['dashboard', 'analytics'],
    showSidebarUpsell: false,
    planBadge: {
      label: 'Pro',
      variant: 'premium',
    },
    header: {
      titleKey: 'yourRooms',
      descriptionKey: 'yourRoomsDesc',
      ctaKey: 'createNewRoom',
    },
    insight: {
      showStats: true,
      showUpgradeBanner: false,
    },
  }
}
