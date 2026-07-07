# Zonaliser

Zonaliser is a local-first, read-only engineering analytics dashboard built on top of [Zoho Sprints](https://www.zoho.com/sprints). It gives engineering managers a single pane of glass into sprint health, developer workload, ticket aging, and delivery risk — running entirely on a local machine with no cloud dependency and no auth wall.

All data is cached locally in SQLite. Zoho is only contacted during scheduled background syncs. Every page load reads from the local database with zero live API calls.

---

## Features

**Developer workload**
View per-developer open issue counts, WIP distribution, and overdue work. Role labels (DEV / QA / PROD / OTHER) are set locally and not sourced from Zoho. Per-user sprint completion percentages and stale ticket breakdowns are shown on the board view.

**Sprint health**
Per-sprint burndown charts built from historical snapshots. See completed vs. remaining work over time. Past sprints can be loaded on demand from the Sprint Health page for historical analysis.

**Board view**
Visual Kanban/Scrum board grouped by status bucket (To Do / In Progress / Done). Issues are grouped per the project's custom status map synced from Zoho. Includes sprint overview, epic breakdown (Scrum), user load, user completion, user stale, and ticket raiser cards. Stale ticket detection is configurable per board via the Stale Settings modal (days threshold + watched status states).

**Backlog view**
Project-level backlog with filtering by status, assignee, and staleness.

**Issue list**
Filterable, sortable issue table per project with computed staleness and delay indicators. Supports filtering by sprint, epic, assignee, status, creator, and watchlist importance.

**Watchlist**
Mark important tickets per user per board. Watched issues are tracked for status changes — when a sync detects a status change on a watched ticket, an activity notification is created automatically.

**Notes**
Create Markdown notes with issue links and user mentions. Notes support optional deadlines and active/closed states. Search for issues and users inline while editing.

**Deadlines**
Set local deadline reminders for specific issues or standalone tasks. Deadlines can be scoped to a project board or span all boards. Overdue items are surfaced in the activity feed.

**Activity and notifications**
Activity feed showing status changes on watched tickets, upcoming deadline reminders, and important issue counts. Notifications can be marked as read or cleared. A summary endpoint provides counts for dashboard widgets.

**Aging and risk detection**
Issues are flagged at query time using configurable thresholds:

| Signal | Default threshold |
|---|---|
| Stale issue | No update for 7 days |
| Delayed issue | Past target date and not closed |

Thresholds are passed as query parameters and are never hardcoded. The stale detection settings (days + watched status states) are configurable per board from the UI and stored in localStorage.

**Sync progress**
A persistent progress bar tracks the active sync and displays live status. Manual sync can be triggered from the UI or via `POST /api/sprints/sync`.

**Project management**
Projects can be reordered via drag-and-drop, hidden/shown, and switched between Kanban and Scrum board types. Sprints can also be hidden individually.

---

## Installation

### Prerequisites

- Node.js 18 or later
- A Zoho Sprints account with OAuth API access

### 1. Obtain Zoho credentials

Create an OAuth client in the [Zoho API Console](https://api-console.zoho.com/) and generate a refresh token with Sprints read permissions. You will need:

- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`
- `ZOHO_REFRESH_TOKEN`

### 2. Configure environment variables

Add the following to your `~/.zshrc` (or equivalent shell profile). Do not use a `.env` file — the backend does not load one.

```bash
export ZOHO_CLIENT_ID="your-client-id"
export ZOHO_CLIENT_SECRET="your-client-secret"
export ZOHO_REFRESH_TOKEN="your-refresh-token"

# Optional: discovered automatically on first run
# export ZOHO_PORTAL_ID="your-portal-id"

# Optional: sets the workspace name displayed in the dashboard
# export ZOHO_WORKSPACE_NAME="your-workspace-name"

# Optional: override default backend port (default: 3001)
# export PORT=3001
```

Then reload your shell:

```bash
source ~/.zshrc
```

### 3. Install dependencies

```bash
cd dashboard/backend && npm install
cd ../frontend && npm install
```

### 4. Start the application

Open two terminal windows:

**Terminal 1 — Backend**
```bash
cd dashboard/backend
npm run dev
# API server running at http://localhost:3001
```

**Terminal 2 — Frontend**
```bash
cd dashboard/frontend
npm run dev
# Dashboard running at http://localhost:5173
```

### 5. Trigger the initial sync

Open the dashboard at `http://localhost:5173`. Use the sync button in the UI or send a manual request:

```bash
curl -X POST http://localhost:3001/api/sprints/sync
```

The first sync fetches all projects, sprints, users, epics, and issues from Zoho. For teams with around 80–100 issues this takes approximately 4 minutes due to Zoho's rate limit. Subsequent syncs are incremental.

The dashboard displays empty states until the first sync completes. This is expected.

---

## Architecture

### Data flow

```
Runtime (every page load):
  Browser → Vite (5173) → Express (3001) → SQLite       [zero Zoho calls]

Sync (cron every 1 hour, or manual POST):
  Express → Zoho Sprints API (rate-limited) → SQLite → Activity sync (watched ticket notifications)
```

All analytics endpoints read exclusively from the local SQLite database. The Zoho API client is only invoked by the sync engine, which runs on a cron schedule (`0 * * * *`) or when manually triggered. After each sync completes, the activity sync service checks watched tickets for status changes and creates notifications.

### Tech stack

| Layer | Technology |
|---|---|
| Backend runtime | Node.js with TypeScript |
| API server | Express.js |
| ORM | Prisma |
| Database | SQLite (local file) |
| Scheduler | node-cron |
| Frontend | React 18 with TypeScript |
| Build tool | Vite |
| Routing | React Router v7 |
| Charts | Custom SVG (no charting library) |
| Styling | Inline `React.CSSProperties` (no CSS framework) |

### Rate limiting

The Zoho API enforces a hard limit across an entire team. Exceeding it returns HTTP 400 `"API locked for team"` and blocks all Zoho access for everyone in the organisation.

The sync engine enforces a **25 requests per 60-second sliding window** via `src/services/rateLimiter.ts`. Every Zoho fetch must call `await zohoThrottle.wait()` before the request and `zohoThrottle.record()` after. This is non-negotiable.

### Database

SQLite file: `dashboard/backend/prisma/dev.db`

Ten models: `User`, `Project`, `Sprint`, `Epic`, `Issue`, `BurndownSnapshot`, `Settings`, `Watchlist`, `Note`, `Deadline`, and `ActivityNotification`.

Computed fields (`isStale`, `delayedDays`) are not stored. They are calculated in JavaScript from `createdAt` and `endDate` at query time inside `src/services/issueQueries.ts`.

`Issue.assigneeIds` is stored as a JSON string (`'["zohoId1","zohoId2"]'`). User-filter queries use SQLite's `json_each()` function. Treat it as opaque text — not a native array. Similarly, `Note.issueIds` and `Note.taggedUserIds` are JSON strings of ID arrays.

`Watchlist` tracks per-user, per-board important ticket markers. After each sync, `src/services/activitySync.ts` compares watched issue statuses against a stored snapshot and creates `ActivityNotification` records for any changes.

Run migrations with:
```bash
cd dashboard/backend
npx prisma migrate dev --name <migration-name>
```

---

## Configuration

### Risk thresholds

Risk signals are passed as query parameters to analytics endpoints. No threshold is hardcoded.

```
GET /api/projects/:id/kanban/issues?staleDays=14&watchedStates=In%20Progress,Review
```

| Parameter | Default | Description |
|---|---|---|
| `staleDays` | `7` | Days since last update before an issue is flagged as stale |
| `watchedStates` | `[]` | Status states to include in stale detection (empty = all states) |

Stale detection settings are configurable per board from the UI via the Stale Settings modal on the board page. Settings are stored in `localStorage` and sent as query parameters on each request.

### Sync schedule

The cron schedule is defined in `dashboard/backend/src/index.ts`:

```typescript
cron.schedule('0 * * * *', () => executeFullSync());
```

Change the cron expression to adjust sync frequency.

---

## API Reference

### Health and status

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Liveness probe |
| `GET` | `/api/status` | Last sync time and sync status |
| `GET` | `/api/sync` | Last successful sync timestamp |
| `GET` | `/api/sync/progress` | Live sync progress |
| `GET` | `/api/config` | Frontend configuration (workspace name) |
| `POST` | `/api/sprints/sync` | Trigger a manual sync (fire-and-forget) |

### Projects

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/projects` | All projects with board type and display order |
| `GET` | `/api/projects/:id` | Single project detail |
| `POST` | `/api/projects/sync` | Sync project list from Zoho |
| `PATCH` | `/api/projects/:id/board-type` | Update project board type |
| `PATCH` | `/api/projects/:id/display` | Update display settings (hidden, order) |
| `POST` | `/api/projects/reorder` | Batch update display order |
| `GET` | `/api/projects/:id/kanban/issues` | Kanban board issues |
| `GET` | `/api/projects/:id/kanban-user-stats` | Kanban user workload stats |
| `GET` | `/api/projects/:id/kanban-raiser-stats` | Kanban ticket raiser stats |
| `GET` | `/api/projects/:id/kanban/stale-count` | Kanban stale ticket count |
| `GET` | `/api/projects/:id/sprints/:sprintId/issues` | Sprint issues with health metrics |
| `GET` | `/api/projects/:id/sprints/:sprintId/epics` | Sprint epic breakdown |
| `GET` | `/api/projects/:id/sprints/:sprintId/user-stats` | Sprint user workload stats |
| `GET` | `/api/projects/:id/sprints/:sprintId/raiser-stats` | Sprint ticket raiser stats |
| `GET` | `/api/projects/:id/backlog/issues` | Backlog issues |
| `GET` | `/api/projects/:id/backlog-stats` | Backlog summary stats |

### Issues

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/issues/:issueId` | Single issue by Zoho ID |

### Sprints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/sprints` | All sprints (active and past) |
| `GET` | `/api/sprints/:sprintZohoId/burndown` | Burndown chart data points |
| `GET` | `/api/sprints/debug/:projectId` | Debug sprint data for a project |
| `POST` | `/api/sprints/fetch-past` | Fetch historical data for a past sprint |
| `PATCH` | `/api/sprints/:id/display` | Update sprint display settings (hidden) |

### Users

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/users` | All users |
| `GET` | `/api/users/:id/profile` | User profile with issue breakdown |
| `GET` | `/api/users/:id/sprint-history` | User sprint history |
| `POST` | `/api/users/sync` | Sync users from Zoho |
| `PATCH` | `/api/users/:id/role` | Set user role (`DEV`/`QA`/`PROD`/`OTHER`) |

### Team

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/team/load` | Aggregate team workload metrics |

### Watchlist

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/watchlist` | List watched issues (filter by `boardId`, `userId`) |
| `POST` | `/api/watchlist` | Add issue to watchlist (upsert) |
| `PATCH` | `/api/watchlist/:issueId/toggle-important` | Toggle importance flag |
| `DELETE` | `/api/watchlist/:issueId` | Remove from watchlist |

### Notes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/notes` | List notes (filter by `userId`, `state`) |
| `POST` | `/api/notes` | Create a note |
| `GET` | `/api/notes/:noteId` | Fetch a single note |
| `PATCH` | `/api/notes/:noteId` | Update a note |
| `DELETE` | `/api/notes/:noteId` | Delete a note |
| `GET` | `/api/notes/with-deadlines` | Notes with deadlines (includes `isOverdue`) |
| `GET` | `/api/notes/search-users` | Search users for @mentions |
| `GET` | `/api/notes/search-issues` | Search issues for linking |

### Deadlines

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/deadlines` | List deadlines (filter by `userId`, `boardId`) |
| `POST` | `/api/deadlines` | Create a deadline |
| `PATCH` | `/api/deadlines/:deadlineId` | Update a deadline |
| `DELETE` | `/api/deadlines/:deadlineId` | Delete a deadline |
| `GET` | `/api/deadlines/combined` | Combined deadlines + note deadlines, sorted by due date |
| `GET` | `/api/deadlines/upcoming` | Upcoming deadlines within N hours |

### Activity

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/activity/notifications` | Fetch notifications (filter by `userId`, `read`) |
| `PATCH` | `/api/activity/notifications/:id/read` | Mark notification as read |
| `DELETE` | `/api/activity/notifications` | Clear all read notifications |
| `GET` | `/api/activity/summary` | Summary counts (unread, upcoming deadlines, important issues) |

---

## Frontend Pages

| Route | Page | Description |
|---|---|---|
| `/` | Home | Overview dashboard with key metrics |
| `/users` | Users | Team list with role filtering |
| `/users/:userId` | User Profile | Per-developer issue breakdown and sprint history |
| `/projects` | Projects | Project list with board type controls, drag-and-drop reorder, hide/show |
| `/board/:projectId` | Board | Kanban/Scrum board view with epic breakdown and stale config |
| `/board/:projectId/issues` | Issue List | Detailed issue table for a project |
| `/backlog/:projectId` | Backlog | Project backlog view |
| `/sprints` | Sprint Health | Sprint burndown, health metrics, and past sprint loading |
| `/activity` | Activity | Activity feed with notifications |
| `/notes` | Notes | Notes list and editor |
| `/notes/new` | New Note | Create a new note |
| `/notes/:noteId` | Edit Note | Edit an existing note |
| `/deadlines` | Deadlines | Deadline tracker |
| `/watchlist` | Watchlist | Watched important tickets |
| `/notifications` | Notifications | Notification center |

---

## Project Structure

```
Zonaliser/
├── dashboard/
│   ├── backend/
│   │   ├── src/
│   │   │   ├── api/
│   │   │   │   ├── router.ts            # Route mounting
│   │   │   │   └── routes/              # One file per route group
│   │   │   │       ├── activity.ts       # Notifications and activity summary
│   │   │   │       ├── appConfig.ts      # Frontend config (workspace name)
│   │   │   │       ├── burndown.ts       # Burndown chart data
│   │   │   │       ├── deadlines.ts      # Deadline CRUD + combined view
│   │   │   │       ├── health.ts         # Liveness probe
│   │   │   │       ├── issues.ts         # Single issue fetch
│   │   │   │       ├── notes.ts          # Notes CRUD + search
│   │   │   │       ├── projects.ts       # Project queries, kanban, backlog, sprints
│   │   │   │       ├── sprints.ts        # Sprint list, sync, past sprint fetch
│   │   │   │       ├── status.ts         # Zoho connectivity check
│   │   │   │       ├── syncStatus.ts     # Sync timestamp and progress
│   │   │   │       ├── team.ts           # Aggregate team load
│   │   │   │       ├── users.ts          # User profile, sprint history, sync
│   │   │   │       └── watchlist.ts      # Watchlist CRUD + importance toggle
│   │   │   ├── config/                  # Environment variable loading
│   │   │   ├── db/                      # Prisma client singleton
│   │   │   ├── services/
│   │   │   │   ├── activitySync.ts       # Post-sync notification logic for watched tickets
│   │   │   │   ├── burndownSnapshots.ts  # Burndown history
│   │   │   │   ├── issueQueries.ts       # DB-only query layer (all runtime routes use this)
│   │   │   │   ├── rateLimiter.ts        # Zoho rate limiter (25 req/60s)
│   │   │   │   ├── syncStatus.ts         # Last-synced-at tracking
│   │   │   │   ├── zohoAuth.ts           # OAuth refresh token flow
│   │   │   │   ├── zohoProjects.ts       # Project list sync
│   │   │   │   ├── zohoSprints.ts        # Sprint/issue fetchers and sync engine
│   │   │   │   ├── zohoTeams.ts          # Team sync
│   │   │   │   └── zohoUsers.ts          # User sync
│   │   │   └── index.ts                 # Entry point: bootstrap, Express, cron
│   │   ├── prisma/
│   │   │   ├── schema.prisma            # Database schema
│   │   │   └── dev.db                   # SQLite database file (gitignored)
│   │   └── package.json
│   └── frontend/
│       ├── src/
│       │   ├── api/client.ts            # All backend fetch calls go through here
│       │   ├── pages/                   # One file per route
│       │   │   ├── ActivityPage.tsx      # Activity feed
│       │   │   ├── BacklogPage.tsx       # Project backlog
│       │   │   ├── BoardPage.tsx         # Kanban/Scrum board
│       │   │   ├── DeadlinesPage.tsx     # Deadline tracker
│       │   │   ├── Home.tsx              # Dashboard overview
│       │   │   ├── IssueListPage.tsx     # Issue table
│       │   │   ├── NotesPage.tsx         # Notes list/editor
│       │   │   ├── NotificationsPage.tsx # Notification center
│       │   │   ├── Projects.tsx          # Project list
│       │   │   ├── SprintHealth.tsx      # Sprint health + past sprints
│       │   │   ├── UserProfilePage.tsx   # User profile
│       │   │   ├── Users.tsx             # User list
│       │   │   └── WatchlistPage.tsx     # Watched tickets
│       │   ├── components/              # Shared UI components and charts
│       │   ├── contexts/                # SyncProgressContext
│       │   └── types/                   # Shared TypeScript types
│       ├── vite.config.ts              # Proxies /api/* to localhost:3001
│       └── package.json
├── docs/                               # Architecture and schema documentation
└── .github/                            # Copilot instructions
```

---

## Known Limitations

- **Empty state on first run** — the dashboard shows no data until the first sync completes (~5 minutes). This is expected.
- **Cold start proxy errors** — if the frontend loads before the backend is ready, Vite logs `ECONNREFUSED`. This resolves once the backend starts.
- **No `.env` file support** — credentials must be exported from the shell environment. The backend does not call `dotenv`.
- **Stale data window** — issues can be up to 1 hour old between scheduled syncs. Trigger a manual sync if fresher data is needed.
- **No automated test suite** — validation is currently done via `tsx watch` and manual UI verification.
- **CORS locked to `localhost:5173`** — change in `src/index.ts` if using a different frontend origin.