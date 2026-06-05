-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "zohoId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "boardType" TEXT NOT NULL DEFAULT 'scrum',
    "description" TEXT,
    "ownerName" TEXT,
    "ownerZohoId" TEXT,
    "createdTime" TEXT,
    "rawData" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Project" ("createdAt", "createdTime", "description", "id", "name", "ownerName", "ownerZohoId", "prefix", "rawData", "status", "updatedAt", "zohoId") SELECT "createdAt", "createdTime", "description", "id", "name", "ownerName", "ownerZohoId", "prefix", "rawData", "status", "updatedAt", "zohoId" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
CREATE UNIQUE INDEX "Project_zohoId_key" ON "Project"("zohoId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
