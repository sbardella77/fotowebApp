# SnapRooms Retention Policy

## Overview

SnapRooms stores event photos for a defined duration based on the owner's plan. This document describes the technical and commercial retention rules, the data model, and the roadmap for reminders and cleanup.

## Plan Durations

| Plan | Storage Duration |
|------|------------------|
| Free | 90 days from event creation |
| Pro Event | 12 months from event creation |
| Wedding Pro | 24 months from event creation |
| Professional | While subscription is active + 90 days grace period after cancellation |
| Business | While subscription is active (custom terms may apply) |

## Data Model

The `Event` table in Prisma has been extended with the following fields:

```prisma
model Event {
  // ... existing fields ...
  retentionUntil     DateTime?
  vaultExtendedUntil DateTime?
  retentionPolicy    String?
  archiveLocked      Boolean   @default(false)
  gracePeriodUntil   DateTime?
}
```

- `retentionUntil` — computed expiration date (can be overridden by Vault).
- `vaultExtendedUntil` — expiration date when covered by SnapRooms Vault.
- `retentionPolicy` — canonical policy slug applied to this event (e.g. `free_90_days`, `pro_event_12_months`).
- `archiveLocked` — when `true`, the event is excluded from any automated cleanup.
- `gracePeriodUntil` — explicit grace-period deadline for former Professional subscribers.

## Calculation Logic

The canonical resolver is `lib/event-retention.js` → `resolveEventRetentionState()`.

Rules (in priority order):

1. **Archive lock** — if `archiveLocked === true`, no expiration.
2. **Vault extension** — if `vaultExtendedUntil` is in the future, that date wins.
3. **Event tier** — `pro_event` = +12 months; `wedding_pro` = +24 months from `createdAt`.
4. **Active subscription** — Professional / Business = no fixed expiration while active.
5. **Grace period** — if the subscription was cancelled, +90 days from `subscriptionCanceledAt`.
6. **Free fallback** — 90 days from `createdAt`.

The helper is isomorphic (safe on client and server). A server-side wrapper `getEventRetentionStateFromDb()` fetches the owner record when needed.

## Dashboard UI

Each event detail panel now shows:

- **Storage duration** label
- Expiration date (or "Stored while your subscription is active")
- A warning when expiry is < 30 days away
- A "SnapRooms Vault — Coming soon" placeholder for extendable events

## Reminders (Future)

Planned email reminder schedule (requires Resend/Postmark integration):

- **T-30 days** — "Your event storage expires in 30 days"
- **T-7 days** — "Your event storage expires in 7 days — download now"
- **T-0 days** — "Storage expired today — download before cleanup"

CTAs in each reminder:
- Download full gallery
- Extend storage / SnapRooms Vault (when available)

## Cleanup Job (Future)

A future Vercel Cron job will:

1. Find events where `retentionUntil < now()` and `archiveLocked = false` and not covered by Vault.
2. Set `status = 'EXPIRED'` (or add an `expiredAt` timestamp).
3. Notify the owner.
4. After an additional grace period (e.g. 7–14 days), soft-delete blobs and DB records.

**Important:** No destructive cleanup is enabled yet. The current implementation is read-only and informational.

## GDPR / Privacy Notes

- Users can download their data at any time from the dashboard.
- We do not promise "forever" or unlimited storage in any public copy.
- The Privacy Policy and Terms have been updated with plan-based retention language and a reminder clause.
- **Legal review required** before commercial launch of automated deletion.
