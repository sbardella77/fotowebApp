# Database Migration Runbook

This is the canonical runbook for Prisma schema migrations against SnapRooms **Preview** and **Production**.

## Safety model

Runtime and migration identities are intentionally separate:

- `DATABASE_URL` is the application runtime connection and must remain least-privilege.
- `DIRECT_URL` is the only connection the approved migration workflow may use.
- Never grant permanent DDL privileges to the runtime role to make a migration pass.

The approved sequence is always:

```text
ENV VERIFY
→ PRE-FLIGHT
→ MIGRATE DEPLOY
→ MIGRATION STATUS
→ SCHEMA VERIFY
```

## Hard rules

- **DO NOT run `prisma migrate deploy` directly.**
- **DO NOT use runtime `DATABASE_URL` for DDL.**
- **DO NOT use `prisma migrate resolve` as the first response to P3018.**
- **DO NOT bypass a failed pre-flight with GRANT, ALTER OWNER, SET ROLE, or a different guessed URL.**
- Never commit plaintext database URLs, passwords, tokens, `.env.preview.local`, or `.env.production.local`.

## Environment policy

### Preview

The current verified policy is:

```text
environment: preview
database: neondb
direct endpoint: ep-bitter-base-an3r03ez.c-6.us-east-1.aws.neon.tech
migration role: neondb_owner
```

Preview's pre-flight must validate all three before it opens the database connection, then validate the server-reported identity and ownership with SELECT-only queries.

### Production

Production migration identity is intentionally **blocked** in code until a separate read-only evidence gate proves:

- the Production direct Neon endpoint;
- the Production database name;
- the Production owner/migration role;
- ownership compatibility for Prisma-managed objects.

Do not copy Preview identity into Production policy by assumption.

## Operator workflow

### 1. Supply the migration credential without writing it to the repository

The wrapper reads `DIRECT_URL` only. It never needs `DATABASE_URL` for migration authorization.

For an interactive local shell, a safe pattern is:

```bash
read -s DIRECT_URL
export DIRECT_URL
npm run db:migration:preflight:preview
unset DIRECT_URL
```

Do not echo `$DIRECT_URL`. Do not use `set -x` while handling it.

If the standalone pre-flight fails, stop. Do not proceed to the wrapper.

### 2. Run the approved wrapper

Preview:

```bash
npm run db:migrate:preview
```

Production:

```bash
npm run db:migrate:production
```

`db:migrate:production` currently fails closed by design until Production policy is verified and explicitly enabled.

The legacy aliases `npm run prisma:migrate:deploy` and `npm run db:migrate:deploy` now route to the guardrail but do not specify an environment, so they fail closed. Use the explicit environment-specific command.

### 3. Pre-flight behavior

The guard performs only SELECT-only checks before authorizing Prisma:

1. explicit `--env` is required;
2. `DIRECT_URL` must be present and parse as PostgreSQL;
3. URL host must equal the expected direct endpoint;
4. URL database must equal the expected database;
5. URL username must equal the expected migration role;
6. server `current_database`, `current_user`, `session_user`, `current_role`, and `current_schema` must match policy;
7. `public` schema must permit `USAGE` and `CREATE` for the connected role;
8. `_prisma_migrations`, `Photo`, and `BlobUploadSession` must exist;
9. every ordinary/partitioned table currently in `public` must be owned by the expected migration role.

Any failed check returns a non-zero exit code and the wrapper emits:

```text
MIGRATION_EXECUTED=NO
```

The migration subprocess is not started.

## Machine-readable output

Example pass:

```text
MIGRATION_PREFLIGHT=PASS
ENVIRONMENT=preview
HOST=<safe hostname>
DATABASE=neondb
EXPECTED_ROLE=neondb_owner
ACTUAL_ROLE=neondb_owner
MIGRATION_EXECUTION=AUTHORIZED_BY_PREFLIGHT
```

Example wrong-role failure:

```text
MIGRATION_PREFLIGHT=FAIL
REASON=UNEXPECTED_URL_ROLE
EXPECTED_ROLE=neondb_owner
ACTUAL_ROLE=snaprooms_runtime
MIGRATION_EXECUTED=NO
```

No password, full connection string, token, or raw provider error is printed.

## After `migrate deploy`

A successful wrapper exit is not the end of the change. Complete the gate with read-only verification:

### Migration status

Inspect Prisma migration status/history using the approved environment and expected role. Do not repair history automatically.

### Schema verify

Verify the expected columns/indexes/constraints for the specific migration using read-only PostgreSQL catalog queries.

If migration history and schema disagree, stop and open a recovery audit. Do not immediately run `migrate resolve`.

## P3018 response

For PostgreSQL ownership/permission errors:

1. stop migration attempts;
2. capture environment, host, database and current role safely;
3. run the pre-flight independently;
4. inspect table ownership read-only;
5. verify migration history and physical schema;
6. classify runtime-role misuse vs ownership inconsistency vs wrong environment;
7. design recovery before any mutation.

A runtime role that cannot `ALTER TABLE` is normally a security property, not a defect.

## Secret handling

Allowed output:

- environment name;
- hostname;
- database name;
- PostgreSQL role name;
- table/schema owner names;
- safe PostgreSQL error code.

Never log:

- full `DIRECT_URL`;
- password;
- token;
- connection query string containing credentials;
- provider/Prisma raw error objects where connection details may be embedded.

After an interactive run:

```bash
unset DIRECT_URL
```

## Approved commands

Read-only pre-flight:

```bash
npm run db:migration:preflight:preview
npm run db:migration:preflight:production
```

Guarded migration wrapper:

```bash
npm run db:migrate:preview
npm run db:migrate:production
```

Production remains blocked until its policy is established by separate evidence.
