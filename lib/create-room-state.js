/**
 * SnapRooms — pure UI state resolver for the dashboard "Create event" flow.
 *
 * This is the single source of truth used by the client to decide:
 * - whether the "Create event" button is enabled
 * - whether to show the Extra Event / Professional upsell block
 * - whether the user has Extra Event credits available
 */

const FREE_ROOM_LIMIT = 1
const UNLIMITED_PLANS = new Set(['professional', 'business', 'pro'])

export function resolveCreateRoomState({ ownerPlan, currentRooms, extraEventCredits = 0 }) {
  const plan = ownerPlan || 'free'
  const isAccountUnlimited = UNLIMITED_PLANS.has(plan)
  const credits = Number(extraEventCredits || 0)
  const hasExtraEventCredits = credits > 0
  const rooms = Number(currentRooms || 0)

  const canCreateRoom = isAccountUnlimited || rooms < FREE_ROOM_LIMIT + credits
  const freeLimitReached = !isAccountUnlimited && rooms >= FREE_ROOM_LIMIT
  const showCreateEventUpsell = freeLimitReached && !hasExtraEventCredits

  return {
    isAccountUnlimited,
    hasExtraEventCredits,
    freeLimitReached,
    canCreateRoom,
    showCreateEventUpsell,
  }
}
