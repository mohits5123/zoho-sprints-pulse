import { useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { SprintSnapshot } from '../api/client';
import { UserAvatar, sortByRole, sortStatusEntries } from './UserAvatar';
import { BarGraph } from './BarGraph';
import { C, R, font, groupColors } from '../theme';

type StatusGroup = 'todo' | 'doing' | 'done';

function parseBreakdown(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try { return JSON.parse(raw) as Record<string, number>; } catch { return {}; }
}

function parseStatusGroups(rawData: string | null): Record<string, StatusGroup> {
  if (!rawData) return {};
  try {
    const d = JSON.parse(rawData) as { statusGroups?: Record<string, StatusGroup> };
    return d.statusGroups ?? {};
  } catch { return {}; }
}

function statusColor(name: string, groups: Record<string, StatusGroup>): string {
  const group = groups[name];
  return group ? groupColors[group] : C.inkSubtle;
}

interface SprintCardProps {
  sprint: SprintSnapshot;
  hideProjectName?: boolean;
  staleCount?: number;
  onStatusClick?: (status: string) => void;
  isKanban?: boolean;
  onStaleClick?: () => void;
  users?: { id: string; name: string; role: string }[];
  onUserClick?: (userId: string, userName: string) => void;
  onSprintClick?: () => void;
  onHide?: () => void;
}

export function SprintCard({ sprint, hideProjectName, staleCount, onStatusClick, onStaleClick, users, onUserClick, onSprintClick, onHide }: SprintCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const breakdown    = parseBreakdown(sprint.statusBreakdown);
  const statusGroups = parseStatusGroups(sprint.rawData);
  const rawEntries   = Object.entries(breakdown);
  const entries      = sortStatusEntries(rawEntries, statusGroups);
  const total        = sprint.totalTickets || rawEntries.reduce((s, [, n]) => s + n, 0);
  const allDone      = total > 0 && rawEntries.every(([status]) => statusGroups[status] === 'done');

  const sprintStatusColor =
    sprint.status === 'active'    ? C.success :
    sprint.status === 'planned'   ? '#f59e0b' :
    sprint.status === 'completed' ? C.inkTertiary : C.inkSubtle;

  const startFmt = sprint.startDate && sprint.startDate !== '-1'
    ? new Date(sprint.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : null;
  const endFmt = sprint.endDate && sprint.endDate !== '-1'
    ? new Date(sprint.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : null;

  return (
    <div
      style={{ ...s.card, ...(allDone ? { borderColor: `${C.success}55` } : {}), ...(onSprintClick ? { cursor: 'pointer' } : {}) }}
      onClick={onSprintClick}
    >
      {!hideProjectName && <p style={s.projectName}>{sprint.projectName}</p>}

      <div style={s.sprintHeader}>
        <h3 style={s.sprintName}>{sprint.name}</h3>
        <div style={s.headerRight}>
          {allDone && (
            <span style={s.doneBadge} title="All tickets done">Done</span>
          )}
          {!allDone && (staleCount ?? 0) > 0 && (
            <span
              style={{ ...s.staleBadge, cursor: onStaleClick ? 'pointer' : 'default' }}
              onClick={onStaleClick}
              title={`${staleCount} stale ticket${staleCount !== 1 ? 's' : ''} in this sprint`}
            >
              {staleCount} stale
            </span>
          )}
          <span style={{ ...s.statusPill, color: sprintStatusColor, borderColor: `${sprintStatusColor}44`, backgroundColor: `${sprintStatusColor}11` }}>
            {sprint.status}
          </span>
          {onHide && (
            <div ref={menuRef} style={{ position: 'relative' }}>
              <button
                style={s.menuBtn}
                onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
                title="More options"
              >
                <MoreHorizontal size={14} strokeWidth={1.5} color={C.inkTertiary} />
              </button>
              {menuOpen && (
                <div style={s.dropdown}>
                  <button
                    style={s.dropdownItem}
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onHide(); }}
                  >
                    Hide sprint
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {(startFmt || endFmt) && (
        <p style={s.dates}>{startFmt ?? '?'} - {endFmt ?? '?'}</p>
      )}

      {users && users.length > 0 && (
        <div style={s.users}>
          {sortByRole(users).map((u) => <UserAvatar key={u.id} name={u.name} role={u.role} onClick={onUserClick ? () => onUserClick(u.id, u.name) : undefined} />)}
        </div>
      )}

      <p style={s.totalLine}>
        <span style={s.totalCount}>{total}</span>
        <span style={s.totalLabel}> tickets</span>
      </p>

      {total > 0 && (
        <BarGraph
          segments={entries
            .filter(([, count]) => count > 0)
            .map(([status, count]) => ({
              value: count,
              color: statusColor(status, statusGroups),
              label: `${status}: ${count}`,
            }))}
          height={6}
          borderRadius={R.sm}
          gap={1}
        />
      )}

      {entries.length > 0 && (
        <div style={s.breakdown}>
          {entries.map(([status, count]) => (
            <StatusRow
              key={status}
              status={status}
              count={count}
              total={total}
              color={statusColor(status, statusGroups)}
              onClick={onStatusClick ? () => onStatusClick(status) : undefined}
            />
          ))}
        </div>
      )}

      {total === 0 && <p style={s.muted}>No tickets found.</p>}
    </div>
  );
}

function StatusRow({ status, count, total, color, onClick }: {
  status: string;
  count: number;
  total: number;
  color: string;
  onClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const clickable = !!onClick;
  return (
    <div
      style={{
        ...s.breakdownRow,
        cursor: clickable ? 'pointer' : 'default',
        borderRadius: R.xs,
        margin: '0 -6px',
        padding: '2px 6px',
        backgroundColor: hovered && clickable ? C.surface2 : 'transparent',
        transition: 'background-color 0.1s',
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ ...s.dot, backgroundColor: color }} />
      <span style={s.statusLabel}>{status}</span>
      <span style={{ ...s.statusCount, color: count === 0 ? C.hairline : C.inkMuted }}>{count}</span>
      <span style={{ ...s.statusPct, color: count === 0 ? C.hairline : C.inkTertiary }}>
        {total > 0 ? `${Math.round((count / total) * 100)}%` : '—'}
      </span>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: {
    backgroundColor: C.surface1, border: `1px solid ${C.hairline}`,
    borderRadius: R.lg, padding: '24px',
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  projectName: { margin: 0, fontSize: 13, fontWeight: 500, color: C.inkTertiary, textTransform: 'uppercase' as const, letterSpacing: '0.4px', fontFamily: font.text },
  sprintHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  headerRight:  { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'wrap' as const, justifyContent: 'flex-end' },
  sprintName: { margin: 0, fontSize: 13, fontWeight: 500, color: C.inkTertiary, textTransform: 'uppercase' as const, letterSpacing: '0.4px', flex: 1, fontFamily: font.text },
  staleBadge: {
    fontSize: 12, fontWeight: 400, padding: '2px 8px',
    borderRadius: R.pill, border: `1px solid #f59e0b66`,
    backgroundColor: '#f59e0b11', color: '#f59e0b',
    fontFamily: font.text,
  },
  doneBadge: {
    fontSize: 12, fontWeight: 400, padding: '2px 8px',
    borderRadius: R.pill, border: `1px solid ${C.success}44`,
    backgroundColor: `${C.success}11`, color: C.success,
    fontFamily: font.text,
  },
  statusPill: {
    fontSize: 12, fontWeight: 400, textTransform: 'uppercase' as const,
    letterSpacing: '0.4px', padding: '2px 8px',
    borderRadius: R.pill, border: '1px solid', flexShrink: 0,
    fontFamily: font.text,
  },
  menuBtn: {
    backgroundColor: 'transparent', border: 'none',
    color: C.inkTertiary, fontSize: 14, cursor: 'pointer',
    padding: '2px 4px', borderRadius: R.xs, lineHeight: 1,
  },
  dropdown: {
    position: 'absolute', top: '100%', right: 0,
    backgroundColor: C.surface2, border: `1px solid ${C.hairline}`,
    borderRadius: R.md, padding: '4px 0', minWidth: 140,
    zIndex: 100,
  },
  dropdownItem: {
    width: '100%', padding: '8px 16px', backgroundColor: 'transparent',
    border: 'none', color: C.inkMuted, fontSize: 14, cursor: 'pointer',
    textAlign: 'left' as const, fontFamily: font.text,
  },
  dates: { margin: 0, fontSize: 12, color: C.inkTertiary, fontFamily: font.text },
  users: { display: 'flex', flexWrap: 'wrap' as const, gap: 4 },
  totalLine: { margin: 0 },
  totalCount: { fontSize: 24, fontWeight: 600, color: C.inkMuted, lineHeight: 1, fontFamily: font.display, letterSpacing: '-0.6px' },
  totalLabel: { fontSize: 14, color: C.inkSubtle, fontFamily: font.text },
  breakdown: { display: 'flex', flexDirection: 'column', gap: 5, marginTop: 4 },
  breakdownRow: { display: 'flex', alignItems: 'center', gap: 7 },
  dot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
  statusLabel: { fontSize: 14, color: C.inkSubtle, flex: 1, fontFamily: font.text },
  statusCount: { fontSize: 14, fontWeight: 500, color: C.inkMuted, minWidth: 24, textAlign: 'right' as const, fontFamily: font.text },
  statusPct:   { fontSize: 12, color: C.inkTertiary, minWidth: 32, textAlign: 'right' as const, fontFamily: font.text },
  muted: { color: C.inkTertiary, fontSize: 14, margin: 0, fontFamily: font.text },
};
