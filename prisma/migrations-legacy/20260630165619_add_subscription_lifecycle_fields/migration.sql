-- Add subscription lifecycle fields to Owner
ALTER TABLE "Owner" ADD COLUMN IF NOT EXISTS "subscriptionStatus" TEXT;
ALTER TABLE "Owner" ADD COLUMN IF NOT EXISTS "paymentFailedAt" TIMESTAMP(3);
ALTER TABLE "Owner" ADD COLUMN IF NOT EXISTS "subscriptionGraceUntil" TIMESTAMP(3);
ALTER TABLE "Owner" ADD COLUMN IF NOT EXISTS "lastInvoiceId" TEXT;
ALTER TABLE "Owner" ADD COLUMN IF NOT EXISTS "lastInvoiceStatus" TEXT;
ALTER TABLE "Owner" ADD COLUMN IF NOT EXISTS "lastPaymentError" TEXT;
