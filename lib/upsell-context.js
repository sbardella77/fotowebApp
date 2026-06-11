/**
 * SnapRooms — Upsell context resolver.
 *
 * Centralises which upsell to show for which missing premium capability.
 * Every upsell derives from resolveEffectiveEventAccessState output.
 *
 * RULE: Never read billingTier / ownerPlan / originalDownloadUnlocked directly
 * to decide an upsell. Use the access state instead.
 */

/**
 * @typedef {ReturnType<import('./event-access').resolveEffectiveEventAccessState>} AccessState
 */

/**
 * @typedef {Object} UpsellItem
 * @property {string} feature - machine id: 'gallery_download' | 'branding' | 'private_delivery' | 'upload_limit' | 'room_limit' | 'pro_event_upgrade' | 'wedding_pro_upgrade'
 * @property {string} titleKey - i18n key for the benefit title
 * @property {string} descriptionKey - i18n key for the description
 * @property {string} ctaKey - i18n key for the CTA button label
 * @property {string} ctaPlan - checkout intent: 'pro_event' | 'wedding_pro' | 'professional' | 'unlock'
 * @property {string[]} [benefitsKeys] - optional i18n keys for bullet benefits
 */

/**
 * Gallery ZIP download upsell.
 * @param {AccessState} state
 * @returns {UpsellItem|null}
 */
export function getGalleryUpsell(state) {
  if (state.canDownloadGallery) return null
  return {
    feature: 'gallery_download',
    titleKey: 'upsellGalleryTitle',
    descriptionKey: 'upsellGalleryDesc',
    ctaKey: 'unlockGalleryDownload',
    ctaPlan: 'pro_event',
    benefitsKeys: ['upsellBenefitZipDownload', 'upsellBenefitNoWatermark'],
  }
}

/**
 * Watermark / unbranded download upsell.
 * @param {AccessState} state
 * @returns {UpsellItem|null}
 */
export function getBrandingUpsell(state) {
  if (state.hasUnbrandedDownloads) return null
  return {
    feature: 'branding',
    titleKey: 'upsellBrandingTitle',
    descriptionKey: 'upsellBrandingDesc',
    ctaKey: 'removeBranding',
    ctaPlan: 'pro_event',
    benefitsKeys: ['upsellBenefitNoWatermark'],
  }
}

/**
 * Private delivery (photographer upload) upsell.
 * @param {AccessState} state
 * @returns {UpsellItem|null}
 */
export function getPrivateDeliveryUpsell(state) {
  if (state.hasPrivateDelivery) return null
  return {
    feature: 'private_delivery',
    titleKey: 'upsellPrivateDeliveryTitle',
    descriptionKey: 'upsellPrivateDeliveryDesc',
    ctaKey: 'enablePrivateDelivery',
    ctaPlan: 'wedding_pro',
    benefitsKeys: ['upsellBenefitPrivateDelivery', 'upsellBenefitNoWatermark'],
  }
}

/**
 * Upload limit upsell (per-room photo cap).
 * @param {AccessState} state
 * @returns {UpsellItem|null}
 */
export function getUploadLimitUpsell(state) {
  if (state.canUploadUnlimited) return null
  return {
    feature: 'upload_limit',
    titleKey: 'upsellUploadLimitTitle',
    descriptionKey: 'upsellUploadLimitDesc',
    ctaKey: 'unlockUnlimitedUploads',
    ctaPlan: 'pro_event',
    benefitsKeys: ['upsellBenefitUnlimitedUploads'],
  }
}

/**
 * Room creation limit upsell (account-level).
 * @param {AccessState} state
 * @returns {UpsellItem|null}
 */
export function getRoomLimitUpsell(state) {
  if (state.canCreateUnlimitedRooms) return null
  return {
    feature: 'room_limit',
    titleKey: 'upsellRoomLimitTitle',
    descriptionKey: 'upsellRoomLimitDesc',
    ctaKey: 'createMoreEvents',
    ctaPlan: 'professional',
    benefitsKeys: ['upsellBenefitUnlimitedRooms'],
  }
}

/**
 * Pro Event plan upgrade upsell.
 * Shown when the event is not upgraded and the owner is not on an account-level premium plan.
 * @param {AccessState} state
 * @returns {UpsellItem|null}
 */
export function getProEventUpsell(state) {
  if (state.accountPremium || state.eventUpgraded) return null
  return {
    feature: 'pro_event_upgrade',
    titleKey: 'upsellUpgradeToProEvent',
    descriptionKey: 'proEventShortDesc',
    ctaKey: 'unlockProEvent',
    ctaPlan: 'pro_event',
    benefitsKeys: ['upsellBenefitZipDownload', 'upsellBenefitNoWatermark', 'upsellBenefitUnlimitedUploads'],
  }
}

/**
 * Wedding Pro plan upgrade upsell.
 * Shown when the event is not Wedding Pro and the owner is not on an account-level premium plan.
 * @param {AccessState} state
 * @returns {UpsellItem|null}
 */
export function getWeddingProUpsell(state) {
  if (state.accountPremium || state.billingTier === 'wedding_pro') return null
  return {
    feature: 'wedding_pro_upgrade',
    titleKey: 'upsellUpgradeToWeddingPro',
    descriptionKey: 'weddingProShortDesc',
    ctaKey: state.billingTier === 'pro_event' ? 'upgradeToWeddingPro' : 'chooseWeddingPro',
    ctaPlan: 'wedding_pro',
    benefitsKeys: ['upsellBenefitPrivateDelivery', 'upsellBenefitZipDownload', 'upsellBenefitNoWatermark'],
  }
}

/**
 * Lightbox original-quality download upsell.
 * @param {AccessState} state
 * @param {boolean} isOwner
 * @returns {UpsellItem|null}
 */
export function getOriginalDownloadUpsell(state, isOwner) {
  if (state.canDownloadOriginal) return null
  if (isOwner) {
    return {
      feature: 'original_download',
      titleKey: 'unlockForEveryone',
      descriptionKey: 'originalQualityDesc',
      ctaKey: 'unlockForEveryone',
      ctaPlan: 'unlock',
    }
  }
  return {
    feature: 'original_download',
    titleKey: 'askOwnerToUnlock',
    descriptionKey: 'originalQualityDesc',
    ctaKey: null,
    ctaPlan: null,
  }
}

/**
 * Return all applicable upsells for an event, deduplicating by ctaPlan
 * so the UI never shows two CTAs for the same intent.
 *
 * @param {AccessState} state
 * @returns {UpsellItem[]}
 */
export function resolveAllUpsells(state) {
  const items = [
    getProEventUpsell(state),
    getWeddingProUpsell(state),
    getBrandingUpsell(state),
    getGalleryUpsell(state),
    getPrivateDeliveryUpsell(state),
    getUploadLimitUpsell(state),
    getRoomLimitUpsell(state),
  ].filter(Boolean)

  // Deduplicate: if both branding and gallery point to pro_event,
  // keep only the first item per checkout intent (plan upgrade cards win).
  const seen = new Set()
  const deduped = []
  for (const item of items) {
    if (item.ctaPlan && seen.has(item.ctaPlan)) continue
    if (item.ctaPlan) seen.add(item.ctaPlan)
    deduped.push(item)
  }
  return deduped
}
