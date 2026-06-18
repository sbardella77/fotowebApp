/**
 * SnapRooms — Centralized upsell analytics layer (client-side only).
 *
 * Tracks the upsell funnel:
 *   impression → click → checkout_start
 *
 * Conversion is tracked server-side via /api/stripe/webhook using
 * trackServerEvent directly, so this file stays safe for client bundles.
 *
 * Rules:
 * - Deduplicated impressions (sessionStorage + in-memory Set)
 * - Consistent payload schema across all events
 * - Attribution helpers for checkout metadata
 * - Fire-and-forget: tracking failures never break the UI
 */

import { trackEvent } from './track-client'
import {
  EVENT_UPSELL_IMPRESSION,
  EVENT_UPSELL_CLICK,
  EVENT_UPSELL_CHECKOUT_START,
} from './events'

export const UPSELL_TYPE_GALLERY_ZIP = 'gallery_zip'
export const UPSELL_TYPE_BRANDING_REMOVAL = 'branding_removal'
export const UPSELL_TYPE_PRIVATE_DELIVERY = 'private_delivery'
export const UPSELL_TYPE_UNLIMITED_UPLOADS = 'unlimited_uploads'
export const UPSELL_TYPE_ROOM_LIMIT = 'room_limit'
export const UPSELL_TYPE_ORIGINAL_QUALITY_UNLOCK = 'original_quality_unlock'
export const UPSELL_TYPE_PROFESSIONAL_ACCOUNT = 'professional_account'
export const UPSELL_TYPE_WEDDING_PRO = 'wedding_pro'
export const UPSELL_TYPE_PRO_EVENT_UPGRADE = 'pro_event_upgrade'
export const UPSELL_TYPE_WEDDING_PRO_UPGRADE = 'wedding_pro_upgrade'

const FEATURE_TO_UPSELL_TYPE = {
  gallery_download: UPSELL_TYPE_GALLERY_ZIP,
  branding: UPSELL_TYPE_BRANDING_REMOVAL,
  private_delivery: UPSELL_TYPE_PRIVATE_DELIVERY,
  upload_limit: UPSELL_TYPE_UNLIMITED_UPLOADS,
  room_limit: UPSELL_TYPE_ROOM_LIMIT,
  original_download: UPSELL_TYPE_ORIGINAL_QUALITY_UNLOCK,
  pro_event_upgrade: UPSELL_TYPE_PRO_EVENT_UPGRADE,
  wedding_pro_upgrade: UPSELL_TYPE_WEDDING_PRO_UPGRADE,
}

const IN_MEMORY_IMPRESSIONS = new Set()
const STORAGE_KEY_IMPRESSIONS = 'snaprooms:upsell:impressions'
const STORAGE_KEY_ATTRIBUTION = 'snaprooms:upsell:attribution'

function logUpsellEvent(payload) {
  try {
    if (typeof window === 'undefined') return
    fetch('/api/analytics/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // ignore
  }
}

function getSessionSet(key) {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

function setSessionSet(key, set) {
  try {
    sessionStorage.setItem(key, JSON.stringify([...set]))
  } catch {
    // ignore quota errors
  }
}

function buildDedupKey({ upsellType, source, eventSlug }) {
  return `${upsellType}|${source}|${eventSlug || '_'}`
}

function buildPayload(context) {
  return {
    upsell_type: context.upsellType || null,
    source: context.source || null,
    location: context.location || null,
    effective_plan: context.effectivePlan || null,
    owner_plan: context.ownerPlan || null,
    billing_tier: context.billingTier || null,
    event_upgraded: context.eventUpgraded ?? null,
    account_premium: context.accountPremium ?? null,
    cta_plan: context.ctaPlan || null,
    price_label: context.priceLabel || null,
    extra_event_credits: context.extraEventCredits ?? null,
    event_id: context.eventId || null,
    event_slug: context.eventSlug || null,
    actor_type: context.actorType || null,
  }
}

/**
 * Resolve a feature id (from upsell-context.js) to a canonical upsell type.
 */
export function resolveUpsellType(feature) {
  return FEATURE_TO_UPSELL_TYPE[feature] || feature
}

/**
 * Track an upsell impression.
 * Deduplicated by upsellType + source + eventSlug for the browser session.
 */
export function trackUpsellImpression(context) {
  try {
    const key = buildDedupKey(context)
    if (IN_MEMORY_IMPRESSIONS.has(key)) return

    const sessionSet = getSessionSet(STORAGE_KEY_IMPRESSIONS)
    if (sessionSet.has(key)) {
      IN_MEMORY_IMPRESSIONS.add(key)
      return
    }

    trackEvent(EVENT_UPSELL_IMPRESSION, buildPayload(context))
    logUpsellEvent({ eventName: EVENT_UPSELL_IMPRESSION, ...buildPayload(context) })
    IN_MEMORY_IMPRESSIONS.add(key)
    sessionSet.add(key)
    setSessionSet(STORAGE_KEY_IMPRESSIONS, sessionSet)
  } catch {
    // silently ignore tracking errors
  }
}

/**
 * Track an upsell CTA click.
 */
export function trackUpsellClick(context) {
  try {
    trackEvent(EVENT_UPSELL_CLICK, buildPayload(context))
    logUpsellEvent({ eventName: EVENT_UPSELL_CLICK, ...buildPayload(context) })
  } catch {
    // silently ignore
  }
}

/**
 * Track upsell checkout start (client-side).
 * The server-side variant lives directly in /api/stripe/checkout-session.
 */
export function trackUpsellCheckoutStart(context) {
  try {
    trackEvent(EVENT_UPSELL_CHECKOUT_START, buildPayload(context))
    logUpsellEvent({ eventName: EVENT_UPSELL_CHECKOUT_START, ...buildPayload(context) })
  } catch {
    // silently ignore
  }
}

/**
 * Store minimal attribution in sessionStorage so that the checkout
 * and webhook can associate a conversion back to the original upsell.
 */
export function storeUpsellAttribution(context) {
  try {
    sessionStorage.setItem(
      STORAGE_KEY_ATTRIBUTION,
      JSON.stringify({
        ...context,
        timestamp: Date.now(),
      })
    )
  } catch {
    // ignore
  }
}

/**
 * Read the last stored upsell attribution.
 */
export function getUpsellAttribution() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_ATTRIBUTION)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/**
 * Clear stored upsell attribution (e.g. after successful conversion).
 */
export function clearUpsellAttribution() {
  try {
    sessionStorage.removeItem(STORAGE_KEY_ATTRIBUTION)
  } catch {
    // ignore
  }
}
