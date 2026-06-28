/**
 * User profile page component.
 *
 * Displays a detailed profile view for a specific team member, including:
 * - Header with avatar, name, email, and role badge
 * - Snapshot stats: total, todo, doing, done, stale, overdue, raised tickets
 * - Status distribution (bar chart of active issue statuses)
 * - Raised vs Assigned comparison (raised tickets vs assigned to user)
 * - Collaboration score (percentage of tickets co-worked)
 * - Stale tickets list (issues over staleDays threshold)
 * - Overdue tickets list (issues past target date, not done)
 * - Sprint history (last N sprints with assigned/done/completion metrics)
 * - Tickets raised this sprint (with status badges)
 *
 * Features:
 * - Click on any issue to navigate to filtered issue list
 * - Stale threshold configurable (default 7 days)
 * - Role-based avatar colors (DEV/QA/PROD/OTHER)
 * - Empty states for missing data
 * - Loading and error states
 *
 * Data flows:
 * - Profile data fetched from local SQLite via backend
 * - Sprint history fetched independently
 * - Navigation to issues page with filter params
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  fetchUserProfile, fetchUserSprintHistory,
  type ProfileIssue, type UserProfileResponse, type SprintHistoryItem,
} from '../api/client';
import { roleColor } from '../components/UserAvatar';

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Extracts the first two letters of a person's name (one from each word)
 * and uppercases them. Used to generate avatar initials.
 *
 * @param name - Full name string (e.g., "Jane Doe")
 * @returns Uppercase initials (e.g., "JD")
 */
function initials(name: string) {
  return name.split(' ').slice(0, 2).map((n) => n[0] ?? '').join('').toUpperCase();
}

/**
 * Formats an ISO date string into a human-readable locale date.
 * Returns '—' for null/undefined input.
 *
 * @param d - ISO date string or null
 * @returns Formatted date string (e.g., "Jan 15, 2025") or '—'
 */
function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Computes how many whole days have elapsed since the given ISO date.
 * Returns 0 for null/undefined input.
 *
 * @param iso - ISO date string or null
 * @returns Number of days elapsed (floor)
 */
