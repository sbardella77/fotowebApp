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
 * @property {string} feature - machine id: 'gallery_download' | 'branding' | 'private_delivery' | 'upload_limit' | 'room_limit'
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
    ctaKey: 'upsellUpgradeToProEvent',
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
    ctaKey: 'upsellUpgradeToProEvent',
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
    ctaKey: 'upsellUpgradeToWeddingPro',
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
    ctaKey: 'upsellUpgradeToProEvent',
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
    ctaKey: 'upsellUpgradeToProfessional',
    ctaPlan: 'professional',
    benefitsKeys: ['upsellBenefitUnlimitedRooms'],
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
    getBrandingUpsell(state),
    getGalleryUpsell(state),
    getPrivateDeliveryUpsell(state),
    getUploadLimitUpsell(state),
    getRoomLimitUpsell(state),
  ].filter(Boolean)

  // Deduplicate: if both branding and gallery point to pro_event,
  // keep only gallery (it includes no-watermark benefit already).
  const seen = new Set()
  const deduped = []
  for (const item of items) {
    if (item.ctaPlan && seen.has(item.ctaPlan)) continue
    if (item.ctaPlan) seen.add(item.ctaPlan)
    deduped.push(item)
  }
  return deduped
}
