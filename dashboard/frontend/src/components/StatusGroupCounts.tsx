import { groupColors, font } from '../theme';

type StatusGroup = 'todo' | 'doing' | 'done';

interface StatusGroupCountsProps {
  counts: Record<StatusGroup, number>;
  groups?: StatusGroup[];
}

export function StatusGroupCounts({ counts, groups = ['todo', 'doing', 'done'] }: StatusGroupCountsProps) {
  return (
    <span style={s.counts}>
      {groups.map((g) => (
        <span key={g} style={{ ...s.count, color: groupColors[g] }}>
          {counts[g]}
        </span>
      ))}
    </span>
  );
}

const s: Record<string, React.CSSProperties> = {
  counts: { display: 'flex', gap: 5, flexShrink: 0 },
  count: { fontSize: 13, fontWeight: 600, fontFamily: font.text },
};
