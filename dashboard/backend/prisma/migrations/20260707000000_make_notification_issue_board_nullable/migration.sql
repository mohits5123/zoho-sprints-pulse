-- CreateTable: Watchlist
CREATE TABLE "Watchlist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "boardId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "important" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Watchlist_boardId_issueId_userId_key" ON "Watchlist"("boardId", "issueId", "userId");

-- CreateTable: Note
CREATE TABLE "Note" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Untitled',
    "content" TEXT NOT NULL DEFAULT '',
    "issueIds" TEXT NOT NULL,
    "taggedUserIds" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "deadline" DATETIME,
    "deadlineGroupId" TEXT,
    "deadlineNotified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Note_deadlineGroupId_fkey" FOREIGN KEY ("deadlineGroupId") REFERENCES "DeadlineGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable: DeadlineGroup
CREATE TABLE "DeadlineGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable: Deadline
CREATE TABLE "Deadline" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "boardId" TEXT,
    "issueId" TEXT,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "deadlineGroupId" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Deadline_deadlineGroupId_fkey" FOREIGN KEY ("deadlineGroupId") REFERENCES "DeadlineGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable: ActivityNotification
CREATE TABLE "ActivityNotification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'status_change',
    "issueId" TEXT,
    "boardId" TEXT,
    "noteId" TEXT,
    "oldStatus" TEXT NOT NULL DEFAULT '',
    "newStatus" TEXT NOT NULL DEFAULT '',
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "ActivityNotification_userId_read_idx" ON "ActivityNotification"("userId", "read");
CREATE INDEX "ActivityNotification_userId_createdAt_idx" ON "ActivityNotification"("userId", "createdAt");
