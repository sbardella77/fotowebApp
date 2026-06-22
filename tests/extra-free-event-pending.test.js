import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  savePendingExtraFreeEvent,
  loadPendingExtraFreeEvent,
  clearPendingExtraFreeEvent,
  markPendingExtraFreeEventCreating,
  markPendingExtraFreeEventFailed,
  isPendingExtraFreeEventCreating,
  isPendingExtraFreeEventRecent,
} from '@/lib/extra-free-event-pending'

function createFakeStorage() {
  const store = new Map()
  return {
    getItem: vi.fn((key) => store.get(key) || null),
    setItem: vi.fn((key, value) => store.set(key, value)),
    removeItem: vi.fn((key) => store.delete(key)),
    _store: store,
  }
}

describe('extra-free-event-pending', () => {
  let storage

  beforeEach(() => {
    storage = createFakeStorage()
  })

  it('saves a valid pending event name', () => {
    savePendingExtraFreeEvent('Test Hochzeit', { storage })
    const pending = loadPendingExtraFreeEvent(storage)
    expect(pending.eventName).toBe('Test Hochzeit')
    expect(pending.status).toBe('pending_checkout')
    expect(pending.source).toBe('create_room_modal')
  })

  it('ignores empty or invalid names', () => {
    savePendingExtraFreeEvent('', { storage })
    expect(loadPendingExtraFreeEvent(storage)).toBeNull()
    savePendingExtraFreeEvent('   ', { storage })
    expect(loadPendingExtraFreeEvent(storage)).toBeNull()
  })

  it('truncates names longer than 120 characters', () => {
    const longName = 'a'.repeat(200)
    savePendingExtraFreeEvent(longName, { storage })
    const pending = loadPendingExtraFreeEvent(storage)
    expect(pending.eventName.length).toBe(120)
  })

  it('marks pending as creating', () => {
    savePendingExtraFreeEvent('Test', { storage })
    markPendingExtraFreeEventCreating({ checkoutSessionId: 'cs_test', storage })
    const pending = loadPendingExtraFreeEvent(storage)
    expect(pending.status).toBe('creating')
    expect(pending.checkoutSessionId).toBe('cs_test')
    expect(isPendingExtraFreeEventCreating(storage)).toBe(true)
  })

  it('marks pending as failed', () => {
    savePendingExtraFreeEvent('Test', { storage })
    markPendingExtraFreeEventCreating({ storage })
    markPendingExtraFreeEventFailed(storage)
    const pending = loadPendingExtraFreeEvent(storage)
    expect(pending.status).toBe('failed')
    expect(isPendingExtraFreeEventCreating(storage)).toBe(false)
  })

  it('clears pending event', () => {
    savePendingExtraFreeEvent('Test', { storage })
    clearPendingExtraFreeEvent(storage)
    expect(loadPendingExtraFreeEvent(storage)).toBeNull()
  })

  it('detects creating status expired', () => {
    savePendingExtraFreeEvent('Test', { storage, status: 'creating' })
    const pending = loadPendingExtraFreeEvent(storage)
    pending.createdAt = Date.now() - 3 * 60 * 1000
    storage._store.set('snaprooms_pending_extra_free_event', JSON.stringify(pending))
    expect(isPendingExtraFreeEventCreating(storage)).toBe(false)
  })

  it('detects recent pending event', () => {
    savePendingExtraFreeEvent('Test', { storage })
    expect(isPendingExtraFreeEventRecent(storage)).toBe(true)
  })
})