function daysAgo(iso: string | null): number {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

// ── Stat pill ─────────────────────────────────────────────────────────────────

/**
 * A small stat display component showing a numeric value with a label underneath.
 * Used throughout the profile page for snapshot metrics (total, todo, done, etc.).
 *
 * @param value - The numeric or string value to display prominently
 * @param label - Descriptive label shown below the value (uppercase, smaller)
 * @param color - Text color; defaults to slate gray (#94a3b8)
 */
function StatPill({ value, label, color = '#94a3b8' }: { value: number | string; label: string; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <span style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' as const }}>{value}</span>
      <span style={{ fontSize: 10, color: '#475569', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em', whiteSpace: 'nowrap' as const }}>{label}</span>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

/**
 * A styled container that wraps a named section within the analytics grid.
 * Each section gets a dark card background with an uppercase section title.
 *
 * @param title - Section heading displayed in small uppercase text
 * @param children - Content rendered inside the card
 * @param span - Number of grid columns to span (default: 1); ranges up to 4
 */
function Section({ title, children, span = 1 }: { title: string; children: React.ReactNode; span?: number }) {
  return (
    <div style={{ gridColumn: `span ${span}`, backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>{title}</p>
      {children}
    </div>
  );
}

// ── Status Distribution (2.6) ─────────────────────────────────────────────────

/**
 * Renders a horizontal bar chart showing the count of issues grouped by their
 * status (todo, doing, etc.), excluding issues in the "done" state.
 *
 * The bars are sorted by count descending. Issues in the "done" group are
 * intentionally hidden (transparent color) since this view focuses on active work.
 *
 * @param issues - The full set of issues for the user; only non-done statuses are visualized
 */
function StatusDistribution({ issues }: { issues: ProfileIssue[] }) {
  // 1. Filter for active statuses (exclude 'done' by default)
  const activeIssues = issues.filter((i) => i.statusGroup !== 'done');

  // 2. Calculate counts only from active issues
  const counts = activeIssues.reduce<Record<string, number>>((m, i) => {
    m[i.status] = (m[i.status] ?? 0) + 1;
    return m;
  }, {});

  // Define colors and ensure 'done' is visually disabled for this specific visualization type
  const GROUP_COLOR: Record<string, string> = { todo: '#64748b', doing: '#3b82f6', done: 'transparent', unknown: '#475569' };

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...sorted.map(([, v]) => v), 1);

  if (sorted.length === 0 && issues.some((i) => i.statusGroup !== 'done')) {
      // Fallback case: If we filtered everything out but the original set had active issues
       return <p style={{ margin: 0, fontSize: 13, color: '#475569' }}>No active status breakdown available.</p>;
  } else if (sorted.length === 0) {
    return <p style={{ margin: 0, fontSize: 13, color: '#475569' }}>No issues found in the analyzed scope.</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {sorted.map(([status, count]) => {
        // Find which group this status belongs to and get its color
        const issue = issues.find((i) => i.status === status);
        const color = GROUP_COLOR[issue?.statusGroup ?? 'unknown'];

        // If the calculated color is transparent, skip rendering this segment
        if (!color || color === 'transparent') return null;

        return (
          <div key={status} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 28px', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{status}</span>
            <div style={{ height: 6, borderRadius: 3, backgroundColor: '#0f172a', overflow: 'hidden' }}>
              <div style={{ width: `${(count / max) * 100}%`, height: '100%', backgroundColor: color, borderRadius: 3, transition: 'width 0.4s' }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const }}>{count}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Raised vs Assigned (2.7) ──────────────────────────────────────────────────

/**
 * Compares how many tickets are assigned to the user versus how many they created.
 * Displays both a side-by-side stat pill view and proportional bar charts.
 *
 * @param assigned - Number of tickets assigned to the user
 * @param raised   - Number of tickets created (raised) by the user
 */
function RaisedVsAssigned({ assigned, raised }: { assigned: number; raised: number }) {
  const total = Math.max(assigned, raised, 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-around' }}>
        <StatPill value={assigned} label="Assigned" color="#3b82f6" />
        <div style={{ width: 1, backgroundColor: '#334155' }} />
        <StatPill value={raised}   label="Raised"   color="#a855f7" />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#475569', width: 60 }}>Assigned</span>
          <div style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: '#0f172a', overflow: 'hidden' }}>
            <div style={{ width: `${(assigned / total) * 100}%`, height: '100%', backgroundColor: '#3b82f6', borderRadius: 3 }} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#475569', width: 60 }}>Raised</span>
          <div style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: '#0f172a', overflow: 'hidden' }}>
            <div style={{ width: `${(raised / total) * 100}%`, height: '100%', backgroundColor: '#a855f7', borderRadius: 3 }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Collaboration (2.9) ───────────────────────────────────────────────────────

/**
 * Displays the user's collaboration score — the percentage of their tickets
 * that were co-worked with others. Shows a progress bar and a qualitative
 * label: "Highly collaborative" (≥50%), "Moderate collaboration" (≥25%),
 * or "Mostly solo work" (<25%).
 *
 * @param total  - Total number of tickets for the user
 * @param collab - Number of tickets that were co-worked
 */
function CollaborationScore({ total, collab }: { total: number; collab: number }) {
  const pct = total > 0 ? Math.round((collab / total) * 100) : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <StatPill value={`${pct}%`} label="Co-worked" color="#06b6d4" />
        <span style={{ fontSize: 12, color: '#475569' }}>{collab} of {total} tickets</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, backgroundColor: '#0f172a', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', backgroundColor: '#06b6d4', borderRadius: 4, transition: 'width 0.4s' }} />
      </div>
      <p style={{ margin: 0, fontSize: 12, color: '#475569' }}>
        {pct >= 50 ? 'Highly collaborative' : pct >= 25 ? 'Moderate collaboration' : 'Mostly solo work'}
      </p>
    </div>
  );
}

// ── Issue row ─────────────────────────────────────────────────────────────────

/**
 * A single interactive row representing an issue in list sections (stale, overdue,
 * raised tickets). Shows the issue number, title, sprint name, and an optional
 * colored badge. Clicking navigates to a filtered issue list.
 *
 * @param issue      - The issue to display (item number, title, sprint info)
 * @param badge      - Optional label shown as a colored tag (e.g., "7d old")
 * @param badgeColor - Color for the badge text and border
 * @param onClick    - Callback invoked when the row is clicked; navigates to filtered issues
 */
function IssueRow({ issue, badge, badgeColor, onClick }: {
  issue:      ProfileIssue;
  badge?:     string;
  badgeColor?: string;
  onClick:    () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 6, cursor: 'pointer', backgroundColor: hovered ? '#263148' : 'transparent', borderBottom: '1px solid #1e293b', margin: '0 -10px' }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ fontSize: 11, color: '#475569', flexShrink: 0, minWidth: 52, fontVariantNumeric: 'tabular-nums' as const }}>#{issue.itemNo}</span>
      <span style={{ fontSize: 13, color: '#e2e8f0', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{issue.title}</span>
      <span style={{ fontSize: 11, color: '#475569', flexShrink: 0 }}>{issue.sprintName}</span>
      {badge && (
        <span style={{ fontSize: 11, fontWeight: 700, color: badgeColor, padding: '2px 6px', borderRadius: 10, border: `1px solid ${badgeColor}44`, backgroundColor: `${badgeColor}11`, flexShrink: 0 }}>
          {badge}
        </span>
      )}
    </div>
  );
}

// ── Sprint History (2.2 + 2.3) ────────────────────────────────────────────────

/**
 * Renders a table of the user's sprint history, showing the last N sprints with
 * columns for sprint name, project, assigned count, done count, and completion
 * percentage. Completion bars are color-coded: green (≥80%), blue (≥50%),
 * amber (≥25%), red (<25%).
 *
 * @param history - Array of sprint history items, sorted by most recent
 */
function SprintHistorySection({ history }: { history: SprintHistoryItem[] }) {
  if (history.length === 0) return <p style={{ margin: 0, fontSize: 13, color: '#475569' }}>No sprint history yet.</p>;

  const maxAssigned = Math.max(...history.map((h) => h.assigned), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Header */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 80px 80px 100px', gap: 10, padding: '4px 10px', fontSize: 10, fontWeight: 600, color: '#475569', textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: '1px solid #334155', marginBottom: 4 }}>
        <span>Sprint</span>
        <span>Project</span>
        <span style={{ textAlign: 'right' as const }}>Assigned</span>
        <span style={{ textAlign: 'right' as const }}>Done</span>
        <span style={{ textAlign: 'right' as const }}>Completion</span>
      </div>
      {history.map((h) => (
        <div key={h.sprintId} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 80px 80px 100px', gap: 10, padding: '8px 10px', borderBottom: '1px solid #1e293b', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 13, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{h.sprintName}</span>
            {h.endDate && <span style={{ fontSize: 11, color: '#475569' }}>{fmtDate(h.endDate)}</span>}
          </div>
          <span style={{ fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{h.projectName}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' as const }}>{h.assigned}</span>
            <div style={{ width: 60, height: 3, borderRadius: 2, backgroundColor: '#0f172a', overflow: 'hidden' }}>
              <div style={{ width: `${(h.assigned / maxAssigned) * 100}%`, height: '100%', backgroundColor: '#3b82f6' }} />
            </div>
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#22c55e', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const }}>{h.done}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
            <div style={{ width: 48, height: 6, borderRadius: 3, backgroundColor: '#0f172a', overflow: 'hidden' }}>
              <div style={{
                width: `${h.completionPct}%`, height: '100%', borderRadius: 3,
                backgroundColor: h.completionPct >= 80 ? '#22c55e' : h.completionPct >= 50 ? '#3b82f6' : h.completionPct >= 25 ? '#f59e0b' : '#ef4444',
              }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', minWidth: 34, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const }}>{h.completionPct}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

/**
 * The main user profile page component. It is rendered at the route `/users/:userId`
 * and displays a comprehensive view of a team member's work profile, including:
 *
 *   1. **Header** — Avatar, name, role badge, email
 *   2. **Snapshot stats** — Total, todo, in-progress, done, stale, overdue, raised
 *   3. **Status breakdown** — Bar chart of active issue statuses (excludes done)
 *   4. **Raised vs Assigned** — Comparison of created tickets vs assigned tickets
 *   5. **Collaboration score** — Percentage of co-worked tickets with qualitative label
 *   6. **Stale tickets** — Issues exceeding the stale threshold (default 7 days)
 *   7. **Overdue tickets** — Issues past target date that are not yet done
 *   8. **Sprint history** — Last N sprints with assignment, completion, and project data
 *   9. **Raised tickets** — Tickets the user created in the current sprint
 *
 * Data is fetched asynchronously from the backend (via local SQLite). The profile
 * data and sprint history are fetched in parallel. Navigation from any issue row
 * passes the user's ID and relevant filters to the issues board page.
 *
 * Loading states are shown for both the profile and sprint history independently.
 * Error states display a message and a back button.
 */
export function UserProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate   = useNavigate();
  const staleDays  = 7; // default; no project context on profile page

  const [profile, setProfile]   = useState<UserProfileResponse | null>(null);
  const [history, setHistory]   = useState<SprintHistoryItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [histLoading, setHistLoading] = useState(true);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    fetchUserProfile(userId, staleDays)
      .then(setProfile)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [userId, staleDays]);

  useEffect(() => {
    if (!userId) return;
    fetchUserSprintHistory(userId)
      .then(({ history: h }) => setHistory(h))
      .catch(() => {})
      .finally(() => setHistLoading(false));
  }, [userId]);

  /**
   * Navigates to the issues board page with query parameters filtered for the
   * current user and any additional filters (e.g., stale, creator-only).
   *
   * Uses the first available issue's sprintId and projectId to construct the
   * destination URL. If no issues exist, navigation is skipped.
   *
   * @param extra - Additional query parameters to merge (e.g., `{ stale: 'true', sprintId: '...' }`)
   */
  function goToIssues(extra: Record<string, string>) {
    if (!profile) return;
    const params = new URLSearchParams({ userId: profile.user.zohoId, userName: profile.user.name, ...extra });
    // Find a project+sprint to link to — use first issue's project/sprint
    const first = profile.issues[0];
    if (first) params.set('sprintId', first.sprintId);
    // Navigate to first project's issues page (best effort)
    const projectId = first?.projectId;
    if (projectId) navigate(`/board/${projectId}/issues?${params}`);
  }

  if (loading) return (
    <div style={s.page}>
      <header style={s.header}>
        <button style={s.back} onClick={() => navigate('/users')}>Back</button>
      </header>
      <p style={s.muted}>Loading profile…</p>
    </div>
  );

  if (error || !profile) return (
    <div style={s.page}>
      <header style={s.header}>
        <button style={s.back} onClick={() => navigate('/users')}>← Back</button>
      </header>
      <p style={{ color: '#f87171', fontSize: 14 }}>{error ?? 'Profile not found.'}</p>
    </div>
  );

  const { user, issues, raisedIssues, summary } = profile;
  const staleIssues   = issues.filter((i) => i.isStale);
  const overdueIssues = issues.filter((i) => i.delayedDays > 0 && i.statusGroup !== 'done');
  const ROLE_DISPLAY: Record<string, string> = { DEV: 'Developer', QA: 'QA Engineer', PROD: 'Product', OTHER: 'Other' };

  return (
    <div style={s.page}>
      <header style={s.header}>
        <button style={s.back} onClick={() => navigate('/users')}>← Back</button>
        <div>
          <h1 style={s.title}>{user.name}</h1>
          <p style={s.subtitle}>{ROLE_DISPLAY[user.role] ?? user.role} · {user.email ?? 'No email'}</p>
        </div>
      </header>

      {/* ── Header Identity + Snapshot (2.1) ───────────────────────────────── */}
      <div style={s.heroCard}>
        {/* Avatar */}
        <div style={{ ...s.avatar, backgroundColor: roleColor(user.role) }}>
          {initials(user.name)}
        </div>

        <div style={s.heroInfo}>
          <span style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9' }}>{user.name}</span>
          <span style={{ fontSize: 13, color: '#64748b' }}>{user.email ?? '—'}</span>
          <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 9px', borderRadius: 20, border: `1px solid ${roleColor(user.role)}44`, color: roleColor(user.role), backgroundColor: `${roleColor(user.role)}11`, alignSelf: 'flex-start', marginTop: 2 }}>
            {user.role}
          </span>
        </div>

        <div style={s.heroDivider} />

        {/* Snapshot stats */}
        <div style={s.heroStats}>
          <StatPill value={summary.total}   label="Total"    />
          <StatPill value={summary.todo}    label="Todo"     color="#64748b" />
          <StatPill value={summary.doing}   label="In Progress" color="#3b82f6" />
          <StatPill value={summary.done}    label="Done"     color="#22c55e" />
          <StatPill value={summary.stale}   label={`Stale ≥${staleDays}d`} color={summary.stale > 0 ? '#f59e0b' : '#94a3b8'} />
          <StatPill value={summary.overdue} label="Overdue"  color={summary.overdue > 0 ? '#ef4444' : '#94a3b8'} />
          <StatPill value={summary.raised}  label="Raised"   color="#a855f7" />
        </div>
      </div>

      {/* ── Analytics grid ──────────────────────────────────────────────────── */}
      <div style={s.grid}>

        {/* 2.6 Status Distribution */}
        <Section title="Status Breakdown" span={2}>
          <StatusDistribution issues={issues} />
        </Section>

        {/* 2.7 Raised vs Assigned */}
        <Section title="Raised vs Assigned">
          <RaisedVsAssigned assigned={summary.total} raised={summary.raised} />
        </Section>

        {/* 2.9 Collaboration */}
        <Section title="Collaboration">
          <CollaborationScore total={summary.total} collab={summary.collab} />
        </Section>

        {/* 2.8 Stale Tickets */}
        <Section title={`Stale Tickets (≥${staleDays} days)`} span={2}>
          {staleIssues.length === 0
            ? <p style={{ margin: 0, fontSize: 13, color: '#22c55e' }}>No stale tickets</p>
            : staleIssues.map((issue) => (
              <IssueRow
                key={issue.zohoId}
                issue={issue}
                badge={`${daysAgo(issue.createdAt)}d old`}
                badgeColor="#f59e0b"
                onClick={() => goToIssues({ stale: 'true', staleDays: String(staleDays), sprintId: issue.sprintId })}
              />
            ))
          }
        </Section>

        {/* 2.10 Overdue Tickets */}
        <Section title="Overdue Tickets" span={2}>
          {overdueIssues.length === 0
            ? <p style={{ margin: 0, fontSize: 13, color: '#22c55e' }}>No overdue tickets</p>
            : overdueIssues.map((issue) => (
              <IssueRow
                key={issue.zohoId}
                issue={issue}
                badge={`${daysAgo(issue.createdAt)}d old`}
                badgeColor="#ef4444"
                onClick={() => goToIssues({ sprintId: issue.sprintId })}
              />
            ))
          }
        </Section>

        {/* 2.2 + 2.3 Sprint History */}
        <Section title={`Sprint History (${history.length} sprint${history.length !== 1 ? 's' : ''})`} span={4}>
          {histLoading
            ? <p style={{ margin: 0, fontSize: 13, color: '#475569' }}>Loading history…</p>
            : <SprintHistorySection history={history} />
          }
        </Section>

        {/* Raised tickets list */}
        {raisedIssues.length > 0 && (
          <Section title={`Tickets Raised This Sprint (${raisedIssues.length})`} span={4}>
            {raisedIssues.map((issue) => (
              <IssueRow
                key={issue.zohoId}
                issue={issue}
                badge={issue.statusGroup === 'done' ? 'done' : issue.statusGroup}
                badgeColor={issue.statusGroup === 'done' ? '#22c55e' : issue.statusGroup === 'doing' ? '#3b82f6' : '#64748b'}
                onClick={() => goToIssues({ creatorOnly: 'true', sprintId: issue.sprintId })}
              />
            ))}
          </Section>
        )}

      </div>
    </div>
  );
}

/** Inline style map for the profile page layout. */
const s: Record<string, React.CSSProperties> = {
  page:     { minHeight: '100vh', backgroundColor: '#0f172a', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif', padding: '0 24px 48px' },
  header:   { display: 'flex', alignItems: 'center', gap: 20, padding: '32px 0 40px', borderBottom: '1px solid #1e293b', marginBottom: 32 },
  back:     { backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '7px 13px', color: '#94a3b8', fontSize: 13, fontWeight: 600, cursor: 'pointer', userSelect: 'none' as const },
  title:    { margin: 0, fontSize: 28, fontWeight: 700, color: '#f1f5f9' },
  subtitle: { margin: '4px 0 0', fontSize: 14, color: '#64748b' },
  muted:    { color: '#64748b', fontSize: 14 },
  heroCard: { backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: '24px 28px', display: 'flex', alignItems: 'center', gap: 24, marginBottom: 28, flexWrap: 'wrap' as const },
  avatar:   { width: 64, height: 64, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700, color: '#fff', flexShrink: 0 },
  heroInfo: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 160 },
  heroDivider: { width: 1, height: 64, backgroundColor: '#334155', flexShrink: 0 },
  heroStats: { display: 'flex', gap: 28, flexWrap: 'wrap' as const, flex: 1, justifyContent: 'space-around' },
  grid:     { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16 },
};
