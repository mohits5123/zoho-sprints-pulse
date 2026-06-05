/*
  Warnings:

  - The primary key for the `BurndownSnapshot` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `createdAt` on the `BurndownSnapshot` table. All the data in the column will be lost.
  - You are about to drop the column `id` on the `BurndownSnapshot` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BurndownSnapshot" (
    "sprintZohoId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "doneCount" INTEGER NOT NULL,
    "totalCount" INTEGER NOT NULL,

    PRIMARY KEY ("sprintZohoId", "date")
);
INSERT INTO "new_BurndownSnapshot" ("date", "doneCount", "sprintZohoId", "totalCount") SELECT "date", "doneCount", "sprintZohoId", "totalCount" FROM "BurndownSnapshot";
DROP TABLE "BurndownSnapshot";
ALTER TABLE "new_BurndownSnapshot" RENAME TO "BurndownSnapshot";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
