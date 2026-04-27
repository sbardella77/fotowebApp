-- AlterTable
ALTER TABLE "Owner" ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'free',
ADD COLUMN     "planUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "stripeCheckoutSessionId" TEXT,
ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "stripeSubscriptionId" TEXT;

-- CreateTable
CREATE TABLE "DeletionLog" (
    "id" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "eventSlug" TEXT NOT NULL,
    "deletedBy" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeletionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeletionLog_createdAt_idx" ON "DeletionLog"("createdAt");

-- CreateIndex
CREATE INDEX "DeletionLog_eventSlug_idx" ON "DeletionLog"("eventSlug");
