/**
 * SnapRooms — pure UI state resolver for the dashboard "Create event" flow.
 *
 * This is the single source of truth used by the client to decide:
 * - whether the "Create event" button is enabled
 * - whether to show the Extra Free Event / Professional upsell block
 * - whether the user has Extra Free Event credits available
 *
 * Important: extraEventCredits represents *additional creations available beyond
 * the included Free limit*, not an extension of the limit itself. One credit
 * allows one extra Free event to be created.
 */

const FREE_ROOM_LIMIT = 1
const UNLIMITED_PLANS = new Set(['professional', 'business', 'pro'])

export function resolveCreateRoomState({ ownerPlan, currentRooms, extraEventCredits = 0 }) {
  const plan = ownerPlan || 'free'
  const isAccountUnlimited = UNLIMITED_PLANS.has(plan)
  const safeCurrentRooms = Number(currentRooms || 0)
  const safeExtraEventCredits = Number(extraEventCredits || 0)

  const hasExtraEventCredits = safeExtraEventCredits > 0
  const withinFreeIncludedLimit = safeCurrentRooms < FREE_ROOM_LIMIT
  const freeLimitReached = !isAccountUnlimited && !withinFreeIncludedLimit

  const canCreateRoom =
    isAccountUnlimited || withinFreeIncludedLimit || hasExtraEventCredits
  const showCreateEventUpsell = freeLimitReached && !hasExtraEventCredits

  return {
    isAccountUnlimited,
    hasExtraEventCredits,
    withinFreeIncludedLimit,
    freeLimitReached,
    canCreateRoom,
    showCreateEventUpsell,
    extraEventCredits: safeExtraEventCredits,
  }
}
