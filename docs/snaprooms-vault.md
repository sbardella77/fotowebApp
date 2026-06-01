# SnapRooms Vault / Archivio Ricordi — Product Spec

## Concept

SnapRooms Vault is a future monthly add-on that lets owners keep events and photos available beyond the normal plan duration.

## Naming

| Locale | Name | Notes |
|--------|------|-------|
| EN | SnapRooms Vault | Primary product name |
| DE | SnapRooms Vault | Keep EN brand; description localized |
| IT | SnapRooms Vault | Keep EN brand; description localized |
| FR | SnapRooms Vault | Keep EN brand; description localized |
| ES | SnapRooms Vault | Keep EN brand; description localized |

Localized descriptions are stored in the dictionary under `vaultDescription`.

## Pricing (Proposed)

- Monthly subscription
- Price TBD (suggested €4.99–€9.99 / month)
- Applied per-event or per-account (decision pending)

## Stripe Setup (Future)

Add to `.env`:

```bash
STRIPE_PRICE_ID_VAULT_MONTHLY=price_xxx
```

In `app/api/stripe/checkout-session/route.js`:
- Add `vault_monthly` to `PRICE_ENV_MAP` and `MODE_MAP` (`mode: 'subscription'`).
- Webhook handler (`app/api/stripe/webhook/route.js`) should set `event.vaultExtendedUntil` to a future date (e.g. +1 month) on each invoice payment, or mirror subscription state.

## UX Placeholders

The dashboard already shows a non-interactive "SnapRooms Vault — Coming soon" line for events that can be extended. No checkout button is rendered until the Stripe price ID is configured.

## Copy Snippets

**EN**
> Keep your event memories safe for longer with SnapRooms Vault.

**DE**
> Bewahre deine Event-Erinnerungen länger mit SnapRooms Vault auf.

**IT**
> Conserva i ricordi dei tuoi eventi più a lungo con SnapRooms Vault.

**FR**
> Gardez vos souvenirs d'événements en sécurité plus longtemps avec SnapRooms Vault.

**ES**
> Mantén los recuerdos de tus eventos seguros por más tiempo con SnapRooms Vault.

## Safe Marketing Language

- "Extended storage"
- "Long-term archive"
- "Keep your memories available"
- "Archive while the Vault subscription is active"

Avoid:
- "Forever"
- "Permanent"
- "Lifetime"

## Open Decisions

1. Per-event vs. per-account Vault subscription.
2. Whether Vault also covers private-delivery assets.
3. Bulk-discount pricing for Professional users.
4. Grace period after Vault cancellation.

## TODO

- [ ] Create Stripe product & price ID for Vault monthly.
- [ ] Implement checkout flow for Vault.
- [ ] Implement webhook fulfillment for Vault (extend `vaultExtendedUntil`).
- [ ] Add Vault management UI (subscribe / cancel / view covered events).
- [ ] Update Terms & Privacy with Vault-specific clauses after legal review.
