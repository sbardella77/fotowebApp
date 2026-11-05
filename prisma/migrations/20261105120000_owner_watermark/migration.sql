-- Additive only: a new per-owner table plus a nullable Photo column. No
-- existing row changes meaning (watermarkDisplayRevision NULL = none).
ALTER TABLE "Photo" ADD COLUMN     "watermarkDisplayRevision" TEXT;

-- CreateTable
CREATE TABLE "OwnerWatermark" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "type" TEXT NOT NULL DEFAULT 'text',
    "text" TEXT,
    "logoPathname" TEXT,
    "logoUrl" TEXT,
    "logoSha256" TEXT,
    "position" TEXT NOT NULL DEFAULT 'bottom-right',
    "opacityPercent" INTEGER NOT NULL DEFAULT 60,
    "sizePercent" INTEGER NOT NULL DEFAULT 20,
    "revision" TEXT,
    "revisionChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "regenState" TEXT NOT NULL DEFAULT 'IDLE',
    "regenRequestedAt" TIMESTAMP(3),
    "regenCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnerWatermark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OwnerWatermark_ownerId_key" ON "OwnerWatermark"("ownerId");

-- CreateIndex
CREATE INDEX "OwnerWatermark_regenState_idx" ON "OwnerWatermark"("regenState");

-- AddForeignKey
ALTER TABLE "OwnerWatermark" ADD CONSTRAINT "OwnerWatermark_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
