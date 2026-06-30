# SnapRooms Legal / Commerce Readiness (EU / Germany)

> **Status:** Pre-launch analysis and TODO list  
> **Last reviewed:** 2026-06-01  
> **Disclaimer:** This document is technical preparation. All legal texts, withdrawal forms, and terms must be validated by a qualified attorney before commercial launch in the EU.

---

## 1. Products Sold

| Product | Type | Stripe Mode | Price (UI) | B2C / B2B | Notes |
|---------|------|-------------|------------|-----------|-------|
| **Pro Event** | One-time (per event) | `payment` | €9.99 | B2C | Unlocks features for a single event |
| **Wedding Pro** | One-time (per event) | `payment` | €19.99 | B2C | Wedding-specific feature pack |
| **Professional** | Subscription (account-level) | `subscription` | €79/mo or €790/yr | B2C / B2B | Currently only one Stripe price ID wired up (likely monthly) |
| **Original Quality Download** | One-time (per event) | `payment` | €1.99 | B2C | Guest-side unlock via Stripe Checkout |
| **Business** | Custom | — | Contact us | B2B | Not sold through Stripe; links to `mailto` |

### Important Gap
The pricing page shows **€79/month** and **€790/year** (save 17%), but the backend only supports **one** Professional price ID (`STRIPE_PRICE_ID_PROFESSIONAL`). The yearly option is **display-only** and not a purchasable checkout option.

**TODO:** Either remove the yearly display or wire up a second yearly price ID in Stripe and the checkout handler.

---

## 2. One-Time vs Subscription — Legal Implications

### One-Time Purchases (Pro Event, Wedding Pro, Original Quality Download)
- **Widerruf (Right of Withdrawal)** under EU Consumer Rights Directive applies to B2C customers
- 14-day withdrawal period from contract conclusion
- Exception possible for "digital content delivered immediately" if the consumer explicitly consents and acknowledges loss of withdrawal right
- **TODO:** Add explicit consent checkbox before checkout for digital delivery

### Subscription (Professional)
- **Widerruf** applies to the initial subscription contract (14 days)
- **Kündigung (Cancellation)** applies to ongoing monthly billing
- The two concepts must **not** be confused in the UI or terms
- **TODO:** Implement Stripe Customer Portal or a "Cancel Subscription" button in the dashboard

---

## 3. B2C vs B2B Considerations

| Aspect | B2C (Consumer) | B2B (Business) |
|--------|----------------|----------------|
| Widerruf | ✅ Required (14 days) | ❌ Not required |
| AGB / Terms | Required, but can be more flexible | Often individually negotiated |
| Invoice details | Usually minimal | Require VAT ID, company name, full billing address |
| Receipt | Sufficient | May require formal invoice (Rechnung) |

**Current state:** SnapRooms does not distinguish B2C vs B2B at checkout. All purchases go through the same Stripe Checkout flow.

**TODO:** If B2B sales become significant, add:
- VAT ID field
- Company name field
- Invoice generation post-purchase

---

## 4. Widerruf vs Kündigung — Distinction

### Widerruf (Right of Withdrawal)
- **What:** The right to cancel the contract within a short period (typically 14 days) without giving a reason
- **When:** After contract conclusion (initial purchase or subscription start)
- **How:** Must be clearly communicated before purchase; usually requires a withdrawal form or clear statement
- **Where in app:** Dedicated page `/withdrawal` (or `/widerruf`) with a form

### Kündigung (Termination of Ongoing Contract)
- **What:** Ending a subscription so it does not renew
- **When:** At any time during the subscription
- **How:** Via Stripe Customer Portal, dashboard button, or email
- **Effect:** Access continues until the end of the current billing period
- **Where in app:** "Manage Subscription" / "Abo verwalten" / "Cancel Subscription" in dashboard

**Critical:** Do **not** label a cancellation button as "Widerruf" — this creates legal confusion.

---

## 5. Future Route — `/withdrawal`

### Proposed Structure

**Route:** `/withdrawal` (localized: `/de/widerruf`, `/it/recesso`, etc.)

**Fields:**
- Email address (required)
- Order / payment reference (optional but helpful)
- Event slug (optional, for context)
- Free-text reason (optional)
- Confirmation checkbox: "I hereby withdraw from the contract concluded with SnapRooms"

**Flow:**
1. User fills form and submits
2. System stores withdrawal request (new table or email log)
3. System sends **email confirmation** to user with:
   - Timestamp of withdrawal
   - Reference number
   - Products/services affected
   - Expected refund timeline (if applicable)
4. Admin receives notification
5. Manual or Stripe-initiated refund within statutory period

**Important:** Do **not** implement automatic refunds unless legally approved. The system should log and confirm, but the actual refund can be initiated manually via Stripe Dashboard until the process is legally solid.

### UI Labels (i18n keys to add)

| Locale | Button / Link Label |
|--------|---------------------|
| DE | "Vertrag widerrufen" |
| EN | "Withdraw from contract" |
| IT | "Esercita il diritto di recesso" |
| FR | "Exercer le droit de rétractation" |
| ES | "Ejercer el derecho de desistimiento" |

