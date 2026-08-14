-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "originalDownloadCheckoutSessionId" TEXT,
ADD COLUMN     "originalDownloadUnlocked" BOOLEAN NOT NULL DEFAULT false;
