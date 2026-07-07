import React, { useEffect, useState } from 'react';
import { fetchIssues, fetchIssuesKanban, type UserLoadStat } from '../api/client';
import { roleColor } from './UserAvatar';
import { BarGraph } from './BarGraph';
import { C, R, font, groupColors } from '../theme';

function initials(name: string) {
  return name.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();
}

function StatusDot({ color, count, label }: { color: string; count: number; label: string }) {
  return (
    <span title={`${count} ${label}`} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: C.inkSubtle, fontVariantNumeric: 'tabular-nums', fontFamily: font.text }}>{count}</span>
    </span>
  );
}

interface UserStaleCardProps {
  projectId:     string;
  sprintId:      string;
  staleDays?:    number | null;
  watchedStates?: string[];
  onUserClick?:  (userId: string, userName: string) => void;
  onStaleClick?: () => void;
  isKanban?:     boolean;
  style?:        React.CSSProperties;
}

type StaleUser = UserLoadStat & {
  todo: number;
  doing: number;
  done: number;
};

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
        borderRadius: R.sm,
        cursor: 'pointer',
        backgroundColor: 'transparent',
        borderBottom: `1px solid ${C.hairline}`,
        margin: '0 -8px',
      }}
      onClick={() => onUserClick?.(String(user.id), user.name)}
      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = C.surface2}
      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
    >
      <span style={{ fontSize: 12, color: C.inkTertiary, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontFamily: font.text }}>
        {rank}
      </span>

      <div
        style={{
          width: 26, height: 26, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, fontWeight: 600, color: '#fff',
          backgroundColor: roleColor(user.role), flexShrink: 0,
        }}
        title={user.role}
      >
        {initials(user.name)}
      </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, overflow: 'hidden' }}>
          <span style={{
            fontSize: 14, color: C.inkMuted, fontWeight: 400,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontFamily: font.text,
          }}>
            {user.name}
          </span>
          <BarGraph
            segments={[
              ...(showTodo ? [{ value: todo, color: groupColors.todo }] : []),
              ...(showDoing ? [{ value: doing, color: groupColors.doing }] : []),
              ...(showDone ? [{ value: done, color: groupColors.done }] : []),
            ]}
            height={6}
            borderRadius={2}
            gap={0}
          />
        </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {showTodo && <StatusDot color={groupColors.todo} count={todo} label="todo"        />}
        {showDoing && <StatusDot color={groupColors.doing} count={doing} label="in progress" />}
        {showDone && <StatusDot color={groupColors.done} count={done}  label="done"        />}
        <span style={{
          fontSize: 14, fontWeight: 500, color: C.inkMuted,
          marginLeft: 4, minWidth: 18, textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
          fontFamily: font.text,
        }}>
          {total}
        </span>
      </div>
    </div>
  );
}

