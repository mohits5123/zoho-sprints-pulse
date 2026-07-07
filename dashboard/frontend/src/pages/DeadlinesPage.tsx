import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar } from 'lucide-react';
import { fetchCombinedDeadlines, type CombinedDeadline } from '../api/client';
import { BackButton } from '../components/BackButton';
import { C, R, font } from '../theme';

export function DeadlinesPage() {
  const navigate = useNavigate();
  const [deadlines, setDeadlines] = useState<CombinedDeadline[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDeadlines = useCallback(async () => {
    try {
      const { deadlines: data } = await fetchCombinedDeadlines();
      const sorted = [...data].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
      setDeadlines(sorted);
    } catch (err) {
      console.error('Failed to load deadlines:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDeadlines();
    const interval = setInterval(loadDeadlines, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadDeadlines]);

  const formatDueDate = (dueDate: string) => {
    const now = new Date();
    const due = new Date(dueDate);
    const diffMs = due.getTime() - now.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffMs < 0) {
      const pastDays = Math.abs(diffDays);
      if (pastDays === 0) return 'today';
      if (pastDays === 1) return 'yesterday';
      return `${pastDays}d ago`;
    }
    if (diffHours < 1) return 'in <1h';
    if (diffHours < 24) return `in ${Math.ceil(diffHours)}h`;
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'tomorrow';
    return `in ${diffDays}d`;
  };

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headerLeft}>
          <BackButton />
          <h1 style={s.title}>
            <Calendar size={24} strokeWidth={1.5} color={C.inkSubtle} style={{ verticalAlign: 'middle', marginRight: 8 }} />
            Deadlines
          </h1>
        </div>
      </header>

      <div style={s.content}>
        <div style={s.card}>
          {loading ? (
            <p style={s.placeholder}>Loading deadlines...</p>
          ) : deadlines.length === 0 ? (
            <p style={s.placeholder}>No deadlines set. Add a deadline to a note to see it here.</p>
          ) : (
            <div style={s.list}>
              {deadlines.map(dl => (
                <div
                  key={`${dl.source}-${dl.id}`}
                  style={{
                    ...s.item,
                    ...(dl.isOverdue ? s.itemOverdue : {}),
                  }}
                  onClick={() => {
                    if (dl.source === 'note' && dl.noteId) navigate(`/notes/${dl.noteId}`);
                  }}
                >
                  <div style={s.itemLeft}>
                    {dl.isOverdue && <span style={s.alert}>!</span>}
                    <span style={s.itemTitle}>{dl.title}</span>
                    <span style={s.itemSource}>{dl.source === 'note' ? 'Note' : 'Deadline'}</span>
                  </div>
                  <span style={{
                    ...s.itemDue,
                    ...(dl.isOverdue ? { color: C.danger } : {}),
                  }}>
                    Due: {formatDueDate(dl.dueDate)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    backgroundColor: C.canvas,
    color: C.inkMuted,
    padding: '0 24px 48px',
    fontFamily: font.text,
  },
  header: {
    padding: '32px 0 24px',
    borderBottom: `1px solid ${C.hairline}`,
    marginBottom: 24,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 20,
  },
  title: {
    margin: 0,
    fontSize: 28,
    fontWeight: 700,
    color: C.inkMuted,
    fontFamily: font.display,
    letterSpacing: '-0.6px',
    display: 'flex',
    alignItems: 'center',
  },
  content: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 24,
  },
  card: {
    backgroundColor: C.surface1,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.lg,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  placeholder: {
    color: C.inkTertiary,
    fontSize: 14,
    textAlign: 'center' as const,
    padding: '48px 0',
    fontFamily: font.text,
  },
  list: {
    display: 'flex',
    flexDirection: 'column' as const,
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: `1px solid ${C.hairline}`,
    cursor: 'pointer',
    transition: 'background-color 0.1s',
  },
  itemOverdue: {
    borderLeft: `3px solid ${C.danger}`,
    backgroundColor: `${C.danger}08`,
  },
  itemLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  alert: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 18,
    height: 18,
    borderRadius: R.pill,
    backgroundColor: C.danger,
    color: '#fff',
    fontSize: 11,
    fontWeight: 700,
    flexShrink: 0,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: 500,
    color: C.inkMuted,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  itemSource: {
    fontSize: 10,
    fontWeight: 600,
    color: C.inkTertiary,
    backgroundColor: C.surface2,
    padding: '2px 6px',
    borderRadius: R.sm,
    flexShrink: 0,
    textTransform: 'uppercase' as const,
  },
  itemDue: {
    fontSize: 13,
    color: C.inkSubtle,
    flexShrink: 0,
    marginLeft: 12,
    fontFamily: font.text,
  },
};
