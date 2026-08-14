-- Add composite index for cleanup queries (status + processedAt)
CREATE INDEX "GalleryDownloadJob_status_processedAt_idx" ON "GalleryDownloadJob"("status", "processedAt");
