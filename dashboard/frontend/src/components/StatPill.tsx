import { C, font } from '../theme';

interface StatPillProps {
  value: number | string;
  label: string;
  color?: string;
}

export function StatPill({ value, label, color = C.inkSubtle }: StatPillProps) {
  return (
    <div style={s.container}>
      <span style={{ ...s.value, color }}>{value}</span>
      <span style={s.label}>{label}</span>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
  },
  value: {
    fontSize: 24,
    fontWeight: 800,
    lineHeight: 1,
    fontVariantNumeric: 'tabular-nums',
    fontFamily: font.display,
  },
  label: {
    fontSize: 10,
    color: C.inkTertiary,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    whiteSpace: 'nowrap',
    fontFamily: font.text,
  },
};
