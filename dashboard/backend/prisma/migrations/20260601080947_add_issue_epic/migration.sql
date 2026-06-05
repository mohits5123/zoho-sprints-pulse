-- CreateTable
CREATE TABLE "Epic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "zohoId" TEXT NOT NULL,
    "projectZohoId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Issue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "zohoId" TEXT NOT NULL,
    "sprintZohoId" TEXT NOT NULL,
    "projectZohoId" TEXT NOT NULL,
    "itemNo" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "statusGroup" TEXT NOT NULL,
    "epicZohoId" TEXT,
    "creatorZohoId" TEXT,
    "assigneeIds" TEXT NOT NULL,
    "createdAt" TEXT,
    "endDate" TEXT,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Epic_zohoId_projectZohoId_key" ON "Epic"("zohoId", "projectZohoId");

-- CreateIndex
CREATE UNIQUE INDEX "Issue_zohoId_sprintZohoId_key" ON "Issue"("zohoId", "sprintZohoId");
