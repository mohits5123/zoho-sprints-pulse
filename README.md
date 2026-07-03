# Zonaliser

Zonaliser is a local-first, read-only engineering analytics dashboard built on top of [Zoho Sprints](https://www.zoho.com/sprints). It gives engineering managers a single pane of glass into sprint health, developer workload, ticket aging, and delivery risk — running entirely on a local machine with no cloud dependency and no auth wall.

All data is cached locally in SQLite. Zoho is only contacted during scheduled background syncs. Every page load reads from the local database with zero live API calls.

---

## Features

**Developer workload**
View per-developer open issue counts, WIP distribution, and overdue work. Role labels (DEV / QA / PROD / OTHER) are set locally and not sourced from Zoho.

**Sprint health**
Per-sprint burndown charts built from historical snapshots. See completed vs. remaining work over time.

**Board view**
Visual Kanban/Scrum board grouped by status bucket (To Do / In Progress / Done). Issues are grouped per the project's custom status map synced from Zoho.

**Backlog view**
Project-level backlog with filtering by status, assignee, and staleness.

**Issue list**
Filterable, sortable issue table per project with computed staleness and delay indicators.

**Aging and risk detection**
Issues are flagged at query time using configurable thresholds:

| Signal | Default threshold |
|---|---|
| Stale issue | No update for 7 days |
| Delayed issue | Past target date and not closed |

Thresholds are passed as query parameters and are never hardcoded.

**Sync progress**
A persistent progress bar tracks the active sync and displays live status. Manual sync can be triggered from the UI or via `POST /api/sprints/sync`.

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

Sync (cron every 1 hours, or manual POST):
  Express → Zoho Sprints API (rate-limited) → SQLite
```

All analytics endpoints read exclusively from the local SQLite database. The Zoho API client is only invoked by the sync engine, which runs on a cron schedule (`0 * * * *`) or when manually triggered.

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

Six models: `User`, `Project`, `Sprint`, `Epic`, `Issue`, `BurndownSnapshot`, plus a `Settings` key-value table.

Computed fields (`isStale`, `delayedDays`) are not stored. They are calculated in JavaScript from `createdAt` and `endDate` at query time inside `src/services/issueQueries.ts`.

`Issue.assigneeIds` is stored as a JSON string (`'["zohoId1","zohoId2"]'`). User-filter queries use SQLite's `json_each()` function. Treat it as opaque text — not a native array.

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
GET /api/projects/:id/issues?staleDays=14
```

| Parameter | Default | Description |
|---|---|---|
| `staleDays` | `7` | Days since last update before an issue is flagged as stale |

### Sync schedule

The cron schedule is defined in `dashboard/backend/src/index.ts`:

```typescript
cron.schedule('0 * * * *', runFullSync);
```

Change the cron expression to adjust sync frequency.

---

## API Reference

### Health and status

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Liveness probe |
| `GET` | `/api/status` | Last sync time and sync status |
| `GET` | `/api/sync-status` | Live sync progress |
| `POST` | `/api/sprints/sync` | Trigger a manual sync (fire-and-forget) |

### Projects

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/projects` | All projects with board type and display order |
| `PATCH` | `/api/projects/:id/board-type` | Update project board type |
| `PATCH` | `/api/projects/:id/display-order` | Update display order |
| `PATCH` | `/api/projects/:id/hidden` | Toggle project visibility |
| `GET` | `/api/projects/:id/issues` | Issues filtered by assignee, status, staleness |
| `GET` | `/api/projects/:id/burndown` | Burndown chart data points |
| `GET` | `/api/projects/:id/team/teamload` | Team workload distribution |

### Sprints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/sprints/:id/issues` | Sprint issues with health metrics |

### Users

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/users` | All users |
| `GET` | `/api/users/:id` | User details |
| `PATCH` | `/api/users/:id/role` | Set user role (`DEV`/`QA`/`PROD`/`OTHER`) |

### Team

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/team/workload/:projectId` | Developer workload by project |

---

## Frontend Pages

| Route | Page | Description |
|---|---|---|
| `/` | Home | Overview dashboard with key metrics |
| `/users` | Users | Team list with role filtering |
| `/users/:userId` | User Profile | Per-developer issue breakdown |
| `/projects` | Projects | Project list with board type controls |
| `/board/:projectId` | Board | Kanban/Scrum board view |
| `/board/:projectId/issues` | Issue List | Detailed issue table for a project |
| `/backlog/:projectId` | Backlog | Project backlog view |
| `/sprints` | Sprint Health | Sprint burndown and health metrics |

---

## Project Structure

```
Zonaliser/
├── dashboard/
│   ├── backend/
│   │   ├── src/
│   │   │   ├── api/
│   │   │   │   └── routes/        # One file per route group
│   │   │   ├── config/            # Environment variable loading
│   │   │   ├── db/                # Prisma client singleton
│   │   │   ├── services/
│   │   │   │   ├── issueQueries.ts        # DB-only query layer (all runtime routes use this)
│   │   │   │   ├── rateLimiter.ts         # Zoho rate limiter (25 req/60s)
│   │   │   │   ├── zohoAuth.ts            # OAuth refresh token flow
│   │   │   │   ├── zohoSprints.ts         # Zoho fetchers and sync engine
│   │   │   │   ├── zohoProjects.ts        # Project list sync
│   │   │   │   ├── zohoUsers.ts           # User sync
│   │   │   │   ├── burndownSnapshots.ts   # Burndown history
│   │   │   │   └── syncStatus.ts          # Last-synced-at tracking
│   │   │   └── index.ts           # Entry point: bootstrap, Express, cron
│   │   ├── prisma/
│   │   │   ├── schema.prisma      # Database schema
│   │   │   └── dev.db             # SQLite database file (gitignored)
│   │   └── package.json
│   └── frontend/
│       ├── src/
│       │   ├── api/client.ts      # All backend fetch calls go through here
│       │   ├── pages/             # One file per route
│       │   ├── components/        # Shared UI components and charts
│       │   ├── contexts/          # SyncProgressContext
│       │   └── types/             # Shared TypeScript types
│       ├── vite.config.ts         # Proxies /api/* to localhost:3001
│       └── package.json
├── docs/                          # Architecture and schema documentation
└── .github/                       # Copilot instructions
```

---

## Known Limitations

- **Empty state on first run** — the dashboard shows no data until the first sync completes (~5 minutes). This is expected.
- **Cold start proxy errors** — if the frontend loads before the backend is ready, Vite logs `ECONNREFUSED`. This resolves once the backend starts.
- **No `.env` file support** — credentials must be exported from the shell environment. The backend does not call `dotenv`.
- **Stale data window** — issues can be up to 1 hour old between scheduled syncs. Trigger a manual sync if fresher data is needed.
- **No automated test suite** — validation is currently done via `tsx watch` and manual UI verification.
- **CORS locked to `localhost:5173`** — change in `src/index.ts` if using a different frontend origin.