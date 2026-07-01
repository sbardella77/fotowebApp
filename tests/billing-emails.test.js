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
  sendExtraFreeEventCreatedEmail,
  sendExtraFreeEventFallbackCreditEmail,
  sendExtraFreeEventCreditGrantedEmail,
  sendProEventPurchasedEmail,
  sendWeddingProPurchasedEmail,
  sendProfessionalActivatedEmail,
  sendProfessionalPaymentFailedEmail,
  sendProfessionalPaymentRecoveredEmail,
  sendProfessionalCanceledEmail,
  sendProfessionalCancellationScheduledEmail,
} from '@/lib/server/billing-emails'
import { buildEmail } from '@/lib/server/email/email-layout'

const appUrl = 'https://snaprooms.app'

function expectNoSensitiveData(email) {
  const combined = `${email.subject} ${email.text} ${email.html}`
  expect(combined).not.toContain('sub_')
  expect(combined).not.toContain('cus_')
  expect(combined).not.toContain('in_')
  expect(combined).not.toContain('pi_')
  expect(combined).not.toContain('test_resend_key')
  expect(combined).not.toContain('card')
  expect(combined).not.toContain('token')
}

describe('buildEmail', () => {
  it('produces text and HTML without raw secrets', () => {
    const email = buildEmail({
      subject: 'Test subject',
      headline: 'Test headline',
      bodyLines: ['Line one', 'Line two'],
      cta: { text: 'Click me', url: `${appUrl}/dashboard` },
      appUrl,
    })

    expect(email.text).toContain('Test headline')
    expect(email.text).toContain('Click me: https://snaprooms.app/dashboard')
    expect(email.html).toContain('Test headline')
    expect(email.html).toContain('https://snaprooms.app/dashboard')
    expect(email.html).toContain('SnapRooms')
  })

  it('escapes HTML in body lines', () => {
    const email = buildEmail({
      subject: 'Escaping',
      headline: 'Headline',
      bodyLines: ['<script>alert(1)</script>'],
      appUrl,
    })

    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('&lt;script&gt;')
  })
})

