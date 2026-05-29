/**
 * SnapRooms — Adaptive Dashboard Experience Resolver
 *
 * Single source of truth for dashboard UX based on user profile,
 * maturity, and behavioral signals.
 *
 * Consumes:
 *   - plan    (account-level: 'free' | 'professional' | 'business' | 'pro')
 *   - events  (array of owner events with billingTier)
 *   - metrics (lightweight client-side signals: eventsCount, totalPhotos, etc.)
 *
 * Returns a flat configuration object used by:
 *   - DashboardSidebar (navigation, upsell visibility)
 *   - DashboardTopBar (plan badge)
 *   - DashboardHeader (title, description, primary/secondary CTA)
 *   - InsightCard (stats, upsell strategy, messaging tone)
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

export const DASHBOARD_MATURITY = {
  STARTER: 'starter',
  ADVANCED: 'advanced',
  BUSINESS: 'business',
}

export const ANALYTICS_LEVEL = {
  NONE: 'none',
  LITE: 'lite',
  COMPLETE: 'complete',
}

export const MESSAGING_TONE = {
  STARTER: 'starter',
  GALLERY: 'gallery',
  DELIVERY: 'delivery',
  STUDIO: 'studio',
}

/* ------------------------------------------------------------------ */
// Public API
/* ------------------------------------------------------------------ */

export function resolveDashboardExperience({ plan, events = [], metrics = {} }) {
  const { accountPremium } = resolveEffectiveEventAccessState({ ownerPlan: plan })

  const eventsCount = metrics?.eventsCount ?? events.length
  const totalPhotos = metrics?.totalPhotos ?? 0
  const hasPremiumEvents = events.some((e) => e.billingTier === 'pro_event' || e.billingTier === 'wedding_pro')
  const hasWeddingPro = events.some((e) => e.billingTier === 'wedding_pro')
  const hasProEvent = events.some((e) => e.billingTier === 'pro_event')

  const maturity = resolveMaturity({ accountPremium, eventsCount, hasPremiumEvents })
  const analyticsLevel = resolveAnalyticsLevel({ accountPremium })

  if (accountPremium) {
    return resolveProfessionalExperience({ plan, events, maturity, analyticsLevel, eventsCount, totalPhotos })
  }

  if (hasWeddingPro) {
    return resolveWeddingProExperience({ plan, events, maturity, analyticsLevel, eventsCount, totalPhotos })
  }

  if (hasProEvent) {
    return resolveEventProExperience({ plan, events, maturity, analyticsLevel, eventsCount, totalPhotos })
  }

  return resolveConsumerExperience({ plan, events, maturity, analyticsLevel, eventsCount, totalPhotos })
}

/* ------------------------------------------------------------------ */
// Maturity
/* ------------------------------------------------------------------ */

function resolveMaturity({ accountPremium, eventsCount, hasPremiumEvents }) {
  if (accountPremium) return DASHBOARD_MATURITY.BUSINESS
  if (hasPremiumEvents || eventsCount > 2) return DASHBOARD_MATURITY.ADVANCED
  return DASHBOARD_MATURITY.STARTER
}

/* ------------------------------------------------------------------ */
// Analytics Level
/* ------------------------------------------------------------------ */

function resolveAnalyticsLevel({ accountPremium }) {
  if (accountPremium) return ANALYTICS_LEVEL.COMPLETE
  return ANALYTICS_LEVEL.LITE
}

/* ------------------------------------------------------------------ */
// Consumer
/* ------------------------------------------------------------------ */

function resolveConsumerExperience({ plan, events, maturity, analyticsLevel, eventsCount, totalPhotos }) {
  return {
    audience: DASHBOARD_AUDIENCES.CONSUMER,
    maturity,
    analyticsLevel,
    messagingTone: MESSAGING_TONE.STARTER,
    modulePriority: ['events', 'create_event', 'share_qr', 'received_photos', 'search_sort'],
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
    secondaryCta: null,
    upsellStrategy: 'light',
    sidebarItems: analyticsLevel === ANALYTICS_LEVEL.NONE ? ['dashboard', 'pricing'] : ['dashboard', 'analytics', 'pricing'],
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

/* ------------------------------------------------------------------ */
// Event Pro — Gallery Experience
/* ------------------------------------------------------------------ */

function resolveEventProExperience({ plan, events, maturity, analyticsLevel, eventsCount, totalPhotos }) {
  return {
    audience: DASHBOARD_AUDIENCES.EVENT_PRO,
    maturity,
    analyticsLevel,
    messagingTone: MESSAGING_TONE.GALLERY,
    modulePriority: ['events', 'cover_editor', 'zip_gallery', 'watermark_free', 'moderation', 'search_sort'],
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
    primaryCta: 'create_event',
    secondaryCta: 'share_gallery',
    upsellStrategy: 'feature_oriented',
    sidebarItems: analyticsLevel !== ANALYTICS_LEVEL.NONE ? ['dashboard', 'analytics', 'pricing'] : ['dashboard', 'pricing'],
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
      benefitsHighlight: ['zip_download', 'no_watermark'],
    },
  }
}

/* ------------------------------------------------------------------ */
// Wedding Pro — Delivery Experience
/* ------------------------------------------------------------------ */

function resolveWeddingProExperience({ plan, events, maturity, analyticsLevel, eventsCount, totalPhotos }) {
  return {
    audience: DASHBOARD_AUDIENCES.WEDDING_PRO,
    maturity,
    analyticsLevel,
    messagingTone: MESSAGING_TONE.DELIVERY,
    modulePriority: ['events', 'private_delivery', 'photographer_upload', 'zip_gallery', 'watermark_free', 'search_sort'],
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
    primaryCta: 'manage_delivery',
    secondaryCta: 'upload_photos',
    upsellStrategy: 'feature_oriented',
    sidebarItems: analyticsLevel !== ANALYTICS_LEVEL.NONE ? ['dashboard', 'analytics', 'pricing'] : ['dashboard', 'pricing'],
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
      benefitsHighlight: ['private_delivery', 'photographer_upload', 'original_quality'],
    },
  }
}

/* ------------------------------------------------------------------ */
// Professional — Studio Experience
/* ------------------------------------------------------------------ */

function resolveProfessionalExperience({ plan, events, maturity, analyticsLevel, eventsCount, totalPhotos }) {
  return {
    audience: DASHBOARD_AUDIENCES.PROFESSIONAL,
    maturity,
    analyticsLevel,
    messagingTone: MESSAGING_TONE.STUDIO,
    modulePriority: ['events', 'analytics', 'branding_studio', 'search_sort'],
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
    primaryCta: 'create_event',
    secondaryCta: 'view_analytics',
    upsellStrategy: 'minimal',
    sidebarItems: analyticsLevel !== ANALYTICS_LEVEL.NONE ? ['dashboard', 'analytics'] : ['dashboard'],
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
