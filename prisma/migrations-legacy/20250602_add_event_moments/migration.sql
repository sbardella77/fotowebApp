-- CreateTable EventMoment
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

-- Add momentId to Photo
ALTER TABLE "Photo" ADD COLUMN "momentId" TEXT;

-- Unique index on EventMoment(eventId, slug)
CREATE UNIQUE INDEX "EventMoment_eventId_slug_key" ON "EventMoment"("eventId", "slug");

-- Index on EventMoment(eventId, sortOrder)
CREATE INDEX "EventMoment_eventId_sortOrder_idx" ON "EventMoment"("eventId", "sortOrder");

-- Index on Photo(momentId, createdAt desc)
CREATE INDEX "Photo_momentId_createdAt_idx" ON "Photo"("momentId", "createdAt" DESC);

-- Foreign key: EventMoment.eventId -> Event.id (Cascade)
ALTER TABLE "EventMoment" ADD CONSTRAINT "EventMoment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Foreign key: Photo.momentId -> EventMoment.id (SetNull)
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_momentId_fkey" FOREIGN KEY ("momentId") REFERENCES "EventMoment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
