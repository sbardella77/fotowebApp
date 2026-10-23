-- AlterTable
-- Owner-level opt-out for the new email notifications (photo digest, photo
-- threshold reached, event-expiring reminders). Defaults to true so every
-- existing owner keeps receiving notifications unless they explicitly
-- disable them from the new account settings page.
ALTER TABLE "Owner" ADD COLUMN     "emailNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
-- Per-event notification state. pendingDigestPhotoCount is incremented on
-- every completed upload and decremented (by the amount read, not reset to
-- zero) by the hourly digest cron, so photos uploaded between the cron's
-- read and its email send are never lost. The *SentAt/*NotifiedAt columns
-- are idempotency guards so each notification is sent at most once.
ALTER TABLE "Event" ADD COLUMN     "pendingDigestPhotoCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastPhotoDigestSentAt" TIMESTAMP(3),
ADD COLUMN     "photoThresholdNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "retentionReminderT30SentAt" TIMESTAMP(3),
ADD COLUMN     "retentionReminderT7SentAt" TIMESTAMP(3),
ADD COLUMN     "retentionReminderT0SentAt" TIMESTAMP(3);
