import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const sendMock = vi.fn().mockResolvedValue({ data: { id: 'email_123' } })

vi.mock('resend', () => ({
  Resend: class MockResend {
    constructor() {
      this.emails = { send: sendMock }
    }
  },
}))

import {
  sendPhotoDigestEmail,
  sendPhotoThresholdReachedEmail,
  sendEventExpiringReminderEmail,
} from '@/lib/server/owner-notification-emails'

const appUrl = 'https://snaprooms.app'

function expectNoSensitiveData(email) {
  const combined = `${email.subject} ${email.text} ${email.html}`
  expect(combined).not.toContain('test_resend_key')
}

describe('owner notification email senders', () => {
  beforeEach(() => {
    sendMock.mockClear()
    vi.stubEnv('RESEND_API_KEY', 'test_resend_key')
    vi.stubEnv('RESEND_FROM_EMAIL', 'notifications@snaprooms.app')
    delete globalThis.__snaproomsResendClient
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('sendPhotoDigestEmail sends a localized digest with the photo count and event link', async () => {
    const result = await sendPhotoDigestEmail({
      owner: { id: 'owner_1', email: 'user@example.com' },
      event: { id: 'event_1', slug: 'birthday-2025', name: 'Birthday Party' },
      newPhotoCount: 12,
      appUrl,
    })

    expect(result.sent).toBe(true)
    expect(sendMock).toHaveBeenCalledTimes(1)
    const payload = sendMock.mock.calls[0][0]
    expect(payload.to).toBe('user@example.com')
    expect(payload.subject).toContain('12')
    expect(payload.text).toContain('Birthday Party')
    expect(payload.text).toContain('https://snaprooms.app/event/birthday-2025')
    expectNoSensitiveData(payload)
  })

  it('sendPhotoThresholdReachedEmail mentions the plan limit and links to the dashboard', async () => {
    const result = await sendPhotoThresholdReachedEmail({
      owner: { id: 'owner_1', email: 'user@example.com' },
      event: { id: 'event_1', slug: 'wedding-2025', name: 'Wedding' },
      max: 50,
      appUrl,
    })

    expect(result.sent).toBe(true)
    const payload = sendMock.mock.calls[0][0]
    expect(payload.text).toContain('Wedding')
    expect(payload.text).toContain('50')
    expect(payload.text).toContain('https://snaprooms.app/dashboard')
    expectNoSensitiveData(payload)
  })

  it('sendEventExpiringReminderEmail reflects the days-remaining count', async () => {
    const result = await sendEventExpiringReminderEmail({
      owner: { id: 'owner_1', email: 'user@example.com' },
      event: { id: 'event_1', slug: 'wedding-2025', name: 'Wedding' },
      daysRemaining: 7,
      appUrl,
    })

    expect(result.sent).toBe(true)
    const payload = sendMock.mock.calls[0][0]
    expect(payload.subject).toContain('7')
    expect(payload.text).toContain('Wedding')
    expectNoSensitiveData(payload)
  })

  it('sendEventExpiringReminderEmail uses "today" phrasing when daysRemaining is 0', async () => {
    const result = await sendEventExpiringReminderEmail({
      owner: { id: 'owner_1', email: 'user@example.com' },
      event: { id: 'event_1', slug: 'wedding-2025', name: 'Wedding' },
      daysRemaining: 0,
      appUrl,
    })

    expect(result.sent).toBe(true)
    const payload = sendMock.mock.calls[0][0]
    expect(payload.subject).not.toContain('0')
  })

  it('does not send when Resend is not configured', async () => {
    vi.unstubAllEnvs()
    delete globalThis.__snaproomsResendClient

    const result = await sendPhotoDigestEmail({
      owner: { id: 'owner_1', email: 'user@example.com' },
      event: { id: 'event_1', slug: 'birthday-2025', name: 'Birthday Party' },
      newPhotoCount: 3,
      appUrl,
    })

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('resend_not_configured')
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('does not send when the owner has no email', async () => {
    const result = await sendPhotoThresholdReachedEmail({
      owner: { id: 'owner_1', email: null },
      event: { id: 'event_1', slug: 'wedding-2025', name: 'Wedding' },
      max: 50,
      appUrl,
    })

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('no_recipient')
    expect(sendMock).not.toHaveBeenCalled()
  })
})
