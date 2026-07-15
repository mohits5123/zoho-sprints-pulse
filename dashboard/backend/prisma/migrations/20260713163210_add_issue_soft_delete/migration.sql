-- Add soft-delete tracking to Issue
ALTER TABLE "Issue" ADD COLUMN "deletedAt" DATETIME;
ALTER TABLE "Issue" ADD COLUMN "missingSyncCount" INTEGER NOT NULL DEFAULT 0;

-- Add human-readable detail message to ActivityNotification
ALTER TABLE "ActivityNotification" ADD COLUMN "message" TEXT NOT NULL DEFAULT '';
