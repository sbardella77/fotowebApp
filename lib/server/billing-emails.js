/**
 * SnapRooms — transactional billing emails.
 *
 * All billing-related emails are centralized here. They are safe to call from
 * webhooks: failures are caught and logged, Resend misconfiguration is handled
 * gracefully, and the functions never throw.
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
  // Prefer persisted owner locale once the field exists; otherwise default to
  // German for billing emails (primary market).
  const locale = owner.locale || EMAIL_DEFAULT_LOCALE
  return locale
}

function formatDate(date, locale = EMAIL_DEFAULT_LOCALE) {
  if (!date) return ''
  try {
    return new Date(date).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return new Date(date).toLocaleDateString('en', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }
}

async function sendEmailSafely({ to, email, logContext }) {
  const resend = getResendClient()
  const fromEmail = getFromEmail()

  if (!resend || !fromEmail) {
    console.warn('[billing-emails] Resend not configured, skipping email:', logContext)
    return { sent: false, reason: 'resend_not_configured' }
  }

  if (!to) {
    console.warn('[billing-emails] No recipient, skipping email:', logContext)
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
    console.log('[billing-emails] Email sent:', { ...logContext, id: result?.data?.id })
    return { sent: true, id: result?.data?.id }
  } catch (error) {
    console.error('[billing-emails] Failed to send email:', { ...logContext, error: error.message })
    return { sent: false, reason: 'send_error', error: error.message }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Extra Free Event
// ─────────────────────────────────────────────────────────────────────────────

const EXTRA_FREE_EVENT_CREATED = {
  de: {
    subject: 'Dein Extra Free Event wurde erstellt',
    headline: 'Dein Extra Free Event wurde erstellt',
    body: (eventName, eventUrl) => [
      `Gute Nachrichten: Wir haben "${eventName}" erstellt.`,
      `Öffentlicher Raum:\n${eventUrl}`,
      'Dieses Event bleibt ein Free-Event:\n• Mit Wasserzeichen\n• Kein Galerie-ZIP\n• Keine private Lieferung',
      'Wenn du Pro-Features möchtest, kannst du jederzeit ein Upgrade vornehmen.',
    ],
    ctaDashboard: 'Zum Dashboard',
  },
  en: {
    subject: 'Your Extra Free Event has been created',
    headline: 'Your Extra Free Event has been created',
    body: (eventName, eventUrl) => [
      `Great news: we've created "${eventName}".`,
      `Public room:\n${eventUrl}`,
      'This event remains on the Free plan:\n• Watermark stays on photos\n• No gallery ZIP download\n• No private delivery',
      'You can upgrade to Pro features at any time.',
    ],
    ctaDashboard: 'Go to dashboard',
  },
  it: {
    subject: 'Il tuo Evento Free aggiuntivo è stato creato',
    headline: 'Il tuo Evento Free aggiuntivo è stato creato',
    body: (eventName, eventUrl) => [
      `Ottime notizie: abbiamo creato "${eventName}".`,
      `Stanza pubblica:\n${eventUrl}`,
      'Questo evento rimane sul piano Free:\n• Filigrana sulle foto\n• Nessun download ZIP galleria\n• Nessuna consegna privata',
      'Puoi eseguire l\'upgrade alle funzioni Pro in qualsiasi momento.',
    ],
    ctaDashboard: 'Vai alla dashboard',
  },
}

export async function sendExtraFreeEventCreatedEmail({ owner = {}, event = {}, appUrl }) {
  const locale = resolveLocale(owner)
  const t = EXTRA_FREE_EVENT_CREATED[locale] || EXTRA_FREE_EVENT_CREATED[EMAIL_DEFAULT_LOCALE]
  const dashboardUrl = `${appUrl}/dashboard`
  const eventUrl = event.slug ? `${appUrl}/event/${event.slug}` : dashboardUrl

  const email = buildEmail({
    subject: t.subject,
    headline: t.headline,
    bodyLines: t.body(event.name || event.slug || 'Extra Free Event', eventUrl),
    cta: { text: t.ctaDashboard, url: dashboardUrl },
    locale,
    appUrl,
  })

  return sendEmailSafely({ to: owner.email, email, logContext: { type: 'extra_free_event_created', ownerId: owner.id, eventId: event.id } })
}

const EXTRA_FREE_EVENT_FALLBACK = {
  de: {
    subject: 'Dein Extra Free Event wurde gekauft',
    headline: 'Dein Extra Free Event wurde gekauft',
    body: (eventName) => [
      `Danke für deinen Kauf von "${eventName}".`,
      'Die automatische Erstellung des Events hat leider nicht funktioniert. Dir wurde stattdessen 1 Extra-Free-Event-Guthaben gutgeschrieben.',
      'Erstelle das Event einfach manuell in deinem Dashboard. Das Guthaben wird automatisch angewendet.',
    ],
    ctaDashboard: 'Zum Dashboard',
  },
  en: {
    subject: 'Your Extra Free Event purchase',
    headline: 'Your Extra Free Event purchase',
    body: (eventName) => [
      `Thank you for purchasing "${eventName}".`,
      'We were unable to create the event automatically, so we have credited 1 Extra Free Event to your account instead.',
      'Please create the event manually from your dashboard. The credit will be applied automatically.',
    ],
    ctaDashboard: 'Go to dashboard',
  },
  it: {
    subject: 'Acquisto Evento Free aggiuntivo',
    headline: 'Acquisto Evento Free aggiuntivo',
    body: (eventName) => [
      `Grazie per aver acquistato "${eventName}".`,
      'Non siamo riusciti a creare l\'evento automaticamente, quindi abbiamo accreditato 1 Evento Free aggiuntivo sul tuo account.',
      'Crea l\'evento manualmente dalla dashboard. Il credito verrà applicato automaticamente.',
    ],
    ctaDashboard: 'Vai alla dashboard',
  },
}

export async function sendExtraFreeEventFallbackCreditEmail({ owner = {}, pending = {}, appUrl }) {
  const locale = resolveLocale(owner)
  const t = EXTRA_FREE_EVENT_FALLBACK[locale] || EXTRA_FREE_EVENT_FALLBACK[EMAIL_DEFAULT_LOCALE]
  const dashboardUrl = `${appUrl}/dashboard`

  const email = buildEmail({
    subject: t.subject,
    headline: t.headline,
    bodyLines: t.body(pending.eventName || 'Extra Free Event'),
    cta: { text: t.ctaDashboard, url: dashboardUrl },
    locale,
    appUrl,
  })

  return sendEmailSafely({
    to: owner.email,
    email,
    logContext: { type: 'extra_free_event_fallback_credit', ownerId: owner.id, pendingCheckoutId: pending.id },
  })
}

const EXTRA_FREE_EVENT_CREDIT_GRANTED = {
  de: {
    subject: 'Extra Free Event-Guthaben gutgeschrieben',
    headline: 'Extra Free Event-Guthaben gutgeschrieben',
    body: (credits) => [
      'Danke für deinen Kauf. Wir haben dir 1 Extra-Free-Event-Guthaben gutgeschrieben.',
      `Aktuelles Guthaben: ${credits}`,
      'Du kannst das Guthaben in deinem Dashboard für ein neues Event einlösen.',
    ],
    ctaDashboard: 'Zum Dashboard',
  },
  en: {
    subject: 'Extra Free Event credit added',
    headline: 'Extra Free Event credit added',
    body: (credits) => [
      'Thank you for your purchase. We have added 1 Extra Free Event credit to your account.',
      `Current credit balance: ${credits}`,
      'You can redeem it from your dashboard when creating a new event.',
    ],
    ctaDashboard: 'Go to dashboard',
  },
  it: {
    subject: 'Credito Evento Free aggiuntivo aggiunto',
    headline: 'Credito Evento Free aggiuntivo aggiunto',
    body: (credits) => [
      'Grazie per l\'acquisto. Abbiamo aggiunto 1 credito Evento Free aggiuntivo al tuo account.',
      `Credito attuale: ${credits}`,
      'Puoi riscattarlo dalla dashboard quando crei un nuovo evento.',
    ],
    ctaDashboard: 'Vai alla dashboard',
  },
}

export async function sendExtraFreeEventCreditGrantedEmail({ owner = {}, credits = 0, appUrl }) {
  const locale = resolveLocale(owner)
  const t = EXTRA_FREE_EVENT_CREDIT_GRANTED[locale] || EXTRA_FREE_EVENT_CREDIT_GRANTED[EMAIL_DEFAULT_LOCALE]
  const dashboardUrl = `${appUrl}/dashboard`

  const email = buildEmail({
    subject: t.subject,
    headline: t.headline,
    bodyLines: t.body(credits),
    cta: { text: t.ctaDashboard, url: dashboardUrl },
    locale,
    appUrl,
  })

  return sendEmailSafely({
    to: owner.email,
    email,
    logContext: { type: 'extra_free_event_credit_granted', ownerId: owner.id, credits },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Pro Event
// ─────────────────────────────────────────────────────────────────────────────

const PRO_EVENT_PURCHASED = {
  de: {
    subject: 'Pro Event wurde aktiviert',
    headline: 'Pro Event wurde aktiviert',
    body: (eventName, eventUrl) => [
      `Wir haben "${eventName}" auf Pro Event upgegradet.`,
      `Öffentlicher Raum:\n${eventUrl}`,
      'Aktive Features:\n• Branding entfernt\n• Galerie-ZIP verfügbar\n• Mehr Uploads\n• Speicherdauer: 12 Monate',
    ],
    ctaDashboard: 'Zum Dashboard',
  },
  en: {
    subject: 'Pro Event activated',
    headline: 'Pro Event activated',
    body: (eventName, eventUrl) => [
      `"${eventName}" has been upgraded to Pro Event.`,
      `Public room:\n${eventUrl}`,
      'Active features:\n• Branding removed\n• Gallery ZIP download available\n• More uploads\n• Storage duration: 12 months',
    ],
    ctaDashboard: 'Go to dashboard',
  },
  it: {
    subject: 'Pro Event attivato',
    headline: 'Pro Event attivato',
    body: (eventName, eventUrl) => [
      `"${eventName}" è stato aggiornato a Pro Event.`,
      `Stanza pubblica:\n${eventUrl}`,
      'Funzioni attive:\n• Rimozione branding\n• Download ZIP galleria disponibile\n• Più upload\n• Durata archiviazione: 12 mesi',
    ],
    ctaDashboard: 'Vai alla dashboard',
  },
}

export async function sendProEventPurchasedEmail({ owner = {}, event = {}, appUrl }) {
  const locale = resolveLocale(owner)
  const t = PRO_EVENT_PURCHASED[locale] || PRO_EVENT_PURCHASED[EMAIL_DEFAULT_LOCALE]
  const dashboardUrl = `${appUrl}/dashboard`
  const eventUrl = event.slug ? `${appUrl}/event/${event.slug}` : dashboardUrl

  const email = buildEmail({
    subject: t.subject,
    headline: t.headline,
    bodyLines: t.body(event.name || event.slug || 'Pro Event', eventUrl),
    cta: { text: t.ctaDashboard, url: dashboardUrl },
    locale,
    appUrl,
  })

  return sendEmailSafely({ to: owner.email, email, logContext: { type: 'pro_event_purchased', ownerId: owner.id, eventId: event.id } })
}

// ─────────────────────────────────────────────────────────────────────────────
// Wedding Pro
// ─────────────────────────────────────────────────────────────────────────────

const WEDDING_PRO_PURCHASED = {
  de: {
    subject: 'Wedding Pro wurde aktiviert',
    headline: 'Wedding Pro wurde aktiviert',
    body: (eventName, eventUrl) => [
      `Wir haben "${eventName}" auf Wedding Pro upgegradet.`,
      `Öffentlicher Raum:\n${eventUrl}`,
      'Aktive Features:\n• Alle Pro-Event-Features\n• Private Delivery\n• Fotografen-Upload-Link\n• Premium Workflow\n• Speicherdauer: 24 Monate',
    ],
    ctaDashboard: 'Zum Dashboard',
  },
  en: {
    subject: 'Wedding Pro activated',
    headline: 'Wedding Pro activated',
    body: (eventName, eventUrl) => [
      `"${eventName}" has been upgraded to Wedding Pro.`,
      `Public room:\n${eventUrl}`,
      'Active features:\n• All Pro Event features\n• Private delivery\n• Photographer upload link\n• Premium workflow\n• Storage duration: 24 months',
    ],
    ctaDashboard: 'Go to dashboard',
  },
  it: {
    subject: 'Wedding Pro attivato',
    headline: 'Wedding Pro attivato',
    body: (eventName, eventUrl) => [
      `"${eventName}" è stato aggiornato a Wedding Pro.`,
      `Stanza pubblica:\n${eventUrl}`,
      'Funzioni attive:\n• Tutte le funzioni Pro Event\n• Consegna privata\n• Link upload fotografo\n• Workflow premium\n• Durata archiviazione: 24 mesi',
    ],
    ctaDashboard: 'Vai alla dashboard',
  },
}

export async function sendWeddingProPurchasedEmail({ owner = {}, event = {}, appUrl }) {
  const locale = resolveLocale(owner)
  const t = WEDDING_PRO_PURCHASED[locale] || WEDDING_PRO_PURCHASED[EMAIL_DEFAULT_LOCALE]
  const dashboardUrl = `${appUrl}/dashboard`
  const eventUrl = event.slug ? `${appUrl}/event/${event.slug}` : dashboardUrl

  const email = buildEmail({
    subject: t.subject,
    headline: t.headline,
    bodyLines: t.body(event.name || event.slug || 'Wedding Pro', eventUrl),
    cta: { text: t.ctaDashboard, url: dashboardUrl },
    locale,
    appUrl,
  })

  return sendEmailSafely({ to: owner.email, email, logContext: { type: 'wedding_pro_purchased', ownerId: owner.id, eventId: event.id } })
}

// ─────────────────────────────────────────────────────────────────────────────
// Professional subscription activated
// ─────────────────────────────────────────────────────────────────────────────

const PROFESSIONAL_ACTIVATED = {
  de: {
    subject: 'SnapRooms Professional ist aktiviert',
    headline: 'SnapRooms Professional ist aktiviert',
    body: [
      'Willkommen bei SnapRooms Professional. Dein Abonnement ist jetzt aktiv.',
      'Das bedeutet für dich:\n• Unbegrenzte Events\n• Premium Account-Features\n• Flexible Verwaltung im Dashboard',
      'Du kannst dein Abonnement jederzeit im Dashboard verwalten.',
    ],
    ctaDashboard: 'Zum Dashboard',
  },
  en: {
    subject: 'SnapRooms Professional is active',
    headline: 'SnapRooms Professional is active',
    body: [
      'Welcome to SnapRooms Professional. Your subscription is now active.',
      'This gives you:\n• Unlimited events\n• Premium account features\n• Easy management from your dashboard',
      'You can manage your subscription at any time from the dashboard.',
    ],
    ctaDashboard: 'Go to dashboard',
  },
  it: {
    subject: 'SnapRooms Professional è attivo',
    headline: 'SnapRooms Professional è attivo',
    body: [
      'Benvenuto in SnapRooms Professional. Il tuo abbonamento è ora attivo.',
      'Cosa include:\n• Eventi illimitati\n• Funzioni premium account\n• Gestione semplice dalla dashboard',
      'Puoi gestire il tuo abbonamento in qualsiasi momento dalla dashboard.',
    ],
    ctaDashboard: 'Vai alla dashboard',
  },
}

export async function sendProfessionalActivatedEmail({ owner = {}, appUrl }) {
  const locale = resolveLocale(owner)
  const t = PROFESSIONAL_ACTIVATED[locale] || PROFESSIONAL_ACTIVATED[EMAIL_DEFAULT_LOCALE]
  const dashboardUrl = `${appUrl}/dashboard`

  const email = buildEmail({
    subject: t.subject,
    headline: t.headline,
    bodyLines: t.body,
    cta: { text: t.ctaDashboard, url: dashboardUrl },
    locale,
    appUrl,
  })

  return sendEmailSafely({ to: owner.email, email, logContext: { type: 'professional_activated', ownerId: owner.id } })
}

// ─────────────────────────────────────────────────────────────────────────────
// Professional payment failed
// ─────────────────────────────────────────────────────────────────────────────

const PROFESSIONAL_PAYMENT_FAILED = {
  de: {
    subject: 'Zahlung fehlgeschlagen – bitte Zahlungsmethode aktualisieren',
    headline: 'Zahlung fehlgeschlagen',
    body: (graceDate) => {
      const lines = [
        'Wir konnten deine Professional-Zahlung nicht verarbeiten.',
        'Bitte aktualisiere deine Zahlungsmethode, um eine Unterbrechung zu vermeiden.',
      ]
      if (graceDate) {
        lines.push(`Deine Professional-Features bleiben bis zum ${graceDate} aktiv.`)
      }
      lines.push('Deine Daten werden nicht sofort gelöscht.')
      return lines
    },
    ctaUpdate: 'Zahlungsmethode aktualisieren',
  },
  en: {
    subject: 'Payment failed – please update your payment method',
    headline: 'Payment failed',
    body: (graceDate) => {
      const lines = [
        'We could not process your Professional payment.',
        'Please update your payment method to avoid any interruption.',
      ]
      if (graceDate) {
        lines.push(`Your Professional features will remain active until ${graceDate}.`)
      }
      lines.push('Your data will not be deleted immediately.')
      return lines
    },
    ctaUpdate: 'Update payment method',
  },
  it: {
    subject: 'Pagamento non riuscito – aggiorna il metodo di pagamento',
    headline: 'Pagamento non riuscito',
    body: (graceDate) => {
      const lines = [
        'Non siamo riusciti a elaborare il pagamento di Professional.',
        'Aggiorna il metodo di pagamento per evitare interruzioni.',
      ]
      if (graceDate) {
        lines.push(`Le funzioni Professional rimarranno attive fino al ${graceDate}.`)
      }
      lines.push('I tuoi dati non verranno eliminati immediatamente.')
      return lines
    },
    ctaUpdate: 'Aggiorna metodo di pagamento',
  },
}

export async function sendProfessionalPaymentFailedEmail({ owner = {}, billingState = {}, appUrl }) {
  const locale = resolveLocale(owner)
  const t = PROFESSIONAL_PAYMENT_FAILED[locale] || PROFESSIONAL_PAYMENT_FAILED[EMAIL_DEFAULT_LOCALE]
  const dashboardUrl = `${appUrl}/dashboard?billing=portal`
  const graceDate = billingState.graceActive ? formatDate(owner.subscriptionGraceUntil, locale) : null

  const email = buildEmail({
    subject: t.subject,
    headline: t.headline,
    bodyLines: t.body(graceDate),
    cta: { text: t.ctaUpdate, url: dashboardUrl },
    locale,
    appUrl,
  })

  return sendEmailSafely({ to: owner.email, email, logContext: { type: 'professional_payment_failed', ownerId: owner.id } })
}

// ─────────────────────────────────────────────────────────────────────────────
// Professional payment recovered
// ─────────────────────────────────────────────────────────────────────────────

const PROFESSIONAL_PAYMENT_RECOVERED = {
  de: {
    subject: 'Zahlung erfolgreich – Professional bleibt aktiv',
    headline: 'Zahlung erfolgreich',
    body: [
      'Deine Zahlung wurde erfolgreich verarbeitet.',
      'SnapRooms Professional bleibt aktiv. Danke, dass du bei uns bleibst.',
    ],
    ctaDashboard: 'Zum Dashboard',
  },
  en: {
    subject: 'Payment successful – Professional remains active',
    headline: 'Payment successful',
    body: [
      'Your payment has been processed successfully.',
      'SnapRooms Professional remains active. Thank you for staying with us.',
    ],
    ctaDashboard: 'Go to dashboard',
  },
  it: {
    subject: 'Pagamento riuscito – Professional resta attivo',
    headline: 'Pagamento riuscito',
    body: [
      'Il tuo pagamento è stato elaborato con successo.',
      'SnapRooms Professional resta attivo. Grazie per restare con noi.',
    ],
    ctaDashboard: 'Vai alla dashboard',
  },
}

export async function sendProfessionalPaymentRecoveredEmail({ owner = {}, appUrl }) {
  const locale = resolveLocale(owner)
  const t = PROFESSIONAL_PAYMENT_RECOVERED[locale] || PROFESSIONAL_PAYMENT_RECOVERED[EMAIL_DEFAULT_LOCALE]
  const dashboardUrl = `${appUrl}/dashboard`

  const email = buildEmail({
    subject: t.subject,
    headline: t.headline,
    bodyLines: t.body,
    cta: { text: t.ctaDashboard, url: dashboardUrl },
    locale,
    appUrl,
  })

  return sendEmailSafely({ to: owner.email, email, logContext: { type: 'professional_payment_recovered', ownerId: owner.id } })
}

// ─────────────────────────────────────────────────────────────────────────────
// Professional subscription canceled
// ─────────────────────────────────────────────────────────────────────────────

const PROFESSIONAL_CANCELED = {
  de: {
    subject: 'Dein Professional-Abonnement wurde beendet',
    headline: 'Dein Professional-Abonnement wurde beendet',
    body: (graceDate) => {
      const lines = [
        'Dein SnapRooms Professional-Abonnement wurde beendet.',
        'Deine Daten werden nicht sofort gelöscht. Bestehende Events bleiben je nach aktuellem Plan erreichbar.',
      ]
      if (graceDate) {
        lines.push(`Professional-Features bleiben bis zum ${graceDate} verfügbar.`)
      }
      lines.push('Du kannst Professional jederzeit wieder aktivieren.')
      return lines
    },
    ctaDashboard: 'Zum Dashboard',
  },
  en: {
    subject: 'Your Professional subscription has ended',
    headline: 'Your Professional subscription has ended',
    body: (graceDate) => {
      const lines = [
        'Your SnapRooms Professional subscription has ended.',
        'Your data will not be deleted immediately. Existing events remain accessible according to your current plan.',
      ]
      if (graceDate) {
        lines.push(`Professional features remain available until ${graceDate}.`)
      }
      lines.push('You can reactivate Professional at any time.')
      return lines
    },
    ctaDashboard: 'Go to dashboard',
  },
  it: {
    subject: 'Il tuo abbonamento Professional è stato terminato',
    headline: 'Il tuo abbonamento Professional è stato terminato',
    body: (graceDate) => {
      const lines = [
        'Il tuo abbonamento SnapRooms Professional è stato terminato.',
        'I tuoi dati non verranno eliminati immediatamente. Gli eventi esistenti restano accessibili in base al piano attuale.',
      ]
      if (graceDate) {
        lines.push(`Le funzioni Professional restano disponibili fino al ${graceDate}.`)
      }
      lines.push('Puoi riattivare Professional in qualsiasi momento.')
      return lines
    },
    ctaDashboard: 'Vai alla dashboard',
  },
}

export async function sendProfessionalCanceledEmail({ owner = {}, appUrl }) {
  const locale = resolveLocale(owner)
  const t = PROFESSIONAL_CANCELED[locale] || PROFESSIONAL_CANCELED[EMAIL_DEFAULT_LOCALE]
  const dashboardUrl = `${appUrl}/dashboard`
  const graceDate = owner.subscriptionGraceUntil ? formatDate(owner.subscriptionGraceUntil, locale) : null

  const email = buildEmail({
    subject: t.subject,
    headline: t.headline,
    bodyLines: t.body(graceDate),
    cta: { text: t.ctaDashboard, url: dashboardUrl },
    locale,
    appUrl,
  })

  return sendEmailSafely({ to: owner.email, email, logContext: { type: 'professional_canceled', ownerId: owner.id } })
}
