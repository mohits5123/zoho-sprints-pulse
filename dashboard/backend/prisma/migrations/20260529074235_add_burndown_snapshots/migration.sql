-- CreateTable
CREATE TABLE "BurndownSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sprintZohoId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "doneCount" INTEGER NOT NULL,
    "totalCount" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "BurndownSnapshot_sprintZohoId_date_key" ON "BurndownSnapshot"("sprintZohoId", "date");
