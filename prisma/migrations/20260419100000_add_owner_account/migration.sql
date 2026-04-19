-- CreateTable
CREATE TABLE "Owner" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "passwordSalt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Owner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Owner_email_key" ON "Owner"("email");

-- CreateIndex
CREATE INDEX "Owner_email_idx" ON "Owner"("email");

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "ownerId" TEXT;

-- CreateIndex
CREATE INDEX "Event_ownerId_idx" ON "Event"("ownerId");

-- Migrate existing owners: create Owner records from unique ownerEmails on Event
INSERT INTO "Owner" ("id", "email", "createdAt", "updatedAt")
SELECT gen_random_uuid(), LOWER(TRIM("ownerEmail")), NOW(), NOW()
FROM "Event"
WHERE "ownerEmail" IS NOT NULL
GROUP BY LOWER(TRIM("ownerEmail"));

-- Link events to their new Owner records
UPDATE "Event"
SET "ownerId" = "Owner"."id"
FROM "Owner"
WHERE LOWER(TRIM("Event"."ownerEmail")) = "Owner"."email";

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
