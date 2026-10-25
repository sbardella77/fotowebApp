-- Additive only: two enums, defaulted/nullable columns. Every existing row
-- becomes mediaType = IMAGE with NULL video fields, i.e. unchanged behavior.
-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO');

-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('UPLOADING', 'PROCESSING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "Photo" ADD COLUMN     "durationSec" DOUBLE PRECISION,
ADD COLUMN     "mediaType" "MediaType" NOT NULL DEFAULT 'IMAGE',
ADD COLUMN     "muxAssetId" TEXT,
ADD COLUMN     "muxPlaybackId" TEXT,
ADD COLUMN     "muxUploadId" TEXT,
ADD COLUMN     "videoStatus" "VideoStatus";

-- CreateIndex
CREATE UNIQUE INDEX "Photo_muxUploadId_key" ON "Photo"("muxUploadId");

-- CreateIndex
CREATE UNIQUE INDEX "Photo_muxAssetId_key" ON "Photo"("muxAssetId");
