# Incident Test: Owner Password Setup + Reset Flow

`scripts/incident-test-reset-flow.mjs` exercises the live owner
password-setup and password-reset API end to end, using a dedicated
disposable test identity. It is a manual, operator-run diagnostic tool —
it is not wired into CI, npm scripts, or any automated pipeline.

## Policy: Development / Preview only, never Production

The script refuses to run unless all of the following hold:

- `APP_URL` is set explicitly. There is no default — a missing `APP_URL`
  is treated as unsafe and the script exits non-zero.
- `APP_URL`'s hostname is not `snaprooms.app` and not a subdomain of it
  (the production domain, per [docs/production-deploy-checklist.md](production-deploy-checklist.md)).
- `INCIDENT_TEST_ENV` is set explicitly to `development` or `preview`.
  Any other value, or leaving it unset, blocks the run.
- `NODE_ENV` is not `production`.

There is no `--force` or override flag that bypasses these checks. If a
Production run is ever genuinely required operationally, that needs a
separate, explicitly authorized workflow — not this script.

## Required environment

| Variable | Requirement |
|---|---|
| `APP_URL` | Target app origin (e.g. a local dev server or a Preview deployment URL). Never the production domain. |
| `INCIDENT_TEST_ENV` | Must be exactly `development` or `preview`. |
| `DATABASE_URL` | Required by Prisma; must point at the non-Production database matching the declared environment. Never logged by this script. |

## Execution gate

Without `--execute`, the script prints the planned steps and the
resolved `APP_URL` / test identity, then exits without making any
network call or touching the database (dry run).

```bash
APP_URL=http://localhost:3000 INCIDENT_TEST_ENV=development \
  node scripts/incident-test-reset-flow.mjs
```

To actually run the flow, add `--execute`:

```bash
APP_URL=http://localhost:3000 INCIDENT_TEST_ENV=development \
  node scripts/incident-test-reset-flow.mjs --execute
```

## Test identity

The script always uses the hardcoded identity
`incident-test-reset@snaprooms.app`. It does not accept an arbitrary
email via CLI argument or environment variable, so it cannot be pointed
at a real user's account.

## What it creates

On `--execute`, against the target `APP_URL` / `DATABASE_URL`:

- One `Owner` row for the test identity, with no password set initially.
- `OwnerPasswordResetToken` rows for that owner (`setup_password` and
  `password_reset` purposes), created and consumed through the real
  `/api/owner/setup`, `/api/owner/reset-password`, and
  `/api/owner/forgot-password` endpoints.

## What it deletes (cleanup)

Cleanup runs both before the flow starts and in a `finally` block after
it ends (success or failure), and is scoped strictly to the test
identity:

1. Look up the `Owner` by the hardcoded test email.
2. If found, delete only that owner's `OwnerPasswordResetToken` rows,
   then delete that owner row.

There is no `deleteMany({})` without a scoping `where`, no table
truncation, and no cleanup of tokens or owners belonging to any other
identity.

## Exit codes

- `0` — dry run printed, or the flow completed successfully.
- `1` — a safety guard rejected the run, or the flow failed (test data
  is still cleaned up before exit).
