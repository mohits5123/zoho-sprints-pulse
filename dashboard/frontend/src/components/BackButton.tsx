import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { C, R, font } from '../theme';

export function BackButton({ label = 'Back' }: { label?: string }) {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  return (
    <button
      style={{
        ...s.back,
        backgroundColor: pressed ? C.primaryFocus : hovered ? C.surface2 : C.surface1,
        borderColor: hovered ? C.hairlineStrong : C.hairline,
      }}
      onClick={() => navigate(-1)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false); }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
    >
      <ArrowLeft size={16} strokeWidth={1.5} color={C.inkMuted} />
      {label}
    </button>
  );
}

const s: Record<string, React.CSSProperties> = {
  back: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.surface1,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.md,
    padding: '8px 14px',
    color: C.inkMuted,
    fontSize: 14,
    fontWeight: 500,
    lineHeight: 1.2,
    letterSpacing: 0,
    fontFamily: font.text,
    cursor: 'pointer',
    userSelect: 'none' as const,
    transition: 'background-color 0.15s, border-color 0.15s',
  },
};
