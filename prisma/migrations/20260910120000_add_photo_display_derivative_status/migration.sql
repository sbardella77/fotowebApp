-- CreateEnum
CREATE TYPE "DisplayDerivativeStatus" AS ENUM ('LEGACY_UNVERIFIED', 'PENDING', 'READY', 'FAILED');

-- AlterTable
-- Every existing Photo row receives the schema default (LEGACY_UNVERIFIED)
-- automatically as part of adding this NOT NULL column — no row is set to
-- READY, PENDING, or FAILED by this migration. New-upload code paths
-- explicitly override this default to PENDING at insert time; this
-- migration does not touch application code or existing data.
ALTER TABLE "Photo" ADD COLUMN     "displayDerivativeStatus" "DisplayDerivativeStatus" NOT NULL DEFAULT 'LEGACY_UNVERIFIED';

-- CreateIndex
CREATE INDEX "Photo_displayDerivativeStatus_idx" ON "Photo"("displayDerivativeStatus");
