# SnapRooms — Testing Notes

## Core Entitlement & Retention Tests

Two critical pure-function layers have minimal but solid test coverage:

- `tests/event-access.test.js` — 12 tests covering Free, Pro Event, Wedding Pro, Professional, Business, legacy `pro`, and `originalDownloadUnlocked` only.
- `tests/event-retention.test.js` — 11 tests covering Free 90 days, Pro Event 12 months, Wedding Pro 24 months, Professional active, Professional cancelled grace period, vault extension, and archive lock.

### Running tests

```bash
npm test
```

Uses **Vitest** (dev dependency). No DB, no Prisma, no fetch — tests are pure, fast, and timezone-safe.

### When to update

- Any change to pricing plans or entitlement rules → update `event-access` tests.
- Any change to retention durations or grace-period logic → update `event-retention` tests.
- Adding a new plan tier? Add a matching scenario in both files before shipping.
