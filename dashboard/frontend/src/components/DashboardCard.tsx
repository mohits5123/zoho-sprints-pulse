import { useState } from 'react';
import { C, R, font } from '../theme';

interface DashboardCardProps {
  title: string;
  subtitle?: string;
  count?: number | string;
  countLabel?: string;
  countColor?: string;
  accentColor?: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

export function DashboardCard({
  title,
  subtitle,
  count,
  countLabel,
  countColor = C.primary,
  accentColor,
  icon,
  children,
  onClick,
}: DashboardCardProps) {
  const [hovered, setHovered] = useState(false);
  const clickable = !!onClick;

  return (
    <div
      style={{
        ...s.card,
        cursor: clickable ? 'pointer' : 'default',
        borderColor: hovered && clickable
          ? C.hairlineStrong
          : accentColor
          ? `${accentColor}44`
          : C.hairline,
        backgroundColor: hovered && clickable ? C.surface2 : C.surface1,
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={s.header}>
        <div>
          <h2 style={s.title}>{title}</h2>
          {subtitle && <p style={s.subtitle}>{subtitle}</p>}
        </div>
        {icon && <div style={s.iconWrap}>{icon}</div>}
      </div>

      {count !== undefined && (
        <div style={s.countRow}>
          <span style={{ ...s.count, color: countColor }}>{count}</span>
          {countLabel && <span style={s.countLabel}>{countLabel}</span>}
        </div>
      )}

      {children}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: {
    backgroundColor: C.surface1,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.lg,
    padding: '24px 28px',
    display: 'flex',
    flexDirection: 'column',
    transition: 'background-color 0.15s, border-color 0.15s',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  iconWrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    borderRadius: R.md,
    backgroundColor: C.surface2,
    flexShrink: 0,
  },
  title: {
    margin: 0,
    fontSize: 16,
    fontWeight: 600,
    color: C.inkMuted,
    fontFamily: font.display,
  },
  subtitle: {
    margin: '4px 0 0',
    fontSize: 12,
    color: C.inkTertiary,
    fontFamily: font.text,
  },
  countRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  count: {
    fontSize: 32,
    fontWeight: 700,
    lineHeight: 1,
    fontFamily: font.display,
    letterSpacing: '-0.6px',
  },
  countLabel: {
    fontSize: 14,
    color: C.inkSubtle,
    fontFamily: font.text,
  },
};
