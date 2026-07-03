import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

const sendMock = vi.fn().mockResolvedValue({ data: { id: 'alert_email_123' } })

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(function ResendMock() {
    this.emails = { send: sendMock }
  }),
}))

import { sendOpsAlert } from '@/lib/server/ops-alerts'

const originalEnv = process.env

beforeAll(() => {
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    NEXT_PUBLIC_BASE_URL: 'https://snaprooms.app',
    OPS_ALERT_EMAIL: 'ops@snaprooms.app',
    RESEND_API_KEY: 'resend_test_key',
    RESEND_FROM_EMAIL: 'alerts@snaprooms.app',
  }
})

afterAll(() => {
  process.env = originalEnv
})

beforeEach(() => {
  vi.clearAllMocks()
  sendMock.mockResolvedValue({ data: { id: 'alert_email_123' } })
  delete globalThis.__snaproomsResendClient
})

describe('sendOpsAlert', () => {
  it('logs and sends a critical alert email when configured', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await sendOpsAlert({
      severity: 'critical',
      type: 'billing:webhook:fulfillment_failed',
      title: 'Payment fulfilled but entitlement missing',
      message: 'checkout.session.completed could not update the event.',
      context: { ownerId: 'owner-1', eventId: 'event-1', stripeSessionId: 'cs_test' },
    })

    expect(result.sent).toBe(true)
    expect(result.id).toBe('alert_email_123')
    expect(consoleErrorSpy).toHaveBeenCalled()
    expect(consoleLogSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
    consoleLogSpy.mockRestore()
  })

  it('skips email and logs warning when OPS_ALERT_EMAIL is missing', async () => {
    delete process.env.OPS_ALERT_EMAIL
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await sendOpsAlert({
      severity: 'warning',
      type: 'billing:email:failed',
      title: 'Billing email failed',
    })

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('ops_alert_email_missing')
    expect(consoleWarnSpy).toHaveBeenCalled()

    process.env.OPS_ALERT_EMAIL = 'ops@snaprooms.app'
    consoleWarnSpy.mockRestore()
  })

  it('skips email and logs warning when Resend is not configured', async () => {
    delete process.env.RESEND_API_KEY
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await sendOpsAlert({
      severity: 'warning',
      type: 'billing:email:failed',
      title: 'Billing email failed',
    })

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('resend_not_configured')
    expect(consoleWarnSpy).toHaveBeenCalled()

    process.env.RESEND_API_KEY = 'resend_test_key'
    consoleWarnSpy.mockRestore()
  })

  it('strips sensitive fields from the alert context', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await sendOpsAlert({
      severity: 'critical',
      type: 'security:csrf:failed',
      title: 'Suspicious CSRF attempt',
      context: {
        ownerId: 'owner-1',
        csrfToken: 'secret-token',
        cookie: 'session=abc',
        password: 'hunter2',
        apiKey: 'sk_live_xxx',
        rawStripeEvent: { id: 'evt_123', object: 'event' },
        safeField: 'keep-me',
      },
    })

    const logCall = consoleErrorSpy.mock.calls.find((call) =>
      typeof call[0] === 'string' && call[0].includes('[ops-alert:critical:security:csrf:failed]')
    )
    expect(logCall).toBeDefined()
    const loggedContext = logCall[1]
    expect(loggedContext).not.toHaveProperty('csrfToken')
    expect(loggedContext).not.toHaveProperty('cookie')
    expect(loggedContext).not.toHaveProperty('password')
    expect(loggedContext).not.toHaveProperty('apiKey')
    expect(loggedContext).not.toHaveProperty('rawStripeEvent')
    expect(loggedContext).toHaveProperty('safeField', 'keep-me')
    expect(loggedContext).toHaveProperty('ownerId', 'owner-1')

    consoleErrorSpy.mockRestore()
  })

  it('does not throw if Resend throws', async () => {
    sendMock.mockRejectedValueOnce(new Error('Resend API down'))
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await sendOpsAlert({
      severity: 'critical',
      type: 'test:send_error',
      title: 'Test send error',
    })

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('send_error')
    expect(result.error).toBe('Resend API down')

    consoleErrorSpy.mockRestore()
  })
})
