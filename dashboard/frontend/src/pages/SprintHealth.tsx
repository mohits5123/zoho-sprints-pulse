import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchSprints, syncSprints, fetchSyncStatus, SprintSnapshot } from '../api/client';
import { SprintCard } from '../components/SprintCard';
import { LastSyncedFooter } from '../components/LastSyncedFooter';

export function SprintHealth() {
  const navigate = useNavigate();
  const [sprints, setSprints]   = useState<SprintSnapshot[]>([]);
  const [loading, setLoading]   = useState(true);
  const [syncing, setSyncing]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchSprints()
      .then((d) => setSprints(d.sprints))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    fetchSyncStatus().then(({ lastSyncedAt: ts }) => setLastSyncedAt(ts)).catch(() => {});
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function handleSync() {
    setSyncing(true);
    setError(null);
    const prevSyncedAt = lastSyncedAt;
    try {
      // Sync starts in background on server — returns immediately
      await syncSprints();
      // Poll every 5s until lastSyncedAt changes, then re-fetch sprints
      pollRef.current = setInterval(async () => {
        try {
          const { lastSyncedAt: ts } = await fetchSyncStatus();
          if (ts && ts !== prevSyncedAt) {
            clearInterval(pollRef.current!);
            pollRef.current = null;
            const updated = await fetchSprints();
            setSprints(updated.sprints);
            setLastSyncedAt(ts);
            setSyncing(false);
          }
        } catch { /* keep polling */ }
      }, 5_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
      setSyncing(false);
    }
  }

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headerLeft}>
          <button style={s.back} onClick={() => navigate('/')}>← Back</button>
          <div>
            <h1 style={s.title}>🏃 Sprint Health</h1>
            <p style={s.subtitle}>
              {sprints.length > 0
                ? `${sprints.length} scrum project${sprints.length !== 1 ? 's' : ''} · latest sprint data`
                : 'Current sprint status for all scrum projects'}
            </p>
          </div>
        </div>
        <button style={s.syncBtn} onClick={handleSync} disabled={syncing}>
          {syncing ? 'Syncing… (background)' : 'Sync'}
        </button>
      </header>

      {error && <p style={s.errorText}>{error}</p>}
      {loading && <p style={s.muted}>Loading sprint data…</p>}

      {!loading && sprints.length === 0 && !syncing && (
        <div style={s.empty}>
          <p style={s.emptyTitle}>No sprint data yet</p>
          <p style={s.muted}>Make sure your Zoho credentials are set in ~/.zshrc, then click <strong>Sync</strong>.</p>
          <button style={s.syncBtnLarge} onClick={handleSync} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync'}
          </button>
        </div>
      )}

      {!loading && sprints.length > 0 && (
        <div style={s.grid}>
          {sprints.map((sp) => <SprintCard key={sp.id} sprint={sp} />)}
        </div>
      )}
      <LastSyncedFooter lastSyncedAt={lastSyncedAt} />
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    padding: '0 24px 48px',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '32px 0 40px', borderBottom: '1px solid #1e293b', marginBottom: 32,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 20 },
  back: {
    backgroundColor: '#1e293b', border: '1px solid #334155',
    borderRadius: 8, padding: '7px 13px',
    color: '#94a3b8', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', userSelect: 'none' as const,
  },
  title:    { margin: 0, fontSize: 28, fontWeight: 700, color: '#f1f5f9' },
  subtitle: { margin: '4px 0 0', fontSize: 14, color: '#64748b' },
  syncBtn: {
    padding: '8px 20px', backgroundColor: '#3b82f6', color: '#fff',
    border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: 20,
  },
  empty: {
    maxWidth: 480, margin: '80px auto 0', textAlign: 'center' as const,
    display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center',
  },
  emptyTitle: { fontSize: 18, fontWeight: 600, color: '#e2e8f0', margin: 0 },
  syncBtnLarge: {
    marginTop: 8, padding: '12px 32px', backgroundColor: '#3b82f6',
    color: '#fff', border: 'none', borderRadius: 8,
    fontSize: 15, fontWeight: 600, cursor: 'pointer',
  },
  muted: { color: '#64748b', fontSize: 14, margin: 0 },
  errorText: { color: '#fca5a5', fontSize: 14, marginBottom: 16 },
};
