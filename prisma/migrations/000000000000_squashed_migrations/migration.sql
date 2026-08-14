-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PhotoStatus" AS ENUM ('VISIBLE', 'HIDDEN');

-- CreateEnum
CREATE TYPE "BlobUploadKind" AS ENUM ('ROOM_PHOTO', 'PRIVATE_DELIVERY', 'PHOTOGRAPHER_UPLOAD');

-- CreateEnum
CREATE TYPE "BlobUploadSessionStatus" AS ENUM ('PENDING', 'TOKEN_ISSUED', 'UPLOADED', 'COMPLETED', 'REJECTED', 'CLEANUP_PENDING', 'CLEANUP_FAILED', 'EXPIRED_CLEANED');

-- CreateEnum
CREATE TYPE "StripeWebhookEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "Owner" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "passwordSalt" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "extraEventCredits" INTEGER NOT NULL DEFAULT 0,
    "extraEventCheckoutSessionId" TEXT,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripeCheckoutSessionId" TEXT,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "passwordChangedAt" TIMESTAMP(3),
    "planUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subscriptionCanceledAt" TIMESTAMP(3),
    "subscriptionCancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "subscriptionCurrentPeriodEnd" TIMESTAMP(3),
    "subscriptionCancelScheduledAt" TIMESTAMP(3),
    "subscriptionBillingInterval" TEXT,
    "subscriptionStatus" TEXT,
    "paymentFailedAt" TIMESTAMP(3),
    "subscriptionGraceUntil" TIMESTAMP(3),
    "lastInvoiceId" TEXT,
    "lastInvoiceStatus" TEXT,
    "lastPaymentError" TEXT,
    "stripeBillingCursorSubscriptionId" TEXT,
    "lastStripeSubscriptionEventCreated" BIGINT,
    "lastStripeInvoiceEventCreated" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Owner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerPasswordResetToken" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'password_reset',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "requestedIpHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerPasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerEmail" TEXT,
    "ownerId" TEXT,
    "managementTokenHash" TEXT,
    "coverPhotoId" TEXT,
    "billingTier" TEXT,
    "stripeCheckoutSessionId" TEXT,
    "billingPurchasedAt" TIMESTAMP(3),
    "originalDownloadUnlocked" BOOLEAN NOT NULL DEFAULT false,
    "originalDownloadCheckoutSessionId" TEXT,
    "photographerUploadTokenHash" TEXT,
    "photographerUploadTokenExpiresAt" TIMESTAMP(3),
    "retentionUntil" TIMESTAMP(3),
    "vaultExtendedUntil" TIMESTAMP(3),
    "retentionPolicy" TEXT,
    "archiveLocked" BOOLEAN NOT NULL DEFAULT false,
    "gracePeriodUntil" TIMESTAMP(3),
    "coverUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventMoment" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventMoment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "uploaderName" TEXT,
    "caption" TEXT,
    "status" "PhotoStatus" NOT NULL DEFAULT 'VISIBLE',
    "uploadSource" TEXT NOT NULL DEFAULT 'mobile',
    "width" INTEGER,
    "height" INTEGER,
    "momentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivateAsset" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "uploadedByRole" TEXT DEFAULT 'owner',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivateAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminCredential" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT 'primary',
    "passwordSalt" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminCredential_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "GalleryDownloadJob" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resultUrl" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "GalleryDownloadJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtraFreeEventCheckout" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "stripeCheckoutSessionId" TEXT,
    "eventName" TEXT,
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

