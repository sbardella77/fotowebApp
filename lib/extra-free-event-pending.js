/**
 * SnapRooms — pending Extra Free Event auto-create state.
 *
 * Stores the event name the user typed before buying an Extra Free Event
 * so the dashboard can create the event automatically after Stripe redirects
 * back with a successful payment.
 *
 * No sensitive data is stored. The shape is:
 *
 * {
 *   eventName: string,
 *   createdAt: number,
 *   source: string,
 *   status: 'pending_checkout' | 'creating' | 'failed',
 *   checkoutSessionId?: string
 * }
 */

const STORAGE_KEY = 'snaprooms_pending_extra_free_event'
const CREATING_MAX_AGE_MS = 2 * 60 * 1000 // 2 minutes

function getStorage(storage) {
  if (storage) return storage
  if (typeof window !== 'undefined' && window.sessionStorage) return window.sessionStorage
  return null
}

export function savePendingExtraFreeEvent(eventName, { source = 'create_room_modal', status = 'pending_checkout', checkoutSessionId, storage } = {}) {
  const st = getStorage(storage)
  if (!st) return
  const payload = {
    eventName: String(eventName || '').trim().slice(0, 120),
    createdAt: Date.now(),
    source,
    status,
    ...(checkoutSessionId ? { checkoutSessionId } : {}),
  }
  st.setItem(STORAGE_KEY, JSON.stringify(payload))
}

export function loadPendingExtraFreeEvent(storage) {
  const st = getStorage(storage)
  if (!st) return null
  try {
    const raw = st.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.eventName || typeof parsed.eventName !== 'string') return null
    return {
      eventName: parsed.eventName,
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : 0,
      source: parsed.source || 'create_room_modal',
      status: parsed.status || 'pending_checkout',
      checkoutSessionId: parsed.checkoutSessionId || null,
    }
  } catch {
    return null
  }
}

export function clearPendingExtraFreeEvent(storage) {
  const st = getStorage(storage)
  if (!st) return
  st.removeItem(STORAGE_KEY)
}

export function markPendingExtraFreeEventCreating({ checkoutSessionId, storage } = {}) {
  const pending = loadPendingExtraFreeEvent(storage)
  if (!pending) return
  savePendingExtraFreeEvent(pending.eventName, {
    source: pending.source,
    status: 'creating',
    checkoutSessionId: checkoutSessionId || pending.checkoutSessionId,
    storage,
  })
}

export function markPendingExtraFreeEventFailed(storage) {
  const pending = loadPendingExtraFreeEvent(storage)
  if (!pending) return
  savePendingExtraFreeEvent(pending.eventName, {
    source: pending.source,
    status: 'failed',
    checkoutSessionId: pending.checkoutSessionId,
    storage,
  })
}

export function isPendingExtraFreeEventCreating(storage) {
  const pending = loadPendingExtraFreeEvent(storage)
  if (!pending || pending.status !== 'creating') return false
  return Date.now() - pending.createdAt < CREATING_MAX_AGE_MS
}

export function isPendingExtraFreeEventRecent(storage, maxAgeMs = CREATING_MAX_AGE_MS) {
  const pending = loadPendingExtraFreeEvent(storage)
  if (!pending) return false
  return Date.now() - pending.createdAt < maxAgeMs
}
