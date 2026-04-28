-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "billingPurchasedAt" TIMESTAMP(3),
ADD COLUMN     "billingTier" TEXT,
ADD COLUMN     "stripeCheckoutSessionId" TEXT;

-- CreateIndex
CREATE INDEX "Event_billingTier_idx" ON "Event"("billingTier");
