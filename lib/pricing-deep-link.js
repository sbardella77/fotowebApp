/**
 * SnapRooms — Pricing deep-link plan normalization.
 *
 * Guest Room's upsell CTA links to the pricing page with `?plan=pro_event`
 * (underscore), but the pricing page's tier id is `pro-event` (hyphen).
 * Guest Room is frozen and must not be changed, so normalization happens
 * here, on the receiving side.
 */

/**
 * @param {string | null | undefined} rawPlan
 * @returns {string | null}
 */
export function normalizePricingPlanParam(rawPlan) {
  if (!rawPlan) return null
  return rawPlan === 'pro_event' ? 'pro-event' : rawPlan
}
