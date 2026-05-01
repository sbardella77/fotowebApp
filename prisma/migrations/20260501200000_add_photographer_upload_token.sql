ALTER TABLE "Event" ADD COLUMN "photographerUploadTokenHash" TEXT;
ALTER TABLE "Event" ADD COLUMN "photographerUploadTokenExpiresAt" TIMESTAMP(3);
CREATE INDEX "Event_photographerUploadTokenHash_idx" ON "Event"("photographerUploadTokenHash");
ALTER TABLE "PrivateAsset" ADD COLUMN "uploadedByRole" TEXT DEFAULT 'owner';
