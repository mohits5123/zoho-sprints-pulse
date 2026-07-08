import { useCallback, useEffect, useState } from 'react';
import { Calendar, Plus } from 'lucide-react';
import { fetchCombinedDeadlines, deleteDeadlineGroup, fetchAppConfig, type CombinedDeadline } from '../api/client';
import { BackButton } from '../components/BackButton';
import { CreateDeadlineModal } from '../components/CreateDeadlineModal';
import { DeadlineRow } from '../components/DeadlineRow';
import { C, R, font } from '../theme';

export function DeadlinesPage() {
  const [deadlines, setDeadlines] = useState<CombinedDeadline[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [workspaceName, setWorkspaceName] = useState('');

  useEffect(() => {
    fetchAppConfig().then(({ workspaceName: wn }) => setWorkspaceName(wn)).catch(() => {});
  }, []);

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

  const handleDelete = useCallback(async (groupId: string) => {
    if (!confirm('Delete this deadline and all its sub-items?')) return;
    try {
      await deleteDeadlineGroup(groupId);
      await loadDeadlines();
    } catch (err) {
      console.error('Failed to delete deadline:', err);
    }
  }, [loadDeadlines]);

  const toggleExpand = useCallback((groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  }, []);

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
        <button style={s.createBtn} onClick={() => setShowCreateModal(true)}>
          <Plus size={16} strokeWidth={1.5} color={C.inkMuted} />
          Create Deadline
        </button>
      </header>

      {showCreateModal && (
        <CreateDeadlineModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => loadDeadlines()}
        />
      )}

      <div style={s.content}>
        <div style={s.card}>
          {loading ? (
            <p style={s.placeholder}>Loading deadlines...</p>
          ) : deadlines.length === 0 ? (
            <p style={s.placeholder}>No deadlines set. Create a deadline to get started.</p>
          ) : (
            <div style={s.list}>
              {deadlines.map(dl => (
                <DeadlineRow
                  key={dl.id}
                  deadline={dl}
                  workspaceName={workspaceName}
                  isExpanded={expandedGroups.has(dl.id)}
                  onToggleExpand={() => toggleExpand(dl.id)}
                  onDelete={() => handleDelete(dl.id)}
                />
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
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  createBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 14px',
    borderRadius: R.md,
    backgroundColor: C.primary,
    border: 'none',
    color: C.inkMuted,
    fontSize: 14,
    fontWeight: 500,
    fontFamily: font.text,
    cursor: 'pointer',
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
};
