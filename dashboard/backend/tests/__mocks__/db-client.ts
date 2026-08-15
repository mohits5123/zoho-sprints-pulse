/**
 * In-memory Prisma mock for tests.
 *
 * Each model is represented by a Map keyed by whatever the production
 * code uses as the primary key (`zohoId` for core models, generated
 * `id` for local-only ones). Tests call {@link resetMockPrisma} in
 * `beforeEach` and then seed fixtures using {@link seed}.
 *
 * This intentionally supports only the surface area used by the route
 * handlers: `findMany`, `findUnique`, `findFirst`, `create`, `update`,
 * `upsert`, and `delete`. Adding more methods is straightforward but
 * we avoid pulling in a heavier abstraction (e.g. prisma-mock) to keep
 * the dependency footprint minimal.
 */
import { randomUUID } from 'node:crypto';

type Store = Map<string, Record<string, unknown>>;

interface MockState {
  user: Store;
  project: Store;
  sprint: Store;
  epic: Store;
  issue: Store;
  note: Store;
  deadline: Store;
  deadlineGroup: Store;
  watchlist: Store;
  activityNotification: Store;
  settings: Store;
  burndownSnapshot: Store;
}

function emptyStore(): Store {
  return new Map();
}

function createState(): MockState {
  return {
    user: emptyStore(),
    project: emptyStore(),
    sprint: emptyStore(),
    epic: emptyStore(),
    issue: emptyStore(),
    note: emptyStore(),
    deadline: emptyStore(),
    deadlineGroup: emptyStore(),
    watchlist: emptyStore(),
    activityNotification: emptyStore(),
    settings: emptyStore(),
    burndownSnapshot: emptyStore(),
  };
}

/**
 * Mutable state shared between every Prisma model mock. Tests replace
 * this wholesale via {@link resetMockPrisma}.
 */
export const state: MockState = createState();

/**
 * Reset every store. Called from `beforeEach` in test files.
 */
export function resetMockPrisma(): void {
  for (const key of Object.keys(state) as Array<keyof MockState>) {
    state[key].clear();
  }
}

/**
 * Insert a fixture into the named store. Returns the fixture for
 * chaining. The `__key` property overrides the auto-derived key when
 * you need to use a value other than the model primary key.
 */
export function seed<K extends keyof MockState>(
  model: K,
  fixture: Record<string, unknown>,
  key?: string,
): Record<string, unknown> {
  const k = key ?? String(fixture.zohoId ?? fixture.id ?? randomUUID());
  state[model].set(k, { ...fixture });
  return state[model].get(k)!;
}

/**
 * Build a Prisma-shaped delegate that reads from and writes to the
 * given store. `where` clauses are interpreted loosely — we support
 * equality matches, `{ not: null }`, and `{ contains }` for substring
 * searches because those cover every route handler in the app.
 */
function makeDelegate(store: Store): Record<string, unknown> {
  function match(row: Record<string, unknown>, where?: Record<string, unknown>): boolean {
    if (!where) return true;
    for (const [key, expected] of Object.entries(where)) {
      if (expected && typeof expected === 'object' && 'not' in expected) {
        const actual = row[key];
        if (expected.not === null) {
          if (actual === null || actual === undefined) return false;
        } else {
          if (actual === expected.not) return false;
        }
        continue;
      }
      if (expected && typeof expected === 'object' && 'contains' in expected) {
        const actual = row[key];
        if (typeof actual !== 'string' || !actual.includes(String((expected as { contains: string }).contains))) {
          return false;
        }
        continue;
      }
      if (row[key] !== expected) return false;
    }
    return true;
  }

  return {
    async findMany(args: { where?: Record<string, unknown>; orderBy?: Record<string, 'asc' | 'desc'>; take?: number; select?: Record<string, boolean> } = {}) {
      let rows = Array.from(store.values()).filter((r) => match(r, args.where));
      if (args.orderBy) {
        const [field, dir] = Object.entries(args.orderBy)[0];
        rows = rows.slice().sort((a, b) => {
          const av = a[field];
          const bv = b[field];
          if (av === bv) return 0;
          if (av === undefined || av === null) return 1;
          if (bv === undefined || bv === null) return -1;
          return (av < bv ? -1 : 1) * (dir === 'desc' ? -1 : 1);
        });
      }
      if (args.take) rows = rows.slice(0, args.take);
      if (args.select) {
        return rows.map((r) => {
          const out: Record<string, unknown> = {};
          for (const k of Object.keys(args.select!)) out[k] = r[k];
          return out;
        });
      }
      return rows;
    },
    /** Prisma's aggregate count is used by activity and dashboard summaries. */
    async count({ where }: { where?: Record<string, unknown> } = {}) {
      return Array.from(store.values()).filter((row) => match(row, where)).length;
    },
    async findUnique({ where }: { where: Record<string, unknown> }) {
      const [field, value] = Object.entries(where)[0];
      return store.get(String(value)) ?? null;
    },
    async findFirst({ where }: { where?: Record<string, unknown> } = {}) {
      return Array.from(store.values()).find((r) => match(r, where)) ?? null;
    },
    async create({ data }: { data: Record<string, unknown> }) {
      const key = String(data.zohoId ?? data.id ?? randomUUID());
      const row = { ...data };
      store.set(key, row);
      return row;
    },
    async update({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
      const [field, value] = Object.entries(where)[0];
      const key = String(value);
      const existing = store.get(key);
      if (!existing) throw new Error('RecordNotFound');
      const next = { ...existing, ...data };
      store.set(key, next);
      return next;
    },
    async upsert({ where, create, update }: { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown> }) {
      const [field, value] = Object.entries(where)[0];
      const key = String(value);
      const existing = store.get(key);
      if (existing) {
        const next = { ...existing, ...update };
        store.set(key, next);
        return next;
      }
      const row = { ...create };
      store.set(key, row);
      return row;
    },
    async delete({ where }: { where: Record<string, unknown> }) {
      const [field, value] = Object.entries(where)[0];
      const key = String(value);
      if (!store.has(key)) throw new Error('RecordNotFound');
      store.delete(key);
      return { [field]: value };
    },
    async deleteMany({ where }: { where?: Record<string, unknown> } = {}) {
      let n = 0;
      for (const [k, v] of Array.from(store.entries())) {
        if (match(v, where)) {
          store.delete(k);
          n++;
        }
      }
      return { count: n };
    },
  };
}

/**
 * Build the top-level Prisma client shape. Tests import this in place
 * of `db/client` via the `vi.mock` factory below.
 */
export function buildMockPrisma() {
  return {
    user: makeDelegate(state.user),
    project: makeDelegate(state.project),
    sprint: makeDelegate(state.sprint),
    epic: makeDelegate(state.epic),
    issue: makeDelegate(state.issue),
    note: makeDelegate(state.note),
    deadline: makeDelegate(state.deadline),
    deadlineGroup: makeDelegate(state.deadlineGroup),
    watchlist: makeDelegate(state.watchlist),
    activityNotification: makeDelegate(state.activityNotification),
    settings: makeDelegate(state.settings),
    burndownSnapshot: makeDelegate(state.burndownSnapshot),
    $queryRawUnsafe: async () => [],
  };
}
