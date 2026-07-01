# SnapRooms Billing Emails

This document describes the transactional emails sent by SnapRooms for billing events.

## Overview

All billing-related emails are centralized in `lib/server/billing-emails.js` and built with the shared layout in `lib/server/email/email-layout.js`. Emails are sent from the Stripe webhook handler (`app/api/stripe/webhook/route.js`) and are **never allowed to fail the webhook**. If Resend is misconfigured or the email API errors, the failure is logged and the webhook still returns `200 { received: true }`.

## Required Environment Variables

- `RESEND_API_KEY` — Resend API key.
- `RESEND_FROM_EMAIL` — Verified sender address (e.g. `billing@snaprooms.app`).
- `NEXT_PUBLIC_BASE_URL` — Public app URL used for links (e.g. `https://snaprooms.app`).

If either `RESEND_API_KEY` or `RESEND_FROM_EMAIL` is missing, email sending is skipped with a warning log. The rest of the billing flow continues normally.

## Supported Languages

Billing emails currently support `de`, `en`, and `it`.

The fallback chain is:

1. `owner.locale` (when the field is added to the `Owner` model)
2. `de` — primary market is Germany
3. `en` — final fallback

Until `Owner.locale` is persisted, all billing emails default to German.

## Emails and Triggers

| Email | Function | Trigger | Idempotency |
|-------|----------|---------|-------------|
| **Extra Free Event created** | `sendExtraFreeEventCreatedEmail` | `checkout.session.completed` with `extra_event` intent and successful auto-create | `extraFreeEventCheckout` status is `auto_created`; retry skips DB update and email |
| **Extra Free Event credit granted** | `sendExtraFreeEventCreditGrantedEmail` | `checkout.session.completed` with `extra_event` intent (credit purchase) | `extraEventCheckoutSessionId` is set to the session; retry skips credit increment and email |
| **Extra Free Event fallback credit** | `sendExtraFreeEventFallbackCreditEmail` | Auto-create fails and a fallback credit is granted | Checkout status becomes `failed`; retry skips credit grant and email |
| **Pro Event activated** | `sendProEventPurchasedEmail` | `checkout.session.completed` with `pro_event` intent | `stripeCheckoutSessionId` on the event; retry skips fulfillment and email |
| **Wedding Pro activated** | `sendWeddingProPurchasedEmail` | `checkout.session.completed` with `wedding_pro` intent | `stripeCheckoutSessionId` on the event; retry skips fulfillment and email |
| **Professional activated** | `sendProfessionalActivatedEmail` | `checkout.session.completed` with `professional` intent | `stripeCheckoutSessionId` on the owner; retry skips fulfillment and email |
| **Professional payment failed** | `sendProfessionalPaymentFailedEmail` | `invoice.payment_failed` | `isPaymentFailureAlreadyHandled` keys on `lastInvoiceId` + `paymentFailedAt`; retry returns `{ duplicate: true }` without email |
| **Professional payment recovered** | `sendProfessionalPaymentRecoveredEmail` | `invoice.payment_succeeded` after `past_due`/`unpaid` or when `paymentFailedAt` was set | After recovery `paymentFailedAt` is cleared; retries see no failure state and skip email |
| **Professional subscription canceled** | `sendProfessionalCanceledEmail` | `customer.subscription.deleted` | Sent only when the owner was not already `canceled`; retries for already-canceled owners skip email |

## Email Content

### Extra Free Event created (DE example)

- Subject: `Dein Extra Free Event wurde erstellt`
- Includes event name, public event link, dashboard link, and a clear statement that Free restrictions remain active (watermark, no gallery ZIP, no private delivery).

### Extra Free Event credit granted (DE example)

- Subject: `Extra Free Event-Guthaben gutgeschrieben`
- Confirms the credit purchase and shows the current credit balance.

### Extra Free Event fallback credit (DE example)

- Subject: `Dein Extra Free Event wurde gekauft`
- Explains that auto-creation failed, a credit was granted, and the user can create the event manually from the dashboard.

### Pro Event activated (DE example)

- Subject: `Pro Event wurde aktiviert`
- Lists activated features: branding removed, gallery ZIP, more uploads, 12 months storage.

### Wedding Pro activated (DE example)

- Subject: `Wedding Pro wurde aktiviert`
- Lists activated features: all Pro Event features, private delivery, photographer upload link, premium workflow, 24 months storage.

### Professional activated (DE example)

- Subject: `SnapRooms Professional ist aktiviert`
- Confirms unlimited events, premium account features, and links to the dashboard.

### Professional payment failed (DE example)

- Subject: `Zahlung fehlgeschlagen – bitte Zahlungsmethode aktualisieren`
- Explains the payment failure, shows the grace-period date if active, and links to the dashboard/customer portal.
- Does not include card data, raw Stripe objects, or secrets.

### Professional payment recovered (DE example)

- Subject: `Zahlung erfolgreich – Professional bleibt aktiv`
- Confirms the recovered payment and that Professional remains active.

### Professional subscription canceled (DE example)

- Subject: `Dein Professional-Abonnement wurde beendet`
- Confirms cancellation, explains that data is not deleted immediately, mentions remaining grace if applicable, and links to the dashboard for reactivation.

## Security and Privacy

- No raw Stripe objects are included in emails.
- No card data, tokens, or secrets are included.
- Email links use only public URLs (`/dashboard`, `/event/{slug}`, `/privacy`) or the Stripe Customer Portal URL generated server-side.
- All user-provided text is HTML-escaped before being rendered.

## Residual Limitations

- No new Prisma migration was added. Idempotency relies on existing fields (`stripeCheckoutSessionId`, `lastInvoiceId`, `paymentFailedAt`, `subscriptionStatus`).
- `customer.subscription.deleted` deduplication is based on the pre-update `subscriptionStatus`. If the owner re-subscribes and cancels again, a new cancellation email is correctly sent.
- Withdrawal (`Widerruf`) confirmation emails are out of scope and still require a dedicated `/withdrawal` flow.
- Refund confirmation emails are out of scope until a refund webhook handler exists.
- Invoice generation for B2B customers is not implemented.
