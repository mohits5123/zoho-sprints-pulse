# Zonaliser - Engineering Delivery Intelligence Dashboard

A local-first, read-only analytics dashboard for engineering teams powered by [Zoho Sprints](https://www.zoho.com/sprints). Track sprint health, ticket staleness, developer workload, and team bottlenecks entirely offline.

## 🎯 Purpose

Zonaliser provides engineering managers with visibility into:
- **Sprint health** - Burndown charts, sprint velocity, completion rates
- **Ticket aging** - Detect stale issues and aging bugs
- **Developer load** - Who's overloaded, who has capacity
- **Team bottlenecks** - Identify blocked work and delays

Runs entirely on your local machine — no cloud sync, no auth wall.

## 🏗️ Architecture

### Local-First Design
All data is cached locally in SQLite. Zoho Sprints API is only contacted during scheduled syncs:

```
Browser → Vite Dev Server (port 5173) → Express Backend (port 3001) → SQLite
                                                ↓
                                          (every 3 hours)
                                              ↓
                                         Zoho Sprints API
```

### Tech Stack

**Backend (Node.js/TypeScript)**
- Express.js API server
- Prisma ORM with SQLite database
- Cron jobs for automated syncs (every 3 hours)
- Rate-limited Zoho API client (25 req/min max to avoid lockouts)

**Frontend (React + Vite)**
- React 18 with TypeScript
- Custom SVG charts (no charting libraries)
- React Router for navigation
- Pure inline styles (no CSS frameworks)

## 📊 Data Models

The local database tracks:
- **Users** - Team members with Zoho IDs and roles (DEV/QA/PROD/OTHER)
- **Projects** - Boards with custom status maps and sprint assignments
- **Sprints** - Timeboxed iterations with health metrics
- **Epics** - Epics grouping related issues
- **Issues** - Tasks, bugs, stories with assignees and dates
- **Burndown Snapshots** - Historical progress tracking

### Computed Fields (not stored)
- `isStale` - Issue age exceeds threshold (default 7 days)
- `delayedDays` - Days past target date if not closed

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- Zoho Sprints account with API access

### Setup

1. **Configure environment variables** (add to `~/.zshrc`):
   ```bash
   export ZOHO_CLIENT_ID="your-client-id"
   export ZOHO_CLIENT_SECRET="your-secret"
   export ZOHO_REFRESH_TOKEN="your-refresh-token"
   ```

2. **Install dependencies**:
   ```bash
   cd dashboard/backend && npm install
   cd ../frontend && npm install
   ```

3. **Run the application**:
   
   Terminal 1 (Backend):
   ```bash
   cd dashboard/backend
   npm run dev
   # API running at http://localhost:3001
   ```

   Terminal 2 (Frontend):
   ```bash
   cd dashboard/frontend
   npm run dev
   # Frontend running at http://localhost:5173
   ```

4. **Trigger first sync**:
   - Manual sync via API: `POST /api/sprints/sync` or UI button
   - Auto-sync runs every 3 hours (cron)

**First sync takes ~4 minutes** for teams with 80-93 issues. Subsequent runs are incremental.

## 📡 API Reference

### Health & Status
- `GET /api/health` - Liveness probe
- `GET /api/status` - Sync status, last sync time

### Data Endpoints
- `GET /api/users/:id` - User details with issue counts
- `GET /api/projects` - All projects with board type and display order
- `POST /api/sprints/sync` - Manual trigger for data sync
- `GET /api/team/workload/:projectId` - Developer load by project
- `POST /api/projects/teams/:id/reassign-user` - Reassign issues

### Analytics (Local-only, no Zoho calls)
All data routes read from SQLite:

- `GET /api/projects/:id/issues` - Issues filtered by assigneeIds, status
- `GET /api/sprints/:id/issues` - Sprint issues with health metrics
- `GET /api/projects/:id/burndown` - Burndown chart data points
- `GET /api/projects/:id/team/teamload` - Team workload distribution

## 🎨 Frontend Routes

Seven main pages:
- `/` - Dashboard with key metrics
- `/users` - User list and filtering (by role)
- `/projects` - Project board management
-BoardPage - Visual project boards with drag-and-drop status changes
- `/issues` - Full issue list with filtering/sorting
- `/sprint/:id/health` - Sprint health and burndown chart

## 🛠️ Development

### Backend
```bash
cd dashboard/backend
npm run dev          # Start dev server with tsx watch
npm run build        # Production build
npm start            # Run production binary
```

### Frontend  
```bash
cd dashboard/frontend
npm run dev          # Start Vite dev server (proxies /api/* → :3001)
npm run build        # Production build
npm run preview      # Preview production build
```

## 🔒 Security & Best Practices

### Rate Limiting
- Zoho API: 25 requests per 60-second sliding window
- Enforced via `src/services/rateLimiter.ts`
- **Critical**: All Zoho API calls must use the rate limiter to avoid team-wide lockouts

### Security
- Environment variables in `~/.zshrc` (NOT `.env` files)
- CORS limited to `http://localhost:5173` in dev mode
- Read-only API access (no write operations to Zoho)

### Database
- SQLite file: `dashboard/backend/prisma/dev.db`
- Migrations via Prisma: `npx prisma migrate dev --name <name>`

## 🧑‍💻 Customization

### Risk Thresholds
Configure detection thresholds in route query params:
- `staleDays` - Days before issue is marked stale (default: 7)
- Custom thresholds for bug aging, WIP limits, delayed stories

Example: `GET /api/projects/:id/issues?staleDays=14&bugStaleDays=2`

### Sync Schedule
Edit cron schedule in `src/index.ts`:
```typescript
cron.schedule('0 */3 * * *', () => { /* runs every 3 hours */ })
```

## 📁 Project Structure

```
Zonaliser/
├── dashboard/
│   ├── backend/                   # Express API server (Node.js)
│   │   ├── src/
│   │   │   ├── services/          # Zoho fetchers, sync logic
│   │   │   ├── api/                # API routes
│   │   │   └── index.ts            # Entry point, bootstrap
│   │   ├── prisma/                 # Database schema & migrations
│   │   └── package.json
│   └── frontend/                   # React SPA (Vite)
│       ├── src/
│       │   ├── pages/              # React Router pages
│       │   ├── components/         # Reusable UI components
│       │   └── api/client.ts       # API client with axios
│       └── package.json
├── .github/                       # GitHub workflows, actions
├── .gitignore                     # Git ignore patterns
└── README.md                      # This file
```

## 🐛 Known Issues & Gotchas

1. **First run shows empty data** - Wait ~4 minutes for sync to complete
2. **CORS errors during startup** - Normal on cold start, resolves after backend starts
3. **.env file not loaded by backend** - All env vars must be in shell (`~/.zshrc`)
4. **Stale data window** - Issues max 3 hours old between syncs

## 📝 Data Flow Summary

1. **Sync** (every 3 hours or manual):
   - Backend contacts Zoho Sprints API (rate-limited)
   - Fetches projects, sprints, users, issues
   - Upserts into local SQLite via Prisma

2. **Runtime** (every page load):
   - Frontend requests data via `/api/*` routes
   - Backend proxies to SQLite (zero Zoho calls)
   - Returns cached analytics from local DB

3. **No data = no Zoho calls** - The backend never queries live Zoho during normal operation

---

**Built with ❤️ for engineering teams using Zoho Sprints**