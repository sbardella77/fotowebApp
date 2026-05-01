-- CreateTable
CREATE TABLE "PrivateAsset" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivateAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrivateAsset_eventId_createdAt_idx" ON "PrivateAsset"("eventId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "PrivateAsset" ADD CONSTRAINT "PrivateAsset_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
