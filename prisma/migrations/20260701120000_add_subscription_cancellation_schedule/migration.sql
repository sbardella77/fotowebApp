-- AlterTable
ALTER TABLE "Owner" ADD COLUMN "subscriptionCancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Owner" ADD COLUMN "subscriptionCurrentPeriodEnd" TIMESTAMP(3);
ALTER TABLE "Owner" ADD COLUMN "subscriptionCancelScheduledAt" TIMESTAMP(3);
