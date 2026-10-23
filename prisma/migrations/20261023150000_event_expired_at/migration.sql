-- AlterTable
-- Reversible retention-expiry marker only — no deletion logic anywhere in
-- this migration or the cron that uses it. Null for every existing event
-- until the daily mark-expired-events cron evaluates it; the cron also
-- clears it back to null if a later run finds the event no longer expired
-- (plan upgrade, Vault extension, archive lock). See docs/retention-policy.md.
ALTER TABLE "Event" ADD COLUMN     "expiredAt" TIMESTAMP(3);
