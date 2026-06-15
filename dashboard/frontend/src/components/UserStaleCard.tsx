import React, { useEffect, useState } from 'react';
import { fetchIssues, fetchIssuesKanban, type UserLoadStat } from '../api/client';
import { roleColor } from './UserAvatar';

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

interface UserStaleCardProps {
  projectId:     string;
  sprintId:      string;
  staleDays?:    number | null;
  watchedStates?: string[];
  onUserClick?:  (userId: string, userName: string) => void;
  isKanban?:     boolean;
}

type StaleUser = UserLoadStat & { todo: number; doing: number; done: number };

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

export function UserStaleCard({
  projectId, sprintId, staleDays = 7,
  watchedStates, onUserClick, isKanban,
}: UserStaleCardProps & { isKanban?: boolean }) {
  const [users,            setUsers]            = useState<StaleUser[]>([]);
  const [totalStaleIssues, setTotalStaleIssues] = useState(0);
  const [loading,          setLoading]          = useState(true);

  const watchedStatesArr = watchedStates ?? [];
  const isKanbanVal = isKanban ?? false;

  // Helper to check if a status should be counted based on watchedStates
  // watchedStates are actual Zoho status names, not status groups
  const isInWatchedStates = (status: string) => {
    if (watchedStatesArr.length === 0) return true; // No filter = show all
    return watchedStatesArr.includes(status);
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);

    (async () => {
      try {
        const d = Number(staleDays) || 7;
        
        if (isKanbanVal) {
          // For kanban boards, fetch raw issues and aggregate on frontend
          const issuesRes = await fetchIssuesKanban(projectId, { stale: true, staleDays: d, watchedStates: watchedStatesArr });
          if (!mounted) return;
          
          // Aggregate issues by user and statusGroup
          const assigneeMap = new Map<string, {
            id: string; name: string; role: string;
            todo: number; doing: number; done: number; stale: number;
          }>();
          
          let totalStaleCount = 0;
          
          for (const issue of issuesRes.issues) {
            // Skip unassigned issues
            if (!issue.assignees || issue.assignees.length === 0) continue;
            
            // Count stale issues
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
                if (issue.statusGroup === 'todo')  entry.todo++;
                else if (issue.statusGroup === 'doing') entry.doing++;
                else if (issue.statusGroup === 'done')  entry.done++;
                
                // Count stale for this assignee
                if (issue.isStale) entry.stale++;
              }
            }
          }
          
          const usersArray = [...assigneeMap.values()];
          // Sort by active load (todo + doing) descending
          usersArray.sort((a, b) => {
            const loadDiff = (b.todo + b.doing) - (a.todo + a.doing);
            return loadDiff !== 0 ? loadDiff : 
                   (b.todo + b.doing + b.done) - (a.todo + a.doing + a.done);
          });
          
          setUsers(usersArray);
          setTotalStaleIssues(totalStaleCount);
        } else {
          // For scrum boards, fetch raw issues and aggregate on frontend
          const issuesRes = await fetchIssues(projectId, sprintId, { stale: true, staleDays: d, watchedStates: watchedStatesArr });
          if (!mounted) return;
          
          // Aggregate issues by user and statusGroup
          const assigneeMap = new Map<string, {
            id: string; name: string; role: string;
            todo: number; doing: number; done: number; stale: number;
          }>();
          
          let totalStaleCount = 0;
          
          for (const issue of issuesRes.issues) {
            // Skip unassigned issues
            if (!issue.assignees || issue.assignees.length === 0) continue;
            
            // Count stale issues
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
                if (issue.statusGroup === 'todo')  entry.todo++;
                else if (issue.statusGroup === 'doing') entry.doing++;
                else if (issue.statusGroup === 'done')  entry.done++;
                
                // Count stale for this assignee
                if (issue.isStale) entry.stale++;
              }
            }
          }
          
          const usersArray = [...assigneeMap.values()];
          // Sort by active load (todo + doing) descending
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

  // Determine which status groups to show based on watchedStates
  // For kanban boards, only show 'doing' (active states)
  // For scrum boards, show 'todo', 'doing', and optionally 'done'
  const showTodo = !isKanbanVal && (watchedStatesArr.includes('todo') || watchedStatesArr.length === 0);
  const showDoing = watchedStatesArr.includes('doing') || watchedStatesArr.length === 0;
  const showDone = !isKanbanVal && (watchedStatesArr.includes('done') || watchedStatesArr.length === 0);

  const sorted = users.filter(u => {
    const todo  = u.todo  ?? 0;
    const doing = u.doing ?? 0;
    const done  = u.done  ?? 0;
    const filterTotal = isKanbanVal ? (todo + doing) : (todo + doing + done);
    return filterTotal > 0;
  });

  return (
    <div style={s.card}>
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

const s: Record<string, React.CSSProperties> = {
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: 700,
    color: '#e2e8f0',
    margin: 0,
  },
  sub: {
    fontSize: 11,
    color: '#94a3b8',
    margin: '2px 0 0 0',
  },
  staleBadge: {
    backgroundColor: '#ef4444',
    color: '#fff',
    fontSize: 11,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: 4,
  },
  skeleton: {
    color: '#475569',
    fontSize: 12,
  },
  empty: {
    color: '#64748b',
    fontSize: 12,
    fontStyle: 'italic',
  },
  table: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
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
  tableCell: {
    fontSize: 10,
    fontWeight: 700,
    color: '#64748b',
  },
};
