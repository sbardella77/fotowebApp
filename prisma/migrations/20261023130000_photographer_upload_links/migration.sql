-- CreateTable
-- Replaces the single Event.photographerUploadTokenHash column with a 1:N
-- table: one Event can now have several independent, independently
-- revocable photographer/collaborator links instead of exactly one.
CREATE TABLE "PhotographerUploadLink" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhotographerUploadLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PhotographerUploadLink_tokenHash_key" ON "PhotographerUploadLink"("tokenHash");

-- CreateIndex
CREATE INDEX "PhotographerUploadLink_eventId_idx" ON "PhotographerUploadLink"("eventId");

-- AddForeignKey
ALTER TABLE "PhotographerUploadLink" ADD CONSTRAINT "PhotographerUploadLink_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: carry over any existing single photographer link per event
-- before the source columns are dropped below. updatedAt mirrors createdAt
-- since the old column never tracked its own update time.
INSERT INTO "PhotographerUploadLink" ("id", "eventId", "tokenHash", "expiresAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", "photographerUploadTokenHash", "photographerUploadTokenExpiresAt", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Event"
WHERE "photographerUploadTokenHash" IS NOT NULL;

-- DropIndex
DROP INDEX "Event_photographerUploadTokenHash_idx";

-- AlterTable
ALTER TABLE "Event" DROP COLUMN "photographerUploadTokenHash",
DROP COLUMN "photographerUploadTokenExpiresAt";

-- AlterTable
ALTER TABLE "PrivateAsset" ADD COLUMN     "photographerLinkId" TEXT;

-- CreateIndex
CREATE INDEX "PrivateAsset_photographerLinkId_idx" ON "PrivateAsset"("photographerLinkId");

-- AddForeignKey
ALTER TABLE "PrivateAsset" ADD CONSTRAINT "PrivateAsset_photographerLinkId_fkey" FOREIGN KEY ("photographerLinkId") REFERENCES "PhotographerUploadLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;