describe('billing email senders', () => {
  beforeEach(() => {
    sendMock.mockClear()
    vi.stubEnv('RESEND_API_KEY', 'test_resend_key')
    vi.stubEnv('RESEND_FROM_EMAIL', 'billing@snaprooms.app')
    delete globalThis.__snaproomsResendClient
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('sendExtraFreeEventCreatedEmail sends localized email with event link', async () => {
    const result = await sendExtraFreeEventCreatedEmail({
      owner: { id: 'owner_1', email: 'user@example.com' },
      event: { id: 'event_1', slug: 'birthday-2025', name: 'Birthday Party' },
      appUrl,
    })

    expect(result.sent).toBe(true)
    expect(sendMock).toHaveBeenCalledTimes(1)
    const payload = sendMock.mock.calls[0][0]
    expect(payload.subject).toBe('Dein Extra Free Event wurde erstellt')
    expect(payload.to).toBe('user@example.com')
    expect(payload.text).toContain('Birthday Party')
    expect(payload.text).toContain('https://snaprooms.app/event/birthday-2025')
    expect(payload.text).toContain('Wasserzeichen')
    expectNoSensitiveData(payload)
  })

  it('sendExtraFreeEventFallbackCreditEmail sends fallback credit message', async () => {
    const result = await sendExtraFreeEventFallbackCreditEmail({
      owner: { id: 'owner_1', email: 'user@example.com' },
      pending: { id: 'pending_1', eventName: 'Fallback Event' },
      appUrl,
    })

    expect(result.sent).toBe(true)
    const payload = sendMock.mock.calls[0][0]
    expect(payload.subject).toBe('Dein Extra Free Event wurde gekauft')
    expect(payload.text).toContain('automatische Erstellung')
    expect(payload.text).toContain('1 Extra-Free-Event-Guthaben')
    expectNoSensitiveData(payload)
  })

  it('sendExtraFreeEventCreditGrantedEmail sends credit balance', async () => {
    const result = await sendExtraFreeEventCreditGrantedEmail({
      owner: { id: 'owner_1', email: 'user@example.com' },
      credits: 3,
      appUrl,
    })

    expect(result.sent).toBe(true)
    const payload = sendMock.mock.calls[0][0]
    expect(payload.subject).toBe('Extra Free Event-Guthaben gutgeschrieben')
    expect(payload.text).toContain('3')
    expectNoSensitiveData(payload)
  })

  it('sendProEventPurchasedEmail lists Pro Event features', async () => {
    const result = await sendProEventPurchasedEmail({
      owner: { id: 'owner_1', email: 'user@example.com' },
      event: { id: 'event_1', slug: 'conference', name: 'Conference' },
      appUrl,
    })

    expect(result.sent).toBe(true)
    const payload = sendMock.mock.calls[0][0]
    expect(payload.subject).toBe('Pro Event wurde aktiviert')
    expect(payload.text).toContain('Branding entfernt')
    expect(payload.text).toContain('Galerie-ZIP')
    expect(payload.text).toContain('12 Monate')
    expectNoSensitiveData(payload)
  })

  it('sendWeddingProPurchasedEmail lists Wedding Pro features', async () => {
    const result = await sendWeddingProPurchasedEmail({
      owner: { id: 'owner_1', email: 'user@example.com' },
      event: { id: 'event_1', slug: 'wedding', name: 'Wedding' },
      appUrl,
    })

    expect(result.sent).toBe(true)
    const payload = sendMock.mock.calls[0][0]
    expect(payload.subject).toBe('Wedding Pro wurde aktiviert')
    expect(payload.text).toContain('Private Delivery')
    expect(payload.text).toContain('Fotografen-Upload-Link')
    expect(payload.text).toContain('24 Monate')
    expectNoSensitiveData(payload)
  })

  it('sendProfessionalActivatedEmail links to dashboard', async () => {
    const result = await sendProfessionalActivatedEmail({
      owner: { id: 'owner_1', email: 'user@example.com' },
      appUrl,
    })

    expect(result.sent).toBe(true)
    const payload = sendMock.mock.calls[0][0]
    expect(payload.subject).toBe('SnapRooms Professional ist aktiviert')
    expect(payload.text).toContain('Unbegrenzte Events')
    expect(payload.text).toContain('https://snaprooms.app/dashboard')
    expectNoSensitiveData(payload)
  })

  it('sendProfessionalPaymentFailedEmail includes grace date when active', async () => {
    const graceUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const result = await sendProfessionalPaymentFailedEmail({
      owner: {
        id: 'owner_1',
        email: 'user@example.com',
        subscriptionGraceUntil: graceUntil,
      },
      billingState: { graceActive: true },
      appUrl,
    })

    expect(result.sent).toBe(true)
    const payload = sendMock.mock.calls[0][0]
    expect(payload.subject).toBe('Zahlung fehlgeschlagen – bitte Zahlungsmethode aktualisieren')
    expect(payload.text).toContain('Zahlungsmethode aktualisieren')
    expect(payload.text).toContain(
      graceUntil.toLocaleDateString('de', { year: 'numeric', month: 'long', day: 'numeric' })
    )
    expect(payload.text).toContain('https://snaprooms.app/dashboard?billing=portal')
    expectNoSensitiveData(payload)
  })

  it('sendProfessionalPaymentRecoveredEmail sends recovery confirmation', async () => {
    const result = await sendProfessionalPaymentRecoveredEmail({
      owner: { id: 'owner_1', email: 'user@example.com' },
      appUrl,
    })

    expect(result.sent).toBe(true)
    const payload = sendMock.mock.calls[0][0]
    expect(payload.subject).toBe('Zahlung erfolgreich – Professional bleibt aktiv')
    expect(payload.text).toContain('Professional bleibt aktiv')
    expectNoSensitiveData(payload)
  })

  it('sendProfessionalCanceledEmail sends cancellation notice', async () => {
    const graceUntil = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    const result = await sendProfessionalCanceledEmail({
      owner: {
        id: 'owner_1',
        email: 'user@example.com',
        subscriptionGraceUntil: graceUntil,
      },
      appUrl,
    })

    expect(result.sent).toBe(true)
    const payload = sendMock.mock.calls[0][0]
    expect(payload.subject).toBe('Dein Professional-Abonnement wurde beendet')
    expect(payload.text).toContain('beendet')
    expect(payload.text).toContain('nicht sofort gelöscht')
    expectNoSensitiveData(payload)
  })

  it('sendProfessionalCancellationScheduledEmail includes period end date', async () => {
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    const result = await sendProfessionalCancellationScheduledEmail({
      owner: { id: 'owner_1', email: 'user@example.com' },
      currentPeriodEnd: periodEnd,
      appUrl,
    })

    expect(result.sent).toBe(true)
    const payload = sendMock.mock.calls[0][0]
    expect(payload.subject).toBe('Professional-Abonnement gekündigt')
    expect(payload.text).toContain('Kündigung erhalten')
    expect(payload.text).toContain(
      periodEnd.toLocaleDateString('de', { year: 'numeric', month: 'long', day: 'numeric' })
    )
    expectNoSensitiveData(payload)
  })

  it('returns gracefully when Resend is not configured', async () => {
    vi.unstubAllEnvs()
    delete globalThis.__snaproomsResendClient

    const result = await sendProfessionalActivatedEmail({
      owner: { id: 'owner_1', email: 'user@example.com' },
      appUrl,
    })

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('resend_not_configured')
  })

  it('catches Resend errors without throwing', async () => {
    sendMock.mockRejectedValueOnce(new Error('Resend API down'))

    const result = await sendProfessionalActivatedEmail({
      owner: { id: 'owner_1', email: 'user@example.com' },
      appUrl,
    })

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('send_error')
    expect(result.error).toBe('Resend API down')
  })
})
