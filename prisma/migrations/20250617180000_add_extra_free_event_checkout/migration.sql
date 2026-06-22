-- CreateTable
CREATE TABLE "ExtraFreeEventCheckout" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "stripeCheckoutSessionId" TEXT,
    "eventName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdEventId" TEXT,
    "createdEventSlug" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "autoCreatedAt" TIMESTAMP(3),

    CONSTRAINT "ExtraFreeEventCheckout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExtraFreeEventCheckout_stripeCheckoutSessionId_key" ON "ExtraFreeEventCheckout"("stripeCheckoutSessionId");

-- CreateIndex
CREATE INDEX "ExtraFreeEventCheckout_ownerId_status_idx" ON "ExtraFreeEventCheckout"("ownerId", "status");

-- CreateIndex
CREATE INDEX "ExtraFreeEventCheckout_stripeCheckoutSessionId_idx" ON "ExtraFreeEventCheckout"("stripeCheckoutSessionId");

-- AddForeignKey
ALTER TABLE "ExtraFreeEventCheckout" ADD CONSTRAINT "ExtraFreeEventCheckout_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
