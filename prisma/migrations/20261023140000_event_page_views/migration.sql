-- CreateTable
-- One row per anonymous gallery page view (guest-facing event page only,
-- never the owner's own views — filtered client-side before this is
-- called). Same one-row-per-occurrence style as UpsellEvent, so trend
-- queries over createdAt work the same way.
CREATE TABLE "EventPageView" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventPageView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventPageView_eventId_createdAt_idx" ON "EventPageView"("eventId", "createdAt");

-- AddForeignKey
ALTER TABLE "EventPageView" ADD CONSTRAINT "EventPageView_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
-- UpsellEvent.eventId has existed since the model was introduced but was
-- never indexed because no query filtered by it — per-event analytics
-- queries now do.
CREATE INDEX "UpsellEvent_eventId_idx" ON "UpsellEvent"("eventId");
