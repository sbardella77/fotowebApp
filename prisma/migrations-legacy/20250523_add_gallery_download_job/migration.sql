-- CreateTable
CREATE TABLE "GalleryDownloadJob" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resultUrl" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "GalleryDownloadJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GalleryDownloadJob_eventId_status_idx" ON "GalleryDownloadJob"("eventId", "status");

-- CreateIndex
CREATE INDEX "GalleryDownloadJob_createdAt_idx" ON "GalleryDownloadJob"("createdAt");

-- AddForeignKey
ALTER TABLE "GalleryDownloadJob" ADD CONSTRAINT "GalleryDownloadJob_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
