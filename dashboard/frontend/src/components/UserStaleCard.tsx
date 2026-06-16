import React, { useEffect, useState } from 'react';
import { fetchIssues, fetchIssuesKanban, type UserLoadStat } from '../api/client';
import { roleColor } from './UserAvatar';

/**
 * Extracts initials from a full name (max 2 characters)
 * @param name Full name string
 * @example initials('John Doe') → 'JD'
 */
function initials(name: string) {
  return name.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();
}

/**
 * Status indicator dot with count and label
 * @param color Hex color string for the dot indicator
 * @param count Number of items in this status
 * @param label Status label shown in tooltip
 */
function StatusDot({ color, count, label }: { color: string; count: number; label: string }) {
  return (
    <span title={`${count} ${label}`} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
      <span style={{ fontSize: 11, color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>{count}</span>
    </span>
  );
}

/**
 * Props for UserStaleCard component
 * Displays stale issues assigned to users with status breakdown visualization
 */
interface UserStaleCardProps {
  projectId:     string;                    // Unique identifier for the project
  sprintId:      string;                    // Unique identifier for the sprint
  staleDays?:    number | null;             // Number of days to consider an issue stale (default: 7)
  watchedStates?: string[];                 // Optional filter for specific Zoho status names
  onUserClick?:  (userId: string, userName: string) => void; // Callback when user row is clicked
  isKanban?:     boolean;                   // True for Kanban boards, false for Scrum boards
  style?:        React.CSSProperties;       // Optional inline style overrides
}

/**
 * Extended user data with issue counts per status group
 * Combines UserLoadStat with aggregated issue counts
 */
type StaleUser = UserLoadStat & { 
  todo: number;   // Count of issues in 'todo' status group
  doing: number;  // Count of issues in 'doing' status group  
  done: number;   // Count of issues in 'done' status group
};

/**
 * Individual user row in the stale issues table
 * Displays user info, stacked bar visualization, and status indicators
 * @param user User data with issue counts per status group
 * @param rank User's rank in sorted list (1-based index)
 * @param onUserClick Callback invoked when row is clicked
 * @param isKanban Whether this is a Kanban board (affects total calculation)
 * @param showTodo Whether to show 'todo' status indicators
 * @param showDoing Whether to show 'doing' status indicators
 * @param showDone Whether to show 'done' status indicators
 * @example <StaleRow user={user} rank={1} showTodo={true} showDoing={true} showDone={false} />
 */
function StaleRow({ user, rank, onUserClick, isKanban, showTodo, showDoing, showDone }: {
  user:        StaleUser;
  rank:        number;
  onUserClick?: (userId: string, userName: string) => void;
  isKanban: boolean;
  showTodo: boolean;
  showDoing: boolean;
  showDone: boolean;
}) {
  const todo  = user.todo  ?? 0;
  const doing = user.doing ?? 0;
  const done  = user.done  ?? 0;
  
  // Calculate total as ALL statuses (for the bar width)
  const total = isKanban ? (todo + doing) : (todo + doing + done);
  
  if (total === 0) return null;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '18px 28px 1fr auto',
        alignItems: 'center',
        gap: 10,
        padding: '6px 8px',
        borderRadius: 6,
        cursor: 'pointer',
        backgroundColor: 'transparent',
        borderBottom: '1px solid #1e293b',
        margin: '0 -8px',
      }}
      onClick={() => onUserClick?.(String(user.id), user.name)}
      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#263148'}
      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
    >
      {/* Rank */}
      <span style={{ fontSize: 11, color: '#475569', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {rank}
      </span>

      {/* Avatar — circular, role-colored */}
      <div
        style={{
          width: 26, height: 26, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, fontWeight: 700, color: '#fff',
          backgroundColor: roleColor(user.role), flexShrink: 0,
        }}
        title={user.role}
      >
        {initials(user.name)}
      </div>

      {/* Name + stacked bar */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, overflow: 'hidden' }}>
        <span style={{
          fontSize: 12, color: '#e2e8f0', fontWeight: 500,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {user.name}
        </span>
        <div style={{ height: 4, borderRadius: 2, backgroundColor: '#0f172a', overflow: 'hidden', display: 'flex' }}>
          {showTodo && <div style={{ width: `${(todo  / total) * 100}%`, backgroundColor: '#64748b', transition: 'width 0.4s' }} />}
          {showDoing && <div style={{ width: `${(doing / total) * 100}%`, backgroundColor: '#3b82f6', transition: 'width 0.4s' }} />}
          {showDone && <div style={{ width: `${(done  / total) * 100}%`, backgroundColor: '#22c55e', transition: 'width 0.4s' }} />}
        </div>
      </div>

      {/* Status dots + total */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {showTodo && <StatusDot color="#64748b" count={todo} label="todo"        />}
        {showDoing && <StatusDot color="#3b82f6" count={doing} label="in progress" />}
        {showDone && <StatusDot color="#22c55e" count={done}  label="done"        />}
        <span style={{
          fontSize: 11, fontWeight: 700, color: '#e2e8f0',
          marginLeft: 4, minWidth: 18, textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {total}
        </span>
      </div>
    </div>
  );
}

/**
 * Renders a card displaying stale issues assigned to users
 * Fetches issues from API, aggregates by assignee, and renders sorted table
 * @param projectId Project identifier for API request
 * @param sprintId Sprint identifier for API request
 * @param staleDays Threshold days for staleness (default: 7)
 * @param watchedStates Optional Zoho status names to filter issues
 * @param onUserClick Callback triggered when user row is clicked
 * @param isKanban Mode flag: true for Kanban, false for Scrum
 * @param style Optional inline style overrides
 * @returns React element containing the stale issues card
 * @example <UserStaleCard projectId="123" sprintId="456" isKanban={true} />
 */
export function UserStaleCard({
  projectId, sprintId, staleDays = 7,
  watchedStates, onUserClick, isKanban, style,
}: UserStaleCardProps & { isKanban?: boolean }) {
  const [users,            setUsers]            = useState<StaleUser[]>([]);
  const [totalStaleIssues, setTotalStaleIssues] = useState(0);
  const [loading,          setLoading]          = useState(true);

  const watchedStatesArr = watchedStates ?? [];
  const isKanbanVal = isKanban ?? false;

  // Status name to status group mapping (Zoho uses custom status names)
  // This maps Zoho status names to frontend status groups (todo/doing/done)
  const statusToGroup: Record<string, 'todo' | 'doing' | 'done'> = {
    'To do': 'todo',
    'In progress': 'doing',
    'In Testing': 'doing',
    'Code Review': 'doing',
    'Preprod Testing': 'doing',
    'Prod Testing': 'doing',
    'Testing Demo': 'doing',
    'Done': 'done',
    'Closed': 'done',
    'Reopened': 'todo',
  };

  /**
   * Checks if an issue's status is in the watched states filter
   * Returns true if no filter is applied or status matches filter
   * @param status The Zoho status name of the issue
   * @returns true if status should be counted
   */
  const isInWatchedStates = (status: string) => {
    if (watchedStatesArr.length === 0) return true; // No filter = show all
    return watchedStatesArr.includes(status);
  };

  /**
   * Maps a Zoho status name to a status group (todo/doing/done)
   * Used for grouping issues in the visualization
   * @param status The Zoho status name of the issue
   * @returns The status group ('todo', 'doing', or 'done')
   * @default 'todo' if status not found in mapping
   */
  const getStatusGroup = (status: string): 'todo' | 'doing' | 'done' => {
    return statusToGroup[status] || 'todo'; // Default to 'todo' if not found
  };

  /**
   * Effect to fetch and aggregate stale issues from API
   * Fetches issues for the current project/sprint and aggregates by assignee
   * Cleans up on component unmount to prevent memory leaks
   */
  useEffect(() => {
    let mounted = true;
    setLoading(true);

    (async () => {
      try {
        const d = Number(staleDays) || 7;
        
        if (isKanbanVal) {
          // Kanban boards: fetch issues and aggregate by assignee
          // Only counts 'todo' and 'doing' statuses for Kanban (active work)
          const issuesRes = await fetchIssuesKanban(projectId, { stale: true, staleDays: d, watchedStates: watchedStatesArr });
          if (!mounted) return;
          
          // Map to aggregate issues per assignee
          const assigneeMap = new Map<string, {
            id: string; name: string; role: string;
            todo: number; doing: number; done: number; stale: number;
          }>();
          
          let totalStaleCount = 0;
          
          for (const issue of issuesRes.issues) {
            // Skip unassigned issues
            if (!issue.assignees || issue.assignees.length === 0) continue;
            
            // Count stale issues globally
            if (issue.isStale) totalStaleCount++;
            
            // Aggregate by assignee
            for (const user of issue.assignees) {
              if (!user || !user.id || user.id === '-1') continue;
              
              let entry = assigneeMap.get(user.id);
              if (!entry) {
                assigneeMap.set(user.id, { 
                  id: user.id, 
                  name: user.name, 
                  role: user.role, 
                  todo: 0, 
                  doing: 0, 
                  done: 0, 
                  stale: 0 
                });
                entry = assigneeMap.get(user.id)!;
              }
              
              // Only count issues in watched states
              if (isInWatchedStates(issue.status)) {
                const statusGroup = getStatusGroup(issue.status);
                if (statusGroup === 'todo')  entry.todo++;
                else if (statusGroup === 'doing') entry.doing++;
                else if (statusGroup === 'done')  entry.done++;
                
                // Count stale for this assignee
                if (issue.isStale) entry.stale++;
              }
            }
          }
          
          const usersArray = [...assigneeMap.values()];
          // Sort by active load (todo + doing) descending, then total load as tiebreaker
          usersArray.sort((a, b) => {
            const loadDiff = (b.todo + b.doing) - (a.todo + b.doing);
            return loadDiff !== 0 ? loadDiff :
                   (b.todo + b.doing + b.done) - (a.todo + a.doing + a.done);
          });
          
          setUsers(usersArray);
          setTotalStaleIssues(totalStaleCount);
        } else {
          // Scrum boards: fetch issues and aggregate by assignee
          // Counts 'todo', 'doing', and optionally 'done' statuses for Scrum (all work)
          const issuesRes = await fetchIssues(projectId, sprintId, { stale: true, staleDays: d, watchedStates: watchedStatesArr });
          if (!mounted) return;
          
          // Map to aggregate issues per assignee
          const assigneeMap = new Map<string, {
            id: string; name: string; role: string;
            todo: number; doing: number; done: number; stale: number;
          }>();
          
          let totalStaleCount = 0;
          
          for (const issue of issuesRes.issues) {
            // Skip unassigned issues
            if (!issue.assignees || issue.assignees.length === 0) continue;
            
            // Count stale issues globally
            if (issue.isStale) totalStaleCount++;
            
            // Aggregate by assignee
            for (const user of issue.assignees) {
              if (!user || !user.id || user.id === '-1') continue;
              
              let entry = assigneeMap.get(user.id);
              if (!entry) {
                assigneeMap.set(user.id, { 
                  id: user.id, 
                  name: user.name, 
                  role: user.role, 
                  todo: 0, 
                  doing: 0, 
                  done: 0, 
                  stale: 0 
                });
                entry = assigneeMap.get(user.id)!;
              }
              
              // Only count issues in watched states
              if (isInWatchedStates(issue.status)) {
                const statusGroup = getStatusGroup(issue.status);
                if (statusGroup === 'todo')  entry.todo++;
                else if (statusGroup === 'doing') entry.doing++;
                else if (statusGroup === 'done')  entry.done++;
                
                // Count stale for this assignee
                if (issue.isStale) entry.stale++;
              }
            }
          }
          
          const usersArray = [...assigneeMap.values()];
          // Sort by active load (todo + doing) descending, then total load as tiebreaker
          usersArray.sort((a, b) => {
            const loadDiff = (b.todo + b.doing) - (a.todo + a.doing);
            return loadDiff !== 0 ? loadDiff : 
                   (b.todo + b.doing + b.done) - (a.todo + a.doing + a.done);
          });
          setUsers(usersArray);
          setTotalStaleIssues(totalStaleCount);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, sprintId, staleDays, watchedStatesArr.join(','), isKanbanVal]);

/**
 * Determine which status groups should be visible based on watchedStates filter
 * - Kanban boards: only show 'doing' (active work)
 * - Scrum boards: show 'todo', 'doing', and optionally 'done'
 */
  // Check if any watched state maps to each status group
  const hasTodo = watchedStatesArr.some(s => statusToGroup[s] === 'todo');
  const hasDoing = watchedStatesArr.some(s => statusToGroup[s] === 'doing');
  const hasDone = watchedStatesArr.some(s => statusToGroup[s] === 'done');

  const showTodo = hasTodo || watchedStatesArr.length === 0;    // Only in Scrum unless no filter
  const showDoing = hasDoing || watchedStatesArr.length === 0;  // Always shown
  const showDone = !isKanbanVal && (hasDone || watchedStatesArr.length === 0); // Only in Scrum unless no filter

/**
 * Filter users to exclude those with no visible issues
 * Calculates filterTotal based on board type (Kanban vs Scrum)
 * @param u User data to filter
 * @returns User object with additional filter metadata
 */
  const usersWithFilter = users.map(u => {
    const todo  = u.todo  ?? 0;
    const doing = u.doing ?? 0;
    const done  = u.done  ?? 0;
    const filterTotal = isKanbanVal ? (todo + doing) : (todo + doing + done);
    return { ...u, filterTotal, showTodo, showDoing, showDone };
  });

  const sorted = usersWithFilter.filter(u => u.filterTotal > 0);

/**
 * Render the stale issues card
 * - Displays header with assignee count and stale ticket count
 * - Shows loading skeleton during data fetch
 * - Shows empty state when no stale issues found
 * - Renders table of users with stacked bar visualization
 * @returns React element containing the complete stale issues card
 */
  return (
    <div style={{ ...s.card, ...style }}>
      {/* Header */}
      <div style={s.headerRow}>
        <div>
          <p style={s.label}>Stale Issues by User</p>
          {!loading && sorted.length > 0 && (
            <p style={s.sub}>{sorted.length} assignee{sorted.length !== 1 ? 's' : ''} · {totalStaleIssues} tickets</p>
          )}
        </div>
        {!loading && totalStaleIssues > 0 && (
          <span style={s.staleBadge}>⚠ {totalStaleIssues} stale</span>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div style={s.skeleton}>Loading...</div>
      ) : sorted.length === 0 ? (
        <div style={s.empty}>No stale issues found</div>
      ) : (
        <div style={s.table}>
          <div style={s.tableRow}>
            <span style={s.tableCell}>#</span>
            <span style={s.tableCell}>Assignee</span>
            {!isKanbanVal && <span style={s.tableCell}>Todo</span>}
            <span style={s.tableCell}>In Progress</span>
            {!isKanbanVal && <span style={s.tableCell}>Done</span>}
            <span style={s.tableCell}>Total</span>
          </div>
          {sorted.map((user, index) => (
            <StaleRow
              key={user.id}
              user={user}
              rank={index + 1}
              onUserClick={onUserClick}
              isKanban={isKanbanVal}
              showTodo={showTodo}
              showDoing={showDoing}
              showDone={showDone}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * CSS styles object for the UserStaleCard component
 * Uses dark theme colors (#1e293b background, #e2e8f0 text)
 */
const s: Record<string, React.CSSProperties> = {
  /** Main card container with dark background and border */
  card: {
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 12,
    padding: '20px 22px',
  },
  /** Header row: title and stats aligned horizontally */
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  /** Title text style */
  label: {
    fontSize: 13,
    fontWeight: 700,
    color: '#e2e8f0',
    margin: 0,
  },
  /** Subtitle showing assignee count and ticket count */
  sub: {
    fontSize: 11,
    color: '#94a3b8',
    margin: '2px 0 0 0',
  },
  /** Warning badge with red background for stale count */
  staleBadge: {
    backgroundColor: '#ef4444',
    color: '#fff',
    fontSize: 11,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: 4,
  },
  /** Loading skeleton text style */
  skeleton: {
    color: '#475569',
    fontSize: 12,
    padding: '16px',
  },
  /** Empty state text style */
  empty: {
    color: '#64748b',
    fontSize: 12,
    fontStyle: 'italic',
    padding: '16px',
  },
  /** Table container for rows */
  table: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minHeight: 120,
  },
  /** Table header row with column labels */
  tableRow: {
    display: 'grid',
    gridTemplateColumns: '18px 28px 1fr auto',
    alignItems: 'center',
    gap: 10,
    padding: '6px 8px',
    borderBottom: '1px solid #334155',
    color: '#64748b',
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase',
  },
  /** Individual table cell style */
  tableCell: {
    fontSize: 10,
    fontWeight: 700,
    color: '#64748b',
  },
};
