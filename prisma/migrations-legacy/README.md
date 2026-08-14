# Legacy migration history — ARCHIVE ONLY

This directory contains the 26 migrations that were applied to Production
before the squash/baseline cutover. It exists for historical audit only.

## Do not use this as an active migration path

Prisma must never be pointed at this directory. The active migration
history lives exclusively at:

```
prisma/migrations/
├── migration_lock.toml
└── 000000000000_squashed_migrations/
    └── migration.sql
```

## Why this cutover happened

Six of these 26 historical migrations have invalid dependency ordering:
their filesystem timestamps sort before the migration that creates the
table/object they alter or reference (`Event`, `Owner`, `Photo`). A fresh
replay of the full history from an empty database fails on the very first
migration (`FOREIGN KEY ... REFERENCES "Event"` before `Event` exists).
Production itself is unaffected — its schema was built incrementally, in
the correct real-world order, over time — but the repository history as
committed is not replayable from zero. The single baseline migration
(`000000000000_squashed_migrations`) represents the exact current schema
and replaces the entire legacy sequence for any new/empty database.

## Integrity of these files

Every file under this directory was relocated byte-identical from its
original location — a pure rename, never rewritten. Do not edit any
`migration.sql` here.

## Intentionally omitted: two historical data backfills

Two of the 26 legacy migrations (`20260419100000_add_owner_account` and
`20260501210000_backfill_event_owner_id`) contain one-time `INSERT`/`UPDATE`
statements that backfilled `Owner` records from legacy `Event.ownerEmail`
values. These are deliberately **not** part of the new baseline: a fresh,
empty database has no such legacy rows to backfill, and current application
code always sets `Event.ownerId` directly at creation time.

## Production's own bookkeeping is untouched

Production's `_prisma_migrations` table still records all 26 of these
migrations, under their original names, exactly as before. This directory
change does not modify Production in any way by itself.

## Production cutover has NOT happened yet

This commit only changes the repository's migration history layout. It
does **not** apply anything to Production and does **not** mark the new
baseline as applied there.

Before any future `prisma migrate deploy` runs against Production with
this new history in place, a separate, controlled step must run exactly
once against the correct Production database:

```
prisma migrate resolve --applied 000000000000_squashed_migrations
```

No build or deploy automation in this repository runs `migrate deploy`
automatically — that has already been audited separately.

## Rollback semantics

Do not treat `prisma migrate resolve --rolled-back` on the baseline as a
rollback mechanism once it has been successfully marked applied — the
Prisma CLI rejects this for any migration that is not in a failed state
(verified empirically: `Error P3012`). Do not perform manual
`UPDATE`/`DELETE` against `_prisma_migrations` as a routine rollback path
either. Any future correction to the Production cutover bookkeeping must
be treated as a deliberate, reviewed, forward-only migration-history
reconciliation — not an automated rollback.

## Do not restore this directory to `prisma/migrations/`

Do not move these legacy folders back under the active `prisma/migrations/`
path without a dedicated migration-history incident review first.

## Reference

This layout follows Prisma's own documented workflow for producing a
clean, replayable migration history for an existing production database
("squashing"/"baselining" an established schema) — see Prisma's official
Migrate documentation for the general procedure.

---

Pre-cutover `main` SHA at the time this baseline was generated:
`99024cf13e6854a31b64b895b7abb0b0dfdac905`