-- CreateTable
CREATE TABLE "UpsellEvent" (
    "id" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "upsellType" TEXT,
    "source" TEXT,
    "location" TEXT,
    "ctaPlan" TEXT,
    "ownerId" TEXT,
    "eventId" TEXT,
    "eventSlug" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UpsellEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlobUploadSession" (
    "id" TEXT NOT NULL,
    "eventId" TEXT,
    "eventSlug" TEXT NOT NULL,
    "uploadKind" "BlobUploadKind" NOT NULL,
    "status" "BlobUploadSessionStatus" NOT NULL DEFAULT 'PENDING',
    "expectedPathname" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "expectedSize" INTEGER NOT NULL,
    "uploaderName" TEXT,
    "caption" TEXT,
    "momentId" TEXT,
    "blobUrl" TEXT,
    "resultId" TEXT,
    "tokenIssuedAt" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "cleanupAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlobUploadSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" "StripeWebhookEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingStartedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Owner_email_key" ON "Owner"("email");

-- CreateIndex
CREATE INDEX "Owner_email_idx" ON "Owner"("email");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerPasswordResetToken_tokenHash_key" ON "OwnerPasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "OwnerPasswordResetToken_ownerId_idx" ON "OwnerPasswordResetToken"("ownerId");

-- CreateIndex
CREATE INDEX "OwnerPasswordResetToken_expiresAt_idx" ON "OwnerPasswordResetToken"("expiresAt");

-- CreateIndex
CREATE INDEX "OwnerPasswordResetToken_usedAt_idx" ON "OwnerPasswordResetToken"("usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Event_slug_key" ON "Event"("slug");

-- CreateIndex
CREATE INDEX "Event_createdAt_idx" ON "Event"("createdAt");

-- CreateIndex
CREATE INDEX "Event_ownerId_idx" ON "Event"("ownerId");

-- CreateIndex
CREATE INDEX "Event_billingTier_idx" ON "Event"("billingTier");

-- CreateIndex
CREATE INDEX "Event_photographerUploadTokenHash_idx" ON "Event"("photographerUploadTokenHash");

-- CreateIndex
CREATE INDEX "EventMoment_eventId_sortOrder_idx" ON "EventMoment"("eventId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "EventMoment_eventId_slug_key" ON "EventMoment"("eventId", "slug");

-- CreateIndex
CREATE INDEX "Photo_eventId_createdAt_idx" ON "Photo"("eventId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Photo_status_createdAt_idx" ON "Photo"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Photo_momentId_createdAt_idx" ON "Photo"("momentId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "PrivateAsset_eventId_createdAt_idx" ON "PrivateAsset"("eventId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "AdminCredential_key_key" ON "AdminCredential"("key");

-- CreateIndex
CREATE INDEX "AdminCredential_updatedAt_idx" ON "AdminCredential"("updatedAt");

-- CreateIndex
CREATE INDEX "DeletionLog_createdAt_idx" ON "DeletionLog"("createdAt");

-- CreateIndex
CREATE INDEX "DeletionLog_eventSlug_idx" ON "DeletionLog"("eventSlug");

-- CreateIndex
CREATE INDEX "GalleryDownloadJob_eventId_status_idx" ON "GalleryDownloadJob"("eventId", "status");

-- CreateIndex
CREATE INDEX "GalleryDownloadJob_createdAt_idx" ON "GalleryDownloadJob"("createdAt");

-- CreateIndex
CREATE INDEX "GalleryDownloadJob_status_processedAt_idx" ON "GalleryDownloadJob"("status", "processedAt");

-- CreateIndex
CREATE INDEX "GalleryDownloadJob_status_updatedAt_idx" ON "GalleryDownloadJob"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExtraFreeEventCheckout_stripeCheckoutSessionId_key" ON "ExtraFreeEventCheckout"("stripeCheckoutSessionId");

-- CreateIndex
CREATE INDEX "ExtraFreeEventCheckout_ownerId_status_idx" ON "ExtraFreeEventCheckout"("ownerId", "status");

-- CreateIndex
CREATE INDEX "ExtraFreeEventCheckout_stripeCheckoutSessionId_idx" ON "ExtraFreeEventCheckout"("stripeCheckoutSessionId");

-- CreateIndex
CREATE INDEX "UpsellEvent_eventName_upsellType_idx" ON "UpsellEvent"("eventName", "upsellType");

-- CreateIndex
CREATE INDEX "UpsellEvent_source_idx" ON "UpsellEvent"("source");

-- CreateIndex
CREATE INDEX "UpsellEvent_createdAt_idx" ON "UpsellEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BlobUploadSession_expectedPathname_key" ON "BlobUploadSession"("expectedPathname");

-- CreateIndex
CREATE INDEX "BlobUploadSession_eventId_status_idx" ON "BlobUploadSession"("eventId", "status");

-- CreateIndex
CREATE INDEX "BlobUploadSession_eventSlug_idx" ON "BlobUploadSession"("eventSlug");

-- CreateIndex
CREATE INDEX "BlobUploadSession_status_expiresAt_idx" ON "BlobUploadSession"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "BlobUploadSession_uploadKind_status_idx" ON "BlobUploadSession"("uploadKind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StripeWebhookEvent_eventId_key" ON "StripeWebhookEvent"("eventId");

-- CreateIndex
CREATE INDEX "StripeWebhookEvent_status_processingStartedAt_idx" ON "StripeWebhookEvent"("status", "processingStartedAt");

-- AddForeignKey
ALTER TABLE "OwnerPasswordResetToken" ADD CONSTRAINT "OwnerPasswordResetToken_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMoment" ADD CONSTRAINT "EventMoment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_momentId_fkey" FOREIGN KEY ("momentId") REFERENCES "EventMoment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateAsset" ADD CONSTRAINT "PrivateAsset_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryDownloadJob" ADD CONSTRAINT "GalleryDownloadJob_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtraFreeEventCheckout" ADD CONSTRAINT "ExtraFreeEventCheckout_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlobUploadSession" ADD CONSTRAINT "BlobUploadSession_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

