-- AlterTable
ALTER TABLE "Owner" ADD COLUMN     "lastStripeInvoiceEventCreated" BIGINT,
ADD COLUMN     "lastStripeSubscriptionEventCreated" BIGINT,
ADD COLUMN     "stripeBillingCursorSubscriptionId" TEXT;
