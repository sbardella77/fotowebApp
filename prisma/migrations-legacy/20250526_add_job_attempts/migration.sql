-- Add attempt tracking columns
ALTER TABLE "GalleryDownloadJob" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "GalleryDownloadJob" ADD COLUMN IF NOT EXISTS "lastAttemptAt" TIMESTAMP(3);

-- Add index for stale job recovery (status + updatedAt)
CREATE INDEX "GalleryDownloadJob_status_updatedAt_idx" ON "GalleryDownloadJob"("status", "updatedAt");
