#!/usr/bin/env bash
#
# Safe migration wrapper — the ONLY approved way to run `prisma migrate
# deploy` against Preview or Production.
#
# Usage:
#   scripts/run-migration-safe.sh --env preview
#   scripts/run-migration-safe.sh --env production
#
# Sequence (mandatory, cannot be skipped):
#   1. ENV VERIFY     — require --env, prompt for DIRECT_URL if not already set
#   2. PRE-FLIGHT      — scripts/db-migration-preflight.cjs (fail closed)
#   3. MIGRATE DEPLOY  — only runs if pre-flight exits 0
#   4. MIGRATION STATUS
#
# DIRECT_URL is read via `read -s` if not already exported, so it is never
# echoed to the terminal and never needs to live in a plaintext file. It is
# unset again before this script exits, on every path (success, failure, or
# interruption).
#
# DO NOT run `prisma migrate deploy` directly. DO NOT export DATABASE_URL in
# place of DIRECT_URL for this workflow — see scripts/db-migration-preflight.cjs
# for why runtime and migration credentials must stay separate.

set -euo pipefail

ENV_NAME=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      ENV_NAME="${2:-}"
      shift 2
      ;;
    --env=*)
      ENV_NAME="${1#--env=}"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ "$ENV_NAME" != "preview" && "$ENV_NAME" != "production" ]]; then
  echo "Usage: $0 --env preview|production" >&2
  exit 1
fi

DIRECT_URL_WAS_ALREADY_SET=0
if [[ -n "${DIRECT_URL:-}" ]]; then
  DIRECT_URL_WAS_ALREADY_SET=1
else
  read -r -s -p "DIRECT_URL for ${ENV_NAME}: " DIRECT_URL
  echo
  export DIRECT_URL
fi

cleanup() {
  if [[ "$DIRECT_URL_WAS_ALREADY_SET" -eq 0 ]]; then
    unset DIRECT_URL
  fi
  unset DATABASE_URL 2>/dev/null || true
}
trap cleanup EXIT

echo "[run-migration-safe] Step 1/4: ENV VERIFY — env=${ENV_NAME}"

echo "[run-migration-safe] Step 2/4: PRE-FLIGHT"
if ! node scripts/db-migration-preflight.cjs --env "$ENV_NAME"; then
  echo "[run-migration-safe] Pre-flight FAILED. Migration NOT executed." >&2
  exit 1
fi

echo "[run-migration-safe] Step 3/4: MIGRATE DEPLOY"
npx prisma migrate deploy

echo "[run-migration-safe] Step 4/4: MIGRATION STATUS"
npx prisma migrate status

echo "[run-migration-safe] Done. Remember to run the schema-verify step for this specific migration (see docs/production-deploy-checklist.md)."
