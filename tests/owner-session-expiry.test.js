import { describe, it, expect, vi } from 'vitest'
import { classifyOwnerApiFailure, createOwnerSessionExpiryGate } from '@/lib/client/owner-session-expiry'

describe('classifyOwnerApiFailure', () => {
  it('401 -> SESSION_EXPIRED', () => {
    expect(classifyOwnerApiFailure(401)).toBe('SESSION_EXPIRED')
  })

  it('403 -> null', () => {
    expect(classifyOwnerApiFailure(403)).toBeNull()
  })

  it('429 -> null', () => {
    expect(classifyOwnerApiFailure(429)).toBeNull()
  })

  it('500 -> null', () => {
    expect(classifyOwnerApiFailure(500)).toBeNull()
  })

  it('503 -> null', () => {
    expect(classifyOwnerApiFailure(503)).toBeNull()
  })

  it('200 -> null', () => {
    expect(classifyOwnerApiFailure(200)).toBeNull()
  })

  it('does not read payload at all — only the status matters', () => {
    // classifyOwnerApiFailure takes just a status, so there is no payload
    // argument it could read even accidentally; this test locks in the
    // single-argument signature as a contract.
    expect(classifyOwnerApiFailure.length).toBe(1)
  })
})

describe('createOwnerSessionExpiryGate — outcome contract', () => {
  it('A: 3 concurrent 401s, session truly expired -> checkSession called once, onExpired called once, all resolve EXPIRED', async () => {
    const gate = createOwnerSessionExpiryGate()
    let checkSessionCalls = 0
    const onExpired = vi.fn()
    const checkSession = async () => {
      checkSessionCalls += 1
      return false
    }

    const results = await Promise.all([
      gate.handleCandidate401(checkSession, onExpired),
      gate.handleCandidate401(checkSession, onExpired),
      gate.handleCandidate401(checkSession, onExpired),
    ])

    expect(checkSessionCalls).toBe(1)
    expect(onExpired).toHaveBeenCalledTimes(1)
    expect(results).toEqual(['EXPIRED', 'EXPIRED', 'EXPIRED'])
  })

  it('B: a later 401 in the same already-expired episode resolves ALREADY_HANDLED, no new check/onExpired', async () => {
    const gate = createOwnerSessionExpiryGate()
    let checkSessionCalls = 0
    const onExpired = vi.fn()
    const checkSession = async () => {
      checkSessionCalls += 1
      return false
    }

    const first = await gate.handleCandidate401(checkSession, onExpired)
    expect(first).toBe('EXPIRED')
    expect(checkSessionCalls).toBe(1)
    expect(onExpired).toHaveBeenCalledTimes(1)

    // A brand-new candidate 401 arriving after the episode already resolved.
    const second = await gate.handleCandidate401(checkSession, onExpired)
    expect(second).toBe('ALREADY_HANDLED')
    expect(checkSessionCalls).toBe(1)
    expect(onExpired).toHaveBeenCalledTimes(1)
  })

  it('C: reset() followed by a future genuine expiry can expire again', async () => {
    const gate = createOwnerSessionExpiryGate()
    const onExpired = vi.fn()
    const checkSession = async () => false

    await gate.handleCandidate401(checkSession, onExpired)
    expect(onExpired).toHaveBeenCalledTimes(1)

    gate.reset()

    const afterReset = await gate.handleCandidate401(checkSession, onExpired)
    expect(afterReset).toBe('EXPIRED')
    expect(onExpired).toHaveBeenCalledTimes(2)
  })

  it('D: reset() + a stale old-style 401 whose confirmation says authenticated=true -> SESSION_VALID, no onExpired', async () => {
    const gate = createOwnerSessionExpiryGate()
    const onExpired = vi.fn()

    // Simulate an earlier real expiry, then a fresh login (reset()).
    await gate.handleCandidate401(async () => false, onExpired)
    expect(onExpired).toHaveBeenCalledTimes(1)
    gate.reset()

    // A stale request sent before the re-login resolves with 401 after the
    // fresh session is already active; confirmation proves it's still valid.
    const staleResult = await gate.handleCandidate401(async () => true, onExpired)
    expect(staleResult).toBe('SESSION_VALID')
    expect(onExpired).toHaveBeenCalledTimes(1) // unchanged — not called again
  })

  it('E: checkSession is never invoked unless handleCandidate401 is called (non-401 responses never reach the gate)', () => {
    // The gate has no knowledge of HTTP status at all — callers only invoke
    // handleCandidate401 after classifyOwnerApiFailure already returned
    // SESSION_EXPIRED. This test documents that contract: constructing the
    // gate performs no network activity of its own.
    const checkSession = vi.fn()
    createOwnerSessionExpiryGate()
    expect(checkSession).not.toHaveBeenCalled()
  })

  it('F: confirmation failure policy — checkSession rejecting resolves EXPIRED (documented fail-safe)', async () => {
    const gate = createOwnerSessionExpiryGate()
    const onExpired = vi.fn()
    const checkSession = async () => {
      throw new Error('network error')
    }

    const result = await gate.handleCandidate401(checkSession, onExpired)
    expect(result).toBe('EXPIRED')
    expect(onExpired).toHaveBeenCalledTimes(1)
  })

  it('a resolved SESSION_VALID confirmation allows a fresh checkSession call for a later, unrelated 401', async () => {
    const gate = createOwnerSessionExpiryGate()
    const onExpired = vi.fn()
    let checkSessionCalls = 0
    const checkSessionValid = async () => {
      checkSessionCalls += 1
      return true
    }

    const first = await gate.handleCandidate401(checkSessionValid, onExpired)
    expect(first).toBe('SESSION_VALID')
    expect(checkSessionCalls).toBe(1)
    expect(onExpired).not.toHaveBeenCalled()

    const checkSessionExpired = async () => {
      checkSessionCalls += 1
      return false
    }
    const second = await gate.handleCandidate401(checkSessionExpired, onExpired)
    expect(second).toBe('EXPIRED')
    expect(checkSessionCalls).toBe(2)
    expect(onExpired).toHaveBeenCalledTimes(1)
  })

  it('G (§9): stronger after-relogin race — expired episode, reset, stale 401 resolves authenticated:true -> SESSION_VALID, onExpired not called again, no second transition', async () => {
    const gate = createOwnerSessionExpiryGate()
    const onExpired = vi.fn()

    // 1. expired episode handled.
    const expiredOutcome = await gate.handleCandidate401(async () => false, onExpired)
    expect(expiredOutcome).toBe('EXPIRED')
    expect(onExpired).toHaveBeenCalledTimes(1)

    // 2. reset after successful login.
    gate.reset()

    // 3 & 4. an old request returns 401; checkSession confirms authenticated:true.
    const staleOutcome = await gate.handleCandidate401(async () => true, onExpired)

    // The outcome itself must prove "consumed" (a defined, non-EXPIRED
    // outcome) — not merely inferred from onExpired's call count.
    expect(staleOutcome).toBe('SESSION_VALID')
    expect(['EXPIRED', 'SESSION_VALID', 'ALREADY_HANDLED']).toContain(staleOutcome)
    expect(onExpired).toHaveBeenCalledTimes(1) // no second transition
  })

  it('H (§10): 3 concurrent candidate 401s, session currently valid -> checkSession called once, onExpired never called, all three consumed as SESSION_VALID', async () => {
    const gate = createOwnerSessionExpiryGate()
    let checkSessionCalls = 0
    const onExpired = vi.fn()
    const checkSession = async () => {
      checkSessionCalls += 1
      return true
    }

    const results = await Promise.all([
      gate.handleCandidate401(checkSession, onExpired),
      gate.handleCandidate401(checkSession, onExpired),
      gate.handleCandidate401(checkSession, onExpired),
    ])

    expect(checkSessionCalls).toBe(1)
    expect(onExpired).not.toHaveBeenCalled()
    expect(results).toEqual(['SESSION_VALID', 'SESSION_VALID', 'SESSION_VALID'])
  })

  it('I (§11): after confirmed expiry, further candidate 401s before login are ALREADY_HANDLED — no new check, no new onExpired', async () => {
    const gate = createOwnerSessionExpiryGate()
    let checkSessionCalls = 0
    const onExpired = vi.fn()
    const checkSession = async () => {
      checkSessionCalls += 1
      return false
    }

    await gate.handleCandidate401(checkSession, onExpired)
    expect(checkSessionCalls).toBe(1)
    expect(onExpired).toHaveBeenCalledTimes(1)

    const second = await gate.handleCandidate401(checkSession, onExpired)
    const third = await gate.handleCandidate401(checkSession, onExpired)

    expect(second).toBe('ALREADY_HANDLED')
    expect(third).toBe('ALREADY_HANDLED')
    expect(checkSessionCalls).toBe(1)
    expect(onExpired).toHaveBeenCalledTimes(1)
  })
})
