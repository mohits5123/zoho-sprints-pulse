import { useEffect, useState } from 'react';
import { fetchRaiserStats, fetchKanbanRaiserStats, type RaiserStat } from '../api/client';
import { roleColor } from './UserAvatar';
import { BarGraph } from './BarGraph';
import { C, R, font, groupColors } from '../theme';

function initials(name: string) {
  return name.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();
}

function StatusDot({ color, count, label }: { color: string; count: number; label: string }) {
  return (
    <span title={`${count} ${label}`} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%',
        backgroundColor: color, flexShrink: 0,
      }} />
      <span style={{ fontSize: 12, color: C.inkSubtle, fontVariantNumeric: 'tabular-nums', fontFamily: font.text }}>
        {count}
      </span>
    </span>
  );
}

function RaiserRow({ raiser, rank, onClick }: {
  raiser: RaiserStat;
  rank: number;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const total = raiser.todo + raiser.doing + raiser.done;

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
        backgroundColor: hovered ? C.surface2 : 'transparent',
        borderBottom: `1px solid ${C.hairline}`,
        margin: '0 -8px',
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ fontSize: 12, color: C.inkTertiary, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums', fontFamily: font.text }}>
        {rank}
      </span>

      <div
        style={{
          width: 26, height: 26, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, fontWeight: 600, color: '#fff',
          backgroundColor: roleColor(raiser.role), flexShrink: 0,
        }}
        title={raiser.role}
      >
        {initials(raiser.name)}
      </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, overflow: 'hidden' }}>
          <span style={{
            fontSize: 14, color: C.inkMuted, fontWeight: 400,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontFamily: font.text,
          }}>
            {raiser.name}
          </span>
          <BarGraph
            segments={[
              { value: raiser.todo, color: groupColors.todo },
              { value: raiser.doing, color: groupColors.doing },
              { value: raiser.done, color: groupColors.done },
            ]}
            height={6}
            borderRadius={2}
            gap={0}
          />
        </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <StatusDot color={groupColors.todo}  count={raiser.todo}  label="todo"  />
        <StatusDot color={groupColors.doing} count={raiser.doing} label="in progress" />
        <StatusDot color={groupColors.done}  count={raiser.done}  label="done"  />
        <span style={{
          fontSize: 14, fontWeight: 500, color: C.inkMuted,
          marginLeft: 4, minWidth: 18, textAlign: 'right' as const,
          fontVariantNumeric: 'tabular-nums',
          fontFamily: font.text,
        }}>
          {total}
        </span>
      </div>
    </div>
  );
}

interface TicketRaiserCardProps {
  projectId: string;
  sprintId: string;
  boardType: 'scrum' | 'kanban';
  onUserClick: (userId: string, userName: string) => void;
}

export function TicketRaiserCard({ projectId, sprintId, boardType, onUserClick }: TicketRaiserCardProps) {
  const [raisers, setRaisers] = useState<RaiserStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const promise = boardType === 'kanban'
      ? fetchKanbanRaiserStats(projectId)
      : fetchRaiserStats(projectId, sprintId);
    promise
      .then((data) => setRaisers(data.filter((r) => r.name !== 'Unknown')))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [projectId, sprintId, boardType]);

  const totalRaised = raisers.reduce((s, r) => s + r.todo + r.doing + r.done, 0);
  const totalDone   = raisers.reduce((s, r) => s + r.done, 0);
  const overallPct  = totalRaised > 0 ? Math.round((totalDone / totalRaised) * 100) : 0;

  return (
    <div style={s.card}>
      <div style={s.headerRow}>
        <div>
          <p style={s.label}>Tickets Raised</p>
          {!loading && raisers.length > 0 && (
            <p style={s.sub}>{raisers.length} contributor{raisers.length !== 1 ? 's' : ''} · {totalRaised} tickets</p>
          )}
        </div>
        {!loading && totalRaised > 0 && (
          <span style={s.badge}>{overallPct}% done</span>
        )}
      </div>

      {!loading && raisers.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '18px 28px 1fr auto',
          gap: 10, padding: '0 8px',
          fontSize: 12, color: C.inkTertiary, fontWeight: 500,
          textTransform: 'uppercase' as const, letterSpacing: '0.4px',
          fontFamily: font.text,
        }}>
          <span style={{ textAlign: 'right' as const }}>#</span>
          <span />
          <span>Raiser</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span title="Todo"        style={{ width: 18, display: 'flex', justifyContent: 'center' }}><span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: groupColors.todo, display: 'inline-block' }} /></span>
            <span title="In Progress" style={{ width: 18, display: 'flex', justifyContent: 'center' }}><span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: groupColors.doing, display: 'inline-block' }} /></span>
            <span title="Done"        style={{ width: 18, display: 'flex', justifyContent: 'center' }}><span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: groupColors.done, display: 'inline-block' }} /></span>
            <span style={{ width: 22, textAlign: 'right' as const }}>Tot</span>
          </div>
        </div>
      )}

      <div style={s.list}>
        {loading && <p style={s.muted}>Loading…</p>}
        {error   && <p style={s.muted}>Failed to load: {error}</p>}
        {!loading && raisers.length === 0 && !error && (
          <p style={s.muted}>No creator data for this sprint.</p>
        )}
        {!loading && raisers.map((r, i) => (
          <RaiserRow
            key={r.id}
            raiser={r}
            rank={i + 1}
            onClick={() => onUserClick(r.id, r.name)}
          />
        ))}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: {
    backgroundColor: C.surface1, border: `1px solid ${C.hairline}`,
    borderRadius: R.lg, padding: '24px',
    display: 'flex', flexDirection: 'column', gap: 10,
    gridColumn: 'span 2',
  },
  headerRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  label: {
    margin: 0, fontSize: 13, fontWeight: 500,
    color: C.inkTertiary, textTransform: 'uppercase', letterSpacing: '0.4px',
    fontFamily: font.text,
  },
  sub:   { margin: '2px 0 0', fontSize: 12, color: C.inkTertiary, fontFamily: font.text },
  badge: {
    fontSize: 12, fontWeight: 400, padding: '2px 8px',
    borderRadius: R.pill, border: `1px solid ${C.success}44`,
    color: C.success, backgroundColor: `${C.success}11`, flexShrink: 0,
    fontFamily: font.text,
  },
  list: { display: 'flex', flexDirection: 'column' },
  muted: { margin: 0, color: C.inkTertiary, fontSize: 14, fontFamily: font.text },
};
