-- CreateEnum
CREATE TYPE "BlobUploadKind" AS ENUM ('ROOM_PHOTO', 'PRIVATE_DELIVERY', 'PHOTOGRAPHER_UPLOAD');

-- CreateEnum
CREATE TYPE "BlobUploadSessionStatus" AS ENUM ('PENDING', 'TOKEN_ISSUED', 'UPLOADED', 'COMPLETED', 'REJECTED', 'CLEANUP_PENDING', 'CLEANUP_FAILED', 'EXPIRED_CLEANED');

-- CreateTable
CREATE TABLE "BlobUploadSession" (
    "id" TEXT NOT NULL,
    "eventId" TEXT,
    "eventSlug" TEXT NOT NULL,
    "uploadKind" "BlobUploadKind" NOT NULL,
    "status" "BlobUploadSessionStatus" NOT NULL DEFAULT 'PENDING',
    "expectedPathname" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "expectedSize" INTEGER NOT NULL,
    "uploaderName" TEXT,
    "caption" TEXT,
    "momentId" TEXT,
    "blobUrl" TEXT,
    "resultId" TEXT,
    "tokenIssuedAt" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "cleanupAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlobUploadSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlobUploadSession_expectedPathname_key" ON "BlobUploadSession"("expectedPathname");

-- CreateIndex
CREATE INDEX "BlobUploadSession_eventId_status_idx" ON "BlobUploadSession"("eventId", "status");

-- CreateIndex
CREATE INDEX "BlobUploadSession_eventSlug_idx" ON "BlobUploadSession"("eventSlug");

-- CreateIndex
CREATE INDEX "BlobUploadSession_status_expiresAt_idx" ON "BlobUploadSession"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "BlobUploadSession_uploadKind_status_idx" ON "BlobUploadSession"("uploadKind", "status");

-- AddForeignKey
ALTER TABLE "BlobUploadSession" ADD CONSTRAINT "BlobUploadSession_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
