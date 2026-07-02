# SnapRooms — Testing Notes

## Core Entitlement & Retention Tests

Critical pure-function layers have focused test coverage:

- `tests/event-access.test.js` — Free, Pro Event, Wedding Pro, Professional, Business, legacy `pro`, and `originalDownloadUnlocked` only.
- `tests/event-retention.test.js` — Free 90 days, Pro Event 12 months, Wedding Pro 24 months, Professional active, Professional cancelled grace period, vault extension, and archive lock.
- `tests/upsell-context.test.js` — Contextual upsell resolver: free vs. upgraded events, account premium suppression, and Wedding Pro upgrade from Pro Event.
- `tests/entitlements.test.js` — Room creation entitlement matrix including Extra Free Event credit consumption.
- `tests/create-room-state.test.js` / `tests/create-event-cta-state.test.js` — UI state machines for create-room modals and CTAs.

### Running tests

```bash
npm test
```

Uses **Vitest** (dev dependency). No DB, no Prisma, no fetch — tests are pure, fast, and timezone-safe.

### Stripe checkout & webhook integration tests

`tests/stripe-checkout-session.test.js` and `tests/stripe-webhook.test.js` cover the payment-critical paths with mocked Prisma/Stripe:

- Checkout rejects `pro_event` on a `wedding_pro` event and allows `wedding_pro` on a `pro_event` event.
- Checkout blocks event-level purchases for Professional/Business owners and duplicate Professional subscriptions.
- Webhook skips duplicate fulfillments by `stripeCheckoutSessionId`.
- Webhook skips `pro_event` fulfillment when the event is already `wedding_pro`.
- Extra Free Event legacy credit and buy-and-create paths are idempotent by session / pending-checkout status.

### When to update

- Any change to pricing plans or entitlement rules → update `event-access` and `upsell-context` tests.
- Any change to retention durations or grace-period logic → update `event-retention` tests.
- Any change to checkout validation or webhook fulfillment → update `stripe-checkout-session` and `stripe-webhook` tests.
- Adding a new plan tier? Add a matching scenario in `event-access`, `event-retention`, and the relevant Stripe tests before shipping.

## Prisma schema changes

If a PR modifies `prisma/schema.prisma`, production deployment is not complete until:

1. a Prisma migration exists in `prisma/migrations/`
2. `npm run db:health` passes against production
3. `npm run db:migrate:deploy` has been executed successfully
4. `npx prisma migrate status` reports the production database as up to date
5. critical production flows are smoke-tested:
   - `/api/health/db`
   - dashboard login
   - affected feature/page

> **Internal note (IT):** Se una PR modifica `prisma/schema.prisma`, la migration production è obbligatoria prima di considerare il deploy completato.

### Schema / Migration checklist

```txt
Schema / Migration checklist

[ ] Questa PR modifica prisma/schema.prisma?
[ ] Se sì, esiste una nuova migration in prisma/migrations/?
[ ] npm run db:health eseguito su production
[ ] npm run db:migrate:deploy eseguito su production
[ ] npx prisma migrate status conferma DB up to date
[ ] /api/health/db ritorna status ok
[ ] Login dashboard testato
[ ] Feature collegata alla migration testata
```

## Resolved risks

- **Extra Free Event credit race condition (resolved).** Every `extra_event` checkout now creates an `ExtraFreeEventCheckout` row with a unique `stripeCheckoutSessionId`. The webhook fulfills credit-only purchases inside a transaction that:
  1. takes a row-level lock with `SELECT ... FOR UPDATE` on the pending row,
  2. re-reads the status,
  3. increments `Owner.extraEventCredits` by 1,
  4. sets the pending row status to `credit_granted`.
  Retries and concurrent deliveries for the same session are no-ops because the row status is already terminal. The buy-and-create path remains protected by its own status machine (`checkout_created` → `auto_created` | `failed`).
