-- Backfill Event.ownerId for legacy rooms that were linked only by ownerEmail.
-- This is safe: only updates rows where ownerId is currently null,
-- and matches by case-insensitive email comparison.

UPDATE "Event" e
SET "ownerId" = o.id,
    "updatedAt" = NOW()
FROM "Owner" o
WHERE e."ownerId" IS NULL
  AND e."ownerEmail" IS NOT NULL
  AND LOWER(TRIM(e."ownerEmail")) = LOWER(TRIM(o.email));
