-- Additive only: one nullable column.
-- AlterTable
ALTER TABLE "Owner" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

-- Grandfather every owner that exists before this release: they signed up
-- under the old rules and must not suddenly hit the unverified photo cap.
-- Only owners created after this migration start out unverified.
UPDATE "Owner" SET "emailVerifiedAt" = "createdAt" WHERE "emailVerifiedAt" IS NULL;
