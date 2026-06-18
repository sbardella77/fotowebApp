import { describe, it, expect } from 'vitest'
import { resolveCreateEventCtaState } from '../lib/create-event-cta-state'

describe('resolveCreateEventCtaState', () => {
  it('routes authenticated owners to the dashboard create modal', () => {
    const result = resolveCreateEventCtaState({ authenticated: true })
    expect(result.href).toBe('/dashboard?createEvent=1')
  })

  it('keeps anonymous visitors on the public homepage flow', () => {
    const result = resolveCreateEventCtaState({ authenticated: false })
    expect(result.href).toBe('/')
  })

  it('defaults to the public homepage flow when authenticated is missing', () => {
    const result = resolveCreateEventCtaState({})
    expect(result.href).toBe('/')
  })
})
