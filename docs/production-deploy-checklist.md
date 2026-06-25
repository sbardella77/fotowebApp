# Production Deploy Checklist

Use this checklist before and after every production deployment, especially when the change touches authentication, payments, storage, or the Prisma schema.

## Pre-deploy

- [ ] `npm run build` passes locally.
- [ ] `npm test` passes locally.
- [ ] If `prisma/schema.prisma` changed, a migration file exists under `prisma/migrations/`.
- [ ] Migration SQL has been reviewed for production safety (no destructive changes, `IF NOT EXISTS` / `DROP COLUMN` justified).

## Deploy

- [ ] Deploy via the project's Vercel/Git workflow (do **not** use `prisma db push` in production).
- [ ] Wait for the Vercel build to complete successfully.

## Post-deploy (mandatory for Prisma/auth changes)

- [ ] Run `npx prisma migrate status` and confirm `Database schema is up to date!`.
- [ ] Run `npx prisma migrate deploy` only if migrations are pending.
- [ ] Run `/api/health/db` and confirm `{"status":"ok"}`.
- [ ] Run `/api/owner/session` and confirm no `P2022` / schema-mismatch errors.
- [ ] Run `/api/owner/forgot-password` with a non-existing email and confirm generic `200` response.
- [ ] Run `/api/owner/login` with a valid account and confirm successful login.
- [ ] For password-reset changes: request a reset, use the link once, reuse the link, and confirm it fails with "invalid or expired".

## Emergency rollback note

- Do **not** run `prisma migrate reset` or drop tables to fix schema errors.
- If a deploy introduces a schema mismatch, apply pending migrations with `npx prisma migrate deploy`.
- If a code bug is exposed, revert the deployment and keep the schema migrations applied; do not roll back the database unless a destructive migration was deployed.
