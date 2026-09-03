-- AlterTable
ALTER TABLE "Photo" ADD COLUMN     "uploadActorType" TEXT;

-- AlterTable
ALTER TABLE "BlobUploadSession" ADD COLUMN     "uploadActorType" TEXT;
