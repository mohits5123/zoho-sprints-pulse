import { useNavigate } from 'react-router-dom';

export function BackButton({ label = 'Back' }: { label?: string }) {
  const navigate = useNavigate();

  return (
    <button style={s.back} onClick={() => navigate(-1)}>
      {label}
    </button>
  );
}

const s: Record<string, React.CSSProperties> = {
  back: {
    backgroundColor: '#1e293b', border: '1px solid #334155',
    borderRadius: 8, padding: '7px 13px',
    color: '#94a3b8', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', userSelect: 'none' as const,
  },
};
