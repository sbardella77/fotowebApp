-- Add extra event credits counter and checkout session tracking to Owner
ALTER TABLE "Owner"
  ADD COLUMN "extraEventCredits" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "extraEventCheckoutSessionId" TEXT;
