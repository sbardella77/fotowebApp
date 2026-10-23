/**
 * SnapRooms — owner-facing operational emails (photo digest, photo
 * threshold reached, event-expiring reminders).
 *
 * Same pattern as lib/server/billing-emails.js: safe to call from
 * best-effort side-effects — failures are caught and logged, Resend
 * misconfiguration is handled gracefully, and the functions never throw.
 */

import { Resend } from 'resend'
import { buildEmail, EMAIL_DEFAULT_LOCALE } from './email/email-layout'

const REPLY_TO = 'hello@snaprooms.app'

function getResendClient() {
  if (!process.env.RESEND_API_KEY) return null
  if (!globalThis.__snaproomsResendClient) {
    globalThis.__snaproomsResendClient = new Resend(process.env.RESEND_API_KEY)
  }
  return globalThis.__snaproomsResendClient
}

function getFromEmail() {
  return process.env.RESEND_FROM_EMAIL || null
}

function resolveLocale(owner = {}) {
  // Same limitation as billing-emails.js: no persisted owner.locale field
  // exists yet, so this always falls back to the default locale today.
  return owner.locale || EMAIL_DEFAULT_LOCALE
}

async function sendEmailSafely({ to, email, logContext }) {
  const resend = getResendClient()
  const fromEmail = getFromEmail()

  if (!resend || !fromEmail) {
    console.warn('[owner-notification-emails] Resend not configured, skipping email:', logContext)
    return { sent: false, reason: 'resend_not_configured' }
  }

  if (!to) {
    console.warn('[owner-notification-emails] No recipient, skipping email:', logContext)
    return { sent: false, reason: 'no_recipient' }
  }

  try {
    const result = await resend.emails.send({
      from: fromEmail,
      to,
      reply_to: REPLY_TO,
      subject: email.subject,
      text: email.text,
      html: email.html,
    })
    console.log('[owner-notification-emails] Email sent:', { ...logContext, id: result?.data?.id })
    return { sent: true, id: result?.data?.id }
  } catch (error) {
    console.error('[owner-notification-emails] Failed to send email:', { ...logContext, error: error.message })
    return { sent: false, reason: 'send_error', error: error.message }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Photo digest (hourly, batched — see lib/server/photo-digest.js for the
// increment side of this)
// ─────────────────────────────────────────────────────────────────────────────

const PHOTO_DIGEST = {
  de: {
    subject: (count) => `${count} neue Foto${count === 1 ? '' : 's'} in deinem Event`,
    headline: (count) => `${count} neue Foto${count === 1 ? '' : 's'} warten auf dich`,
    body: (eventName, eventUrl) => [
      `In "${eventName}" sind neue Gästefotos eingegangen.`,
      `Raum ansehen:\n${eventUrl}`,
    ],
    cta: 'Fotos ansehen',
  },
  en: {
    subject: (count) => `${count} new photo${count === 1 ? '' : 's'} in your event`,
    headline: (count) => `${count} new photo${count === 1 ? '' : 's'} waiting for you`,
    body: (eventName, eventUrl) => [
      `New guest photos have arrived in "${eventName}".`,
      `View room:\n${eventUrl}`,
    ],
    cta: 'View photos',
  },
  it: {
    subject: (count) => `${count} nuova${count === 1 ? '' : 'e'} foto${count === 1 ? '' : ''} nel tuo evento`,
    headline: (count) => `${count} nuova${count === 1 ? '' : 'e'} foto${count === 1 ? '' : ''} ti aspetta${count === 1 ? '' : 'no'}`,
    body: (eventName, eventUrl) => [
      `Sono arrivate nuove foto degli invitati in "${eventName}".`,
      `Vai alla stanza:\n${eventUrl}`,
    ],
    cta: 'Vedi le foto',
  },
}

export async function sendPhotoDigestEmail({ owner = {}, event = {}, newPhotoCount, appUrl }) {
  const locale = resolveLocale(owner)
  const t = PHOTO_DIGEST[locale] || PHOTO_DIGEST[EMAIL_DEFAULT_LOCALE]
  const eventUrl = event.slug ? `${appUrl}/event/${event.slug}` : `${appUrl}/dashboard`

  const email = buildEmail({
    subject: t.subject(newPhotoCount),
    headline: t.headline(newPhotoCount),
    bodyLines: t.body(event.name || event.slug || 'SnapRooms', eventUrl),
    cta: { text: t.cta, url: eventUrl },
    locale,
    appUrl,
  })

  return sendEmailSafely({
    to: owner.email,
    email,
    logContext: { type: 'photo_digest', ownerId: owner.id, eventId: event.id, newPhotoCount },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Photo threshold reached (Free plan photo limit hit)
// ─────────────────────────────────────────────────────────────────────────────

const PHOTO_THRESHOLD_REACHED = {
  de: {
    subject: 'Dein Foto-Limit ist erreicht',
    headline: 'Foto-Limit erreicht',
    body: (eventName, max) => [
      `"${eventName}" hat das Free-Limit von ${max} Fotos erreicht.`,
      'Weitere Gäste können gerade keine neuen Fotos mehr hochladen. Mit einem Upgrade entfernst du das Limit für dieses Event.',
    ],
    cta: 'Jetzt upgraden',
  },
  en: {
    subject: 'Your photo limit has been reached',
    headline: 'Photo limit reached',
    body: (eventName, max) => [
      `"${eventName}" has reached the Free plan's limit of ${max} photos.`,
      'Guests can no longer upload new photos right now. Upgrade to remove the limit for this event.',
    ],
    cta: 'Upgrade now',
  },
  it: {
    subject: 'Hai raggiunto il limite di foto',
    headline: 'Limite foto raggiunto',
    body: (eventName, max) => [
      `"${eventName}" ha raggiunto il limite di ${max} foto del piano Free.`,
      "Gli invitati non possono più caricare nuove foto. Fai l'upgrade per rimuovere il limite su questo evento.",
    ],
    cta: 'Fai l\'upgrade',
  },
}

export async function sendPhotoThresholdReachedEmail({ owner = {}, event = {}, max, appUrl }) {
  const locale = resolveLocale(owner)
  const t = PHOTO_THRESHOLD_REACHED[locale] || PHOTO_THRESHOLD_REACHED[EMAIL_DEFAULT_LOCALE]
  const dashboardUrl = `${appUrl}/dashboard`

  const email = buildEmail({
    subject: t.subject,
    headline: t.headline,
    bodyLines: t.body(event.name || event.slug || 'SnapRooms', max),
    cta: { text: t.cta, url: dashboardUrl },
    locale,
    appUrl,
  })

  return sendEmailSafely({
    to: owner.email,
    email,
    logContext: { type: 'photo_threshold_reached', ownerId: owner.id, eventId: event.id },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Event expiring reminder (T-30 / T-7 / T-0)
// ─────────────────────────────────────────────────────────────────────────────

const EVENT_EXPIRING = {
  de: {
    subject: (days) => (days <= 0 ? 'Dein Event läuft heute ab' : `Dein Event läuft in ${days} Tagen ab`),
    headline: (days) => (days <= 0 ? 'Event läuft heute ab' : `Event läuft in ${days} Tagen ab`),
    body: (eventName, days) => [
      days <= 0
        ? `"${eventName}" erreicht heute das Ende der Speicherfrist.`
        : `"${eventName}" erreicht in ${days} Tagen das Ende der Speicherfrist.`,
      'Lade die Galerie jetzt herunter oder verlängere die Speicherung, um nichts zu verlieren.',
    ],
    cta: 'Zum Event',
  },
  en: {
    subject: (days) => (days <= 0 ? 'Your event expires today' : `Your event expires in ${days} days`),
    headline: (days) => (days <= 0 ? 'Event expires today' : `Event expires in ${days} days`),
    body: (eventName, days) => [
      days <= 0
        ? `"${eventName}" reaches the end of its storage period today.`
        : `"${eventName}" reaches the end of its storage period in ${days} days.`,
      'Download the gallery now or extend storage to avoid losing anything.',
    ],
    cta: 'Go to event',
  },
  it: {
    subject: (days) => (days <= 0 ? 'Il tuo evento scade oggi' : `Il tuo evento scade in ${days} giorni`),
    headline: (days) => (days <= 0 ? 'Evento in scadenza oggi' : `Evento in scadenza in ${days} giorni`),
    body: (eventName, days) => [
      days <= 0
        ? `"${eventName}" raggiunge oggi la fine del periodo di conservazione.`
        : `"${eventName}" raggiunge la fine del periodo di conservazione in ${days} giorni.`,
      'Scarica subito la galleria o estendi la conservazione per non perdere nulla.',
    ],
    cta: "Vai all'evento",
  },
}

export async function sendEventExpiringReminderEmail({ owner = {}, event = {}, daysRemaining, appUrl }) {
  const locale = resolveLocale(owner)
  const t = EVENT_EXPIRING[locale] || EVENT_EXPIRING[EMAIL_DEFAULT_LOCALE]
  const eventUrl = event.slug ? `${appUrl}/event/${event.slug}` : `${appUrl}/dashboard`

  const email = buildEmail({
    subject: t.subject(daysRemaining),
    headline: t.headline(daysRemaining),
    bodyLines: t.body(event.name || event.slug || 'SnapRooms', daysRemaining),
    cta: { text: t.cta, url: eventUrl },
    locale,
    appUrl,
  })

  return sendEmailSafely({
    to: owner.email,
    email,
    logContext: { type: 'event_expiring_reminder', ownerId: owner.id, eventId: event.id, daysRemaining },
  })
}
