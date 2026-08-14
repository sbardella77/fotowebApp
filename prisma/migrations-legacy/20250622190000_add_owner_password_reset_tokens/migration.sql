-- Add session invalidation fields to Owner
ALTER TABLE "Owner" ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Owner" ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP(3);

-- Create password reset token table
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

-- CreateIndex
CREATE UNIQUE INDEX "OwnerPasswordResetToken_tokenHash_key" ON "OwnerPasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "OwnerPasswordResetToken_ownerId_idx" ON "OwnerPasswordResetToken"("ownerId");

-- CreateIndex
CREATE INDEX "OwnerPasswordResetToken_expiresAt_idx" ON "OwnerPasswordResetToken"("expiresAt");

-- CreateIndex
CREATE INDEX "OwnerPasswordResetToken_usedAt_idx" ON "OwnerPasswordResetToken"("usedAt");

-- AddForeignKey
ALTER TABLE "OwnerPasswordResetToken" ADD CONSTRAINT "OwnerPasswordResetToken_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
