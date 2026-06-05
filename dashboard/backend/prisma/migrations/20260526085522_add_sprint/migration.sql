-- CreateTable
CREATE TABLE "Sprint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "zohoId" TEXT NOT NULL,
    "projectZohoId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "startDate" TEXT,
    "endDate" TEXT,
    "totalTickets" INTEGER NOT NULL DEFAULT 0,
    "statusBreakdown" TEXT,
    "rawData" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Sprint_zohoId_projectZohoId_key" ON "Sprint"("zohoId", "projectZohoId");