---

## 6. Stripe Customer Portal

**Current state:** ✅ Implemented.

**Route:** `POST /api/stripe/customer-portal`

**Required for subscriptions:**
- Allow users to update payment method
- Allow users to view invoices
- Allow users to **cancel** the subscription (Kündigung)

**Implementation:**
```js
// app/api/stripe/customer-portal/route.js
const session = await stripe.billingPortal.sessions.create({
  customer: owner.stripeCustomerId,
  return_url: `${baseUrl}/dashboard?billing=portal_return`,
})
return NextResponse.json({ url: session.url })
```

**Security:** owner session, same-origin check, CSRF token, rate limit (`PAYMENT_LIMITS.customerPortal`).

**UI:** "Manage subscription" / "Abo verwalten" button in dashboard sidebar when the owner has a Professional subscription.

---

## 6.5 Subscription Payment Failure / Dunning

**Stripe events:** `invoice.payment_failed`, `invoice.payment_succeeded`, `customer.subscription.updated`.

**Behavior on `invoice.payment_failed`:**
- Owner `subscriptionStatus` is set to `past_due`.
- A 7-day grace period is started (`subscriptionGraceUntil`).
- Professional features remain active during the grace period.
- Dashboard shows a payment-failed warning with a CTA to update the payment method via the Customer Portal.
- A dunning email is sent to the owner via Resend.
- No events or photos are deleted.

**Behavior on `invoice.payment_succeeded`:**
- Owner `subscriptionStatus` is restored to `active`.
- `paymentFailedAt`, `subscriptionGraceUntil`, and `lastPaymentError` are cleared.

**If the grace period expires without recovery:**
- Effective premium access ends (effective `accountPremium` becomes false).
- Data retention follows the existing cancellation grace policy (90 days from `subscriptionCanceledAt` or event-level tier).

**Important:** Payment failure is not treated as immediate cancellation. The subscription remains in `past_due` until Stripe sends `customer.subscription.deleted` or the owner explicitly cancels.

---

## 7. Email Confirmation Requirement

For both **Widerruf** and **Kündigung**, EU consumer law requires clear confirmation:

- **Widerruf:** Email confirmation must be sent immediately upon receipt of the withdrawal declaration
- **Kündigung:** Confirmation of cancellation and end-of-access date should be communicated

**TODO:**
- Set up transactional email provider (e.g. Resend, SendGrid, Postmark) if not already done
- Create email templates for:
  - Withdrawal received
  - Subscription cancelled
  - Refund processed (if applicable)

---

## 8. Pre-Launch Legal TODO List

### Critical (Must have before first B2C sale in EU)
- [ ] **Validate Terms & Conditions** with an EU consumer law attorney
- [ ] **Add explicit withdrawal right notice** before Stripe Checkout for one-time digital products
- [ ] **Add checkbox** at checkout: "I acknowledge that I lose my right of withdrawal once the digital content is delivered"
- [ ] **Implement `/withdrawal` page** with form and email confirmation
- [x] **Implement Stripe Customer Portal** (or equivalent cancellation flow) for Professional subscriptions
- [ ] **Wire up yearly Professional price** or remove display from pricing page
- [ ] **Set `OWNER_SESSION_SECRET`** in Vercel Production environment
- [ ] **Review privacy policy** for GDPR compliance (lawful basis, data retention, DPO contact)

### Important (Should have within 30 days of launch)
- [ ] **Add VAT ID / company name fields** if B2B sales are expected
- [ ] **Set up transactional email** for withdrawal and cancellation confirmations
- [ ] **Create invoice generation** for B2B customers (Stripe invoices or custom)
- [x] **Add "Manage Subscription" button** to dashboard
- [ ] **Document refund policy** clearly in Terms (e.g. discretionary refunds within 14 days)

### Nice to have
- [x] **Dunning management** for failed subscription payments
- [ ] **Self-service refund** for small amounts (e.g. Pro Event €9.99) to reduce support load
- [ ] **Billing history page** in dashboard

---

## 9. Notes on German Consumer Law (BGB)

- **§ 355 BGB** — Widerrufsrecht (right of withdrawal)
- **§ 356 BGB** — Widerrufsfolgen (consequences: return of payments, return of goods)
- **§ 312g BGB** — Exceptions for digital content if consumer explicitly consents to immediate execution
- **§ 309 No. 13 BGB** — Unfair contract terms regarding cancellation periods
- **Fernabsatzgesetz** — Distance selling regulations (now integrated into BGB)

**Key risk:** If SnapRooms sells to German consumers without clear withdrawal information and form, the contract may be challengeable and the withdrawal period may be extended indefinitely (up to 12 months under certain conditions).

---

*This document is a technical product engineering guide. It does not constitute legal advice. Always have terms, withdrawal forms, and checkout flows reviewed by a qualified attorney licensed in the jurisdictions where you sell.*