export function UserStaleCard({
  projectId, sprintId, staleDays = 7,
  watchedStates, onUserClick, onStaleClick, isKanban, style,
}: UserStaleCardProps & { isKanban?: boolean }) {
  const [users,            setUsers]            = useState<StaleUser[]>([]);
  const [totalStaleIssues, setTotalStaleIssues] = useState(0);
  const [loading,          setLoading]          = useState(true);

  const watchedStatesArr = watchedStates ?? [];
  const isKanbanVal = isKanban ?? false;

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

  const isInWatchedStates = (status: string) => {
    if (watchedStatesArr.length === 0) return true;
    return watchedStatesArr.includes(status);
  };

  const getStatusGroup = (status: string): ('todo' | 'doing' | 'done') => {
    return statusToGroup[status] || 'todo';
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);

    (async () => {
      try {
        const d = Number(staleDays) || 7;
        
        if (isKanbanVal) {
          const issuesRes = await fetchIssuesKanban(projectId, { stale: true, staleDays: d, watchedStates: watchedStatesArr });
          if (!mounted) return;
          
          const assigneeMap = new Map<string, {
            id: string; name: string; role: string;
            todo: number; doing: number; done: number; stale: number;
          }>();
          
          let totalStaleCount = 0;
          
          for (const issue of issuesRes.issues) {
            if (!issue.assignees || issue.assignees.length === 0) continue;
            
            if (issue.isStale) totalStaleCount++;
            
            for (const user of issue.assignees) {
              if (!user || !user.id || user.id === '-1') continue;
              if (user.name === 'Unknown') continue;
              
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
              
              if (isInWatchedStates(issue.status)) {
                const statusGroup = getStatusGroup(issue.status);
                if (statusGroup === 'todo')  entry.todo++;
                else if (statusGroup === 'doing') entry.doing++;
                else if (statusGroup === 'done')  entry.done++;
                
                if (issue.isStale) entry.stale++;
              }
            }
          }
          
          const usersArray = [...assigneeMap.values()];
          usersArray.sort((a, b) => {
            const loadDiff = (b.todo + b.doing) - (a.todo + a.doing);
            return loadDiff !== 0 ? loadDiff :
                   (b.todo + b.doing + b.done) - (a.todo + a.doing + a.done);
          });
          
          setUsers(usersArray);
          setTotalStaleIssues(totalStaleCount);
        } else {
          const issuesRes = await fetchIssues(projectId, sprintId, { stale: true, staleDays: d, watchedStates: watchedStatesArr });
          if (!mounted) return;
          
          const assigneeMap = new Map<string, {
            id: string; name: string; role: string;
            todo: number; doing: number; done: number; stale: number;
          }>();
          
          let totalStaleCount = 0;
          
          for (const issue of issuesRes.issues) {
            if (!issue.assignees || issue.assignees.length === 0) continue;
            
            if (issue.isStale) totalStaleCount++;
            
            for (const user of issue.assignees) {
              if (!user || !user.id || user.id === '-1') continue;
              if (user.name === 'Unknown') continue;
              
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
              
              if (isInWatchedStates(issue.status)) {
                const statusGroup = getStatusGroup(issue.status);
                if (statusGroup === 'todo')  entry.todo++;
                else if (statusGroup === 'doing') entry.doing++;
                else if (statusGroup === 'done')  entry.done++;
                
                if (issue.isStale) entry.stale++;
              }
            }
          }
          
          const usersArray = [...assigneeMap.values()];
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

  const hasTodo = watchedStatesArr.some(s => statusToGroup[s] === 'todo');
  const hasDoing = watchedStatesArr.some(s => statusToGroup[s] === 'doing');
  const hasDone = watchedStatesArr.some(s => statusToGroup[s] === 'done');

  const showTodo = hasTodo || watchedStatesArr.length === 0;
  const showDoing = hasDoing || watchedStatesArr.length === 0;
  const showDone = !isKanbanVal && (hasDone || watchedStatesArr.length === 0);

  const usersWithFilter = users.map(u => {
    const todo  = u.todo  ?? 0;
    const doing = u.doing ?? 0;
    const done  = u.done  ?? 0;
    const filterTotal = isKanbanVal ? (todo + doing) : (todo + doing + done);
    return { ...u, filterTotal, showTodo, showDoing, showDone };
  });

  const sorted = usersWithFilter.filter(u => u.filterTotal > 0);

  return (
    <div style={{ ...s.card, ...style }}>
      <div style={s.headerRow}>
        <div>
          <p style={s.label}>Stale Issues by User</p>
          {!loading && sorted.length > 0 && (
            <p style={s.sub}>{sorted.length} assignee{sorted.length !== 1 ? 's' : ''} · {totalStaleIssues} tickets</p>
          )}
        </div>
        {!loading && totalStaleIssues > 0 && (
          <span
            style={{ ...s.staleBadge, cursor: onStaleClick ? 'pointer' : 'default' }}
            onClick={onStaleClick}
            title={`${totalStaleIssues} stale ticket${totalStaleIssues !== 1 ? 's' : ''} across all users`}
          >
            {totalStaleIssues} stale
          </span>
        )}
      </div>

      {loading ? (
        <div style={s.skeleton}>Loading...</div>
      ) : sorted.length === 0 ? (
        <div style={s.empty}>No stale issues found</div>
      ) : (
        <div style={s.table}>
          <div style={s.tableRow}>
            <span style={s.tableCell}>#</span>
            <span style={s.tableCell}>Assignee</span>
            <span style={{ visibility: 'hidden' }}>&nbsp;</span>
            <span style={s.tableCell}>Tickets</span>
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
    backgroundColor: C.surface1,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.lg,
    padding: '24px',
  },
  headerRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  label: {
    margin: 0, fontSize: 13, fontWeight: 500,
    color: C.inkTertiary, textTransform: 'uppercase', letterSpacing: '0.4px',
    fontFamily: font.text,
  },
  sub: {
    margin: '2px 0 0', fontSize: 12, color: C.inkTertiary, fontFamily: font.text,
  },
  staleBadge: {
    fontSize: 12, fontWeight: 400, padding: '2px 8px',
    borderRadius: R.pill, border: '1px solid #f59e0b66',
    backgroundColor: '#f59e0b11', color: '#f59e0b',
    fontFamily: font.text,
  },
  skeleton: {
    color: C.inkTertiary,
    fontSize: 14,
    padding: '16px',
    fontFamily: font.text,
  },
  empty: {
    color: C.inkTertiary,
    fontSize: 14,
    fontStyle: 'italic',
    padding: '16px',
    fontFamily: font.text,
  },
  table: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minHeight: 120,
  },
  tableRow: {
    display: 'grid',
    gridTemplateColumns: '18px 28px 1fr auto',
    alignItems: 'center',
    gap: 10,
    padding: '6px 8px',
    borderBottom: `1px solid ${C.hairline}`,
    color: C.inkTertiary,
    fontSize: 12,
    fontWeight: 500,
    textTransform: 'uppercase',
    fontFamily: font.text,
  },
  tableCell: {
    fontSize: 12,
    fontWeight: 500,
    color: C.inkTertiary,
    fontFamily: font.text,
  },
};
